import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { customerRate, dishBaseSen, orderBaseSen, staffPayRate, stockCount, type RandInt, type StepInput, type StepParams } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import { World, type OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { Economy, GameError } from '../economy/economy';
import { emptyProgress, ProgressionSystem } from '../progression/progression';
import { StallSystem } from './stalls';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
/** Server ms when the in-game clock shows `hour`:00 (the clock is offset by config). */
const atHour = (hour: number) => ((hour * 60 - cfg.time.offsetGameMinutes + 1440 * 10) % 1440) * cfg.time.realMsPerGameMinute + 1440 * 1000 * 100;

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

function setup(walletSen = 500_000, hour = 20) {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const id = repos.accounts.create('cook', 'h', false, { x: 0, y: 0 }, 2, walletSen);
  const plot = cfg.map.stallPlots.find((p) => p.id === 'pasar_1')!;
  const T = cfg.map.tileSize;
  const p = {
    id, name: 'cook', scene: 'town', hasCharacter: true, x: plot.x * T, y: (plot.y + 1) * T, walletSen, shards: 0, inventory: [], equipped: {}, cosmetics: {},
    index: new Set<string>(), pages: new Set<string>(), pity: {}, jobs: {}, job: null, vehicle: null, skills: {}, manifestBank: 0, manifestSecs: 0,
    hotbar: [], rideQuote: null, ride: null, prog: emptyProgress(),
  } as unknown as OnlinePlayer;
  p.prog.stage = 2;
  p.prog.goalsDone = cfg.goals.goals.map((g) => g.id); // keep Hustle Path rewards out of the sums
  const world = new World();
  world.add(p);
  let now = atHour(hour);
  const clock = () => now;
  const econ = new Economy(repos, cfg);
  const rand = seeded(7);
  const prog = new ProgressionSystem(cfg, repos, econ, rand, {
    wallet: () => {}, items: () => {}, progress: () => {}, publicChanged: () => {}, announce: () => {}, freeRoll: () => ({ crateId: '', results: [] }),
  }, clock);
  prog.load(p);
  p.prog.stage = 2;
  p.prog.goalsDone = cfg.goals.goals.map((g) => g.id);
  const events: string[] = [];
  const stalls = new StallSystem(cfg, repos, econ, prog, world, rand, {
    publicChanged: () => {}, selfChanged: () => {}, event: (_p, ev) => events.push(ev.kind), wallet: () => {},
  }, clock);
  /** Run the stall for `ms` in 250 ms ticks. */
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 250) {
      now += 250;
      stalls.tick(now);
    }
  };
  return { db, repos, p, world, econ, prog, stalls, run, events, setNow: (t: number) => (now = t), now: () => now };
}

/** Perfect inputs for a dish (what a flawless player sends). */
function perfectInputs(steps: StepParams[]): StepInput[] {
  let start = 0;
  return steps.map((s) => {
    let ev: number[] = [];
    if (s.kind === 'hold') ev = [100, 100 + ((s.zone[0] + s.zone[1]) / 2) * s.fillMs];
    else if (s.kind === 'timing') ev = [s.targetMs];
    else if (s.kind === 'rhythm') ev = [...s.beats];
    else if (s.kind === 'sequence') ev = s.order.flatMap((id, i) => [s.options.findIndex((o) => o.id === id), 300 * (i + 1)]);
    else if (s.kind === 'path') ev = s.points.flatMap(([x, y], i) => [x, y, 100 * (i + 1)]);
    else if (s.kind === 'assemble') ev = s.want.flatMap((id, i) => [s.options.findIndex((o) => o.id === id), 300 * (i + 1)]);
    else if (s.kind === 'meter') {
      // Ramp up to the zone, then hold 40% of every 200 ms to stay level.
      const c = (s.zone[0] + s.zone[1]) / 2;
      const up = ((c - 0.15) / s.rise) * 1000;
      ev = [0, up];
      const f = s.fall / (s.rise + s.fall);
      for (let t = up + 100; t < s.durationMs; t += 200) ev.push(t, t + 200 * f);
    }
    const inp = { startMs: start, ev };
    start += s.maxMs;
    return inp;
  });
}

