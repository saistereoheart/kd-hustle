import { gearBonuses, gradeMult, type GradesConfig } from '../items/grades';
// Progression maths (Phase 3), shared by the server (which owns the real numbers) and the client
// (which shows progress bars, live odds and the next goal). Pure functions only.
//
// MULTIPLIERS
//   Bonuses from different systems combine the same way as luck (see luck.ts): within one source
//   type they multiply, across types they add. E.g. job pay with Hustle Harder Lv 4 (+20%) and a
//   Kopi Kaw (1.5×) = 1 + 0.2 + 0.5 = 1.7×. That keeps stacking fun without exploding.
//
// NET WORTH
//   cash + what your items would fetch at the pawn shop (− debt, from Phase 6). Using the pawn
//   price (not the full item value) means rolling crates can't inflate your net worth.
//
// WEALTH STAGE
//   The highest stage your net worth has reached. It never goes back down, so spending money on
//   crates or upgrades never costs you the things a stage unlocked.
import type { CratesConfig, CrateDef, ItemDef, ItemsConfig, RaritiesConfig, BuffKind } from '../economy/schemas';
import { isCollectible } from '../economy/schemas';
import { pawnPriceSen, totalLuck, type LuckSource, type LuckSourceType, type RandInt } from '../luck';
import type {
  Condition, GoalsConfig, LevelsConfig, QuestDef, QuestsConfig, Reward, SkillDef, SkillEffect, StagesConfig, TitlesConfig, UpgradesConfig,
} from './schemas';

/** Everything progression needs from the configs (the server and client both build one). */
export interface ProgCfg {
  rarities: RaritiesConfig;
  items: ItemsConfig;
  itemById: Map<string, ItemDef>;
  crates: CratesConfig;
  crateOfItem: Map<string, CrateDef>;
  pawnRate: number;
  levels: LevelsConfig;
  stages: StagesConfig;
  titles: TitlesConfig;
  upgrades: UpgradesConfig;
  quests: QuestsConfig;
  goals: GoalsConfig;
  grades: GradesConfig;
}

// ------------------------------------------------------------------ levels
/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(cfg: LevelsConfig, level: number): number {
  return Math.round(cfg.xpBase * Math.pow(Math.max(1, level), cfg.xpExponent));
}

const cumCache = new WeakMap<LevelsConfig, number[]>();
/** Total XP needed to reach each level (index = level; [1] = 0). */
function cumulative(cfg: LevelsConfig): number[] {
  let c = cumCache.get(cfg);
  if (!c) {
    c = [0, 0];
    for (let l = 1; l < cfg.maxLevel; l++) c.push(c[l] + xpToNext(cfg, l));
    cumCache.set(cfg, c);
  }
  return c;
}

export function totalXpForLevel(cfg: LevelsConfig, level: number): number {
  const c = cumulative(cfg);
  return c[Math.min(cfg.maxLevel, Math.max(1, level))];
}

/** Level from total XP, plus progress into the current level (for the XP bar). */
export function levelInfo(cfg: LevelsConfig, totalXp: number): { level: number; into: number; need: number; maxed: boolean } {
  const c = cumulative(cfg);
  let lo = 1, hi = cfg.maxLevel;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c[mid] <= totalXp) lo = mid;
    else hi = mid - 1;
  }
  if (lo >= cfg.maxLevel) return { level: cfg.maxLevel, into: 0, need: 0, maxed: true };
  return { level: lo, into: totalXp - c[lo], need: c[lo + 1] - c[lo], maxed: false };
}

/** Rewards for reaching `level` (RM + any milestone rewards). */
export function levelUpReward(cfg: LevelsConfig, level: number): Reward {
  const r: Reward = { sen: level * cfg.levelUpSenPerLevel, items: [] };
  for (const m of cfg.milestones) {
    if (level % m.every !== 0) continue;
    r.sen = (r.sen ?? 0) + (m.reward.sen ?? 0);
    r.shards = (r.shards ?? 0) + (m.reward.shards ?? 0);
    r.items = [...(r.items ?? []), ...(m.reward.items ?? [])];
  }
  return r;
}

