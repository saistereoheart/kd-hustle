import { describe, expect, it } from 'vitest';
import gradesJson from '../../config/grades.json';
import { bestVariant, gearBonuses, gearBuff, gradeMult, gradesConfigSchema, nextGrade, rerollGrade, rollGrade } from './grades';

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
