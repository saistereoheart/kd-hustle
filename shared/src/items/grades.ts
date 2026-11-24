// Item tiers (shown as "Tier D".."Tier S"; called grades in code so they don't clash with the
// rarity tiers). Every rolled item has a rarity (from its item type), a grade and a variant
// (normal / shiny / golden / rainbow). Grade and variant MULTIPLY: value and the buff an
// equipped item gives = base (from rarity) × grade mult × variant mult.
//  - New items roll a grade (mostly D, rarely S).
//  - Merge: N copies of the same item at the same grade → 1 at the next grade (keeps every variant).
//  - Shards reroll a grade or a variant: a chance at better, never worse.
import { z } from 'zod';
import type { RandInt } from '../luck';
import { joinVariants, variantParts, variantProduct } from './variants';

export const gradesConfigSchema = z.object({
  grades: z.array(z.object({ id: z.string(), name: z.string(), mult: z.number().positive(), weight: z.number().nonnegative(), color: z.string() })).min(2),
  mergeCount: z.number().int().min(2),
  buffs: z.object({
    /** An equipped item's buff before grade and variant (a share: 0.04 = +4%). */
    byRarity: z.record(z.string(), z.number().nonnegative()),
    /** Which stat each equipment slot boosts. */
    bySlot: z.record(z.string(), z.enum(['luck', 'xp', 'jobPay', 'passive', 'dishPrice', 'chef'])),
    /** Chefs are stronger: their base buff by rarity (stall prices AND how fast your cooks work). */
    chefByRarity: z.record(z.string(), z.number().nonnegative()).default({}),
    /** A gear buff's tier multiplier (gentler than the value's: Tier S ×3, not ×5). */
    gradeBuff: z.record(z.string(), z.number().positive()).default({ D: 1, C: 1.25, B: 1.5, A: 2, S: 3 }),
    /** Each special variant ADDS this to a gear buff (they don't multiply: all three = +185%). */
    variantBonus: z.record(z.string(), z.number().min(0)).default({ normal: 0, shiny: 0.25, golden: 0.6, rainbow: 1 }),
    /** The most each stat can get from gear, chefs and cashiers together (1 = +100%; luck: ×(1 + cap)). */
    caps: z.record(z.string(), z.number().min(0)).default({}),
    /** Caps are soft: up to this share of a cap a stat counts in full; above it, it keeps growing more and
     *  more slowly towards the cap (never past it). So a stronger piece always shows more: before, every
     *  piece past a cap stopped dead at the same number (a Striva legendary chef = a Striva mythic). */
    softCapKnee: z.number().min(0).max(1).default(0.75),
    /** Each chef's strengths: how much of their buff goes to each stall stat (missing = even). */
    /** Cashiers (kopitiam): their base buff by rarity, split by profile into Tips and Patience. */
    cashierByRarity: z.record(z.string(), z.number().nonnegative()).default({}),
    cashierProfiles: z.record(z.string(), z.object({ tips: z.number().nonnegative(), patience: z.number().nonnegative() })).default({}),
    chefProfiles: z.record(z.string(), z.object({ speed: z.number().nonnegative(), flavour: z.number().nonnegative(), charm: z.number().nonnegative() })).default({}),
  }),
  shards: z.object({ rerollGrade: z.record(z.string(), z.number().int().positive()), rerollVariant: z.record(z.string(), z.number().int().positive()) }),
  /** Merging: each special variant among the inputs gives this chance of one more variant. */
  mergeVariantBonus: z.number().min(0).max(1).default(0.2),
  /** Reroll pity: from `soft` misses in a row each miss adds `softStep` chance of a sure upgrade;
   *  at `hard` misses the next reroll always upgrades. Counted per player, tier and variant apart. */
  rerollPity: z.object({
    grade: z.object({ soft: z.number().int().positive(), hard: z.number().int().positive(), softStep: z.number().min(0).max(1) }),
    variant: z.object({ soft: z.number().int().positive(), hard: z.number().int().positive(), softStep: z.number().min(0).max(1) }),
  }).default({ grade: { soft: 6, hard: 15, softStep: 0.12 }, variant: { soft: 8, hard: 20, softStep: 0.1 } }),
});
export type GradesConfig = z.infer<typeof gradesConfigSchema>;
export type GearStat = GradesConfig['buffs']['bySlot'][string];