// ------------------------------------------------------------------ net worth + stages
export function netWorthSen(cfg: Pick<ProgCfg, 'rarities' | 'itemById' | 'crateOfItem' | 'pawnRate'> & Partial<Pick<ProgCfg, 'grades'>>, walletSen: number, inventory: ReadonlyArray<{ itemId: string; variant: string; grade?: string }>, assetsSen = 0): number {
  let sum = walletSen + assetsSen;
  for (const i of inventory) {
    const def = cfg.itemById.get(i.itemId);
    if (def) sum += pawnPriceSen(cfg.rarities, def, cfg.crateOfItem.get(def.id), i.variant, cfg.pawnRate, cfg.grades ? gradeMult(cfg.grades, i.grade) : 1);
  }
  return sum;
}

/** The equipped items, as the gear-buff maths wants them (type, rarity, tier, variant). */
export function gearOf(
  cfg: Pick<ProgCfg, 'itemById'>,
  equipped: Partial<Record<string, number>>,
  inventory: ReadonlyArray<{ iid: number; itemId: string; variant: string; grade?: string }>,
): Array<{ type: string; rarity: string; grade?: string; variant: string }> {
  const out: Array<{ type: string; rarity: string; grade?: string; variant: string }> = [];
  for (const iid of Object.values(equipped)) {
    const inst = inventory.find((i) => i.iid === iid);
    const def = inst && cfg.itemById.get(inst.itemId);
    if (inst && def) out.push({ type: def.type, rarity: def.rarity, grade: inst.grade, variant: inst.variant });
  }
  return out;
}

/** The stage a net worth qualifies for (1 = Budak Baru). */
export function stageForNetWorth(cfg: StagesConfig, sen: number): number {
  let n = cfg.stages[0].n;
  for (const s of cfg.stages) if (sen >= s.minNetWorthSen) n = Math.max(n, s.n);
  return n;
}

export function stageDef(cfg: StagesConfig, n: number) {
  return cfg.stages.find((s) => s.n === n) ?? cfg.stages[0];
}

export function nextStage(cfg: StagesConfig, n: number) {
  return cfg.stages.find((s) => s.n === n + 1) ?? null;
}

// ------------------------------------------------------------------ skills (Hustle Skills tree)
export function skillLevel(cfg: UpgradesConfig, skills: Record<string, number>, id: string): number {
  const def = cfg.skills[id];
  if (!def) return 0;
  return Math.min(def.maxLevel, Math.max(def.startLevel, skills[id] ?? def.startLevel));
}

/** Cost to buy the next level (from `level` to `level + 1`). */
export function skillCostSen(def: SkillDef, level: number): number {
  return Math.round(def.baseCostSen * Math.pow(def.costGrowth, Math.max(0, level - def.startLevel)));
}

/** Why a skill can't be bought right now (ignoring money), or null if it can. */
export function skillLockReason(def: SkillDef, level: number, playerLevel: number, stage: number, stages: StagesConfig): string | null {
  if (level >= def.maxLevel) return 'Maxed out';
  if (def.requires.level && playerLevel < def.requires.level) return `Needs Level ${def.requires.level}`;
  if (def.requires.stage && stage < def.requires.stage) return `Needs ${stageDef(stages, def.requires.stage).name} (stage ${def.requires.stage})`;
  return null;
}

/** Total value of every skill with this effect: base + perLevel × levels bought. */
export function skillValue(cfg: UpgradesConfig, skills: Record<string, number>, kind: SkillEffect): number {
  let v = 0;
  for (const [id, def] of Object.entries(cfg.skills)) {
    if (def.effect.kind !== kind) continue;
    const lv = skillLevel(cfg, skills, id);
    v += def.effect.base + def.effect.perLevel * (lv - def.startLevel);
  }
  return v;
}

/** Manifesting earnings per second (sen) at the current skill level, before multipliers. */
export function manifestRateSen(cfg: UpgradesConfig, skills: Record<string, number>): number {
  return skillValue(cfg, skills, 'manifestRate');
}

