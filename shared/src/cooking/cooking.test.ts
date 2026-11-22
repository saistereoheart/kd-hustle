import { describe, expect, it } from 'vitest';
import recipesJson from '../../config/recipes.json';
import stallsJson from '../../config/stalls.json';
import timeJson from '../../config/time.json';
import { darkness, dayPhase, gameTime, inHours, rushHour, timeConfigSchema } from '../time/clock';
import { dishQuality, gradeStep, makeDish, meterZoneAt, recipesConfigSchema, validateDishInputs, type StepParams } from './cooking';
import {
  ageStock, customerRate, dishBaseSen, dishPay, masteryLevel, menuRecipes, NO_BONUS, orderBaseSen, queueCapacity, stallOpenNow, stallsConfigSchema,
  stockItems, stockPriceSen, takeStock, upgradeCostSen, wagePerHourSen, type StallState,
} from './stall';

const recipes = recipesConfigSchema.parse(recipesJson);
const stalls = stallsConfigSchema.parse(stallsJson);
const time = timeConfigSchema.parse(timeJson);
const nasi = recipes.recipes.find((r) => r.id === 'nasi_lemak')!;
let seed = 3;
const rand = (max: number) => (seed = (seed * 16807) % 2147483647) % max;
const stall = (o: Partial<StallState> = {}): StallState => ({
  tier: 1, plot: 'pasar_1', open: true, rep: 50, upgrades: {}, staff: 0, stock: {}, mastery: {}, combo: 0, perfectTokens: 0, investedSen: 0, buzzUntil: 0, ...o,
});

describe('the game clock', () => {
  it('runs an in-game hour per real minute and wraps at midnight', () => {
    const t0 = gameTime(time, 0);
    const t1 = gameTime(time, 60_000);
    expect(t1.total - t0.total).toBeCloseTo(60);
    expect(gameTime(time, 24 * 60_000).hourF).toBeCloseTo(t0.hourF);
  });

  it('knows opening hours that wrap past midnight, rush hours and dark', () => {
    expect(inHours(23, 17, 2)).toBe(true);
    expect(inHours(1.5, 17, 2)).toBe(true);
    expect(inHours(10, 17, 2)).toBe(false);
    expect(rushHour(time, 12.5)).toBe('Lunch rush');
    expect(rushHour(time, 16)).toBeNull();
    expect(dayPhase(time, 12)).toBe('day');
    expect(dayPhase(time, 23)).toBe('night');
    expect(darkness(time, 12)).toBe(0);
    expect(darkness(time, 1)).toBe(1);
    expect(darkness(time, 19)).toBeGreaterThan(0);
    expect(darkness(time, 19)).toBeLessThan(1);
  });
});

