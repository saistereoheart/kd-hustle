import { describe, expect, it } from 'vitest';
import gradesJson from '../../config/grades.json';
import itemsJson from '../../config/items.json';
import raritiesJson from '../../config/rarities.json';
import { cashierStats, chefStats, gearBonuses, gradesConfigSchema, isStriva, softCap } from './grades';

const g = gradesConfigSchema.parse(gradesJson);
const rar = raritiesJson as { tiers: Array<{ id: string }>; variants: Array<{ id: string; oneIn: number }> };
const tiers = rar.tiers.map((t) => t.id);
const items = (itemsJson as { items: Array<{ id: string; type: string; rarity: string }> }).items;
const STRIVA = { grade: 'S', variant: 'shiny+golden+rainbow' };
const LOOKS = [{ grade: 'D', variant: 'normal' }, { grade: 'B', variant: 'shiny' }, { grade: 'A', variant: 'golden+rainbow' }, STRIVA];
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe('🌈 STRIVA', () => {
  it('is the top tier with every special variant, nothing less', () => {
    expect(isStriva(g, rar.variants, 'S', 'shiny+golden+rainbow')).toBe(true);
    expect(isStriva(g, rar.variants, 'S', 'golden+rainbow')).toBe(false);
    expect(isStriva(g, rar.variants, 'A', 'shiny+golden+rainbow')).toBe(false);
    expect(isStriva(g, rar.variants, undefined, 'shiny+golden+rainbow')).toBe(false);
  });
});

describe('soft caps: a rarer piece always shows more (no two rarities stuck at the same cap)', () => {
  it('softCap: in full up to the knee, then always rising, never past the cap', () => {
    const cap = g.buffs.caps.chefFlavour;
    expect(softCap(g, 'chefFlavour', cap * 0.5)).toBe(cap * 0.5);
    let last = 0;
    for (let v = 0.1; v < cap * 4; v += 0.1) {
      const s = softCap(g, 'chefFlavour', v);
      expect(s).toBeGreaterThan(last);
      expect(s).toBeLessThan(cap);
      last = s;
    }
  });

  for (const [type, stats] of [['chef', chefStats], ['cashier', cashierStats]] as const) {
    it(`${type}s: at the same tier and variants, every rarity's total beats the rarity below`, () => {
      const list = items.filter((i) => i.type === type);
      for (const look of LOOKS) {
        const byTier = new Map<number, number[]>();
        for (const it of list) {
          const t = tiers.indexOf(it.rarity);
          byTier.set(t, [...(byTier.get(t) ?? []), sum(stats(g, { id: it.id, rarity: it.rarity, ...look }) as unknown as Record<string, number>)]);
        }
        const ordered = [...byTier.entries()].sort((a, b) => a[0] - b[0]);
        for (let k = 1; k < ordered.length; k++) {
          expect(Math.min(...ordered[k][1]), `${type} ${look.grade} ${look.variant}: ${tiers[ordered[k][0]]} vs ${tiers[ordered[k - 1][0]]}`).toBeGreaterThan(Math.max(...ordered[k - 1][1]));
        }
      }
    });
  }

  it('Striva Grandmaster Teh (mythic) and Sambal Sultan (legendary) differ, and the mythic is stronger overall', () => {
    const teh = chefStats(g, { id: 'chef_grandmaster_teh', rarity: 'mythic', ...STRIVA });
    const sultan = chefStats(g, { id: 'chef_sambal_sultan', rarity: 'legendary', ...STRIVA });
    expect(teh).not.toEqual(sultan);
    expect(sum(teh)).toBeGreaterThan(sum(sultan));
  });

  it('gear: one Striva piece per rarity gives a bigger buff than the rarity below, for every stat', () => {
    for (const type of Object.keys(g.buffs.bySlot).filter((t) => t !== 'chef')) {
      let last = 0;
      for (const r of Object.keys(g.buffs.byRarity)) {
        const v = Object.values(gearBonuses(g, [{ type, rarity: r, ...STRIVA }]))[0] ?? 0;
        expect(v, `${type} ${r}`).toBeGreaterThan(last);
        last = v;
      }
    }
  });
});