describe('buying a stall', () => {
  it('needs wealth stage 2, charges the price and takes the first free plot', () => {
    const s = setup();
    s.p.prog.stage = 1;
    expect(() => s.stalls.buy(s.p, 1)).toThrow(/stage 2/);
    s.p.prog.stage = 2;
    s.stalls.buy(s.p, 1);
    const tier = cfg.stalls.tiers[0];
    expect(s.p.walletSen).toBe(500_000 - tier.priceSen);
    const me = s.stalls.selfOf(s.p)!;
    expect(me.plot).toBe('pasar_1');
    expect(me.investedSen).toBe(tier.priceSen);
    expect(stockCount(me, 'nasi_lemak')).toBe(10); // starter stock
    expect(s.p.prog.stats.stallTier).toBe(1);
    expect(s.stalls.assetsOf(s.p)).toBe(Math.floor(tier.priceSen * cfg.stalls.assetValueRate));
    expect(() => s.stalls.buy(s.p, 1)).toThrow(GameError); // next is tier 2
    expect(s.repos.stalls.all()[0]).toMatchObject({ owner: s.p.id, tier: 1, plot: 'pasar_1' });
  });
});

describe('customers and cooking', () => {
  it('stall level raises every price; staff level raises what cooks earn', () => {
    const nasi = cfg.recipeById.get('nasi_lemak')!;
    const base = dishBaseSen(cfg.stalls, nasi, { tier: 1, mastery: {} }, false);
    expect(dishBaseSen(cfg.stalls, nasi, { tier: 1, mastery: {}, upgrades: { level: 2 } }, false)).toBe(Math.round(nasi.basePriceSen * (1 + 2 * cfg.stalls.upgrades.level!.perLevel)));
    expect(base).toBe(nasi.basePriceSen);
    expect(staffPayRate(cfg.stalls, { upgrades: { training: 5 } })).toBeCloseTo(cfg.stalls.staff.passiveRate * (1 + 5 * cfg.stalls.upgrades.training!.bonusPerLevel!));
  });

  it('the stall opens any time; quiet hours just bring fewer customers', () => {
    const day = setup(500_000, 12);
    day.stalls.buy(day.p, 1);
    day.run(60_000);
    expect(day.stalls.all()[0].open).toBe(true);
    const tier = cfg.stalls.tiers[0];
    const st = { tier: 1, rep: 50, upgrades: {}, buzzUntil: 0 };
    expect(customerRate(cfg.stalls, st, false, 0, undefined, true)).toBeCloseTo(customerRate(cfg.stalls, st, false, 0) * cfg.stalls.offHoursCustomers);
    expect(tier.customersPerMin).toBeGreaterThan(0);
    const night = setup();
    night.stalls.buy(night.p, 1);
    night.run(60_000);
    expect(night.stalls.all()[0].open).toBe(true);
    expect(night.stalls.all()[0].queue.length).toBeGreaterThan(0);
  });

  it('a perfect dish pays 1.8× (plus tip), builds the combo and mastery', () => {
    const s = setup();
    s.stalls.buy(s.p, 1);
    s.run(40_000);
    const before = s.p.walletSen;
    const { dish } = s.stalls.cook(s.p, undefined, false);
    expect(dish).not.toBeNull();
    s.setNow(s.now() + dish!.steps.reduce((a, st) => a + st.maxMs, 0)); // as long as the inputs claim
    const r = s.stalls.serve(s.p, dish!.dishId, perfectInputs(dish!.steps));
    expect(r.quality).toBe('perfect');
    // The order's add-ons (if the customer asked for any) are part of the bill.
    const box = dish!.steps.find((st) => st.kind === 'assemble') as Extract<StepParams, { kind: 'assemble' }>;
    const addons = box.want.filter((id) => box.options.find((o) => o.id === id)?.addon);
    const base = orderBaseSen(cfg.stalls, cfg.recipeById.get('nasi_lemak')!, { tier: 1, mastery: {} }, false, addons);
    expect(r.paidSen).toBe(Math.round(base * 1.8));
    expect(s.p.walletSen).toBe(before + r.paidSen + r.tipSen);
    expect(r.combo).toBeCloseTo(cfg.stalls.combo.perPerfect);
    expect(s.stalls.selfOf(s.p)!.mastery.nasi_lemak).toBe(1);
    expect(s.p.prog.stats).toMatchObject({ dishes: 1, dishes_nasi_lemak: 1, perfectDishes: 1 });
    expect(stockCount(s.stalls.selfOf(s.p)!, 'nasi_lemak')).toBeLessThan(10);
  });

  it('closing up: the queue is held for the grace period, then the stall closes', () => {
    const s = setup();
    s.stalls.buy(s.p, 1);
    s.run(40_000);
    expect(s.stalls.all()[0].queue.length).toBeGreaterThan(0);
    s.stalls.setOpen(s.p, false);
    s.run(5_000);
    const mid = s.stalls.all()[0];
    expect(mid.open).toBe(true); // still serving who's there
    expect(mid.queue.length).toBeGreaterThan(0);
    s.run(cfg.stalls.closingGraceSec * 1000);
    expect(s.stalls.all()[0].open).toBe(false);
    expect(s.stalls.all()[0].queue).toHaveLength(0);
  });

  it('starting a dish over is free: same customer, no more stock, a new dish id', () => {
    const s = setup();
    s.stalls.buy(s.p, 1);
    s.run(40_000);
    const { dish } = s.stalls.cook(s.p, undefined, false);
    const stock = stockCount(s.stalls.selfOf(s.p)!, 'nasi_lemak');
    const again = s.stalls.redo(s.p);
    expect(again.dishId).not.toBe(dish!.dishId);
    expect(again.customerId).toBe(dish!.customerId);
    expect(stockCount(s.stalls.selfOf(s.p)!, 'nasi_lemak')).toBe(stock);
    expect(() => s.stalls.serve(s.p, dish!.dishId, [])).toThrow(); // the old one is gone
  });

  it('impossible inputs (faster than real time) get a Burnt dish', () => {
    const s = setup();
    s.stalls.buy(s.p, 1);
    s.run(40_000);
    const { dish } = s.stalls.cook(s.p, undefined, false);
    const r = s.stalls.serve(s.p, dish!.dishId, perfectInputs(dish!.steps)); // no time passed
    expect(r.quality).toBe('burnt');
  });

  it('you have to stand at your stall to cook', () => {
    const s = setup();
    s.stalls.buy(s.p, 1);
    s.run(40_000);
    s.p.x += cfg.map.tileSize * 30;
    expect(() => s.stalls.cook(s.p, undefined, false)).toThrow(/Walk to your stall/);
  });

  it('a Perfect Cook Token serves a Perfect dish straight away', () => {
    const s = setup();
    s.stalls.buy(s.p, 1);
    s.stalls.addPerfectTokens(s.p, 2);
    s.run(40_000);
    const r = s.stalls.cook(s.p, undefined, true);
    expect(r.dish).toBeNull();
    expect(r.served?.quality).toBe('perfect');
    expect(s.stalls.selfOf(s.p)!.perfectTokens).toBe(1);
  });

  it('customers who wait too long leave and reputation drops', () => {
    const s = setup();
    s.stalls.buy(s.p, 1);
    s.run(150_000);
    expect(s.p.prog.stats.customersLost ?? 0).toBeGreaterThan(0);
    expect(s.stalls.all()[0].rep).toBeLessThan(cfg.stalls.reputation.start);
  });

  it('cooks slowly rebuild reputation, but only up to the cap', () => {
    const s = setup(5_000_000);
    s.stalls.buy(s.p, 1);
    s.stalls.buyStock(s.p, 'nasi_lemak', 200, true);
    s.stalls.hire(s.p);
    const live = (s.stalls as unknown as { stalls: Map<number, { s: { rep: number; upgrades: Record<string, number> } }> }).stalls.get(s.p.id)!;
    live.s.rep = 0;
    live.s.upgrades = { training: 10, queue: 3 }; // a fast cook: nobody waits too long
    s.run(10 * 60_000);
    expect(s.p.prog.stats.staffDishes ?? 0).toBeGreaterThan(20);
    const rep = s.stalls.all()[0].rep;
    expect(rep).toBeGreaterThan(0);
    expect(rep).toBeLessThanOrEqual(cfg.stalls.reputation.staffRepCap);
    live.s.rep = 90; // above the cap: cooks don't push it further
    s.run(60_000);
    expect(s.stalls.all()[0].rep).toBeLessThanOrEqual(90);
  });

  it('moving up a tier: lost customers cost no reputation for a short while', () => {
    const s = setup(50_000_000);
    s.p.prog.stage = 5;
    s.p.prog.level = 50;
    s.stalls.buy(s.p, 1);
    s.stalls.buy(s.p, 2);
    s.stalls.buyStock(s.p, 'nasi_lemak', 200, true);
    const rep0 = s.stalls.all()[0].rep;
    s.run(Math.min(110_000, cfg.stalls.reputation.moveGraceSec * 1000 - 1000)); // nobody cooks: people give up
    expect(s.p.prog.stats.customersLost ?? 0).toBeGreaterThan(0);
    expect(s.stalls.all()[0].rep).toBe(rep0);
    s.run(150_000); // after the grace, losses count again
    expect(s.stalls.all()[0].rep).toBeLessThan(rep0);
  });

  it('closes and clears the queue when the owner logs off', () => {
    const s = setup();
    s.stalls.buy(s.p, 1);
    s.run(40_000);
    s.world.remove(s.p.id);
    s.run(500);
    expect(s.stalls.all()[0]).toMatchObject({ open: false, queue: [] });
  });
});