describe('building a dish', () => {
  it('makes the steps the recipe lists, with orders from the recipe options', () => {
    for (let i = 0; i < 20; i++) {
      const steps = makeDish(nasi, rand);
      expect(steps.map((s) => s.kind)).toEqual(nasi.steps.map((s) => s.kind));
      const box = steps.find((s) => s.kind === 'assemble') as Extract<StepParams, { kind: 'assemble' }>;
      expect(box.want.length).toBeGreaterThanOrEqual(3);
      expect(new Set(box.want).size).toBe(box.want.length);
      for (const id of box.want) expect(box.options.some((o) => o.id === id && !o.addon)).toBe(true);
      // Every add-on is a box too (so you have to pick the right ones).
      for (const a of nasi.addons) expect(box.options.some((o) => o.id === a.id && o.addon)).toBe(true);
      const hold = steps[0] as Extract<StepParams, { kind: 'hold' }>;
      expect(hold.zone[1] - hold.zone[0]).toBeCloseTo(0.16);
    }
  });

  it("puts the customer's add-ons into the order", () => {
    const steps = makeDish(nasi, rand, ['ayam_goreng', 'telur_mata', 'not_a_thing']);
    const box = steps.find((s) => s.kind === 'assemble') as Extract<StepParams, { kind: 'assemble' }>;
    expect(box.want).toContain('ayam_goreng');
    expect(box.want).toContain('telur_mata');
    expect(box.want).not.toContain('not_a_thing');
  });

  it('teh tarik: a cup, the tea, ice only when iced (1-3), the milk with its spoons; tarik only when hot', () => {
    const teh = recipes.recipes.find((r) => r.id === 'teh_tarik')!;
    let sawHot = false, sawIced = false;
    for (let i = 0; i < 40; i++) {
      const steps = makeDish(teh, rand, ['susu_pekat']);
      const box = steps[0] as Extract<StepParams, { kind: 'assemble' }>;
      const hot = box.want.includes('cup_panas');
      expect(hot !== box.want.includes('cup_ais')).toBe(true);
      expect(box.want.filter((x) => x === 'teh')).toHaveLength(1);
      const ice = box.want.filter((x) => x === 'ais').length;
      expect(hot ? ice === 0 : ice >= 1 && ice <= 3).toBe(true);
      const spoons = box.want.filter((x) => x === 'susu_pekat').length;
      expect(spoons).toBeGreaterThanOrEqual(1);
      expect(spoons).toBeLessThanOrEqual(3);
      expect(steps.some((s) => s.art === 'kole')).toBe(hot);
      expect(steps).toHaveLength(hot ? 2 : 1); // iced: just make it; hot: then tarik
      if (hot) sawHot = true;
      else sawIced = true;
    }
    expect(sawHot && sawIced).toBe(true);
  });

  it('counts matter: 2 spoons need exactly 2 taps', () => {
    const box: StepParams = {
      kind: 'assemble', label: '', hint: '', art: '', maxMs: 15000, fastMs: 6000,
      options: [{ id: 'teh', name: 'T', icon: '' }, { id: 'pekat', name: 'P', icon: '', addon: true }],
      want: ['teh', 'pekat', 'pekat'],
    };
    expect(gradeStep(recipes, box, [0, 300, 1, 600, 1, 900]).grade).toBe('perfect');
    expect(gradeStep(recipes, box, [0, 300, 1, 600]).grade).toBe('good'); // a spoon short
    expect(gradeStep(recipes, box, [0, 300, 1, 600, 1, 900, 1, 1200]).grade).toBe('good'); // a spoon too many
  });

  it('tarik slider: following the moving zone is Perfect, leaving it still is not', () => {
    const m: Extract<StepParams, { kind: 'track' }> = { kind: 'track', label: '', hint: '', art: 'kole', maxMs: 7000, durationMs: 5000, zone: [0.4, 0.6], wave: { amp: 0.22, periodMs: 2400, phase: 0 } };
    const follow: number[] = [];
    for (let t = 0; t < m.durationMs; t += 60) {
      const z = meterZoneAt(m, t + 30);
      follow.push(t, Math.round(((z[0] + z[1]) / 2) * 1000) / 1000);
    }
    expect(gradeStep(recipes, m, follow).grade).toBe('perfect');
    expect(['good', 'miss']).toContain(gradeStep(recipes, m, [0, 0.5]).grade);
    expect(validateDishInputs([m], [{ startMs: 0, ev: [0, 1.5] }], 9000)).toMatch(/slider/);
  });

  it('a moving zone has to be followed', () => {
    const m: Extract<StepParams, { kind: 'meter' }> = {
      kind: 'meter', label: '', hint: '', art: 'kole', maxMs: 7000, durationMs: 5000, zone: [0.4, 0.64], rise: 0.75, fall: 0.6, wave: { amp: 0.2, periodMs: 2300, phase: 0 },
    };
    // Follow it: hold whenever the level is under the zone's middle (20 ms steps, like the grader).
    const follow: number[] = [];
    let v = 0.15, holding = false;
    for (let t = 0; t < m.durationMs; t += 20) {
      const z = meterZoneAt(m, t);
      const want = v < (z[0] + z[1]) / 2;
      if (want !== holding) {
        follow.push(t);
        holding = want;
      }
      v = Math.max(0, Math.min(1, v + ((holding ? m.rise : -m.fall) * 20) / 1000));
    }
    if (holding) follow.push(m.durationMs);
    expect(gradeStep(recipes, m, follow).grade).toBe('perfect');
    // Holding at the zone's starting height (ignoring the movement) isn't enough.
    const still: number[] = [0, 500];
    for (let t = 600; t < m.durationMs; t += 200) still.push(t, t + 89);
    expect(['good', 'miss']).toContain(gradeStep(recipes, m, still).grade);
  });

  it('lists the order in tray order: base sides first, then add-ons', () => {
    for (let i = 0; i < 20; i++) {
      const steps = makeDish(nasi, rand, ['telur_mata', 'ayam_goreng']);
      const box = steps.find((s) => s.kind === 'assemble') as Extract<StepParams, { kind: 'assemble' }>;
      const idx = box.want.map((id) => box.options.findIndex((o) => o.id === id));
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
      expect(box.want.slice(-2)).toEqual(['ayam_goreng', 'telur_mata']);
    }
  });
});

