import { describe, expect, it } from 'vitest';
import gradesJson from '../../config/grades.json';
import { bestVariant, chefStats, mergeOutcome, pityForces, rerollVariantOutcome, rollGradeLuck, gearBonuses, gearBuff, gradeMult, gradesConfigSchema, nextGrade, rerollGrade, rollGrade } from './grades';
import { joinVariants, topVariant, variantParts, variantProduct } from './variants';

const cfg = gradesConfigSchema.parse(gradesJson);
let seed = 11;
const rand = (max: number) => (seed = (seed * 16807) % 2147483647) % max;

describe('item tiers (grades)', () => {
  it('roll mostly D, rarely S, roughly by weight', () => {
    const n = 20000;
    const count: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const g = rollGrade(cfg, rand);
      count[g] = (count[g] ?? 0) + 1;
    }
    const total = cfg.grades.reduce((a, g) => a + g.weight, 0);
    for (const g of cfg.grades) expect(count[g.id] / n).toBeCloseTo(g.weight / total, 1);
  });

  it('go up one step at a time and stop at the top', () => {
    expect(nextGrade(cfg, 'D')).toBe('C');
    expect(nextGrade(cfg, 'A')).toBe('S');
    expect(nextGrade(cfg, 'S')).toBeNull();
    expect(nextGrade(cfg, undefined)).toBe('C'); // old items are tier D
  });

  it('rerolls never make an item worse', () => {
    for (let i = 0; i < 500; i++) expect(['A', 'S']).toContain(rerollGrade(cfg, 'A', rand));
  });
});

describe('gear buffs', () => {
  it('rarity sets the base; tier and variant multiply it', () => {
    const base = gearBuff(cfg, { type: 'hat', rarity: 'legendary', grade: 'D', variant: 'normal' })!;
    expect(base).toEqual({ stat: 'luck', value: cfg.buffs.byRarity.legendary });
    const top = gearBuff(cfg, { type: 'hat', rarity: 'legendary', grade: 'S', variant: 'rainbow' })!;
    expect(top.value).toBeCloseTo(cfg.buffs.byRarity.legendary * gradeMult(cfg, 'S') * cfg.buffs.variantMult.rainbow);
    expect(gearBuff(cfg, { type: 'trinket', rarity: 'legendary', variant: 'normal' })).toBeNull(); // not wearable
  });

  it('adds up per stat across equipped items', () => {
    const b = gearBonuses(cfg, [
      { type: 'hat', rarity: 'common', variant: 'normal' },
      { type: 'face', rarity: 'rare', grade: 'C', variant: 'shiny' },
    ]);
    expect(b.luck).toBeCloseTo(0.01);
    expect(b.xp).toBeCloseTo(0.04 * 1.5 * 1.5);
  });

  it('chefs use their own, stronger table', () => {
    const c = gearBuff(cfg, { type: 'chef', rarity: 'epic', grade: 'B', variant: 'golden' })!;
    expect(c.stat).toBe('chef');
    expect(c.value).toBeCloseTo(cfg.buffs.chefByRarity.epic * gradeMult(cfg, 'B') * cfg.buffs.variantMult.golden);
    expect(cfg.buffs.chefByRarity.common).toBeGreaterThan(cfg.buffs.byRarity.common);
  });

  it('a merged item keeps the best variant of its inputs', () => {
    const order = ['normal', 'shiny', 'golden', 'rainbow'];
    expect(bestVariant(order, ['normal', 'normal', 'golden', 'shiny', 'normal'])).toBe('golden');
  });
});

describe('head chef stats', () => {
  it('split the rarity buff by the chef profile, × tier × variant × (1 + Chef Academy)', () => {
    const base = cfg.buffs.chefByRarity.common;
    const p = cfg.buffs.chefProfiles.chef_mak_senah;
    const s = chefStats(cfg, { id: 'chef_mak_senah', rarity: 'common', grade: 'D', variant: 'normal' });
    expect(s.speed).toBeCloseTo(base * p.speed);
    expect(s.flavour).toBeCloseTo(base * p.flavour);
    const boosted = chefStats(cfg, { id: 'chef_mak_senah', rarity: 'common', grade: 'S', variant: 'golden' }, 0.5);
    expect(boosted.charm).toBeCloseTo(base * p.charm * gradeMult(cfg, 'S') * cfg.buffs.variantMult.golden * 1.5);
  });
  it('chefs are not counted twice as plain gear', () => {
    expect(gearBonuses(cfg, [{ type: 'chef', rarity: 'epic', variant: 'normal' }])).toEqual({});
  });
});

describe('multi-variant items, luck rerolls, pity and merging', () => {
  const variants = [
    { id: 'normal', oneIn: 1 }, { id: 'shiny', oneIn: 20 }, { id: 'golden', oneIn: 100 }, { id: 'rainbow', oneIn: 1000 },
  ];
  it('variants stack, sorted rarest last, and multiply', () => {
    expect(joinVariants(variants.map((v) => v.id), ['golden', 'shiny', 'golden', 'normal'])).toBe('shiny+golden');
    expect(variantParts('normal')).toEqual([]);
    expect(topVariant('shiny+golden')).toBe('golden');
    expect(variantProduct(cfg.buffs.variantMult, 'shiny+golden')).toBeCloseTo(cfg.buffs.variantMult.shiny * cfg.buffs.variantMult.golden);
  });
  it('luck makes better tiers likelier', () => {
    const share = (luck: number) => {
      let r = 3;
      const rnd = (max: number) => (r = (r * 16807) % 2147483647) % max;
      let up = 0;
      for (let i = 0; i < 20000; i++) if (rollGradeLuck(cfg, rnd, luck) !== 'D') up++;
      return up / 20000;
    };
    expect(share(3)).toBeGreaterThan(share(1) * 1.8);
  });
  it('hard pity forces an upgrade; a variant reroll adds instead of replacing', () => {
    const p = cfg.rerollPity.variant;
    const o = rerollVariantOutcome(cfg, variants, 'golden', () => 999_999, 1, p.hard - 1);
    expect(o).toMatchObject({ forced: true, improved: true, result: 'shiny+golden' });
    const miss = rerollVariantOutcome(cfg, variants, 'golden', () => 999_999, 1, 0);
    expect(miss).toMatchObject({ improved: false, result: 'golden' });
    expect(pityForces(cfg.rerollPity.grade, 0, () => 0)).toBe(false);
  });
  it('merging: a tier above the lowest (not below the highest), every variant kept, maybe a bonus', () => {
    const none = mergeOutcome(cfg, variants, [{ grade: 'D', variant: 'shiny' }, { grade: 'D', variant: 'normal' }, { grade: 'B', variant: 'golden' }], () => 999_999);
    expect(none).toEqual({ grade: 'B', variant: 'shiny+golden', bonus: null });
    const lucky = mergeOutcome(cfg, variants, [{ grade: 'C', variant: 'shiny' }, { grade: 'C', variant: 'normal' }, { grade: 'C', variant: 'normal' }], () => 0);
    expect(lucky.grade).toBe('B');
    expect(lucky.bonus).not.toBeNull();
    expect(variantParts(lucky.variant)).toContain('shiny');
    expect(variantParts(lucky.variant)).toHaveLength(2);
  });
});
