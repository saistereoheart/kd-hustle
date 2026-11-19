// Item tiers (shown as "Tier D".."Tier S"; called grades in code so they don't clash with the
// rarity tiers). Every rolled item has a rarity (from its item type), a grade and a variant
// (normal / shiny / golden / rainbow). Grade and variant MULTIPLY: value and the buff an
// equipped item gives = base (from rarity) × grade mult × variant mult.
//  - New items roll a grade (mostly D, rarely S).
//  - Merge: N copies of the same item at the same grade → 1 at the next grade (keeps the best variant).
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
    variantMult: z.record(z.string(), z.number().positive()),
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
export function gearBuff(cfg: GradesConfig, item: { type: string; rarity: string; grade?: string; variant: string }): { stat: GearStat; value: number } | null {
  const stat = cfg.buffs.bySlot[item.type];
  if (!stat) return null;
  const base = (item.type === 'chef' ? cfg.buffs.chefByRarity : cfg.buffs.byRarity)[item.rarity] ?? 0;
  return { stat, value: base * gradeMult(cfg, item.grade) * variantProduct(cfg.buffs.variantMult, item.variant) };
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
  const base = (cfg.buffs.chefByRarity[chef.rarity] ?? 0) * gradeMult(cfg, chef.grade) * variantProduct(cfg.buffs.variantMult, chef.variant) * (1 + boost);
  const prof = cfg.buffs.chefProfiles[chef.id] ?? EVEN_PROFILE;
  return { speed: base * prof.speed, flavour: base * prof.flavour, charm: base * prof.charm };
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
  const base = (cfg.buffs.cashierByRarity[c.rarity] ?? 0) * gradeMult(cfg, c.grade) * variantProduct(cfg.buffs.variantMult, c.variant) * (1 + boost);
  const prof = cfg.buffs.cashierProfiles[c.id] ?? { tips: 1, patience: 0.5 };
  return { tips: base * prof.tips, patience: base * prof.patience };
}

/** All equipped items' buffs added up per stat (the head chef / cashier are handled separately). */
export function gearBonuses(cfg: GradesConfig, items: ReadonlyArray<{ type: string; rarity: string; grade?: string; variant: string }>): Partial<Record<GearStat, number>> {
  const out: Partial<Record<GearStat, number>> = {};
  for (const it of items) {
    if (it.type === 'chef' || it.type === 'cashier') continue;
    const b = gearBuff(cfg, it);
    if (b) out[b.stat] = (out[b.stat] ?? 0) + b.value;
  }
  return out;
}

// ------------------------------------------------------------------ rerolls (luck + pity) and merging
export type VariantDefs = ReadonlyArray<{ id: string; oneIn: number }>;

/** A grade roll where every grade above the lowest is `luck`× likelier. */
export function rollGradeLuck(cfg: GradesConfig, rand: RandInt, luck = 1): string {
  const ws = cfg.grades.map((g, i) => (i === 0 ? g.weight : g.weight * Math.max(1, luck)));
  const total = ws.reduce((a, w) => a + w, 0);
  let r = rand(Math.max(1, Math.round(total * 1000))) / 1000;
  for (let i = 0; i < ws.length; i++) {
    if (r < ws[i]) return cfg.grades[i].id;
    r -= ws[i];
  }
  return cfg.grades[0].id;
}

/** A variant roll ("1 in N" each, rarest checked first) with every chance × `luck`. */
export function rollVariantLuck(variants: VariantDefs, rand: RandInt, luck = 1): string {
  const special = variants.filter((v) => v.oneIn > 1).sort((a, b) => b.oneIn - a.oneIn);
  const SC = 1_000_000;
  const r = rand(SC);
  let acc = 0;
  for (const v of special) {
    acc += (SC * Math.max(1, luck)) / v.oneIn;
    if (r < acc) return v.id;
  }
  return 'normal';
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
  const rolled = rollVariantLuck(variants, rand, luck);
  const adds = rolled !== 'normal' && !have.includes(rolled);
  return { rolled, result: adds ? joinVariants(order, [...have, rolled]) : current, improved: adds, forced: false };
}

/**
 * Merging N copies of the same item (any tiers and variants): the result is one tier above the
 * lowest input, but never below the highest (capped at the top tier); it keeps EVERY variant
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