describe('add-ons', () => {
  it('cost extra on top of the dish, at the stall tier price', () => {
    const s = stall({ tier: 2 });
    const plain = orderBaseSen(stalls, nasi, s, false);
    const ayam = nasi.addons.find((a) => a.id === 'ayam_goreng')!;
    expect(plain).toBe(dishBaseSen(stalls, nasi, s, false));
    expect(orderBaseSen(stalls, nasi, s, false, ['ayam_goreng'])).toBe(plain + Math.round(ayam.basePriceSen * stalls.tiers[1].priceMult));
  });

  it('are stocked separately, listed after their dish', () => {
    const items = stockItems(stalls, recipes.recipes, stall()).map((i) => i.id);
    expect(items[0]).toBe('nasi_lemak');
    for (const a of nasi.addons) expect(items).toContain(a.id);
    expect(items).not.toContain('teh_tarik'); // not unlocked yet
  });
});

describe('assembling an order', () => {
  const box: StepParams = {
    kind: 'assemble', label: '', hint: '', art: '', maxMs: 15000, fastMs: 6000,
    options: [{ id: 'a', name: 'A', icon: '' }, { id: 'b', name: 'B', icon: '' }, { id: 'c', name: 'C', icon: '' }, { id: 'x', name: 'X', icon: '', addon: true }],
    want: ['a', 'c', 'x'],
  };
  it('all the right boxes quickly = Perfect, slowly = Great, any order', () => {
    expect(gradeStep(recipes, box, [2, 500, 3, 900, 0, 1400]).grade).toBe('perfect');
    expect(gradeStep(recipes, box, [0, 500, 2, 900, 3, 9000]).grade).toBe('great');
  });
  it('a wrong box or a missing add-on costs you', () => {
    expect(gradeStep(recipes, box, [0, 500, 2, 900, 1, 1000, 3, 1200]).grade).toBe('good');
    expect(gradeStep(recipes, box, [0, 500, 2, 900]).grade).toBe('good');
    expect(gradeStep(recipes, box, [1, 500]).grade).toBe('miss');
  });
  it('rejects taps on boxes that do not exist', () => {
    expect(validateDishInputs([box], [{ startMs: 0, ev: [7, 100] }], 5000)).toMatch(/box/);
  });
});

