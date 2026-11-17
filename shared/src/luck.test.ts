import { describe, expect, it } from 'vitest';
import cratesJson from '../config/crates.json';
import itemsJson from '../config/items.json';
import raritiesJson from '../config/rarities.json';
import { cratesConfigSchema, itemsConfigSchema, raritiesConfigSchema, validateEconomyConfigs } from './economy/schemas';
import {
  crateOdds, formatOneIn, itemValueSen, nextPity, pawnPriceSen, rollCrate, rollVariant, scrapShards, totalLuck,
  type RandInt,
} from './luck';

const rar = raritiesConfigSchema.parse(raritiesJson);
const itemsCfg = itemsConfigSchema.parse(itemsJson);
const crates = cratesConfigSchema.parse(cratesJson);
const items = new Map(itemsCfg.items.map((i) => [i.id, i]));
const crate = (id: string) => crates.crates.find((c) => c.id === id)!;

/** Seeded PRNG (mulberry32) so statistical tests are repeatable. */
function seeded(seed: number): RandInt {
  let a = seed >>> 0;
  return (max: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(u * max);
  };
}

describe('config sanity', () => {
  it('every item is in exactly one crate and every rarity exists', () => {
    expect(validateEconomyConfigs(rar, itemsCfg, crates)).toEqual([]);
  });
  it('base tier weights add up to 100% and match the spec table', () => {
    const sum = rar.tiers.reduce((a, t) => a + t.weight, 0);
    expect(sum).toBe(100000);
    const oneIn = Object.fromEntries(rar.tiers.map((t) => [t.id, Math.round(sum / t.weight)]));
    expect(oneIn).toMatchObject({ common: 2, uncommon: 4, rare: 8, epic: 18, legendary: 50, mythic: 222, divine: 2041, secret: 100000 });
  });
});

describe('totalLuck', () => {
  it('multiplies within a type and adds across types', () => {
    expect(totalLuck([], 50)).toBe(1);
    expect(totalLuck([{ type: 'potion', mult: 2 }, { type: 'potion', mult: 2 }], 50)).toBe(4);
    expect(totalLuck([{ type: 'potion', mult: 4 }, { type: 'title', mult: 1.5 }], 50)).toBeCloseTo(4.5);
    expect(totalLuck([{ type: 'upgrade', mult: 1.25 }, { type: 'event', mult: 2 }, { type: 'item', mult: 1.1 }], 50)).toBeCloseTo(2.35);
  });
  it('is capped and ignores junk multipliers', () => {
    expect(totalLuck([{ type: 'potion', mult: 1000 }], 50)).toBe(50);
    expect(totalLuck([{ type: 'potion', mult: NaN }, { type: 'item', mult: -3 }], 50)).toBe(1);
  });
});

describe('crateOdds', () => {
  it('sums to 1 and shows 0 for tiers the crate cannot drop', () => {
    for (const c of crates.crates) {
      const odds = crateOdds(rar, c, items, 1);
      expect(odds.reduce((a, o) => a + o.p, 0)).toBeCloseTo(1, 10);
    }
    const capsule = crateOdds(rar, crate('capsule'), items, 1);
    expect(capsule.find((o) => o.tier === 'secret')!.p).toBe(0);
    expect(formatOneIn(capsule.find((o) => o.tier === 'secret')!.oneIn)).toBe('—');
  });
  it('luck raises Rare+ and lowers Common/Uncommon', () => {
    const base = crateOdds(rar, crate('mallbox'), items, 1);
    const lucky = crateOdds(rar, crate('mallbox'), items, 2);
    for (const t of ['rare', 'epic', 'legendary', 'mythic', 'divine', 'secret']) {
      expect(lucky.find((o) => o.tier === t)!.p).toBeGreaterThan(base.find((o) => o.tier === t)!.p);
    }
    expect(lucky[0].p).toBeLessThan(base[0].p);
    // Ratios inside the boosted group stay the same.
    expect(lucky[3].p / lucky[2].p).toBeCloseTo(base[3].p / base[2].p, 10);
  });
});

