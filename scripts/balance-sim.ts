// npm run sim: the economy balance simulator (spec §6, §17).
//
// It plays an "optimal-ish" active player for N hours using the REAL config and the REAL server
// systems (Economy, Gacha, ProgressionSystem) against an in-memory database, so XP, levels,
// stages, quests, the Hustle Path, potions, skills and crate rolls behave exactly like the game.
// Only the player's hands are modelled: how long a delivery or a car wash takes, how clean the
// car gets, and what they choose to buy. Stalls, homes and Ventures are modelled with the real
// shared formulas in sim/assets.ts (cooking yourself, hired cooks, rent, business income, and
// offline income between sessions). --jobs-only turns them off (the old jobs-only model).
//
//   npm run sim                        12 hours, 2-hour sessions (one per day), 20 runs
//   npm run sim -- --hours=30 --runs=10 --session=3 --budget=0.2 --cook=0.3 --verbose
//   npm run sim -- --jobs-only
//
// Then it prints time to each wealth stage vs the pacing targets, the Hustle Path timeline
// (is there always a next goal?), income by source, money sinks and inflation indicators.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  carwashPay, currentGoalIndex, deliveryPay, formatMoney, jobLevel, levelMult, netWorthSen, skillCostSen, skillLevel, skillLockReason,
  stageDef, type RandInt,
} from '@kh/shared';
import { loadConfig, type ServerConfig } from '../server/src/config/loadConfig';
import { openDatabase } from '../server/src/db/db';
import { createRepos } from '../server/src/db/repos';
import type { OnlinePlayer } from '../server/src/game/world';
import { Economy } from '../server/src/systems/economy/economy';
import { Gacha } from '../server/src/systems/gacha/gacha';
import { InventorySystem } from '../server/src/systems/inventory/inventory';
import { emptyProgress, ProgressionSystem } from '../server/src/systems/progression/progression';
import { log } from '../server/src/log';
import { AssetModel } from './sim/assets';

// The server logs every rare roll; thousands of simulated rolls would drown the report.
log.info = () => {};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------------ options
const arg = (name: string, def: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : def;
};
const OPTS = {
  hours: arg('hours', 12),
  /** Hours played per day (each session starts a new day: login reward + new quests). */
  session: arg('session', 2),
  runs: arg('runs', 20),
  seed: arg('seed', 1),
  /** Share of earnings the player spends on crates (for fun). */
  budget: arg('budget', 0.2),
  verbose: process.argv.includes('--verbose'),
  /** Jobs and crates only (no stall, homes or Ventures). */
  jobsOnly: process.argv.includes('--jobs-only'),
  /** Once you have a stall: share of your actions that are a 5-minute cooking shift. */
  cook: arg('cook', 0.3),
};

/** Pacing targets from spec §6 (hours of active play). */
const STAGE_TARGET_H: Record<number, number> = { 2: 20 / 60, 3: 2, 4: 8, 5: 25, 6: 60 };

// ------------------------------------------------------------------ the player's "hands"
/** Assumptions about a decent player (tweak if playtests say otherwise). */
const HANDS = {
  /** Seconds between jobs: walking to the board / car wash, reading, tapping. */
  jobOverheadSec: 14,
  /** Bicycle: average terrain multiplier (roads 1, sidewalks 0.6, paths 0.5). */
  bikeTerrain: 0.8,
  /** Delivery route vs straight line (the server pays on straight × 1.3 already). */
  routeFactor: 1.15,
  /** Share of car washes that come out 100% clean, and how long a wash takes. */
  perfectWashRate: 0.65,
  washSec: [34, 48] as [number, number],
  imperfectClean: [0.82, 0.96] as [number, number],
  /** Seconds for a ×1 / ×10 roll including the reveal. */
  rollSec: { 1: 6, 5: 9, 10: 10 } as Record<number, number>,
  /** A manifesting break of this many minutes every hour of play. */
  breakMinPerHour: 4,
};

