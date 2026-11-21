// Bulk item tools: ⚒️ Merge all and ♻️ Scrap all (with the player's include / exclude filters),
// and the Item Index's "best ever" (the highest tier and the best variant you've had of each item).
// Pure planning: the server runs these on the real inventory, the client uses them for the preview.
import { gradeIndex, type GradesConfig } from './grades';
import { variantParts } from './variants';

export interface BulkItem {
  iid: number;
  itemId: string;
  grade?: string;
  variant: string;
  serial: number | null;
}

/** A variant's worth: its parts' value multipliers multiplied (Shiny ×2, Golden ×5, both ×10). */
export function variantScore(variants: ReadonlyArray<{ id: string; valueMult?: number }>, v: string): number {
  let k = 1;
  for (const id of variantParts(v)) k *= variants.find((x) => x.id === id)?.valueMult ?? 1;
  return k;
}

/** Which of two copies is better: higher tier first, then the better variant. >0: `a` is better. */
export function compareCopies(g: GradesConfig, variants: ReadonlyArray<{ id: string; valueMult?: number }>, a: { grade?: string; variant: string }, b: { grade?: string; variant: string }): number {
  return gradeIndex(g, a.grade) - gradeIndex(g, b.grade) || variantScore(variants, a.variant) - variantScore(variants, b.variant);
}

// ------------------------------------------------------------------ ⚒️ merge all
/**
 * Splits copies of ONE item at ONE tier into merge sets of `n`. Copies with variants go in first
 * (they're what you want merged up) and are dealt out across the sets, so each result keeps as
 * many variants as possible. Leftovers (fewer than `n`) stay as they are.
 */
export function mergeSets<T extends { variant: string }>(copies: readonly T[], n: number): T[][] {
  const sets = Math.floor(copies.length / n);
  if (!sets) return [];
  const sorted = [...copies].sort((a, b) => variantParts(b.variant).length - variantParts(a.variant).length);
  const out: T[][] = Array.from({ length: sets }, () => []);
  for (let k = 0; k < sets * n; k++) out[k % sets].push(sorted[k]);
  return out;
}

/**
 * What Merge all would do for one item: copies per tier in (`counts[tier]`), merging up to tier
 * `upTo` (index; results at `upTo` aren't merged again). Each tier's results join the next tier.
 * Returns the merges and the copies per tier afterwards.
 */
export function mergePreview(counts: readonly number[], n: number, upTo: number): { merges: number; after: number[] } {
  const after = [...counts];
  let merges = 0;
  for (let t = 0; t < Math.min(upTo, after.length - 1); t++) {
    const m = Math.floor(after[t] / n);
    if (!m) continue;
    merges += m;
    after[t] -= m * n;
    after[t + 1] += m;
  }
  return { merges, after };
}

// ------------------------------------------------------------------ ♻️ scrap all
export interface ScrapFilter {
  /** Only copies at or below this tier (index). */
  maxGrade: number;
  /** Leave copies with a variant (Shiny, Golden…) alone. */
  keepVariants: boolean;
}

/**
 * Which copies of ONE item Scrap all takes. `all` = every copy you own of it (worn, placed and
 * limited ones too: they count as copies you keep); `usable` = the ones that may be scrapped (not
 * worn / placed / limited). You always keep at least one copy: if the filter would take every
 * last one, the best of them stays. `keptLast` says that happened.
 */
export function planScrap<T extends BulkItem>(g: GradesConfig, variants: ReadonlyArray<{ id: string; valueMult?: number }>, all: readonly T[], usable: readonly T[], f: ScrapFilter): { scrap: T[]; keptLast: boolean } {
  const take = usable.filter((i) => i.serial === null && gradeIndex(g, i.grade) <= f.maxGrade && (!f.keepVariants || variantParts(i.variant).length === 0));
  if (all.length - take.length >= 1) return { scrap: take, keptLast: false };
  const best = [...take].sort((a, b) => compareCopies(g, variants, b, a))[0];
  return { scrap: take.filter((i) => i !== best), keptLast: true };
}

/** How many of `count` copies you can scrap when you own `owned` of the item: never the last one. */
export function scrapAllowed(owned: number, count: number): number {
  return Math.max(0, Math.min(count, owned - 1));
}

// ------------------------------------------------------------------ 📖 best ever (Item Index)
export interface ItemBest {
  grade: string;
  variant: string;
}

/** The best tier and the best variant seen so far (each on its own: they may be from different
 *  copies). Returns the new best, or null if this copy doesn't beat it. */
export function improveBest(g: GradesConfig, variants: ReadonlyArray<{ id: string; valueMult?: number }>, cur: ItemBest | undefined, it: { grade?: string; variant: string }): ItemBest | null {
  const grade = it.grade ?? g.grades[0].id;
  if (!cur) return { grade, variant: it.variant };
  const betterG = gradeIndex(g, grade) > gradeIndex(g, cur.grade);
  const betterV = variantScore(variants, it.variant) > variantScore(variants, cur.variant);
  if (!betterG && !betterV) return null;
  return { grade: betterG ? grade : cur.grade, variant: betterV ? it.variant : cur.variant };
}