// ------------------------------------------------------------------ buffs + multipliers
export interface ActiveBuff {
  item: string;
  kind: BuffKind;
  mult: number;
  /** Time left (ms). The server keeps an absolute expiry while you're online. */
  leftMs: number;
}

export interface Mods {
  /** Total crate luck, and where it comes from (shown on the crate screen). */
  luck: number;
  luckSources: LuckSource[];
  /** Shiny/Golden/Rainbow chance multiplier. */
  variantChance: number;
  /** Pity thresholds × this (e.g. 0.88 = pity comes 12% sooner). */
  pityMult: number;
  potionDuration: number;
  xp: number;
  jobPay: number;
  passive: number;
  walk: number;
  carwashExtraSec: number;
  rollSpeed: number;
  autoRoll: boolean;
  /** Stall bonuses (Business skills + Customer Rush / Speed Tonic). */
  stall: { dishPrice: number; customers: number; wages: number; customerBuff: number; staffSpeedBuff: number };
  /** Property skills (Passive Income counts for rent and Airbnb too). All multipliers. */
  property: { rent: number; airbnb: number; cleanLoss: number; appeal: number };
}

/** Combines multipliers: multiply within a source type, add across types (like luck, no cap). */
export function combineMults(sources: Array<{ type: string; mult: number }>): number {
  return totalLuck(sources.map((s) => ({ type: s.type as LuckSourceType, mult: s.mult })), Number.MAX_SAFE_INTEGER);
}

export function computeMods(
  cfg: Pick<ProgCfg, 'upgrades' | 'titles' | 'rarities'> & Partial<Pick<ProgCfg, 'grades'>>,
  state: { skills: Record<string, number>; title: string | null; buffs: ReadonlyArray<ActiveBuff>; gear?: ReadonlyArray<{ type: string; rarity: string; grade?: string; variant: string }> },
): Mods {
  // Equipped items: each slot boosts one stat (rarity × tier × variant).
  const gear = cfg.grades && state.gear ? gearBonuses(cfg.grades, state.gear) : {};
  const sv = (k: SkillEffect) => skillValue(cfg.upgrades, state.skills, k);
  const title = state.title ? cfg.titles.titles.find((t) => t.id === state.title) : undefined;
  const buffs = (kind: BuffKind) => state.buffs.filter((b) => b.kind === kind && b.leftMs > 0);
  const mult = (skill: SkillEffect, buff: BuffKind, titleBonus: number | undefined, gearBonus = 0) =>
    combineMults([
      { type: 'upgrade', mult: 1 + sv(skill) },
      ...buffs(buff).map((b) => ({ type: 'potion', mult: b.mult })),
      ...(titleBonus ? [{ type: 'title', mult: titleBonus }] : []),
      ...(gearBonus ? [{ type: 'gear', mult: 1 + gearBonus }] : []),
    ]);

  const luckSources: LuckSource[] = [];
  const luckSkill = sv('luck');
  if (luckSkill > 0) luckSources.push({ type: 'upgrade', mult: 1 + luckSkill, label: 'Lucky Charm' });
  for (const b of buffs('luck')) luckSources.push({ type: 'potion', mult: b.mult, label: b.item });
  if (title?.bonus?.luck) luckSources.push({ type: 'title', mult: title.bonus.luck, label: title.name });
  if (gear.luck) luckSources.push({ type: 'gear', mult: 1 + gear.luck, label: 'Your gear' });

  const passive = mult('passiveIncome', 'passive', undefined, gear.passive);
  return {
    luck: totalLuck(luckSources, cfg.rarities.maxLuck),
    luckSources,
    variantChance: 1 + sv('variantChance'),
    pityMult: Math.max(0.3, 1 - sv('pity')),
    potionDuration: 1 + sv('potionDuration'),
    xp: mult('xp', 'xp', title?.bonus?.xp, gear.xp),
    jobPay: mult('jobPay', 'jobPay', title?.bonus?.jobPay, gear.jobPay),
    passive,
    walk: 1 + sv('walkSpeed'),
    carwashExtraSec: sv('carwashSeconds'),
    rollSpeed: 1 + sv('rollSpeed'),
    autoRoll: Object.entries(cfg.upgrades.skills).some(([id, d]) => d.effect.kind === 'unlock' && id === 'auto_roll' && skillLevel(cfg.upgrades, state.skills, id) > 0),
    stall: {
      // Your chef: + stall prices and faster cooks.
      dishPrice: sv('dishPrice') + (gear.dishPrice ?? 0) + (gear.chef ?? 0),
      customers: sv('customers'),
      wages: sv('wages'),
      customerBuff: buffs('customers').reduce((a, b) => a * b.mult, 1),
      staffSpeedBuff: buffs('staffSpeed').reduce((a, b) => a * b.mult, 1) * (1 + (gear.chef ?? 0)),
    },
    property: {
      rent: (1 + sv('rentIncome')) * passive,
      airbnb: (1 + sv('airbnbIncome')) * passive,
      cleanLoss: Math.max(0.3, 1 - sv('cleanLoss')),
      appeal: 1 + sv('tenantAppeal'),
    },
  };
}

