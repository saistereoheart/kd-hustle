// 🌀 Labirin stats (the abyss keeps its own): FINAL = (BASE + ITEMS) × (1 + BUFFS%).
//   BASE  = the starting stats + per-level growth + the skill tree's flat points;
//   ITEMS = your Labirin gear (shop pieces and drops), flat;
//   BUFFS = class, tavern drink, lead Teman and the tree's % nodes, added up, then multiplied once.
// Crit / block chances just add up. Pure: the server uses it for fights, the client for the bag's breakdown.
import type { LabConfig } from './config';
import type { LabGearBonus } from './gear';
import { classMods } from './loot';

export type LabTreeNode = LabConfig['tree']['nodes'][number];

/** What the tree's ranks add up to. */
export interface LabTreeTotals {
  hp: number; atk: number; def: number; spd: number; mana: number; manaRegen: number;
  crit: number; block: number; atkPct: number; defPct: number; hpPct: number; manaPct: number;
  skillPower: number; spellPower: number; coins: number; regen: number; focus: number;
}

const TREE_KEYS: Array<keyof LabTreeTotals> = ['hp', 'atk', 'def', 'spd', 'mana', 'manaRegen', 'crit', 'block', 'atkPct', 'defPct', 'hpPct', 'manaPct', 'skillPower', 'spellPower', 'coins', 'regen', 'focus'];

export function treeTotals(cfg: LabConfig, ranks: Record<string, number>): LabTreeTotals {
  const t = Object.fromEntries(TREE_KEYS.map((k) => [k, 0])) as unknown as LabTreeTotals;
  for (const n of cfg.tree.nodes) {
    const r = Math.max(0, Math.min(n.max ?? Infinity, ranks[n.id] ?? 0));
    if (!r) continue;
    for (const k of TREE_KEYS) t[k] += ((n as Record<string, unknown>)[k] as number | undefined ?? 0) * r;
  }
  return t;
}

/** Points spent in a branch (what unlocks its deeper nodes). */
export function branchPoints(cfg: LabConfig, ranks: Record<string, number>, branch: string): number {
  return cfg.tree.nodes.filter((n) => n.branch === branch).reduce((a, n) => a + Math.max(0, ranks[n.id] ?? 0), 0);
}

/** Why you can't put a point in this node now ('' = you can). */
export function treeBlock(cfg: LabConfig, ranks: Record<string, number>, id: string, free: number): string {
  const n = cfg.tree.nodes.find((x) => x.id === id);
  if (!n) return 'No such skill.';
  const r = ranks[id] ?? 0;
  if (n.max && r >= n.max) return `${n.name} is at its best (rank ${n.max}).`;
  const have = branchPoints(cfg, ranks, n.branch);
  if (have < n.need) {
    const b = cfg.tree.branches.find((x) => x.id === n.branch);
    return `${n.name} needs ${n.need} points in ${b?.icon ?? ''} ${b?.name ?? n.branch} (you have ${have}).`;
  }
  if (free < 1) return 'No skill points left. Win fights down here to level up.';
  return '';
}

export interface LabStatLine {
  base: number;
  items: number;
  /** The buffs' share (0.15 = +15%). */
  pct: number;
  total: number;
}

export interface LabStatsInput {
  level: number;
  ranks: Record<string, number>;
  gear: LabGearBonus;
  cls?: string;
  drink?: string;
  /** The lead Teman's tiny boost (a buff on ATK, DEF and HP). */
  teman: number;
}

export function labStats(cfg: LabConfig, i: LabStatsInput) {
  const p = cfg.player;
  const L = Math.max(0, i.level - 1);
  const pl = cfg.progress.perLevel;
  const t = treeTotals(cfg, i.ranks);
  const c = classMods(cfg, i.cls);
  const d = i.drink ? cfg.tavern.drinks.find((x) => x.id === i.drink) : undefined;
  const tm = Math.max(0, Math.min(cfg.teman.max, i.teman));
  const line = (base: number, items: number, pct: number, round: (v: number) => number): LabStatLine =>
    ({ base: Math.round(base * 100) / 100, items: Math.round(items * 100) / 100, pct, total: round((base + items) * Math.max(0.1, 1 + pct)) });
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const hp = line(p.hp + pl.hp * L + t.hp, i.gear.hp, c.hp + (d?.hp ?? 0) + tm + t.hpPct, Math.round);
  const atk = line(p.atk + pl.atk * L + t.atk, i.gear.atk, c.atk + (d?.atk ?? 0) + tm + t.atkPct, r1);
  const def = line(p.def + pl.def * L + t.def, i.gear.def, c.def + (d?.def ?? 0) + tm + t.defPct, r1);
  const spd = line(p.spd + t.spd + c.spd, i.gear.spd, d?.spd ?? 0, r1);
  const mana = line(p.mana.max + pl.mana * L + t.mana, 0, c.mana + t.manaPct, Math.round);
  return {
    hp: hp.total, atk: atk.total, def: def.total, spd: Math.max(1, spd.total),
    crit: Math.min(0.5, p.crit + i.gear.crit + t.crit + c.crit),
    block: Math.min(0.5, i.gear.block + t.block),
    mana: mana.total,
    /** 🔷 Mana back every fight round. */
    manaRegen: Math.round((p.mana.perRound + t.manaRegen) * 100) / 100,
    skillPower: t.skillPower + c.skillPower,
    spellPower: t.spellPower + c.spellPower,
    coins: t.coins + c.coins,
    /** Out-of-fight healing × (1 + regen). */
    regen: t.regen,
    focusStart: Math.min(p.focusMax, Math.round(t.focus)),
    lines: { hp, atk, def, spd, mana },
  };
}
export type LabStats = ReturnType<typeof labStats>;
