import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cycleMs, levelCostSen, maxAffordable, retailDemand, revenuePerCycleSen, type RandInt } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { Economy } from '../economy/economy';
import { emptyProgress } from '../progression/progression';
import { BusinessSystem } from './business';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const bc = cfg.businesses;
const carwash = bc.types.find((t) => t.id === 'carwash')!;

function seeded(seed: number): RandInt {
  let a = seed >>> 0;
  return (max: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max);
  };
}

function setup(walletSen = 1_000_000_000, mult = 1) {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const id = repos.accounts.create('boss', 'h', false, { x: 0, y: 0 }, 2, walletSen);
  const p = {
    id, name: 'boss', walletSen, shards: 0, inventory: [], equipped: {}, cosmetics: {}, index: new Set<string>(), pages: new Set<string>(), pity: {}, jobs: {}, skills: {},
    prog: emptyProgress(),
  } as unknown as OnlinePlayer;
  p.prog.stage = 6;
  let now = 1_000_000;
  const econ = new Economy(repos, cfg);
  const biz = new BusinessSystem(cfg, repos, econ, seeded(5), { wallet: () => {}, changed: () => {}, incomeMult: () => mult }, () => now);
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 1000) {
      now += 1000;
      biz.tick(p);
    }
  };
  return { repos, p, biz, advance, setNow: (t: number) => (now = t), now: () => now };
}

describe('idle businesses', () => {
  it('levels cost more each time (geometric), and buying needs the stage and the money', () => {
    expect(levelCostSen(bc, carwash, 0, 1)).toBe(carwash.baseCostSen);
    expect(levelCostSen(bc, carwash, 0, 3)).toBe(levelCostSen(bc, carwash, 0, 1) + levelCostSen(bc, carwash, 1, 1) + levelCostSen(bc, carwash, 2, 1));
    const { n, costSen } = maxAffordable(bc, carwash, 0, carwash.baseCostSen * 3);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(costSen).toBeLessThanOrEqual(carwash.baseCostSen * 3);
    const s = setup();
    s.p.prog.stage = 1;
    expect(() => s.biz.buyLevels(s.p, 'carwash', 1)).toThrow(/stage/);
    s.p.prog.stage = 6;
    const w = s.p.walletSen;
    s.biz.buyLevels(s.p, 'carwash', 5);
    expect(w - s.p.walletSen).toBe(levelCostSen(bc, carwash, 0, 5));
    const poor = setup(100);
    expect(() => poor.biz.buyLevels(poor.p, 'carwash', 1)).toThrow(/money/);
  });

  it('milestones double the speed', () => {
    expect(cycleMs(bc, carwash, bc.milestones[0])).toBeCloseTo(cycleMs(bc, carwash, 1) / bc.milestoneSpeedMult);
    expect(cycleMs(bc, carwash, bc.milestones[1])).toBeCloseTo(cycleMs(bc, carwash, 1) / bc.milestoneSpeedMult ** 2);
  });

  it('without a manager a finished cycle waits to be collected (one at a time)', () => {
    const s = setup();
    s.biz.buyLevels(s.p, 'carwash', 2);
    const w = s.p.walletSen;
    s.advance(cycleMs(bc, carwash, 2) * 5);
    expect(s.p.walletSen).toBe(w); // nothing paid by itself
    const { paidSen } = s.biz.collect(s.p, 'carwash');
    expect(paidSen).toBe(Math.round(revenuePerCycleSen(carwash, 2) * bc.storedCyclesWithoutManager * (1 - bc.taxRate)));
    expect(s.p.walletSen - w).toBe(paidSen);
  });

  it('a manager pays every cycle automatically (minus business tax, times the income multiplier)', () => {
    const s = setup(1_000_000_000, 1.5);
    s.biz.buyLevels(s.p, 'carwash', 3);
    s.biz.hireManager(s.p, 'carwash');
    const w = s.p.walletSen;
    const cycles = 20;
    s.advance(cycleMs(bc, carwash, 3) * cycles);
    const per = Math.round(revenuePerCycleSen(carwash, 3) * 1.5 * (1 - bc.taxRate));
    expect(s.p.walletSen - w).toBeGreaterThanOrEqual(per * (cycles - 1));
    expect(s.p.walletSen - w).toBeLessThanOrEqual(per * (cycles + 1));
  });

  it('rush needs enough fast taps, then triples output for a while (with a cooldown)', () => {
    const s = setup();
    s.biz.buyLevels(s.p, 'carwash', 1);
    expect(() => s.biz.rush(s.p, 'carwash', [0, 1000])).toThrow(/faster/);
    const taps = Array.from({ length: bc.rush.taps }, (_, i) => i * 200);
    s.biz.rush(s.p, 'carwash', taps);
    expect(() => s.biz.rush(s.p, 'carwash', taps)).toThrow(/cooling/);
    s.advance(cycleMs(bc, carwash, 1) + 10);
    const { paidSen } = s.biz.collect(s.p, 'carwash');
    expect(paidSen).toBe(Math.round(revenuePerCycleSen(carwash, 1) * bc.rush.mult * (1 - bc.taxRate)));
  });

  it('offline: managed businesses earn at the offline rate, capped', () => {
    const s = setup();
    s.biz.buyLevels(s.p, 'carwash', 4);
    s.biz.hireManager(s.p, 'carwash');
    const w = s.p.walletSen;
    s.setNow(s.now() + 100 * 3_600_000); // away 100 h
    const paid = s.biz.offline(s.p, 100 * 3_600_000, 8, 0.5);
    const perHour = (revenuePerCycleSen(carwash, 4) * 3_600_000) / cycleMs(bc, carwash, 4);
    expect(paid).toBeCloseTo(perHour * 8 * 0.5 * (1 - bc.taxRate), -3);
    expect(s.p.walletSen - w).toBe(paid);
  });

  it('counts half of what was spent towards net worth, and survives a reload', () => {
    const s = setup();
    s.biz.buyLevels(s.p, 'carwash', 3);
    expect(s.biz.assetsOf(s.p)).toBe(Math.round(levelCostSen(bc, carwash, 0, 3) * 0.5));
    s.biz.save(s.p);
    const again = new BusinessSystem(cfg, s.repos, new Economy(s.repos, cfg), seeded(1), { wallet: () => {}, changed: () => {}, incomeMult: () => 1 });
    expect(again.of(s.p).businesses.carwash.level).toBe(3);
  });
});