/** A crate's pity thresholds after the Pity Pact skill. */
export function effectivePity(crate: CrateDef, pityMult: number): CrateDef['pity'] {
  return {
    epic: Math.max(5, Math.ceil(crate.pity.epic * pityMult)),
    legendary: Math.max(20, Math.ceil(crate.pity.legendary * pityMult)),
  };
}

// ------------------------------------------------------------------ conditions
export interface ProgressSnapshot {
  level: number;
  stage: number;
  netWorthSen: number;
  stats: Record<string, number>;
  skills: Record<string, number>;
  indexFound: number;
  indexTotal: number;
  pages: ReadonlySet<string>;
  /** crate id → [found, total] */
  pageProgress: Record<string, [number, number]>;
}

export function buildSnapshot(
  cfg: ProgCfg,
  s: {
    level: number; stage: number; walletSen: number; inventory: ReadonlyArray<{ itemId: string; variant: string }>;
    index: Iterable<string>; pages: Iterable<string>; stats: Record<string, number>; skills: Record<string, number>;
    /** Businesses / property counted in net worth (e.g. a share of what the stall cost). */
    assetsSen?: number;
  },
): ProgressSnapshot {
  const index = new Set(s.index);
  const collectibles = cfg.items.items.filter(isCollectible);
  const pageProgress: Record<string, [number, number]> = {};
  for (const c of cfg.crates.crates) pageProgress[c.id] = [c.pool.filter((id) => index.has(id)).length, c.pool.length];
  return {
    level: s.level,
    stage: s.stage,
    netWorthSen: netWorthSen(cfg, s.walletSen, s.inventory, s.assetsSen ?? 0),
    stats: s.stats,
    skills: s.skills,
    indexFound: collectibles.filter((i) => index.has(i.id)).length,
    indexTotal: collectibles.length,
    pages: new Set(s.pages),
    pageProgress,
  };
}

export type ProgressUnit = 'count' | 'money' | 'level' | 'pct' | 'minutes';
export interface CondProgress {
  cur: number;
  target: number;
  done: boolean;
  unit: ProgressUnit;
}