export const DEFAULT_GRADE = 'D';

export function gradeIndex(cfg: GradesConfig, grade: string | undefined): number {
  const i = cfg.grades.findIndex((g) => g.id === (grade ?? DEFAULT_GRADE));
  return i < 0 ? 0 : i;
}
export function gradeDef(cfg: GradesConfig, grade: string | undefined) {
  return cfg.grades[gradeIndex(cfg, grade)];
}
export function gradeMult(cfg: GradesConfig, grade: string | undefined): number {
  return gradeDef(cfg, grade).mult;
}
/** The grade above, or null at the top. */
export function nextGrade(cfg: GradesConfig, grade: string | undefined): string | null {
  return cfg.grades[gradeIndex(cfg, grade) + 1]?.id ?? null;
}

/** A fresh item's grade, by weight. */
export function rollGrade(cfg: GradesConfig, rand: RandInt): string {
  const total = cfg.grades.reduce((a, g) => a + g.weight, 0);
  let r = rand(Math.max(1, Math.round(total * 1000))) / 1000;
  for (const g of cfg.grades) {
    if (r < g.weight) return g.id;
    r -= g.weight;
  }
  return cfg.grades[0].id;
}

/** Reroll with shards: a new roll, but never worse than what you had. */
export function rerollGrade(cfg: GradesConfig, current: string | undefined, rand: RandInt): string {
  const g = rollGrade(cfg, rand);
  return gradeIndex(cfg, g) > gradeIndex(cfg, current) ? g : (current ?? DEFAULT_GRADE);
}

/** The buff one equipped item gives: which stat, and how much (0.12 = +12%). */
/**
 * How much a gear buff grows with tier and variants. Gentle on purpose: tier × (1 + each variant's
 * bonus, ADDED). Tier S with Shiny + Golden + Rainbow = 3 × 2.85 ≈ ×8.6. (It used to multiply
 * everything: ×5 × 1.5 × 2.5 × 4 = ×75, which made one cooked dish pay tens of millions.) An item's
 * VALUE still uses the full tier and variant multipliers: collecting still pays.
 */
export function buffMult(cfg: GradesConfig, grade: string | undefined, variant: string): number {
  const g = cfg.buffs.gradeBuff[grade ?? DEFAULT_GRADE] ?? 1;
  const v = variantParts(variant).reduce((a, id) => a + (cfg.buffs.variantBonus[id] ?? 0), 0);
  return g * (1 + v);
}

/** A stat's cap (Infinity if none). */
export function buffCap(cfg: GradesConfig, stat: string): number {
  return cfg.buffs.caps[stat] ?? Infinity;
}

/** A value under its soft cap: in full up to knee × cap, then easing towards the cap (always rising). */
export function softCap(cfg: GradesConfig, stat: string, v: number): number {
  const cap = buffCap(cfg, stat);
  if (!Number.isFinite(cap) || v <= 0) return v;
  const knee = cap * cfg.buffs.softCapKnee;
  if (v <= knee) return v;
  const room = cap - knee;
  return room > 0 ? knee + room * (1 - Math.exp(-(v - knee) / room)) : cap;
}

/** 🌈 STRIVA: the top tier with every special variant (S + Shiny + Golden + Rainbow). */
export function isStriva(cfg: GradesConfig, variants: ReadonlyArray<{ id: string; oneIn: number }>, grade: string | undefined, variant: string | undefined): boolean {
  if (!grade || grade !== cfg.grades[cfg.grades.length - 1]?.id) return false;
  const have = variantParts(variant);
  const special = variants.filter((v) => v.oneIn > 1);
  return special.length > 0 && special.every((v) => have.includes(v.id));
}

