// 📈 Labirin Purba progress (docs/LABYRINTH.md): XP from fights → levels → skill points for passive
// skills, and 📜 spell books (an ultimate that hits every monster, or heals the party). Pure: the
// server owns the saves and every check.
import type { LabConfig } from './config';
import type { LabFighter } from './battle';

export type LabSkillDef = LabConfig['skills'][number];
export type LabSpellDef = LabConfig['spells']['list'][number];
export type LabElementDef = LabConfig['elements'][number];

/** XP to go from `level` to the next. */
export function labXpNeed(cfg: LabConfig, level: number): number {
  const l = cfg.progress.levels;
  return Math.round(l.base * Math.pow(l.growth, Math.max(0, level - 1)));
}

/** Level from total XP, and how far into the next one. */
export function labLevel(cfg: LabConfig, xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let left = Math.max(0, Math.floor(xp));
  while (level < cfg.progress.levels.max) {
    const need = labXpNeed(cfg, level);
    if (left < need) return { level, into: left, need };
    left -= need;
    level++;
  }
  return { level, into: 0, need: 0 };
}

/** Skill points spent on these tree ranks (unknown ids don't count). */
export function labPointsSpent(cfg: LabConfig, skills: Record<string, number>): number {
  return cfg.tree.nodes.reduce((a, n) => a + Math.max(0, skills[n.id] ?? 0), 0);
}

/** Skill points free to spend (a point a level: no cap). */
export function labPointsFree(cfg: LabConfig, xp: number, skills: Record<string, number>): number {
  return Math.max(0, labLevel(cfg, xp).level * cfg.progress.pointsPerLevel - labPointsSpent(cfg, skills));
}

/** A spell book, or an element's basic ultimate (`ult_<element>`). */
export function labSpell(cfg: LabConfig, id: string | undefined): LabSpellDef | undefined {
  if (!id) return undefined;
  if (id.startsWith('ult_')) {
    const e = cfg.elements.find((x) => `ult_${x.id}` === id);
    return e ? basicUltimate(e) : undefined;
  }
  return cfg.spells.list.find((s) => s.id === id);
}

/** 🔥 An element (an unknown or missing id: the first one, the default). */
export function labElement(cfg: LabConfig, id: string | undefined): LabElementDef {
  return cfg.elements.find((e) => e.id === id) ?? cfg.elements[0];
}

/** An element's free basic ultimate, shaped like a spell book. */
function basicUltimate(e: LabElementDef): LabSpellDef {
  return { ...e.ultimate, id: `ult_${e.id}`, name: `${e.name} (basic)`, icon: e.icon, color: e.color, price: 0, minFloor: 0, weight: 0, element: e.id };
}

/** 📜 Your ultimate: the spell book of your equipped element if you own one, else that element's basic one. */
export function labUltimate(cfg: LabConfig, element: string | undefined, books: string[]): LabSpellDef {
  const e = labElement(cfg, element);
  // Your strongest book for this element (a boss skill, element 'all', works with any).
  const mine = cfg.spells.list.filter((s) => (s.element === e.id || s.element === 'all') && books.includes(s.id));
  mine.sort((a, b) => (b.power ?? 0) + (b.heal ?? 0) - ((a.power ?? 0) + (a.heal ?? 0)));
  return mine[0] ?? basicUltimate(e);
}

/** XP for beating these monsters on this floor (each player who stayed gets it all). */
export function groupXp(cfg: LabConfig, floor: number, foes: LabFighter[]): number {
  const x = cfg.progress.xp;
  let sum = 0;
  for (const f of foes) sum += f.boss ? x.boss * (1 + floor) : x.perMonster * (1 + x.perFloor * floor);
  return Math.round(sum);
}

/** The tavern's daily roll: a book you don't have yet (by weight), or null (a free drink instead). */
export function rollSpellBook(cfg: LabConfig, owned: string[], rand: () => number): LabSpellDef | null {
  if (rand() >= cfg.spells.roll.bookChance) return null;
  const pool = cfg.spells.list.filter((s) => !owned.includes(s.id) && s.weight > 0);
  const total = pool.reduce((a, s) => a + s.weight, 0);
  if (!total) return null;
  let r = rand() * total;
  for (const s of pool) {
    r -= s.weight;
    if (r < 0) return s;
  }
  return pool[pool.length - 1];
}