// ------------------------------------------------------------------ helpers
function prng(seed: number): RandInt {
  let a = seed >>> 0;
  return (max: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max);
  };
}
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const fmtT = (sec: number) => {
  if (!Number.isFinite(sec)) return '—';
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const lpad = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

interface RunResult {
  stageAt: Record<number, number>;
  goalAt: Record<string, number>;
  levelAt: Record<string, number>;
  income2h: Record<string, number>;
  incomeAll: Record<string, number>;
  sinks: Record<string, number>;
  netWorthByHour: number[];
  finalLevel: number;
  finalNetWorth: number;
  jobRates: Record<'delivery' | 'carwash', { sen: number; sec: number; n: number }>;
  titles: number;
  jobs: number;
  rolls: number;
}

// ------------------------------------------------------------------ one simulated player
function simulate(cfg: ServerConfig, seed: number): RunResult {
  const rand = prng(seed);
  const r01 = () => rand(1_000_000) / 1_000_000;
  const between = ([a, b]: [number, number]) => a + (b - a) * r01();
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const id = repos.accounts.create(`sim${seed}`, 'x', false, { x: 0, y: 0 }, 0, cfg.economy.startingWalletSen);
  const p = {
    id, name: `sim${seed}`, scene: 'town', walletSen: cfg.economy.startingWalletSen, shards: 0, inventory: [], equipped: {}, cosmetics: {},
    index: new Set<string>(), pages: new Set<string>(), pity: {}, jobs: {}, job: null, vehicle: null, skills: {}, manifestBank: 0,
    manifestSecs: 0, hotbar: [], rideQuote: null, ride: null, prog: emptyProgress(),
  } as unknown as OnlinePlayer;

  // Ledger: every wallet change is tagged by where it came from.
  const income2h: Record<string, number> = {};
  const incomeAll: Record<string, number> = {};
  const sinks: Record<string, number> = {};
  let t = 0; // seconds of play
  let day = 0;
  let sessionStart = 0;
  const base = new Date(2026, 0, 5, 9).getTime();
  const clock = () => base + day * 86_400_000 + (t - sessionStart) * 1000;
  const book = (src: string, sen: number) => {
    if (sen > 0) {
      incomeAll[src] = (incomeAll[src] ?? 0) + sen;
      if (t <= 7200) income2h[src] = (income2h[src] ?? 0) + sen;
    } else if (sen < 0) sinks[src] = (sinks[src] ?? 0) - sen;
  };

  const econ = new Economy(repos, cfg);
  const gacha = new Gacha(repos, cfg, econ, rand);
  const inv = new InventorySystem(cfg, econ);
  let assets: AssetModel | null = null;
  const prog = new ProgressionSystem(cfg, repos, econ, rand, {
    assetsOf: () => assets?.value() ?? 0,
    wallet: (_p, delta, reason) => book(reason === 'skill' ? 'skills' : reason === 'reward' || reason === 'daily' || reason === 'quest' ? `rewards (${reason === 'reward' ? 'levels/goals/stages' : reason})` : reason, delta),
    items: () => {},
    progress: () => {},
    publicChanged: () => {},
    announce: () => {},
    freeRoll: (pl, crateId) => ({ crateId, results: gacha.roll(pl, crateId, 1, { ...rollMods(crateId), free: true }).results }),
  }, clock);
  prog.load(p);
  if (!OPTS.jobsOnly) assets = new AssetModel(cfg, p, econ, prog, book);
  const rollMods = (crateId: string) => {
    const m = prog.mods(p);
    return { luck: m.luck, variantChance: m.variantChance, pity: prog.crateFor(p, cfg.crateById.get(crateId)!).pity };
  };

  const stageAt: Record<number, number> = { 1: 0 };
  const goalAt: Record<string, number> = {};
  const levelAt: Record<string, number> = {};
  const netWorthByHour: number[] = [];
  const record = () => {
    for (let s = 1; s <= p.prog.stage; s++) if (stageAt[s] === undefined) stageAt[s] = t;
    for (const g of p.prog.goalsDone) if (goalAt[g] === undefined) goalAt[g] = t;
  };

  // --- what the player does ---
  const bikeMps = (cfg.vehicles.vehicles.bicycle.speed / cfg.map.tileSize) * cfg.map.metersPerTile;
  const jobProg = (kind: string) => p.jobs[kind] ?? { level: 1, done: 0 };
  const jobRates: RunResult['jobRates'] = { delivery: { sen: 0, sec: 0, n: 0 }, carwash: { sen: 0, sec: 0, n: 0 } };
  const payJob = (kind: 'delivery' | 'carwash', paySen: number, perfect: boolean) => {
    const before = jobProg(kind);
    const done = before.done + (paySen > 0 ? 1 : 0);
    econ.run(p, () => {
      if (paySen > 0) econ.change(p, paySen, 0, `job-${kind}`);
      p.jobs = { ...p.jobs, [kind]: { level: jobLevel(cfg.jobs, done), done } };
      econ.saveState(p);
    });
    book(`job: ${kind}`, paySen);
    prog.onJob(p, kind, paySen, perfect);
  };
  const doDelivery = () => {
    const d = cfg.jobs.delivery;
    const straight = d.minMeters + (d.maxMeters - d.minMeters) * r01();
    const meters = Math.round(straight * 1.3);
    const toPickup = 30 + 230 * r01();
    const speed = bikeMps * HANDS.bikeTerrain;
    const rideSec = (meters * HANDS.routeFactor) / 1.3 / speed;
    const budgetMs = (meters / bikeMps) * d.timeBudgetFactor * 1000 + d.timeBudgetSlackSec * 1000;
    const raw = deliveryPay(cfg.jobs, meters, jobProg('delivery').level, rideSec * 1000 + 3000, budgetMs);
    const mult = prog.mods(p).jobPay;
    const sec = HANDS.jobOverheadSec + toPickup / speed + rideSec;
    const pay = Math.round(raw.paySen * mult) + Math.round(raw.tipSen * mult);
    t += sec;
    Object.assign(jobRates.delivery, { sen: jobRates.delivery.sen + pay, sec: jobRates.delivery.sec + sec, n: jobRates.delivery.n + 1 });
    payJob('delivery', pay, false);
  };
  const doCarwash = () => {
    const perfect = r01() < HANDS.perfectWashRate;
    const sec = between(HANDS.washSec);
    const cleaned = perfect ? 1 : between(HANDS.imperfectClean);
    const pay = Math.round(carwashPay(cfg.jobs, cleaned, sec * 1000, jobProg('carwash').level) * prog.mods(p).jobPay);
    t += HANDS.jobOverheadSec + sec;
    Object.assign(jobRates.carwash, { sen: jobRates.carwash.sen + pay, sec: jobRates.carwash.sec + HANDS.jobOverheadSec + sec, n: jobRates.carwash.n + 1 });
    payJob('carwash', pay, perfect);
  };
  /** Expected RM per second of each job right now (the player knows roughly). */
  const jobRate = (kind: 'delivery' | 'carwash') => {
    if (kind === 'delivery') {
      const d = cfg.jobs.delivery;
      const meters = ((d.minMeters + d.maxMeters) / 2) * 1.3;
      const sec = HANDS.jobOverheadSec + 145 / (bikeMps * HANDS.bikeTerrain) + (meters * HANDS.routeFactor) / 1.3 / (bikeMps * HANDS.bikeTerrain);
      return ((d.baseSen + d.perMeterSen * meters) * levelMult(cfg.jobs, jobProg('delivery').level) * 1.25) / sec;
    }
    const sec = HANDS.jobOverheadSec + (HANDS.washSec[0] + HANDS.washSec[1]) / 2;
    return (cfg.jobs.carwash.baseSen * 1.1 * levelMult(cfg.jobs, jobProg('carwash').level)) / sec;
  };

  /** Skills worth buying, and how much of the wallet the player will spend on each. */
  const SKILL_POLICY: Array<[string, number]> = [
    ['hustle_harder', 0.4], ['fast_learner', 0.2], ['elbow_grease', 0.1], ['manifest', 0.08], ['passive_income', 0.05],
    ['lucky_charm', 0.1], ['shiny_sense', 0.05], ['potion_brewer', 0.05], ['pity_pact', 0.05],
    ['fast_hands', 0.04], ['auto_roll', 0.04], ['kaki_lari', 0.04],
    ...(OPTS.jobsOnly ? [] : ([['secret_recipe', 0.1], ['kaki_promo', 0.08], ['good_boss', 0.05], ['prime_landlord', 0.08], ['kerb_appeal', 0.05]] as Array<[string, number]>)),
  ];
  const buySkills = () => {
    // The Hustle Path asks for a skill level: buy it if it's affordable.
    const goal = cfg.goals.goals[currentGoalIndex(cfg.goals, p.prog.goalsDone)];
    if (goal?.cond.type === 'skill') {
      const def = cfg.upgrades.skills[goal.cond.id];
      const lv = skillLevel(cfg.upgrades, p.skills, goal.cond.id);
      if (!skillLockReason(def, lv, p.prog.level, p.prog.stage, cfg.stages) && skillCostSen(def, lv) <= p.walletSen * 0.6) prog.upgradeSkill(p, goal.cond.id);
    }
    for (let guard = 0; guard < 20; guard++) {
      let bought = false;
      for (const [sid, share] of SKILL_POLICY) {
        const def = cfg.upgrades.skills[sid];
        const lv = skillLevel(cfg.upgrades, p.skills, sid);
        if (skillLockReason(def, lv, p.prog.level, p.prog.stage, cfg.stages)) continue;
        const cost = skillCostSen(def, lv);
        if (cost > p.walletSen * share) continue;
        prog.upgradeSkill(p, sid); // books the cost through the wallet hook ('skill')
        bought = true;
      }
      if (!bought) break;
    }
  };

  const usePotions = (kinds: string[]) => {
    for (const it of [...p.inventory]) {
      const def = cfg.itemById.get(it.itemId);
      if (!def?.effect || !kinds.includes(def.effect.buff)) continue;
      if (p.prog.buffs.some((b) => b.item === def.id && b.until > clock())) continue;
      prog.useItem(p, it.iid);
    }
  };

  let crateBudget = 0;
  let equipped = false;
  const rollCrates = () => {
    // The player saves their fun budget for the best crate they're allowed (×10 if it stretches
    // that far). If the Hustle Path asks for a crate, they roll that one once, budget or not.
    const goal = cfg.goals.goals[currentGoalIndex(cfg.goals, p.prog.goalsDone)];
    const goalCrate = goal?.cond.type === 'stat' && goal.cond.stat.startsWith('rolls') ? (goal.cond.stat.split('_')[1] ?? 'capsule') : null;
    const best = [...cfg.crates.crates].filter((c) => !prog.crateLock(p, c)).sort((a, b) => b.priceSen - a.priceSen)[0];
    const forced = goalCrate ? cfg.crateById.get(goalCrate) : undefined;
    const pick = forced && !prog.crateLock(p, forced) && p.walletSen >= forced.priceSen * 2 ? forced : best;
    for (const c of pick ? [pick] : []) {
      const count = crateBudget >= c.priceSen * 10 ? 10 : crateBudget >= c.priceSen || c === forced ? 1 : 0;
      if (!count || p.walletSen < c.priceSen * count) continue;
      usePotions(['luck']);
      const batch = gacha.roll(p, c.id, count, rollMods(c.id));
      book('crates', -c.priceSen * count);
      if (batch.pageReward) book('index page', batch.pageReward.sen);
      prog.onRolls(p, c, batch.results, c.priceSen * count);
      crateBudget = Math.max(0, crateBudget - c.priceSen * count);
      t += HANDS.rollSec[count] ?? 8;
      if (!equipped && batch.results.some((r) => ['hat', 'face', 'aura', 'back', 'namecolor'].includes(cfg.itemById.get(r.itemId)!.type))) {
        equipped = true;
        prog.onEquip(p);
      }
      // Keep one of each item; pawn the duplicates.
      const seen = new Set<string>();
      const sell = new Map<string, { itemId: string; variant: string; n: number }>();
      for (const it of p.inventory) {
        const def = cfg.itemById.get(it.itemId)!;
        if (def.effect || it.serial !== null) continue;
        if (!seen.has(it.itemId)) {
          seen.add(it.itemId);
          continue;
        }
        const k = `${it.itemId}|${it.variant}`;
        sell.set(k, { itemId: it.itemId, variant: it.variant, n: (sell.get(k)?.n ?? 0) + 1 });
      }
      let sold = 0;
      for (const s of sell.values()) {
        const r = inv.sell(p, s.itemId, s.variant, s.n);
        book('pawn shop', r.gainedSen);
        sold += r.removed.length;
      }
      if (sold) prog.onSell(p, sold);
      t += 4;
      return true;
    }
    return false;
  };

  const claimQuests = () => {
    for (const q of p.prog.quests.list) {
      try {
        prog.claimQuest(p, q.id);
      } catch {
        /* not done yet */
      }
    }
  };

  const wearTitle = () => {
    if (p.prog.title) return;
    const best = p.prog.titles.filter((x) => x !== 'budak_baru');
    if (best.length) prog.equipTitle(p, best[0]);
  };

  // --- the main loop ---
  const END = OPTS.hours * 3600;
  const SESSION = OPTS.session * 3600;
  let nextBreak = 3600 - HANDS.breakMinPerHour * 60;
  const checkpoints = [20 * 60, 3600, 7200, 4 * 3600, 8 * 3600, 12 * 3600];
  let nextHour = 3600;
  // Day 1: claim the login reward first thing.
  const startDay = () => {
    prog.check(p);
    try {
      prog.claimDaily(p);
    } catch {
      /* already */
    }
  };
  startDay();
  while (t < END) {
    if (t - sessionStart >= SESSION) {
      // Log off; next session is tomorrow (buff timers pause while offline).
      prog.save(p);
      assets?.offline((24 - OPTS.session) * 3600); // away until tomorrow's session
      day++;
      sessionStart = t;
      prog.load(p);
      startDay();
    }
    const walletBefore = p.walletSen;
    const tBefore = t;
    let cooked = false;
    claimQuests();
    wearTitle();
    buySkills();
    assets?.invest();
    usePotions(['jobPay', 'xp']);
    if (t >= nextBreak) {
      // A short manifesting break (also covers the "manifest N minutes" quest).
      usePotions(['passive']);
      const secs = HANDS.breakMinPerHour * 60;
      const sen = Math.floor(prog.manifestRate(p) * secs);
      if (sen > 0) {
        econ.run(p, () => econ.change(p, sen, 0, 'manifest', `${secs}s`));
        book('manifest', sen);
      }
      prog.onManifest(p, secs);
      t += secs;
      nextBreak += 3600;
      continue;
    }
    if (assets?.stall && r01() < OPTS.cook) {
      // A cooking shift at your stall (your cooks help; they also work while you do other things).
      assets.cook(300);
      t += 300;
      cooked = true;
      crateBudget += Math.max(0, p.walletSen - walletBefore) * OPTS.budget;
    } else if (!rollCrates()) {
      // Quests decide the job when one asks for it; otherwise the better-paying one.
      const open = (stat: string) => p.prog.quests.list.some((q) => !q.claimed && cfg.quests.daily.find((d) => d.id === q.id)?.stat === stat);
      // Otherwise players mix the two jobs, favouring the one that pays better (∝ rate³).
      const goal = cfg.goals.goals[currentGoalIndex(cfg.goals, p.prog.goalsDone)];
      const goalWash = goal?.cond.type === 'stat' && (goal.cond.stat === 'perfectWashes' || goal.cond.stat === 'jobs_carwash');
      const rd = jobRate('delivery') ** 3, rc = jobRate('carwash') ** 3;
      const kind = open('jobs_delivery') ? 'delivery' : open('jobs_carwash') || open('perfectWashes') || goalWash ? 'carwash' : r01() < rd / (rd + rc) ? 'delivery' : 'carwash';
      if (kind === 'delivery') doDelivery();
      else doCarwash();
      // A share of what the job paid goes into the fun (crate) budget.
      crateBudget += Math.max(0, p.walletSen - walletBefore) * OPTS.budget;
    }
    // Everything you own keeps earning while you work (cooking shifts count their own).
    if (assets && t > tBefore && !cooked) assets.tick(t - tBefore);
    if (assets) prog.check(p);
    record();
    for (const c of checkpoints) if (t >= c && levelAt[c] === undefined) levelAt[c] = p.prog.level;
    while (t >= nextHour) {
      netWorthByHour.push(netWorthSen(cfg.prog, p.walletSen, p.inventory, assets?.value() ?? 0));
      nextHour += 3600;
    }
  }
  record();
  return {
    stageAt, goalAt, levelAt, income2h, incomeAll, sinks, netWorthByHour,
    jobRates, finalLevel: p.prog.level, finalNetWorth: netWorthSen(cfg.prog, p.walletSen, p.inventory, assets?.value() ?? 0), titles: p.prog.titles.length,
    jobs: p.prog.stats.jobs ?? 0, rolls: p.prog.stats.rolls ?? 0,
  };
}

// ------------------------------------------------------------------ report
function main() {
  const t0 = Date.now();
  const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
  console.log(`\nKota Hustle balance simulator: ${OPTS.runs} runs × ${OPTS.hours} h of play, ${OPTS.session} h sessions (one per day), ${Math.round(OPTS.budget * 100)}% of earnings spent on crates${OPTS.jobsOnly ? ', JOBS ONLY' : `, stall/homes/Ventures on (${Math.round(OPTS.cook * 100)}% cooking shifts)`}\n`);
  const runs: RunResult[] = [];
  for (let i = 0; i < OPTS.runs; i++) runs.push(simulate(cfg, OPTS.seed + i * 7919));

  // --- wealth stages vs targets ---
  console.log('WEALTH STAGES (median time to reach, active play)');
  console.log(`  ${pad('Stage', 22)}${lpad('Net worth', 12)}${lpad('Median', 12)}${lpad('Range', 22)}${lpad('Target', 10)}  Verdict`);
  const verdicts: string[] = [];
  for (const s of cfg.stages.stages) {
    if (s.n === 1) continue;
    const times = runs.map((r) => r.stageAt[s.n]).filter((x) => x !== undefined);
    const target = STAGE_TARGET_H[s.n] * 3600;
    const reached = times.length;
    const med = reached > OPTS.runs / 2 ? median(times) : Infinity;
    let verdict: string;
    if (Number.isFinite(med)) {
      const ratio = med / target;
      verdict = ratio >= 0.5 && ratio <= 1.5 ? '✅ on target' : ratio < 0.5 ? '⚠️ too fast' : OPTS.jobsOnly && s.n >= 3 ? '⏳ slow on jobs alone (expected: stalls, homes and Ventures carry this stage)' : '⚠️ too slow';
    } else if (OPTS.hours * 3600 < target * 0.5) verdict = '… beyond the simulated hours';
    else verdict = OPTS.jobsOnly && s.n >= 3 ? '⏳ needs Phase 4+ income (stalls, property, businesses)' : '⚠️ not reached';
    verdicts.push(`${s.n}: ${verdict.split(' ')[0]}`);
    const range = reached ? `${fmtT(Math.min(...times))} – ${fmtT(Math.max(...times))}` : '';
    console.log(`  ${pad(`${s.n}. ${s.name}`, 22)}${lpad(formatMoney(s.minNetWorthSen), 12)}${lpad(fmtT(med), 12)}${lpad(range, 22)}${lpad(fmtT(target), 10)}  ${verdict}${reached && reached < OPTS.runs ? ` (${reached}/${OPTS.runs} runs)` : ''}`);
  }

  // --- levels ---
  const cps: Array<[number, string]> = [[20 * 60, '20 min'], [3600, '1 h'], [7200, '2 h'], [4 * 3600, '4 h'], [8 * 3600, '8 h'], [12 * 3600, '12 h']];
  console.log('\nLEVEL (median)');
  console.log(`  ${cps.filter(([c]) => c <= OPTS.hours * 3600).map(([c, l]) => `${l}: Lv ${median(runs.map((r) => r.levelAt[c] ?? r.finalLevel))}`).join(' · ')}`);

  // --- the Hustle Path ---
  console.log('\nHUSTLE PATH (median time each goal is done; it should never leave you without a goal for long)');
  let prev = 0;
  let maxGap = 0;
  let doneIn2h = 0;
  for (const g of cfg.goals.goals) {
    const times = runs.map((r) => r.goalAt[g.id]).filter((x) => x !== undefined);
    const med = times.length > OPTS.runs / 2 ? median(times) : Infinity;
    if (Number.isFinite(med)) {
      if (med <= 7200) {
        doneIn2h++;
        maxGap = Math.max(maxGap, med - prev);
      }
      prev = med;
    }
    console.log(`  ${lpad(fmtT(med), 9)}  ${g.text}`);
  }
  const pathOk = maxGap <= 25 * 60 && doneIn2h >= 15;
  console.log(`  → ${doneIn2h}/${cfg.goals.goals.length} goals in the first 2 h, longest wait for the next goal ${fmtT(maxGap)}  ${pathOk ? '✅ a clear path' : '⚠️ gaps or too few goals'}`);

  // --- jobs ---
  const jr = runs.map((r) => r.jobRates);
  console.log('\nJOBS (average RM per minute while working, incl. walking between jobs)');
  for (const k of ['delivery', 'carwash'] as const) {
    const sen = jr.reduce((a, r) => a + r[k].sen, 0);
    const sec = jr.reduce((a, r) => a + r[k].sec, 0);
    const n = jr.reduce((a, r) => a + r[k].n, 0);
    console.log(`  ${pad(k, 10)} ${lpad(formatMoney(Math.round((sen / Math.max(1, sec)) * 60)), 10)}/min  ${lpad(formatMoney(Math.round(sen / Math.max(1, n))), 9)} a job  ${Math.round(n / runs.length)} jobs per player`);
  }

  // --- money ---
  const sumBy = (k: 'income2h' | 'incomeAll' | 'sinks') => {
    const out: Record<string, number> = {};
    for (const r of runs) for (const [s, v] of Object.entries(r[k])) out[s] = (out[s] ?? 0) + v / runs.length;
    return out;
  };
  const table = (title: string, rec: Record<string, number>) => {
    const total = Object.values(rec).reduce((a, b) => a + b, 0);
    console.log(`\n${title} (average per player, total ${formatMoney(Math.round(total))})`);
    for (const [k, v] of Object.entries(rec).sort((a, b) => b[1] - a[1])) console.log(`  ${pad(k, 34)}${lpad(formatMoney(Math.round(v)), 12)}  ${lpad(((v / Math.max(1, total)) * 100).toFixed(1), 5)}%`);
    return total;
  };
  table('INCOME, FIRST 2 HOURS', sumBy('income2h'));
  const inAll = table(`INCOME, ALL ${OPTS.hours} HOURS`, sumBy('incomeAll'));
  const outAll = table(`MONEY SINKS, ALL ${OPTS.hours} HOURS`, sumBy('sinks'));

  // --- inflation ---
  console.log('\nINFLATION INDICATORS');
  console.log(`  Sinks / income: ${((outAll / Math.max(1, inAll)) * 100).toFixed(0)}% of what players earn is spent back into the game`);
  const nw = runs[0].netWorthByHour.map((_, h) => median(runs.map((r) => r.netWorthByHour[h] ?? 0)));
  const growth = nw.map((v, i) => (i === 0 ? v : v - nw[i - 1]));
  console.log(`  Net worth by hour: ${nw.map((v, i) => `h${i + 1} ${formatMoney(Math.round(v))}`).join(' · ')}`);
  console.log(`  Net worth gained per hour: ${growth.map((v) => formatMoney(Math.round(v))).join(' → ')}`);
  console.log(`  At the end: Level ${median(runs.map((r) => r.finalLevel))}, ${median(runs.map((r) => r.jobs))} jobs, ${median(runs.map((r) => r.rolls))} rolls, ${median(runs.map((r) => r.titles))} titles, net worth ${formatMoney(Math.round(median(runs.map((r) => r.finalNetWorth))))} (${stageDef(cfg.stages, Math.max(...Object.keys(runs[0].stageAt).map(Number))).name})`);

  if (OPTS.verbose) for (const [i, r] of runs.entries()) console.log(`  run ${i + 1}: stages ${JSON.stringify(Object.fromEntries(Object.entries(r.stageAt).map(([k, v]) => [k, fmtT(v)])))}`);
  console.log(`\nVerdict: stages ${verdicts.join(' ')} · Hustle Path ${pathOk ? '✅' : '⚠️'} · (${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);
}

main();