export function gearBuff(cfg: GradesConfig, item: { type: string; rarity: string; grade?: string; variant: string }): { stat: GearStat; value: number } | null {
  const stat = cfg.buffs.bySlot[item.type];
  if (!stat) return null;
  const base = (item.type === 'chef' ? cfg.buffs.chefByRarity : cfg.buffs.byRarity)[item.rarity] ?? 0;
  return { stat, value: base * buffMult(cfg, item.grade, item.variant) };
}

export const CHEF_STATS = ['speed', 'flavour', 'charm'] as const;
export type ChefStat = (typeof CHEF_STATS)[number];
export type ChefStats = Record<ChefStat, number>;
export const CHEF_STAT_INFO: Record<ChefStat, { icon: string; name: string; does: string }> = {
  speed: { icon: '🔥', name: 'Speed', does: 'cooks work faster' },
  flavour: { icon: '😋', name: 'Flavour', does: 'higher dish prices' },
  charm: { icon: '😊', name: 'Charm', does: 'more customers' },
};
const EVEN_PROFILE: ChefStats = { speed: 0.8, flavour: 0.8, charm: 0.4 };

/**
 * A head chef's stats (0.12 = +12%): their rarity's base buff × tier × variant, split by their
 * profile (what they're good at), then × (1 + Chef Academy skill).
 */
export function chefStats(cfg: GradesConfig, chef: { id: string; rarity: string; grade?: string; variant: string }, boost = 0): ChefStats {
  const base = (cfg.buffs.chefByRarity[chef.rarity] ?? 0) * buffMult(cfg, chef.grade, chef.variant) * (1 + boost);
  const prof = cfg.buffs.chefProfiles[chef.id] ?? EVEN_PROFILE;
  return {
    speed: softCap(cfg, 'chefSpeed', base * prof.speed),
    flavour: softCap(cfg, 'chefFlavour', base * prof.flavour),
    charm: softCap(cfg, 'chefCharm', base * prof.charm),
  };
}

export const CASHIER_STATS = ['tips', 'patience'] as const;
export type CashierStat = (typeof CASHIER_STATS)[number];
export type CashierStats = Record<CashierStat, number>;
export const CASHIER_STAT_INFO: Record<CashierStat, { icon: string; name: string; does: string }> = {
  tips: { icon: '💵', name: 'Tips', does: 'bigger tips (and tips on your cooks\' sales)' },
  patience: { icon: '⏳', name: 'Patience', does: 'customers wait longer' },
};

/** A kopitiam cashier's stats: rarity base × tier × variant, split by profile, × (1 + Staff Academy). */
export function cashierStats(cfg: GradesConfig, c: { id: string; rarity: string; grade?: string; variant: string }, boost = 0): CashierStats {
  const base = (cfg.buffs.cashierByRarity[c.rarity] ?? 0) * buffMult(cfg, c.grade, c.variant) * (1 + boost);
  const prof = cfg.buffs.cashierProfiles[c.id] ?? { tips: 1, patience: 0.5 };
  return { tips: softCap(cfg, 'tips', base * prof.tips), patience: softCap(cfg, 'patience', base * prof.patience) };
}

/** All equipped items' buffs added up per stat (the head chef / cashier are handled separately). */
export function gearBonuses(cfg: GradesConfig, items: ReadonlyArray<{ type: string; rarity: string; grade?: string; variant: string }>): Partial<Record<GearStat, number>> {
  const out: Partial<Record<GearStat, number>> = {};
  for (const it of items) {
    if (it.type === 'chef' || it.type === 'cashier') continue;
    const b = gearBuff(cfg, it);
    if (b) out[b.stat] = (out[b.stat] ?? 0) + b.value;
  }
  // Each stat's cap (gear can't take one stat to the moon).
  for (const k of Object.keys(out) as GearStat[]) out[k] = softCap(cfg, k, out[k]!);
  return out;
}