describe('grading steps', () => {
  const hold: StepParams = { kind: 'hold', label: '', hint: '', art: '', maxMs: 5000, fillMs: 1000, zone: [0.6, 0.8] };
  const timing: StepParams = { kind: 'timing', label: '', hint: '', art: '', maxMs: 5000, targetMs: 2000 };
  const rhythm: StepParams = { kind: 'rhythm', label: '', hint: '', art: '', maxMs: 5000, beats: [1000, 1500, 2000, 2500] };
  const seq: StepParams = { kind: 'sequence', label: '', hint: '', art: '', maxMs: 9000, options: [{ id: 'a', name: 'A', icon: '' }, { id: 'b', name: 'B', icon: '' }, { id: 'c', name: 'C', icon: '' }], order: ['b', 'a', 'c'] };
  const path: StepParams = { kind: 'path', label: '', hint: '', art: '', maxMs: 9000, points: [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8]], radius: 0.08 };
  const meter: StepParams = { kind: 'meter', label: '', hint: '', art: '', maxMs: 6000, durationMs: 2000, zone: [0.4, 0.7], rise: 0.6, fall: 0.4 };

  it('hold: release in the middle of the zone = Perfect, outside = Miss', () => {
    expect(gradeStep(recipes, hold, [100, 800]).grade).toBe('perfect');
    expect(gradeStep(recipes, hold, [100, 870]).grade).toBe('great');
    expect(gradeStep(recipes, hold, [100, 400]).grade).toBe('miss');
    expect(gradeStep(recipes, hold, []).grade).toBe('miss');
  });

  it('timing: closer to the moment is better; better equipment forgives more', () => {
    expect(gradeStep(recipes, timing, [2050]).grade).toBe('perfect');
    expect(gradeStep(recipes, timing, [2200]).grade).toBe('great');
    expect(gradeStep(recipes, timing, [2350]).grade).toBe('good');
    expect(gradeStep(recipes, timing, [2600]).grade).toBe('miss');
    expect(gradeStep(recipes, timing, [2600], 1.6).grade).not.toBe('miss');
  });

  it('rhythm: on the beat = Perfect; mashing the button = Miss', () => {
    expect(gradeStep(recipes, rhythm, [1010, 1490, 2030, 2500]).grade).toBe('perfect');
    expect(gradeStep(recipes, rhythm, [1010, 1490]).grade).toBe('good');
    expect(gradeStep(recipes, rhythm, [1010]).grade).toBe('miss');
    expect(gradeStep(recipes, rhythm, Array.from({ length: 40 }, (_, i) => i * 70)).grade).toBe('miss');
  });

  it('sequence: the exact order = Perfect, mostly right = Good', () => {
    expect(gradeStep(recipes, seq, [1, 100, 0, 200, 2, 300]).grade).toBe('perfect');
    expect(gradeStep(recipes, seq, [1, 100, 2, 200, 2, 300]).grade).toBe('good');
    expect(gradeStep(recipes, seq, [0, 100, 2, 200, 1, 300]).grade).toBe('miss');
  });

  it('path: passing every dot in order = Perfect, skipping = less', () => {
    expect(gradeStep(recipes, path, [0.2, 0.2, 10, 0.5, 0.2, 20, 0.8, 0.2, 30, 0.8, 0.5, 40, 0.8, 0.8, 50]).grade).toBe('perfect');
    // Dots out of order don't count.
    expect(gradeStep(recipes, path, [0.8, 0.8, 10, 0.8, 0.2, 20]).grade).toBe('miss');
  });

  it('meter: keeping it in the zone scores; never pressing does not', () => {
    // Rise from 0.15 to ~0.51 (0.6 s), then hold 40% of the time to keep it level.
    const ev: number[] = [0, 600];
    for (let t = 700; t < 2000; t += 200) ev.push(t, t + 80);
    expect(gradeStep(recipes, meter, ev).grade).toBe('perfect');
    // Holding the whole time overflows the zone.
    expect(gradeStep(recipes, meter, [0, 2000]).grade).toBe('miss');
    expect(gradeStep(recipes, meter, []).grade).toBe('miss');
  });

  it('turns step grades into a dish quality', () => {
    expect(dishQuality(recipes, ['perfect', 'perfect', 'perfect']).quality).toBe('perfect');
    expect(dishQuality(recipes, ['perfect', 'great', 'great']).quality).toBe('great');
    expect(dishQuality(recipes, ['good', 'good', 'good']).quality).toBe('ok');
    expect(dishQuality(recipes, ['miss', 'miss', 'good']).quality).toBe('burnt');
    expect(dishQuality(recipes, ['perfect']).mult).toBe(1.8);
  });

  it('rejects impossible submissions (too fast, out of order, wrong step count)', () => {
    const steps = [timing, hold];
    expect(validateDishInputs(steps, [{ startMs: 0, ev: [2000] }, { startMs: 2600, ev: [100, 800] }], 4000)).toBeNull();
    expect(validateDishInputs(steps, [{ startMs: 0, ev: [2000] }, { startMs: 2600, ev: [100, 800] }], 1000)).toMatch(/faster/);
    expect(validateDishInputs(steps, [{ startMs: 0, ev: [2000] }], 9000)).toMatch(/steps/);
    expect(validateDishInputs(steps, [{ startMs: 3000, ev: [2000] }, { startMs: 100, ev: [1, 2] }], 9000)).toMatch(/order/);
  });
});