describe('rollCrate', () => {
  it('matches the advertised odds over many rolls', () => {
    const rand = seeded(42);
    const N = 300_000;
    const counts = new Map<string, number>();
    const odds = crateOdds(rar, crate('mallbox'), items, 1);
    const pityOff = { sinceEpic: -1e9, sinceLegendary: -1e9 };
    for (let i = 0; i < N; i++) {
      const r = rollCrate(rar, crate('mallbox'), items, 1, pityOff, rand);
      counts.set(r.tier, (counts.get(r.tier) ?? 0) + 1);
      expect(items.get(r.itemId)!.rarity).toBe(r.tier);
    }
    for (const o of odds) {
      if (o.p < 0.001) continue; // too rare to check tightly at this N
      const observed = (counts.get(o.tier) ?? 0) / N;
      const sd = Math.sqrt((o.p * (1 - o.p)) / N);
      expect(Math.abs(observed - o.p)).toBeLessThan(5 * sd);
    }
  });

  it('pity guarantees Legendary+ and Epic+ on schedule', () => {
    const rand = seeded(7);
    const c = crate('capsule');
    for (let i = 0; i < 200; i++) {
      const leg = rollCrate(rar, c, items, 1, { sinceEpic: 0, sinceLegendary: c.pity.legendary - 1 }, rand);
      expect(leg.tierIndex).toBeGreaterThanOrEqual(rar.tiers.findIndex((t) => t.id === 'legendary'));
      const epic = rollCrate(rar, c, items, 1, { sinceEpic: c.pity.epic - 1, sinceLegendary: 10 }, rand);
      expect(epic.tierIndex).toBeGreaterThanOrEqual(rar.tiers.findIndex((t) => t.id === 'epic'));
    }
  });

  it('updates pity counters', () => {
    const epic = rar.tiers.findIndex((t) => t.id === 'epic');
    const leg = rar.tiers.findIndex((t) => t.id === 'legendary');
    expect(nextPity(rar, { sinceEpic: 5, sinceLegendary: 9 }, 0)).toEqual({ sinceEpic: 6, sinceLegendary: 10 });
    expect(nextPity(rar, { sinceEpic: 5, sinceLegendary: 9 }, epic)).toEqual({ sinceEpic: 0, sinceLegendary: 10 });
    expect(nextPity(rar, { sinceEpic: 5, sinceLegendary: 9 }, leg)).toEqual({ sinceEpic: 0, sinceLegendary: 0 });
  });

  it('never drops sold-out limited items', () => {
    const rand = seeded(3);
    const c = crate('mallbox');
    const soldOut = new Set(['tan_sri_songkok', 'durian_crown']);
    for (let i = 0; i < 5000; i++) {
      const r = rollCrate(rar, c, items, 50, { sinceEpic: 0, sinceLegendary: 0 }, rand, soldOut);
      expect(soldOut.has(r.itemId)).toBe(false);
    }
  });

  it('rolls variants at roughly 1/20, 1/100, 1/1000', () => {
    const rand = seeded(99);
    const N = 400_000;
    const c = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const v = rollVariant(rar, rand);
      c.set(v, (c.get(v) ?? 0) + 1);
    }
    expect((c.get('shiny') ?? 0) / N).toBeCloseTo(1 / 20, 2);
    expect((c.get('golden') ?? 0) / N).toBeCloseTo(1 / 100, 2);
    expect((c.get('rainbow') ?? 0) / N).toBeCloseTo(1 / 1000, 3);
  });
});

describe('values', () => {
  it('prices items from crate price × rarity × variant, and the pawn shop pays less', () => {
    const duck = items.get('rubber_duck')!;
    const cap = crate('capsule');
    expect(itemValueSen(rar, duck, cap, 'normal')).toBe(600); // RM 20 × 0.3
    expect(itemValueSen(rar, duck, cap, 'golden')).toBe(3000);
    expect(pawnPriceSen(rar, duck, cap, 'normal', 0.5)).toBe(300);
    expect(scrapShards(rar, duck, 'rainbow')).toBe(25);
  });
  it('the house keeps an edge: expected pawn value of a roll is below the crate price', () => {
    for (const c of crates.crates) {
      const odds = crateOdds(rar, c, items, 1);
      let ev = 0;
      for (const o of odds) {
        if (!o.p) continue;
        const tier = rar.tiers.find((t) => t.id === o.tier)!;
        ev += o.p * c.priceSen * tier.valueFactor * 0.5;
      }
      expect(ev).toBeLessThan(c.priceSen);
    }
  });
});
