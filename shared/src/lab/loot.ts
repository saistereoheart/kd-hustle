// 🎁 Labirin loot (feedback #24): 💎 diamonds, gear drops with a grade and a variant (scrappable for
// diamonds), and 🎭 classes. Pure: the server rolls and owns the saves. Numbers: labyrinth.json `loot`, `classes`.
import type { LabConfig } from './config';
import { labGear, labGearList, type LabGearBonus, type LabGearItem, type LabSlot } from './gear';

export type LabClassDef = LabConfig['classes'][number];

/** A dropped piece of gear: a shop piece's stats × its grade × its variant. */
export interface LabItem {
  uid: number;
  /** The base piece (`weapon_besi`). */
  gear: string;
  /** D, C, B, A, S. */
  grade: string;
  /** normal, shiny, golden, rainbow. */
  variant: string;
}

/** How much stronger than the shop piece (grade × variant). */
export function itemMult(cfg: LabConfig, it: Pick<LabItem, 'grade' | 'variant'>): number {
  const g = cfg.loot.grades.find((x) => x.id === it.grade)?.mult ?? 1;
  const v = cfg.loot.variants.find((x) => x.id === it.variant)?.mult ?? 1;
  return g * v;
}

/** Diamonds for scrapping it. */
export function itemScrap(cfg: LabConfig, it: Pick<LabItem, 'gear' | 'grade' | 'variant'>): number {
  const g = cfg.loot.grades.find((x) => x.id === it.grade)?.scrap ?? 1;
  const v = cfg.loot.variants.find((x) => x.id === it.variant)?.scrap ?? 1;
  const tier = labGear(cfg, it.gear)?.tier ?? 0;
  return Math.max(1, Math.round(g * v + Math.floor(tier / 2)));
}

/** A dropped item's name ("Golden Keris Besi (A)"). */
export function itemName(cfg: LabConfig, it: Pick<LabItem, 'gear' | 'grade' | 'variant'>): string {
  const g = labGear(cfg, it.gear);
  const v = it.variant !== 'normal' ? `${cfg.loot.variants.find((x) => x.id === it.variant)?.name ?? it.variant} ` : '';
  return `${v}${g?.name ?? it.gear} (${it.grade})`;
}

/** An equipped slot's value: a shop piece id, or `#<uid>` for a dropped item. Gives the piece and its multiplier. */
export function resolveWorn(cfg: LabConfig, id: string | undefined, items: LabItem[] = []): { piece: LabGearItem; mult: number; item?: LabItem } | undefined {
  if (!id) return undefined;
  if (id.startsWith('#')) {
    const it = items.find((x) => x.uid === Number(id.slice(1)));
    const piece = it ? labGear(cfg, it.gear) : undefined;
    return it && piece ? { piece, mult: itemMult(cfg, it), item: it } : undefined;
  }
  const piece = labGear(cfg, id);
  return piece ? { piece, mult: 1 } : undefined;
}

/** What your worn gear adds up to (shop pieces and dropped items). */
export function wornBonus(cfg: LabConfig, equipped: Partial<Record<LabSlot, string>>, items: LabItem[] = []): LabGearBonus {
  const b: LabGearBonus = { atk: 0, def: 0, hp: 0, spd: 0, crit: 0, block: 0 };
  for (const [slot, id] of Object.entries(equipped) as Array<[LabSlot, string]>) {
    const w = resolveWorn(cfg, id, items);
    if (!w || w.piece.slot !== slot) continue;
    const m = w.mult;
    b.atk += w.piece.atk * m;
    b.def += w.piece.def * m;
    b.hp += Math.round(w.piece.hp * m);
    b.spd += Math.round(w.piece.spd * m * 10) / 10;
    b.crit += w.piece.crit * m;
    b.block += w.piece.block * m;
  }
  return b;
}

/** The base piece ids worn (what others see: `#uid` → its shop piece). */
export function wornBase(cfg: LabConfig, equipped: Partial<Record<LabSlot, string>>, items: LabItem[] = []): Partial<Record<LabSlot, string>> {
  const out: Partial<Record<LabSlot, string>> = {};
  for (const [slot, id] of Object.entries(equipped) as Array<[LabSlot, string]>) {
    const w = resolveWorn(cfg, id, items);
    if (w) out[slot] = w.piece.id;
  }
  return out;
}

function pick<T extends { weight: number }>(list: T[], rand: () => number): T {
  const total = list.reduce((a, x) => a + x.weight, 0);
  let r = rand() * total;
  for (const x of list) {
    r -= x.weight;
    if (r < 0) return x;
  }
  return list[list.length - 1];
}

/** 🎁 What one player finds after a win on this floor (`monsters` beaten, `boss`: a floor boss). */
export function rollLoot(cfg: LabConfig, floor: number, monsters: number, boss: boolean, rand: () => number): { diamonds: number; item?: Omit<LabItem, 'uid'> } {
  const L = cfg.loot;
  let diamonds = 0;
  const chance = L.diamond.perMonster * (1 + L.diamond.perFloor * floor);
  for (let i = 0; i < monsters; i++) if (rand() < chance) diamonds++;
  if (boss) diamonds += L.diamond.boss + Math.floor(floor / 2);
  let item: Omit<LabItem, 'uid'> | undefined;
  if (rand() < Math.min(L.item.max, L.item.perMonster * monsters + (boss ? L.item.boss : 0))) {
    // The best shop tier sold by this floor (sometimes one lower), a random slot.
    const tiers = cfg.gear.tiers.map((t, k) => ({ t, k })).filter(({ t }) => !t.dropOnly && t.minFloor <= floor);
    const top = tiers[tiers.length - 1]?.k ?? 0;
    const tier = rand() < L.item.lowerTier && top > 0 ? top - 1 : top;
    const slots = cfg.gear.slots.map((s) => s.id);
    const slot = slots[Math.floor(rand() * slots.length)];
    const piece = labGearList(cfg).find((g) => g.slot === slot && g.tier === tier);
    const grade = pick(L.grades, rand).id;
    // Variants at their own odds, rarest first.
    let variant = 'normal';
    for (const v of [...L.variants].filter((x) => x.oneIn > 1).sort((a, b) => b.oneIn - a.oneIn)) {
      if (rand() < 1 / v.oneIn) {
        variant = v.id;
        break;
      }
    }
    if (piece) item = { gear: piece.id, grade, variant };
  }
  return { diamonds, item };
}

/** 🎭 A class's numbers (none = all zero). */
export function classMods(cfg: LabConfig, id: string | undefined) {
  const c = cfg.classes.find((x) => x.id === id);
  return {
    atk: c?.atk ?? 0, def: c?.def ?? 0, hp: c?.hp ?? 0, spd: c?.spd ?? 0, crit: c?.crit ?? 0,
    mana: c?.mana ?? 0, skillPower: c?.skillPower ?? 0, spellPower: c?.spellPower ?? 0, coins: c?.coins ?? 0,
  };
}

/** 🎲 The class roll: a roll-class you don't own yet (by weight), or null (some diamonds back). */
export function rollClass(cfg: LabConfig, owned: string[], rand: () => number): LabClassDef | null {
  if (rand() >= cfg.loot.classRoll.chance) return null;
  const pool = cfg.classes.filter((c) => c.source === 'roll' && !owned.includes(c.id) && (c.weight ?? 0) > 0) as Array<LabClassDef & { weight: number }>;
  return pool.length ? pick(pool, rand) : null;
}