describe('stall economics', () => {
  it('prices dishes by tier, mastery, rush and skills', () => {
    const base = dishBaseSen(stalls, nasi, stall(), false);
    expect(base).toBe(nasi.basePriceSen);
    expect(dishBaseSen(stalls, nasi, stall({ tier: 2 }), false)).toBe(Math.round(nasi.basePriceSen * stalls.tiers[1].priceMult));
    expect(dishBaseSen(stalls, nasi, stall(), true)).toBe(Math.round(base * stalls.rush.price));
    expect(dishBaseSen(stalls, nasi, stall({ mastery: { nasi_lemak: 30 } }), false)).toBe(Math.round(base * (1 + 2 * stalls.mastery.pricePerLevel)));
    expect(dishBaseSen(stalls, nasi, stall(), false, { ...NO_BONUS, dishPrice: 0.1 })).toBe(Math.round(base * 1.1));
  });

  it('pays quality × combo, tips for Great+ and 5× for the food blogger', () => {
    // (The tip comes from the base price, not the price after quality and combo.)
    expect(dishPay(stalls, 1000, 1.8, 'perfect', 0.1, 1, false)).toEqual({ paySen: 1980, tipSen: Math.round(1000 * stalls.tips.max) });
    expect(dishPay(stalls, 1000, 1, 'good', 0, 1, false).tipSen).toBe(0);
    expect(dishPay(stalls, 1000, 1.3, 'great', 0, 0, false).tipSen).toBe(0); // they waited too long
    expect(dishPay(stalls, 1000, 1, 'good', 0, 1, true).paySen).toBe(1000 * stalls.blogger.payMult);
  });

  it('customers come faster with reputation, signage, rush and skills', () => {
    const base = customerRate(stalls, stall(), false, 0);
    expect(customerRate(stalls, stall({ rep: 100 }), false, 0)).toBeGreaterThan(base);
    expect(customerRate(stalls, stall({ upgrades: { signage: 2 } }), false, 0)).toBeCloseTo(base * 1.2);
    // A well-run stall in a rush: the rush multiplier on top of everything.
    const good = stall({ rep: 100, upgrades: { signage: 3 } });
    expect(customerRate(stalls, good, true, 0)).toBeCloseTo(customerRate(stalls, good, false, 0) * stalls.rush.customers);
    expect(customerRate(stalls, stall({ buzzUntil: 10 }), false, 0)).toBeCloseTo(base * stalls.blogger.boostCustomers);
    expect(customerRate(stalls, stall(), false, 0, { ...NO_BONUS, customerBuff: 2 })).toBeCloseTo(base * 2);
    expect(queueCapacity(stalls, stall({ upgrades: { queue: 2 } }))).toBe(stalls.tiers[0].queueBase + 2);
    expect(queueCapacity(stalls, stall(), true)).toBe(stalls.tiers[0].queueBase + stalls.rush.extraQueue);
  });

  it('keeps foot traffic fair: a floor for every stall, and a busy rush for everyone', () => {
    const tierBase = stalls.tiers[0].customersPerMin;
    // Reputation 0, no upgrades: still at least the floor.
    expect(customerRate(stalls, stall({ rep: 0 }), false, 0)).toBeGreaterThanOrEqual(tierBase * stalls.minCustomersMult - 1e-9);
    // In a rush every stall gets at least the rush floor, however new it is.
    expect(customerRate(stalls, stall({ rep: 0 }), true, 0)).toBeCloseTo(tierBase * stalls.rush.floorMult);
    expect(customerRate(stalls, stall(), true, 0)).toBeGreaterThanOrEqual(tierBase * stalls.rush.floorMult - 1e-9);
    // Reputation still matters, but a top stall gets less than 2× a brand-new one.
    const ratio = customerRate(stalls, stall({ rep: 100 }), false, 0) / customerRate(stalls, stall({ rep: 0 }), false, 0);
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(2);
  });

  it('opens at the tier hours only', () => {
    expect(stallOpenNow(stalls, 1, 20)).toBe(true);
    expect(stallOpenNow(stalls, 1, 12)).toBe(false);
    expect(stallOpenNow(stalls, 3, 12)).toBe(true);
  });

  it('costs scale with level and tier; wages and stock have discounts', () => {
    const e0 = upgradeCostSen(stalls, 1, 'equipment', 0);
    expect(upgradeCostSen(stalls, 1, 'equipment', 2)).toBe(Math.round(stalls.upgrades.equipment!.baseCostSen * stalls.upgrades.equipment!.costGrowth ** 2));
    expect(upgradeCostSen(stalls, 2, 'equipment', 0)).toBe(Math.round(e0 * stalls.tiers[1].upgradeCostMult));
    expect(wagePerHourSen(stalls, 1, { ...NO_BONUS, wages: 0.5 })).toBe(Math.round((stalls.tiers[0].wagePerDaySen / 24) * 0.5));
    const ten = stockPriceSen(stalls, nasi, stall(), 10, false);
    expect(ten).toBe(nasi.ingredientCostSen * 10);
    expect(stockPriceSen(stalls, nasi, stall(), 50, false)).toBe(Math.round(nasi.ingredientCostSen * 50 * 0.9));
    expect(stockPriceSen(stalls, nasi, stall(), 10, true)).toBe(Math.round(ten * (1 + stalls.stock.deliveryFee)));
    expect(stockPriceSen(stalls, nasi, stall({ upgrades: { supplier: 2 } }), 10, false)).toBe(Math.round(ten * 0.9));
  });

  it('uses the oldest stock first and throws away what goes off', () => {
    const s = stall({ stock: { nasi_lemak: [{ qty: 2, age: 100 }, { qty: 5, age: 0 }] } });
    expect(takeStock(s, 'nasi_lemak', 3)).toBe(true);
    expect(s.stock.nasi_lemak).toEqual([{ qty: 4, age: 0 }]);
    expect(takeStock(s, 'nasi_lemak', 9)).toBe(false);
    expect(ageStock(stalls, s, stalls.stock.shelfLifeGameHours * 60)).toBe(4);
    expect(s.stock.nasi_lemak).toEqual([]);
  });

  it('unlocks Teh Tarik and Roti Canai through mastery', () => {
    expect(menuRecipes(stalls, recipes.recipes, stall()).map((r) => r.id)).toEqual(['nasi_lemak']);
    const t = stalls.mastery.thresholds[0];
    expect(masteryLevel(stalls, t)).toBe(1);
    expect(menuRecipes(stalls, recipes.recipes, stall({ mastery: { nasi_lemak: t } })).map((r) => r.id)).toEqual(['nasi_lemak', 'teh_tarik']);
    expect(menuRecipes(stalls, recipes.recipes, stall({ mastery: { nasi_lemak: t, teh_tarik: t } }))).toHaveLength(3);
  });
});