describe('staff', () => {
  it('a cook serves customers at the passive rate and is paid hourly', () => {
    const s = setup(2_000_000);
    s.stalls.buy(s.p, 1);
    s.stalls.buyStock(s.p, 'nasi_lemak', 200, true);
    s.stalls.hire(s.p);
    const afterHire = s.p.walletSen;
    s.run(5 * 60_000); // 5 in-game hours
    const staffDishes = s.p.prog.stats.staffDishes ?? 0;
    expect(staffDishes).toBeGreaterThan(5);
    const base = dishBaseSen(cfg.stalls, cfg.recipeById.get('nasi_lemak')!, { tier: 1, mastery: {} }, false);
    const wages = 5 * Math.round(cfg.stalls.tiers[0].wagePerDaySen / 24);
    // Income from cooks (at ~50%, some at rush-hour prices) minus 5 hours of wages.
    const delta = s.p.walletSen - afterHire;
    expect(delta).toBeGreaterThanOrEqual(staffDishes * Math.round(base * staffPayRate(cfg.stalls, { upgrades: {} })) - wages);
    // At most: every order in a rush with the dearest add-ons.
    const nasi = cfg.recipeById.get('nasi_lemak')!;
    const dearest = [...nasi.addons].sort((a, b) => b.basePriceSen - a.basePriceSen).slice(0, nasi.maxAddons).map((a) => a.id);
    const top = orderBaseSen(cfg.stalls, nasi, { tier: 1, mastery: {} }, true, dearest);
    expect(delta).toBeLessThanOrEqual(staffDishes * Math.round(top * staffPayRate(cfg.stalls, { upgrades: {} })) - wages);
  });

  it('left open with a cook, the stall stays open while you are away and earns from real time', () => {
    const s = setup(2_000_000);
    s.stalls.buy(s.p, 1);
    s.stalls.buyStock(s.p, 'nasi_lemak', 200, true);
    s.stalls.hire(s.p);
    s.run(1000);
    s.world.remove(s.p.id);
    s.run(500);
    expect(s.stalls.all()[0].open).toBe(true); // still open on the map
    // Back after 2 hours (e.g. the server was off): the cook's takings, at the offline rate, minus wages.
    s.setNow(s.now() + 2 * 3_600_000);
    s.world.add(s.p);
    const stock0 = stockCount(s.stalls.selfOf(s.p)!, 'nasi_lemak');
    const w = s.p.walletSen;
    const r = s.stalls.offline(s.p, 2 * 3_600_000, cfg.economy.offline.capHours, cfg.economy.offline.efficiency)!;
    expect(r.dishes).toBeGreaterThan(20);
    expect(r.sen).toBeGreaterThan(0);
    expect(r.wagesSen).toBeGreaterThan(0);
    expect(s.p.walletSen - w).toBe(r.sen);
    expect(stockCount(s.stalls.selfOf(s.p)!, 'nasi_lemak')).toBe(stock0 - r.dishes);
    // Closed (switched off): stays closed, nothing earned.
    s.stalls.setOpen(s.p, false);
    expect(s.stalls.offline(s.p, 3_600_000, 8, 0.5)).toBeNull();
  });

  it('can only hire up to the tier limit', () => {
    const s = setup(2_000_000);
    s.stalls.buy(s.p, 1);
    s.stalls.hire(s.p);
    expect(() => s.stalls.hire(s.p)).toThrow(/room for 1/);
  });
});