/** How far along a condition is (for progress bars) and whether it's met. */
export function conditionProgress(cond: Condition, snap: ProgressSnapshot, stages?: StagesConfig): CondProgress {
  switch (cond.type) {
    case 'always':
      return { cur: 1, target: 1, done: true, unit: 'count' };
    case 'stat': {
      const cur = snap.stats[cond.stat] ?? 0;
      const unit: ProgressUnit = cond.stat.endsWith('Sen') ? 'money' : cond.stat.endsWith('Secs') ? 'minutes' : 'count';
      return { cur: Math.min(cur, cond.n), target: cond.n, done: cur >= cond.n, unit };
    }
    case 'level':
      return { cur: Math.min(snap.level, cond.n), target: cond.n, done: snap.level >= cond.n, unit: 'level' };
    case 'stage': {
      const target = stages ? stageDef(stages, cond.n).minNetWorthSen : cond.n;
      const done = snap.stage >= cond.n;
      return { cur: done ? target : Math.min(snap.netWorthSen, target), target, done, unit: stages ? 'money' : 'level' };
    }
    case 'netWorth':
      return { cur: Math.min(snap.netWorthSen, cond.sen), target: cond.sen, done: snap.netWorthSen >= cond.sen, unit: 'money' };
    case 'index': {
      const pct = snap.indexTotal ? (snap.indexFound / snap.indexTotal) * 100 : 0;
      return { cur: Math.min(pct, cond.pct), target: cond.pct, done: pct >= cond.pct - 1e-9, unit: 'pct' };
    }
    case 'indexCount':
      return { cur: Math.min(snap.indexFound, cond.n), target: cond.n, done: snap.indexFound >= cond.n, unit: 'count' };
    case 'page': {
      const [have, total] = snap.pageProgress[cond.crate] ?? [0, 1];
      const done = snap.pages.has(cond.crate) || have >= total;
      return { cur: done ? total : have, target: total, done, unit: 'count' };
    }
    case 'skill': {
      const cur = snap.skills[cond.id] ?? 0;
      return { cur: Math.min(cur, cond.n), target: cond.n, done: cur >= cond.n, unit: 'level' };
    }
  }
}

/** Titles the player qualifies for (whether or not they already own them). */
export function qualifiedTitles(cfg: TitlesConfig, snap: ProgressSnapshot, stages?: StagesConfig): string[] {
  return cfg.titles.filter((t) => conditionProgress(t.cond, snap, stages).done).map((t) => t.id);
}

// ------------------------------------------------------------------ daily login + quests
/** Calendar day (server local time) as YYYY-MM-DD. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The day before a YYYY-MM-DD key. */
export function prevDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1, 12).getTime());
}

export interface LoginState {
  /** Last day a login reward was claimed (YYYY-MM-DD), or null. */
  lastDay: string | null;
  /** Streak position of that claim, 1..7. */
  streak: number;
}

/** Whether today's login reward can be claimed, and which day (1–7) it would be. */
export function loginStatus(login: LoginState, today: string): { canClaim: boolean; nextDay: number; keepsStreak: boolean } {
  if (login.lastDay === today) return { canClaim: false, nextDay: (login.streak % 7) + 1, keepsStreak: true };
  const keepsStreak = login.lastDay !== null && login.lastDay === prevDayKey(today);
  return { canClaim: true, nextDay: keepsStreak ? (login.streak % 7) + 1 : 1, keepsStreak };
}

export interface QuestState {
  id: string;
  /** The stat's value when the quest was handed out (progress = stat − base). */
  base: number;
  target: number;
  senReward: number;
  claimed: boolean;
}

const byStage = <T>(arr: T[], stage: number): T => arr[Math.min(arr.length - 1, Math.max(0, stage - 1))];

export function makeQuest(def: QuestDef, stage: number, stats: Record<string, number>): QuestState {
  return { id: def.id, base: stats[def.stat] ?? 0, target: byStage(def.targets, stage), senReward: byStage(def.reward.senByStage, stage), claimed: false };
}

/** Picks `perDay` different quests the player's stage (and e.g. owning a stall) allows. */
export function pickQuests(cfg: QuestsConfig, stage: number, stats: Record<string, number>, rand: RandInt, flags: ReadonlySet<string> = new Set()): QuestState[] {
  const pool = cfg.daily.filter((q) => q.minStage <= stage && (!q.requires || flags.has(q.requires)));
  const out: QuestState[] = [];
  while (out.length < cfg.perDay && pool.length) out.push(makeQuest(pool.splice(rand(pool.length), 1)[0], stage, stats));
  return out;
}

export function questProgress(def: QuestDef, q: QuestState, stats: Record<string, number>): { cur: number; done: boolean } {
  const cur = Math.max(0, (stats[def.stat] ?? 0) - q.base);
  return { cur: Math.min(cur, q.target), done: cur >= q.target };
}

/** "Roll any crate 10 times" / "Earn RM 300 from jobs" / "Manifest for 5 minutes". */
export function questText(def: QuestDef, target: number, money: (sen: number) => string): string {
  const n = def.format === 'money' ? money(target) : def.format === 'minutes' ? `${Math.round(target / 60)}` : `${target}`;
  return def.text.replace('{n}', n);
}

