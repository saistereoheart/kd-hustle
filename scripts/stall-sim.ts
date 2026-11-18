// npm run sim:stall: Phase 4 acceptance check ("cooking Perfect clearly earns more than passive
// mode, and both feel worth doing"). Runs the REAL StallSystem (customers, queue, patience,
// combo, tips, blogger, reputation, staff, wages) through a whole pasar malam night with:
//   - an active player who cooks every dish flawlessly (perfect inputs),
//   - an active player with sloppy timing (inputs jittered, so a mix of grades),
//   - a hired cook while the owner is away doing jobs (passive mode),
// and compares RM per real hour with what jobs pay at the same stage.
//
//   npm run sim:stall -- --nights=5 --tier=1
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliveryPay, carwashPay, formatMoney, meterZoneAt, type RandInt, type StepInput, type StepParams } from '@kh/shared';
import { loadConfig } from '../server/src/config/loadConfig';
import { openDatabase } from '../server/src/db/db';
import { createRepos } from '../server/src/db/repos';
import { World, type OnlinePlayer } from '../server/src/game/world';
import { Economy } from '../server/src/systems/economy/economy';
import { emptyProgress, ProgressionSystem } from '../server/src/systems/progression/progression';
import { StallSystem } from '../server/src/systems/stalls/stalls';
import { log } from '../server/src/log';

log.info = () => {};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const arg = (name: string, def: number) => Number(process.argv.find((x) => x.startsWith(`--${name}=`))?.split('=')[1] ?? def);
const NIGHTS = arg('nights', 5);
const TIER = arg('tier', 1);
/** Seconds between dishes for an active player (walking the queue, tapping Cook). */
const OVERHEAD_MS = 2500;

function seeded(seed: number): RandInt {
  let a = seed >>> 0;
  return (max: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max);
  };
}

/** Inputs a player sends for a dish; `jitter` ms of timing error (0 = flawless). */
function inputs(steps: StepParams[], jitter: number, rand: RandInt): StepInput[] {
  const j = () => (jitter ? (rand(2001) / 1000 - 1) * jitter : 0);
  let start = 0;
  return steps.map((s) => {
    let ev: number[] = [];
    if (s.kind === 'hold') ev = [100, Math.max(120, 100 + ((s.zone[0] + s.zone[1]) / 2) * s.fillMs + j() * 2)];
    else if (s.kind === 'timing') ev = [Math.max(0, s.targetMs + j())];
    else if (s.kind === 'rhythm') ev = s.beats.map((b) => Math.max(0, b + j()));
    else if (s.kind === 'sequence') {
      const order = s.order.map((id) => s.options.findIndex((o) => o.id === id));
      if (jitter > 100 && rand(3) === 0 && order.length > 2) [order[0], order[1]] = [order[1], order[0]]; // a slip
      ev = order.flatMap((o, i) => [o, 300 * (i + 1)]);
    } else if (s.kind === 'path') {
      const skip = jitter > 100 && rand(4) === 0 ? 1 : -1;
      ev = s.points.flatMap(([x, y], i) => (i === skip ? [] : [x + j() / 4000, y + j() / 4000, 100 * (i + 1)]));
    } else if (s.kind === 'assemble') {
      // Tap the boxes the order needs, ~0.7 s each; a sloppy cook sometimes grabs a wrong box.
      const picks = s.want.map((id) => s.options.findIndex((o) => o.id === id));
      if (jitter > 100 && rand(3) === 0) picks.splice(1, 0, (picks[0] + 1) % s.options.length);
      ev = picks.flatMap((o, i) => [o, 700 * (i + 1) + Math.abs(j())]);
    } else if (s.kind === 'meter') {
      // Follow the (maybe moving) zone: hold while under its middle; a sloppy player aims off.
      const off = j() / 2000;
      let v = 0.15, holding = false;
      for (let t = 0; t < s.durationMs; t += 20) {
        const z = meterZoneAt(s, t);
        const want = v < (z[0] + z[1]) / 2 + off;
        if (want !== holding) {
          ev.push(t);
          holding = want;
        }
        v = Math.max(0, Math.min(1, v + ((holding ? s.rise : -s.fall) * 20) / 1000));
      }
      if (holding) ev.push(s.durationMs);
    }
    const inp = { startMs: start, ev };
    // How long the step really took: its last input + a beat to read the next one.
    const times = s.kind === 'sequence' || s.kind === 'assemble' ? ev.filter((_, i) => i % 2 === 1) : s.kind === 'path' ? ev.filter((_, i) => i % 3 === 2) : s.kind === 'meter' ? [s.durationMs] : ev;
    start += Math.min(s.maxMs, Math.max(...times, 0) + 500);
    return inp;
  });
}