describe('stock and upgrades', () => {
  it('only menu recipes can be stocked, and the cap holds', () => {
    const s = setup(5_000_000);
    s.stalls.buy(s.p, 1);
    expect(() => s.stalls.buyStock(s.p, 'teh_tarik', 10, true)).toThrow(/menu/);
    s.stalls.buyStock(s.p, 'nasi_lemak', 200, true);
    s.stalls.buyStock(s.p, 'nasi_lemak', 200, true);
    expect(() => s.stalls.buyStock(s.p, 'nasi_lemak', 200, true)).toThrow(/up to/);
  });

  it('upgrades cost money, count towards the stall value, and persist', () => {
    const s = setup();
    s.stalls.buy(s.p, 1);
    const w = s.p.walletSen;
    s.stalls.upgrade(s.p, 'signage');
    const cost = w - s.p.walletSen;
    expect(cost).toBe(cfg.stalls.upgrades.signage!.baseCostSen);
    expect(s.stalls.selfOf(s.p)!.investedSen).toBe(cfg.stalls.tiers[0].priceSen + cost);
    const again = new StallSystem(cfg, s.repos, s.econ, s.prog, s.world, () => 0, { publicChanged: () => {}, selfChanged: () => {}, event: () => {}, wallet: () => {} });
    expect(again.selfOf(s.p)!.upgrades.signage).toBe(1);
  });
});