// ------------------------------------------------------------------ rerolls (luck + pity) and merging
export type VariantDefs = ReadonlyArray<{ id: string; oneIn: number }>;

/**
 * 🍀 Luck on rerolls = more tries, keep the rarest. With ×L luck it's as if you rolled L times and
 * kept the best, so the rarer an outcome is the more luck helps it (Rainbow ×25, Golden ×22, Shiny
 * ×11 at ×25 luck), and nothing common ever reaches 100% and crowds the rest out (just multiplying
 * every chance by luck made Shiny "100%" at ×20). Exact for any luck (fractional too): with the
 * outcomes ordered common → rare and F their running total, P(best ≤ i) = F(i)^L.
 */
export function bestOfOdds(ps: number[], luck: number): number[] {
  const L = Math.max(1, luck);
  const total = ps.reduce((a, b) => a + b, 0) || 1;
  let F = 0, prev = 0;
  return ps.map((p, i) => {
    F += p / total;
    const c = i === ps.length - 1 ? 1 : Math.pow(Math.min(1, F), L);
    const out = Math.max(0, c - prev);
    prev = c;
    return out;
  });
}

/** Picks one of `ids` by the chances `ps` (summing to 1), rarest (last) first as before. */
function pickBy<T>(ids: readonly T[], ps: number[], rand: RandInt): T {
  let r = rand(1_000_000) / 1_000_000;
  for (let i = ids.length - 1; i >= 0; i--) {
    if (r < ps[i]) return ids[i];
    r -= ps[i];
  }
  return ids[0];
}

/** A tier reroll's chances at this luck (Tier D … Tier S). */
export function gradeRerollOdds(cfg: GradesConfig, luck = 1): Array<{ id: string; p: number }> {
  const ps = bestOfOdds(cfg.grades.map((g) => g.weight), luck);
  return cfg.grades.map((g, i) => ({ id: g.id, p: ps[i] }));
}

/** A tier reroll at this luck (best of `luck` tries). */
export function rollGradeLuck(cfg: GradesConfig, rand: RandInt, luck = 1): string {
  const o = gradeRerollOdds(cfg, luck);
  return pickBy(o.map((x) => x.id), o.map((x) => x.p), rand);
}

/** A variant reroll's chances at this luck: 'normal' = nothing new (no special variant, or one the
 *  item already has), then each special variant it doesn't have yet, commonest first. */
export function variantRerollOdds(variants: VariantDefs, have: readonly string[], luck = 1): Array<{ id: string; p: number }> {
  const missing = variants.filter((v) => v.oneIn > 1 && !have.includes(v.id)).sort((a, b) => a.oneIn - b.oneIn);
  const pMissing = missing.map((v) => 1 / v.oneIn);
  const nothing = Math.max(0, 1 - pMissing.reduce((a, b) => a + b, 0));
  const ps = bestOfOdds([nothing, ...pMissing], luck);
  return [{ id: 'normal', p: ps[0] }, ...missing.map((v, i) => ({ id: v.id, p: ps[i + 1] }))];
}

/** A variant reroll at this luck (best of `luck` tries, among the variants it doesn't have yet). */
export function rollVariantLuck(variants: VariantDefs, rand: RandInt, luck = 1, have: readonly string[] = []): string {
  const o = variantRerollOdds(variants, have, luck);
  return pickBy(o.map((x) => x.id), o.map((x) => x.p), rand);
}

/** Pity: is this reroll a sure upgrade? (`fails` = misses in a row so far.) */
export function pityForces(p: { soft: number; hard: number; softStep: number }, fails: number, rand: RandInt): boolean {
  if (fails + 1 >= p.hard) return true;
  if (fails + 1 < p.soft) return false;
  return rand(1_000_000) / 1_000_000 < Math.min(1, (fails + 2 - p.soft) * p.softStep);
}