describe('retail shop', () => {
  it('demand falls as your price rises above the market value', () => {
    expect(retailDemand(bc, 100, 100)).toBeCloseTo(1);
    expect(retailDemand(bc, 150, 100)).toBeLessThan(0.5);
    expect(retailDemand(bc, 70, 100)).toBeGreaterThan(1);
  });

  it('a hired cashier sells stock at your prices', () => {
    const s = setup();
    s.biz.openShop(s.p);
    for (const pr of bc.retail.products) s.biz.buyStock(s.p, pr.id, 100);
    s.biz.setCashier(s.p, true);
    const w = s.p.walletSen;
    s.advance(10 * 60_000);
    const sh = s.biz.of(s.p).retail!;
    expect(sh.soldToday).toBeGreaterThan(10);
    expect(s.p.walletSen).toBeGreaterThan(w - bc.retail.cashierWagePerDaySen); // sales cover the wage
    expect(() => s.biz.buyStock(s.p, bc.retail.products[0].id, bc.retail.maxStockPerProduct)).toThrow(/up to/);
  });

  it('being the cashier: the right change in time pays a bonus; too fast is refused', () => {
    const s = setup();
    s.biz.openShop(s.p);
    for (const pr of bc.retail.products) s.biz.buyStock(s.p, pr.id, 50);
    const co = s.biz.checkoutStart(s.p);
    expect(() => s.biz.checkoutFinish(s.p, co.id, 0)).toThrow(/Too fast/);
    const co2 = s.biz.checkoutStart(s.p);
    s.setNow(s.now() + bc.retail.cashierMinMs + 500);
    const total = co2.items.reduce((a, i) => a + i.priceSen, 0);
    const right = co2.paidSen - total;
    expect(co2.options).toContain(right);
    const w = s.p.walletSen;
    const r = s.biz.checkoutFinish(s.p, co2.id, right);
    expect(r).toMatchObject({ correct: true, onTime: true });
    expect(r.bonusSen).toBe(Math.round(total * bc.retail.cashierBonus));
    expect(s.p.walletSen - w).toBe(total + r.bonusSen);
    // Wrong change: no bonus, and you lose the difference.
    const co3 = s.biz.checkoutStart(s.p);
    s.setNow(s.now() + bc.retail.cashierMinMs + 500);
    const t3 = co3.items.reduce((a, i) => a + i.priceSen, 0);
    const wrong = co3.options.find((o) => o !== co3.paidSen - t3)!;
    const w3 = s.p.walletSen;
    const r3 = s.biz.checkoutFinish(s.p, co3.id, wrong);
    expect(r3.correct).toBe(false);
    expect(s.p.walletSen - w3).toBe(t3 - Math.abs(wrong - (co3.paidSen - t3)));
  });
});
