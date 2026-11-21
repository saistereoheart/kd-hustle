// 🗝️ Labirin Purba gear and potions (docs/LABYRINTH.md §2): what the merchant sells, and what your
// equipped gear adds to the weakened state. Pure: the server owns the saves.
import type { LabConfig } from './config';

export type LabSlot = LabConfig['gear']['slots'][number]['id'];
export const LAB_SLOTS: readonly LabSlot[] = ['weapon', 'shield', 'armour', 'charm'];

export interface LabGearItem {
  /** `${slot}_${tier}`, e.g. `weapon_besi`. */
  id: string;
  slot: LabSlot;
  /** Tier index (0 = Kayu). */
  tier: number;
  name: string;
  icon: string;
  color: string;
  price: number;
  /** Sold once you've reached this floor (0-based). */
  minFloor: number;
  atk: number;
  def: number;
  hp: number;
  spd: number;
  crit: number;
  block: number;
}

const cache = new WeakMap<LabConfig, LabGearItem[]>();

/** Every piece of gear: each slot in each tier. */
export function labGearList(cfg: LabConfig): LabGearItem[] {
  const hit = cache.get(cfg);
  if (hit) return hit;
  const out: LabGearItem[] = [];
  for (const s of cfg.gear.slots) {
    cfg.gear.tiers.forEach((t, k) => {
      out.push({
        id: `${s.id}_${t.id}`, slot: s.id, tier: k, name: `${s.name} ${t.name}`, icon: s.icon, color: t.color, price: t.price, minFloor: t.minFloor,
        atk: s.atk?.[k] ?? 0, def: s.def?.[k] ?? 0, hp: s.hp?.[k] ?? 0, spd: s.spd?.[k] ?? 0, crit: s.crit?.[k] ?? 0, block: s.block?.[k] ?? 0,
      });
    });
  }
  cache.set(cfg, out);
  return out;
}

export function labGear(cfg: LabConfig, id: string | undefined): LabGearItem | undefined {
  return id ? labGearList(cfg).find((g) => g.id === id) : undefined;
}

export function labPotion(cfg: LabConfig, id: string) {
  return cfg.potions.list.find((p) => p.id === id);
}

export interface LabGearBonus {
  atk: number;
  def: number;
  hp: number;
  spd: number;
  crit: number;
  block: number;
}

/** What your equipped gear adds up to. */
export function gearBonus(cfg: LabConfig, equipped: Partial<Record<LabSlot, string>>): LabGearBonus {
  const b: LabGearBonus = { atk: 0, def: 0, hp: 0, spd: 0, crit: 0, block: 0 };
  for (const slot of LAB_SLOTS) {
    const g = labGear(cfg, equipped[slot]);
    if (!g || g.slot !== slot) continue;
    b.atk += g.atk;
    b.def += g.def;
    b.hp += g.hp;
    b.spd += g.spd;
    b.crit += g.crit;
    b.block += g.block;
  }
  return b;
}

/** A one-line summary of a piece's stats ("+7 ATK", "+70 HP · +1.1 DEF"). */
export function gearLine(g: LabGearItem): string {
  const parts: string[] = [];
  if (g.atk) parts.push(`+${g.atk} ATK`);
  if (g.hp) parts.push(`+${g.hp} HP`);
  if (g.def) parts.push(`+${g.def} DEF`);
  if (g.spd) parts.push(`+${g.spd} SPD`);
  if (g.crit) parts.push(`+${Math.round(g.crit * 100)}% crit`);
  if (g.block) parts.push(`${Math.round(g.block * 100)}% block`);
  return parts.join(' · ');
}
