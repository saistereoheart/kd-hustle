// Item tiers (shown as "Tier D".."Tier S"; called grades in code so they don't clash with the
// rarity tiers). Every rolled item has a rarity (from its item type), a grade and a variant
// (normal / shiny / golden / rainbow). Grade and variant MULTIPLY: value and the buff an
// equipped item gives = base (from rarity) × grade mult × variant mult.
//  - New items roll a grade (mostly D, rarely S).
//  - Merge: N copies of the same item at the same grade → 1 at the next grade (keeps the best variant).
//  - Shards reroll a grade or a variant: a chance at better, never worse.
import { z } from 'zod';
import type { RandInt } from '../luck';

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
  }),
  shards: z.object({ rerollGrade: z.record(z.string(), z.number().int().positive()), rerollVariant: z.record(z.string(), z.number().int().positive()) }),
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
  return { stat, value: base * gradeMult(cfg, item.grade) * (cfg.buffs.variantMult[item.variant] ?? 1) };
}

/** All equipped items' buffs added up per stat. */
export function gearBonuses(cfg: GradesConfig, items: ReadonlyArray<{ type: string; rarity: string; grade?: string; variant: string }>): Partial<Record<GearStat, number>> {
  const out: Partial<Record<GearStat, number>> = {};
  for (const it of items) {
    const b = gearBuff(cfg, it);
    if (b) out[b.stat] = (out[b.stat] ?? 0) + b.value;
  }
  return out;
}

/** Merged item's variant: the best (rarest) among the inputs. `order` = variants rarest last. */
export function bestVariant(order: readonly string[], variants: readonly string[]): string {
  return variants.reduce((best, v) => (order.indexOf(v) > order.indexOf(best) ? v : best), variants[0] ?? 'normal');
}
