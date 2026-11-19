// Luck, odds and roll maths. Pure functions shared by the server (which does the real rolls)
// and the client (which shows the live odds). Every number here is visible to players.
//
// LUCK
//   Each source has a type (upgrade, potion, item, title, rebirth, event, index) and a multiplier.
//   - Within one type, multipliers MULTIPLY:   two 2× potions  = 4× from potions.
//   - Across types, the bonuses ADD:           4× potions + 1.5× title = 1 + 3 + 0.5 = 4.5×.
//   This keeps stacking strong but not exponential across every system. The total is capped.
//
// ODDS
//   Luck multiplies the base weight of every tier from `luckAffectsFrom` (Rare) upward, then the
//   table is renormalised, so luck makes good tiers more likely and Commons/Uncommons less likely.
//   Tiers that have no items in a crate's pool get weight 0 (a crate never shows odds for things
//   it can't drop).
import { variantParts } from './items/variants';
import type { CrateDef, ItemDef, RaritiesConfig } from './economy/schemas';

export const LUCK_SOURCE_TYPES = ['upgrade', 'potion', 'item', 'title', 'rebirth', 'event', 'index', 'gear'] as const;
export type LuckSourceType = (typeof LUCK_SOURCE_TYPES)[number];
export interface LuckSource {
  type: LuckSourceType;
  mult: number;
  label?: string;
}

export function totalLuck(sources: LuckSource[], maxLuck: number): number {
  const byType = new Map<LuckSourceType, number>();
  for (const s of sources) {
    if (!(s.mult > 0) || !Number.isFinite(s.mult)) continue;
    byType.set(s.type, (byType.get(s.type) ?? 1) * s.mult);
  }
  let total = 1;
  for (const m of byType.values()) total += m - 1;
  return Math.min(maxLuck, Math.max(0.1, total));
}

export interface TierOdds {
  tier: string;
  name: string;
  color: string;
  /** Probability 0..1 (0 if the crate has no items of this tier). */
  p: number;
  /** "1 in X" (Infinity if impossible). */
  oneIn: number;
}

/** Odds per tier for a crate at a given luck. */
export function crateOdds(rar: RaritiesConfig, crate: CrateDef, items: Map<string, ItemDef>, luck: number, minTierIndex = 0): TierOdds[] {
  const fromIdx = rar.tiers.findIndex((t) => t.id === rar.luckAffectsFrom);
  const present = new Set(crate.pool.map((id) => items.get(id)?.rarity).filter(Boolean));
  const w = rar.tiers.map((t, i) => {
    if (!present.has(t.id) || i < minTierIndex) return 0;
    return t.weight * (i >= fromIdx ? luck : 1);
  });
  const sum = w.reduce((a, b) => a + b, 0);
  return rar.tiers.map((t, i) => {
    const p = sum > 0 ? w[i] / sum : 0;
    return { tier: t.id, name: t.name, color: t.color, p, oneIn: p > 0 ? 1 / p : Infinity };
  });
}

/** Pretty "1 in X" (1 in 2, 1 in 18, 1 in 2,041). */
export function formatOneIn(oneIn: number): string {
  if (!Number.isFinite(oneIn)) return '—';
  if (oneIn < 10) return `1 in ${Math.round(oneIn * 10) / 10}`;
  return `1 in ${Math.round(oneIn).toLocaleString('en-US')}`;
}

export interface PityState {
  sinceEpic: number;
  sinceLegendary: number;
}

/** Random integer in [0, max). The server passes crypto.randomInt; tests pass a seeded PRNG. */
export type RandInt = (max: number) => number;

export interface RollOutcome {
  itemId: string;
  tier: string;
  tierIndex: number;
  variant: string;
  /** True if this roll was forced up by the pity counter. */
  pity: boolean;
  /** "1 in X" odds of the tier at the time of the roll (after luck, before pity). */
  oneIn: number;
}

const SCALE = 1_000_000_000;

/** Picks an index from probabilities using integer arithmetic (no float bias at the edges). */
function pickWeighted(ps: number[], rand: RandInt): number {
  const ints = ps.map((p) => Math.round(p * SCALE));
  const total = ints.reduce((a, b) => a + b, 0);
  let r = rand(total);
  for (let i = 0; i < ints.length; i++) {
    if (r < ints[i]) return i;
    r -= ints[i];
  }
  for (let i = ints.length - 1; i >= 0; i--) if (ints[i] > 0) return i;
  return 0;
}