/** Total time the inputs claim (what the server's clock must have moved by). */
const claimedMs = (inp: StepInput[], steps: StepParams[]) => {
  const last = inp[inp.length - 1];
  const s = steps[steps.length - 1];
  return last.startMs + Math.min(s.maxMs, 4000);
};

/** In-game hour → server ms on some day. */
const atHour = (hour: number, day: number) => ((hour * 60 - cfg.time.offsetGameMinutes + 1440 * 10) % 1440) * cfg.time.realMsPerGameMinute + 1440 * 1000 * (100 + day);

type Mode = 'perfect' | 'sloppy' | 'passive';
function night(mode: Mode, day: number, seed: number) {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const startWallet = 50_000_000;
  const id = repos.accounts.create('cook', 'h', false, { x: 0, y: 0 }, 2, startWallet);
  const T = cfg.map.tileSize;
  const p = {
    id, name: 'cook', scene: 'town', hasCharacter: true, x: 0, y: 0, walletSen: startWallet, shards: 0, inventory: [], equipped: {}, cosmetics: {},
    index: new Set<string>(), pages: new Set<string>(), pity: {}, jobs: {}, job: null, vehicle: null, skills: {}, manifestBank: 0, manifestSecs: 0,
    hotbar: [], rideQuote: null, ride: null, prog: emptyProgress(), errand: null, interior: null,
  } as unknown as OnlinePlayer;
  const world = new World();
  world.add(p);
  const tier = cfg.stalls.tiers.find((t) => t.tier === TIER)!;
  let now = atHour(tier.hours[0], day);
  const clock = () => now;
  const econ = new Economy(repos, cfg);
  const rand = seeded(seed);
  const prog = new ProgressionSystem(cfg, repos, econ, rand, {
    wallet: () => {}, items: () => {}, progress: () => {}, publicChanged: () => {}, announce: () => {}, freeRoll: () => ({ crateId: '', results: [] }),
  }, clock);
  prog.load(p);
  p.prog.stage = TIER === 3 ? 3 : 2;
  p.prog.level = 20;
  p.prog.goalsDone = cfg.goals.goals.map((g) => g.id);
  const stalls = new StallSystem(cfg, repos, econ, prog, world, rand, { publicChanged: () => {}, selfChanged: () => {}, event: () => {}, wallet: () => {} }, clock);
  for (let t = 1; t <= TIER; t++) stalls.buy(p, t);
  const me = stalls.selfOf(p)!;
  const plot = cfg.map.stallPlots.find((x) => x.id === me.plot)!;
  p.x = plot.x * T;
  p.y = (plot.y + 1) * T;
  for (let k = 0; k < 2; k++) stalls.buyStock(p, "nasi_lemak", 200, true);
  if (mode === 'passive') {
    stalls.hire(p);
    p.x += 200 * T; // the owner is off doing jobs
  }
  const afterSetup = p.walletSen;
  const hours = ((tier.hours[1] - tier.hours[0] + 24) % 24) || 24;
  const end = now + hours * 60 * cfg.time.realMsPerGameMinute;
  const tick = (ms: number) => {
    for (let t = 0; t < ms; t += 250) {
      now += 250;
      stalls.tick(now);
    }
  };
  const grades: Record<string, number> = {};
  let dishes = 0;
  tick(2000);
  while (now < end) {
    if (mode === 'passive') {
      tick(1000);
      continue;
    }
    const queue = stalls.all().find((s) => s.owner === p.id)?.queue ?? [];
    if (!queue.length) {
      tick(500);
      continue;
    }
    let dish;
    try {
      dish = stalls.cook(p, undefined, false).dish;
    } catch {
      tick(500);
      continue;
    }
    if (!dish) {
      tick(500);
      continue;
    }
    const inp = inputs(dish.steps, mode === 'perfect' ? 0 : 140, rand);
    tick(claimedMs(inp, dish.steps));
    try {
      const r = stalls.serve(p, dish.dishId, inp);
      grades[r.quality] = (grades[r.quality] ?? 0) + 1;
      dishes++;
    } catch {
      grades.lost = (grades.lost ?? 0) + 1; // the customer gave up / the stall closed mid-dish
    }
    tick(OVERHEAD_MS);
  }
  // Stock used is a real cost: value it at the in-person (Gergasi) price.
  const realMs = hours * 60 * cfg.time.realMsPerGameMinute;
  const stockLeft = stalls.selfOf(p)!.stock.nasi_lemak?.reduce((a, b) => a + b.qty, 0) ?? 0;
  const recipe = cfg.recipeById.get('nasi_lemak')!;
  const used = 400 + 10 - stockLeft;
  const stockCost = used * recipe.ingredientCostSen;
  const earned = p.walletSen - afterSetup - stockCost;
  db.close();
  return { earned, realMs, dishes: mode === 'passive' ? (p.prog.stats.staffDishes ?? 0) : dishes, grades };
}