/**
 * Hustle Path goals that are met now but weren't done before. Goals can be finished in any order
 * (a stall goal may have to wait for the night market to open); the HUD shows the first one not
 * done yet (`currentGoalIndex`).
 */
export function newlyDoneGoals(cfg: GoalsConfig, done: ReadonlySet<string>, snap: ProgressSnapshot, stages?: StagesConfig): number[] {
  const out: number[] = [];
  cfg.goals.forEach((g, i) => {
    if (!done.has(g.id) && conditionProgress(g.cond, snap, stages).done) out.push(i);
  });
  return out;
}

/** Index of the first goal not done yet (= goals.length when the path is complete). */
export function currentGoalIndex(cfg: GoalsConfig, done: ReadonlySet<string> | readonly string[]): number {
  const set = done instanceof Set ? done : new Set(done as readonly string[]);
  const i = cfg.goals.findIndex((g) => !set.has(g.id));
  return i < 0 ? cfg.goals.length : i;
}

// ------------------------------------------------------------------ config checks
/** Cross-file checks for the progression configs (unknown items, crates, rarities, branches...). */
export function validateProgressionConfigs(cfg: ProgCfg): string[] {
  const errors: string[] = [];
  const tiers = new Set(cfg.rarities.tiers.map((t) => t.id));
  const crateIds = new Set(cfg.crates.crates.map((c) => c.id));
  const checkReward = (where: string, r: Reward | undefined) => {
    if (!r) return;
    for (const id of r.items ?? []) if (!cfg.itemById.has(id)) errors.push(`${where}: unknown item ${id}`);
    if (r.crate && !crateIds.has(r.crate)) errors.push(`${where}: unknown crate ${r.crate}`);
  };
  const checkCond = (where: string, c: Condition) => {
    if (c.type === 'page' && !crateIds.has(c.crate)) errors.push(`${where}: unknown crate ${c.crate}`);
    if (c.type === 'skill' && !cfg.upgrades.skills[c.id]) errors.push(`${where}: unknown skill ${c.id}`);
    if (c.type === 'stage' && !cfg.stages.stages.some((s) => s.n === c.n)) errors.push(`${where}: unknown stage ${c.n}`);
  };
  for (const t of cfg.titles.titles) {
    if (!tiers.has(t.rarity)) errors.push(`title ${t.id}: unknown rarity ${t.rarity}`);
    checkCond(`title ${t.id}`, t.cond);
  }
  if (!tiers.has(cfg.titles.announceFrom)) errors.push(`titles.announceFrom: unknown rarity`);
  const branches = new Set(cfg.upgrades.branches.map((b) => b.id));
  for (const [id, s] of Object.entries(cfg.upgrades.skills)) if (!branches.has(s.branch)) errors.push(`skill ${id}: unknown branch ${s.branch}`);
  for (const g of cfg.goals.goals) {
    checkCond(`goal ${g.id}`, g.cond);
    checkReward(`goal ${g.id}`, g.reward);
  }
  cfg.quests.login.forEach((r, i) => checkReward(`login day ${i + 1}`, r));
  for (const q of cfg.quests.daily) for (const id of q.reward.items ?? []) if (!cfg.itemById.has(id)) errors.push(`quest ${q.id}: unknown item ${id}`);
  for (const s of cfg.stages.stages) checkReward(`stage ${s.n}`, s.reward);
  for (const m of cfg.levels.milestones) checkReward('level milestone', m.reward);
  for (const c of Object.keys(cfg.levels.xp.crateRoll)) if (!crateIds.has(c)) errors.push(`levels.xp.crateRoll: unknown crate ${c}`);
  if (cfg.quests.daily.filter((q) => q.minStage <= 1).length < cfg.quests.perDay) errors.push('quests: not enough stage-1 quests for perDay');
  const sorted = [...cfg.stages.stages].sort((a, b) => a.n - b.n);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].minNetWorthSen <= sorted[i - 1].minNetWorthSen) errors.push('stages: net worth thresholds must increase');
  return errors;
}