/** `chanceMult` (from the Shiny Sense skill) makes every special variant that much likelier. */
export function rollVariant(rar: RaritiesConfig, rand: RandInt, chanceMult = 1): string {
  // Check the rarest variant first; each has its own independent "1 in N" chance.
  const special = rar.variants.filter((v) => v.oneIn > 1).sort((a, b) => b.oneIn - a.oneIn);
  const r = rand(SCALE);
  let acc = 0;
  for (const v of special) {
    acc += (SCALE * chanceMult) / v.oneIn;
    if (r < acc) return v.id;
  }
  return rar.variants.find((v) => v.oneIn <= 1)?.id ?? 'normal';
}

/**
 * One crate roll.
 * - Pity: if this roll would reach the Legendary (or Epic) pity count, only tiers at or above
 *   it can drop (renormalised among those the crate has).
 * - Limited items that are sold out are skipped; if a whole tier is sold out its weight moves
 *   to the other tiers.
 */
export function rollCrate(
  rar: RaritiesConfig,
  crate: CrateDef,
  items: Map<string, ItemDef>,
  luck: number,
  pity: PityState,
  rand: RandInt,
  soldOut: ReadonlySet<string> = new Set(),
  variantChanceMult = 1,
): RollOutcome {
  const tierIdx = (id: string) => rar.tiers.findIndex((t) => t.id === id);
  const epicIdx = tierIdx('epic');
  const legIdx = tierIdx('legendary');
  const available = crate.pool.filter((id) => !soldOut.has(id) && items.has(id));
  const live: CrateDef = { ...crate, pool: available };
  const base = crateOdds(rar, live, items, luck);
  let minTier = 0;
  let pityHit = false;
  if (pity.sinceLegendary + 1 >= crate.pity.legendary) {
    minTier = legIdx;
    pityHit = true;
  } else if (pity.sinceEpic + 1 >= crate.pity.epic) {
    minTier = epicIdx;
    pityHit = true;
  }
  let odds = minTier > 0 ? crateOdds(rar, live, items, luck, minTier) : base;
  if (odds.every((o) => o.p === 0)) odds = base; // crate has nothing that high: no pity possible
  const ti = pickWeighted(odds.map((o) => o.p), rand);
  const candidates = available.filter((id) => items.get(id)!.rarity === rar.tiers[ti].id);
  const itemId = candidates[rand(candidates.length)];
  const naturallyHigh = base[ti].p > 0;
  return {
    itemId,
    tier: rar.tiers[ti].id,
    tierIndex: ti,
    variant: rollVariant(rar, rand, variantChanceMult),
    pity: pityHit && naturallyHigh && minTier > 0,
    oneIn: base[ti].oneIn,
  };
}

/** Pity counters after a roll of the given tier. */
export function nextPity(rar: RaritiesConfig, pity: PityState, tierIndex: number): PityState {
  const epicIdx = rar.tiers.findIndex((t) => t.id === 'epic');
  const legIdx = rar.tiers.findIndex((t) => t.id === 'legendary');
  if (tierIndex >= legIdx) return { sinceEpic: 0, sinceLegendary: 0 };
  if (tierIndex >= epicIdx) return { sinceEpic: 0, sinceLegendary: pity.sinceLegendary + 1 };
  return { sinceEpic: pity.sinceEpic + 1, sinceLegendary: pity.sinceLegendary + 1 };
}

// ------------------------------------------------------------------ values
/** Value multiplier of an item's variants (several multiply: Shiny + Golden = 2 × 5). */
export function variantMult(rar: RaritiesConfig, variant: string): number {
  return variantParts(variant).reduce((m, id) => m * (rar.variants.find((v) => v.id === id)?.valueMult ?? 1), 1);
}

/** An item's value in sen: crate price × rarity factor × variant multiplier (or its fixed
 *  `valueSen` if it doesn't come from a crate, e.g. potions). */
export function itemValueSen(rar: RaritiesConfig, item: ItemDef, crate: CrateDef | undefined, variant: string, gradeMult = 1): number {
  if (!crate) return Math.round((item.valueSen ?? 0) * variantMult(rar, variant) * gradeMult);
  const tier = rar.tiers.find((t) => t.id === item.rarity)!;
  return Math.round(crate.priceSen * tier.valueFactor * variantMult(rar, variant) * gradeMult);
}

/** `gradeMult`: the item's tier (Tier D ×1 … Tier S ×5) multiplies its value too. */
export function pawnPriceSen(rar: RaritiesConfig, item: ItemDef, crate: CrateDef | undefined, variant: string, pawnRate: number, gradeMult = 1): number {
  return Math.max(1, Math.floor(itemValueSen(rar, item, crate, variant, gradeMult) * pawnRate));
}

export function scrapShards(rar: RaritiesConfig, item: ItemDef, variant: string): number {
  const tier = rar.tiers.find((t) => t.id === item.rarity)!;
  return Math.round(tier.shards * variantMult(rar, variant));
}