const perHour = (sen: number, ms: number) => (sen / ms) * 3_600_000;
console.log(`\nStall sim: tier ${TIER} (${cfg.stalls.tiers.find((t) => t.tier === TIER)!.name}), ${NIGHTS} nights each\n`);
const rows: Array<[Mode, number]> = [];
for (const mode of ['perfect', 'sloppy', 'passive'] as Mode[]) {
  let sen = 0, ms = 0, dishes = 0;
  const grades: Record<string, number> = {};
  for (let n = 0; n < NIGHTS; n++) {
    const r = night(mode, n, 11 + n * 17);
    sen += r.earned;
    ms += r.realMs;
    dishes += r.dishes;
    for (const [k, v] of Object.entries(r.grades)) grades[k] = (grades[k] ?? 0) + v;
  }
  const rate = perHour(sen, ms);
  rows.push([mode, rate]);
  const g = Object.entries(grades).map(([k, v]) => `${k} ${Math.round((v / Math.max(1, dishes)) * 100)}%`).join(', ');
  console.log(`${mode.padEnd(8)} ${formatMoney(Math.round(rate)).padStart(10)} / real hour · ${Math.round(dishes / NIGHTS)} dishes a night${g ? ` · ${g}` : ''}`);
}
// Jobs at the same point in the game (job level 5, no skills), for comparison.
const j = cfg.jobs;
// A 400 m delivery (plus ~200 m to the pickup) on the bicycle, and a 40 s perfect car wash.
const bikeMps = (290 / cfg.map.tileSize) * cfg.map.metersPerTile * 0.8;
const deliveryMs = (600 / bikeMps) * 1.15 * 1000 + 14_000;
const dp = deliveryPay(j, 400, 5, deliveryMs * 0.7, deliveryMs);
const deliveryRate = perHour(dp.paySen + dp.tipSen, deliveryMs);
const washRate = perHour(carwashPay(j, 1, 40_000, 5), 54_000);
console.log(`jobs     ${formatMoney(Math.round(Math.max(deliveryRate, washRate))).padStart(10)} / real hour (best of delivery ${formatMoney(Math.round(deliveryRate))}, car wash ${formatMoney(Math.round(washRate))})`);
const [perfect, sloppy, passive] = rows.map((r) => r[1]);
console.log('');
console.log(perfect > passive * 1.5 ? `✅ Perfect cooking earns ${(perfect / passive).toFixed(1)}× passive mode` : `⚠️ Perfect cooking only earns ${(perfect / passive).toFixed(1)}× passive mode (want ≥ 1.5×)`);
console.log(sloppy > passive ? '✅ Even sloppy cooking beats passive mode' : '⚠️ Sloppy cooking earns less than a hired cook');
console.log(passive > 0 ? `✅ Passive mode makes money while you're away (${formatMoney(Math.round(passive))}/h on top of your jobs)` : '⚠️ Passive mode loses money (wages > sales)');
