import { describe, expect, it } from 'vitest';
import gradesJson from '../../config/grades.json';
import rarJson from '../../config/rarities.json';
import { gradesConfigSchema } from './grades';
import { improveBest, mergePreview, mergeSets, planScrap, scrapAllowed, variantScore } from './bulk';

const g = gradesConfigSchema.parse(gradesJson);
const V = rarJson.variants;
const cp = (iid: number, grade = 'D', variant = 'normal', serial: number | null = null) => ({ iid, itemId: 'x', grade, variant, serial });

describe('bulk merge', () => {
  it('makes whole sets only and spreads the variants over them', () => {
    const copies = [cp(1, 'D', 'shiny'), cp(2, 'D', 'golden'), ...Array.from({ length: 9 }, (_, k) => cp(10 + k))];
    const sets = mergeSets(copies, 5);
    expect(sets).toHaveLength(2);
    expect(sets.every((s) => s.length === 5)).toBe(true);
    // one variant in each set, not both in one
    expect(sets.map((s) => s.filter((c) => c.variant !== 'normal').length)).toEqual([1, 1]);
  });

  it('cascades up the tiers, stopping at the chosen tier', () => {
    // 25 D → 5 C → 1 B
    expect(mergePreview([25, 0, 0, 0, 0], 5, 4)).toEqual({ merges: 6, after: [0, 0, 1, 0, 0] });
    // only up to C
    expect(mergePreview([25, 0, 0, 0, 0], 5, 1)).toEqual({ merges: 5, after: [0, 5, 0, 0, 0] });
  });
});

describe('bulk scrap', () => {
  const f = { maxGrade: 4, keepVariants: false };
  it('never takes your last copy (keeps the best one)', () => {
    const all = [cp(1, 'D'), cp(2, 'C'), cp(3, 'D', 'shiny')];
    const r = planScrap(g, V, all, all, f);
    expect(r.keptLast).toBe(true);
    expect(r.scrap.map((c) => c.iid).sort()).toEqual([1, 3]); // the Tier C stays
  });

  it('a worn copy counts as the one you keep', () => {
    const all = [cp(1), cp(2), cp(3)];
    const r = planScrap(g, V, all, all.slice(1), f);
    expect(r).toEqual({ scrap: all.slice(1), keptLast: false });
  });

  it('respects the tier cap and leaves variants alone when asked', () => {
    const all = [cp(1, 'D'), cp(2, 'B'), cp(3, 'D', 'golden'), cp(4, 'D')];
    const r = planScrap(g, V, all, all, { maxGrade: 0, keepVariants: true });
    expect(r.scrap.map((c) => c.iid)).toEqual([1, 4]);
  });

  it('scrapAllowed stops one short of the last copy', () => {
    expect(scrapAllowed(3, 3)).toBe(2);
    expect(scrapAllowed(1, 1)).toBe(0);
    expect(scrapAllowed(10, 4)).toBe(4);
  });
});

describe('best ever', () => {
  it('keeps the highest tier and the best variant, each on its own', () => {
    let b = improveBest(g, V, undefined, { grade: 'C', variant: 'normal' })!;
    expect(improveBest(g, V, b, { grade: 'D', variant: 'normal' })).toBeNull();
    b = improveBest(g, V, b, { grade: 'D', variant: 'golden' })!;
    expect(b).toEqual({ grade: 'C', variant: 'golden' });
    b = improveBest(g, V, b, { grade: 'A', variant: 'shiny' })!;
    expect(b).toEqual({ grade: 'A', variant: 'golden' });
    expect(variantScore(V, 'shiny+golden')).toBe(10);
  });
});