export interface RerollOutcome {
  /** What the reel lands on. */
  rolled: string;
  /** The item's grade / variant afterwards (never worse). */
  result: string;
  improved: boolean;
  /** Pity made it an upgrade. */
  forced: boolean;
}

/** Tier reroll: a luck-boosted roll; keep the better one. Pity forces the next tier. */
export function rerollGradeOutcome(cfg: GradesConfig, current: string | undefined, rand: RandInt, luck: number, fails: number): RerollOutcome {
  const cur = current ?? DEFAULT_GRADE;
  const next = nextGrade(cfg, cur);
  if (next && pityForces(cfg.rerollPity.grade, fails, rand)) return { rolled: next, result: next, improved: true, forced: true };
  const rolled = rollGradeLuck(cfg, rand, luck);
  const better = gradeIndex(cfg, rolled) > gradeIndex(cfg, cur);
  return { rolled, result: better ? rolled : cur, improved: better, forced: false };
}

/** Variant reroll: a luck-boosted roll; a special variant the item doesn't have yet is ADDED
 *  (they stack). Pity forces the most common variant it's missing. */
export function rerollVariantOutcome(cfg: GradesConfig, variants: VariantDefs, current: string, rand: RandInt, luck: number, fails: number): RerollOutcome {
  const order = variants.map((v) => v.id);
  const have = variantParts(current);
  const missing = variants.filter((v) => v.oneIn > 1 && !have.includes(v.id)).sort((a, b) => a.oneIn - b.oneIn);
  if (missing.length && pityForces(cfg.rerollPity.variant, fails, rand)) {
    const add = missing[0].id;
    return { rolled: add, result: joinVariants(order, [...have, add]), improved: true, forced: true };
  }
  const rolled = rollVariantLuck(variants, rand, luck, have);
  const adds = rolled !== 'normal' && !have.includes(rolled);
  return { rolled, result: adds ? joinVariants(order, [...have, rolled]) : current, improved: adds, forced: false };
}

/**
 * Merging N copies of the same item (the server only allows copies at the same tier): the result
 * is one tier up (capped at the top tier); it keeps EVERY variant
 * of the inputs, and each special variant among them gives a `mergeVariantBonus` chance of one
 * more (a variant none of them had, the commoner ones likelier).
 */
export function mergeOutcome(cfg: GradesConfig, variants: VariantDefs, inputs: ReadonlyArray<{ grade?: string; variant: string }>, rand: RandInt): { grade: string; variant: string; bonus: string | null } {
  const order = variants.map((v) => v.id);
  const idx = inputs.map((i) => gradeIndex(cfg, i.grade));
  const lo = Math.min(...idx), hi = Math.max(...idx);
  const gi = Math.min(cfg.grades.length - 1, Math.max(lo + 1, hi));
  const parts = inputs.flatMap((i) => variantParts(i.variant));
  let bonus: string | null = null;
  for (let k = 0; k < parts.length && !bonus; k++) {
    if (rand(1_000_000) / 1_000_000 >= cfg.mergeVariantBonus) continue;
    const missing = variants.filter((v) => v.oneIn > 1 && !parts.includes(v.id));
    if (!missing.length) break;
    // Commoner variants are likelier (weight 1 / oneIn).
    const total = missing.reduce((a, v) => a + 1 / v.oneIn, 0);
    let r = (rand(1_000_000) / 1_000_000) * total;
    for (const v of missing) {
      r -= 1 / v.oneIn;
      if (r <= 0) {
        bonus = v.id;
        break;
      }
    }
    bonus ??= missing[missing.length - 1].id;
  }
  return { grade: cfg.grades[gi].id, variant: joinVariants(order, bonus ? [...parts, bonus] : parts), bonus };
}

/** Merged item's variant: the best (rarest) among the inputs. `order` = variants rarest last. */
export function bestVariant(order: readonly string[], variants: readonly string[]): string {
  return variants.reduce((best, v) => (order.indexOf(v) > order.indexOf(best) ? v : best), variants[0] ?? 'normal');
}
