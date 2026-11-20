import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RandInt } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import { World, type OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { Economy, GameError } from '../economy/economy';
import { emptyProgress } from '../progression/progression';
import { PropertySystem, type PropMods } from './property';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const T = cfg.map.tileSize;
const DAY_MS = 1440 * cfg.time.realMsPerGameMinute;

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

function setup(walletSen = 200_000_000, rand: RandInt = seeded(3), mods?: PropMods) {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const id = repos.accounts.create('owner', 'h', false, { x: 0, y: 0 }, 2, walletSen);
  const p = {
    id, name: 'owner', scene: 'town', hasCharacter: true, socketId: 's1', x: 0, y: 0, walletSen, shards: 0, inventory: [], equipped: {}, cosmetics: {},
    index: new Set<string>(), pages: new Set<string>(), pity: {}, jobs: {}, job: null, vehicle: null, skills: {}, manifestBank: 0, manifestSecs: 0,
    hotbar: [], rideQuote: null, ride: null, prog: emptyProgress(), errand: null, interior: null,
  } as unknown as OnlinePlayer;
  p.prog.stage = 4;
  const world = new World();
  world.add(p);
  let now = 1440 * 1000 * 500;
  const econ = new Economy(repos, cfg);
  const events: string[] = [];
  const props = new PropertySystem(cfg, repos, econ, world, rand, {
    publicChanged: () => {}, selfChanged: () => {}, wallet: () => {}, event: (_p, ev) => events.push(ev.text), mods: mods && (() => mods),
  }, () => now);
  const studio = props.units.find((u) => u.type === 'studio')!;
  const goTo = (u: { x: number; y: number }) => {
    p.x = u.x * T;
    p.y = u.y * T + 4;
  };
  const days = (n: number) => {
    for (let i = 0; i < n; i++) {
      now += DAY_MS;
      props.tick();
    }
  };
  return { db, repos, p, world, econ, props, studio, goTo, days, events, now: () => now, setNow: (t: number) => (now = t) };
}

/** Give the player furniture items (as if bought). */
function give(s: ReturnType<typeof setup>, items: string[]) {
  return items.map((id) => s.econ.run(s.p, () => s.econ.grant(s.p, id, 'normal', null).item));
}

describe('buying homes', () => {
  it('your first home is free (up to the cap) and you can only have so many', () => {
    const s = setup();
    s.goTo(s.studio);
    s.p.prog.stage = 4;
    const before = s.p.walletSen;
    s.props.buy(s.p, s.studio.id);
    expect(s.p.walletSen).toBe(before); // claimed free
    expect(s.props.assetsOf(s.p)).toBe(0); // a free home adds nothing to net worth
    const lofts = s.props.units.filter((u) => u.type === 'loft');
    expect(lofts.length).toBeGreaterThan(0); // plain shoplots hold homes too
    const cl = cfg.properties.claim;
    const others = s.props.units.filter((u) => u.id !== s.studio.id && u.priceSen <= s.p.walletSen).slice(0, cl.maxHomes);
    for (const u of others.slice(0, cl.maxHomes - 1)) {
      s.goTo(u);
      s.props.buy(s.p, u.id);
    }
    const extra = others[cl.maxHomes - 1];
    s.goTo(extra);
    expect(() => s.props.buy(s.p, extra.id)).toThrow(/up to/);
  });

  it('needs you at the door, the wealth stage and the money; then it is yours', () => {
    const s = setup();
    const cap = cfg.properties.claim.firstFreeMaxSen;
    cfg.properties.claim.firstFreeMaxSen = 0; // this test is about paying
    try {
    expect(() => s.props.buy(s.p, s.studio.id)).toThrow(/Go to the building/);
    s.goTo(s.studio);
    s.p.prog.stage = 1;
    expect(() => s.props.buy(s.p, s.studio.id)).toThrow(/stage/);
    s.p.prog.stage = 4;
    const before = s.p.walletSen;
    s.props.buy(s.p, s.studio.id);
    expect(s.p.walletSen).toBe(before - s.studio.priceSen);
    expect(() => s.props.buy(s.p, s.studio.id)).toThrow(GameError);
    expect(s.props.assetsOf(s.p)).toBe(Math.floor(s.studio.priceSen * cfg.properties.assetValueRate));
    // Survives a restart.
    const again = new PropertySystem(cfg, s.repos, s.econ, s.world, seeded(1), { publicChanged: () => {}, selfChanged: () => {}, wallet: () => {}, event: () => {} }, s.now);
    expect(again.all()).toEqual([expect.objectContaining({ unit: s.studio.id, owner: s.p.id })]);
    } finally {
      cfg.properties.claim.firstFreeMaxSen = cap;
    }
  });

  it('selling pays back part of what you paid (a free home pays nothing back)', () => {
    const s = setup();
    s.goTo(s.studio);
    s.props.buy(s.p, s.studio.id); // the free first home
    const w0 = s.p.walletSen;
    s.props.sell(s.p, s.studio.id);
    expect(s.p.walletSen).toBe(w0);
    s.props.buy(s.p, s.studio.id); // free again (you own none), so check with a paid one
    const paid = s.props.units.find((u) => u.id !== s.studio.id && u.type === 'studio')!;
    s.goTo(paid);
    s.props.buy(s.p, paid.id);
    const w = s.p.walletSen;
    s.props.sell(s.p, paid.id);
    expect(s.p.walletSen - w).toBe(Math.floor(paid.priceSen * cfg.properties.sellBackRate));
  });
});

describe('long-term rent', () => {
  it('a tenant moves in at a fair rent and pays every day (minus running costs)', () => {
    const s = setup();
    s.goTo(s.studio);
    s.props.buy(s.p, s.studio.id);
    s.props.setMode(s.p, s.studio.id, 'rent');
    const me = () => s.props.selfOf(s.p)[0];
    s.props.setPrices(s.p, s.studio.id, me().fairRentSen);
    // Hours pass until someone applies.
    for (let h = 0; h < 48 && !me().tenant; h++) {
      s.setNow(s.now() + 60 * cfg.time.realMsPerGameMinute);
      s.props.tick();
    }
    expect(me().tenant).not.toBeNull();
    const w = s.p.walletSen;
    s.days(10);
    expect(s.p.walletSen).toBeGreaterThan(w);
    expect(me().earnedSen).toBeGreaterThan(0);
  });

  it('you can ask a tenant to leave: they get a day of rent, the home looks for a new one', () => {
    const s = setup();
    s.goTo(s.studio);
    s.props.buy(s.p, s.studio.id);
    s.props.setMode(s.p, s.studio.id, 'rent');
    const me = () => s.props.selfOf(s.p)[0];
    expect(() => s.props.evict(s.p, s.studio.id)).toThrow(/no tenant/);
    for (let h = 0; h < 48 && !me().tenant; h++) {
      s.setNow(s.now() + 60 * cfg.time.realMsPerGameMinute);
      s.props.tick();
    }
    expect(me().tenant).not.toBeNull();
    expect(() => s.props.setMode(s.p, s.studio.id, 'airbnb')).toThrow(/move out first/);
    const w = s.p.walletSen;
    const { feeSen } = s.props.evict(s.p, s.studio.id);
    expect(feeSen).toBe(Math.round(me().rentSen * cfg.properties.rent.evictFeeDays));
    expect(s.p.walletSen).toBe(w - feeSen);
    expect(me().tenant).toBeNull();
    s.props.setMode(s.p, s.studio.id, 'airbnb'); // free to change now
    expect(me().mode).toBe('airbnb');
  });

  it('happiness falls with overpriced rent, and unhappy tenants move out', () => {
    const s = setup();
    s.goTo(s.studio);
    s.props.buy(s.p, s.studio.id);
    s.props.setMode(s.p, s.studio.id, 'rent');
    const me = () => s.props.selfOf(s.p)[0];
    for (let h = 0; h < 72 && !me().tenant; h++) {
      s.setNow(s.now() + 60 * cfg.time.realMsPerGameMinute);
      s.props.tick();
    }
    expect(me().tenant).not.toBeNull();
    s.props.setPrices(s.p, s.studio.id, me().fairRentSen * 3);
    expect(me().happiness!).toBeLessThan(cfg.properties.rent.moveOutBelowHappiness);
    s.days(20);
    expect(me().tenant).toBeNull();
    expect(s.events.some((e) => /moved out/.test(e))).toBe(true);
  });
});

describe('Property skills', () => {
  /** A studio let at the fair rent, with a tenant in. */
  function rented(mods?: PropMods) {
    const s = setup(200_000_000, seeded(7), mods);
    s.goTo(s.studio);
    s.props.buy(s.p, s.studio.id); // free first home: no running costs, so earnings = rent
    s.props.setMode(s.p, s.studio.id, 'rent');
    const me = () => s.props.selfOf(s.p)[0];
    s.props.setPrices(s.p, s.studio.id, me().fairRentSen);
    for (let h = 0; h < 96 && !me().tenant; h++) {
      s.setNow(s.now() + 60 * cfg.time.realMsPerGameMinute);
      s.props.tick();
    }
    expect(me().tenant).not.toBeNull();
    return { s, me };
  }

  it('Prime Landlord (and Passive Income) multiply the rent you collect', () => {
    const a = rented();
    const b = rented({ rent: 1.5, airbnb: 1, cleanLoss: 1, appeal: 1 });
    a.s.days(6);
    b.s.days(6);
    expect(a.me().earnedSen).toBeGreaterThan(0);
    expect(b.me().earnedSen / a.me().earnedSen).toBeCloseTo(1.5, 1);
  });

  it('Kerb Appeal raises the fair rent (so you can charge more)', () => {
    const a = rented();
    const b = rented({ rent: 1, airbnb: 1, cleanLoss: 1, appeal: 1.25 });
    expect(b.me().fairRentSen / a.me().fairRentSen).toBeCloseTo(1.25, 2);
  });
});

describe('Airbnb', () => {
  it('only furniture you own and is free can be placed; placed pieces can\'t be pawned', () => {
    const s = setup();
    s.goTo(s.studio);
    s.props.buy(s.p, s.studio.id);
    const [bed] = give(s, ['basic_bed']);
    expect(() => s.props.setLayout(s.p, s.studio.id, [{ iid: 99999, item: 'basic_bed', x: 0, y: 1, rot: 0 }])).toThrow(/own/);
    s.props.setLayout(s.p, s.studio.id, [{ iid: bed.iid, item: 'basic_bed', x: 0, y: 1, rot: 0 }]);
    expect(s.props.lockedIids(s.p).has(bed.iid)).toBe(true);
    expect(() => s.props.setLayout(s.p, s.studio.id, [{ iid: bed.iid, item: 'basic_bed', x: 9, y: 1, rot: 0 }])).toThrow(/sticks out/);
  });

  it('a well-decorated unit earns more per night than a bare one', () => {
    const run = (decorate: boolean) => {
      const s = setup(200_000_000, seeded(9));
      s.goTo(s.studio);
      s.props.buy(s.p, s.studio.id);
      s.props.setMode(s.p, s.studio.id, 'airbnb');
      const items = give(s, ['basic_bed', 'toilet', 'shower', 'kitchenette', 'aircond', 'wifi_router', ...(decorate ? ['japandi_sofa', 'low_table', 'paper_lantern', 'bonsai', 'smart_tv', 'coffee_machine'] : [])]);
      // The studio (10 × 8): main room x 0-6, bathroom x 7-9 rows 0-3, kitchenette x 7-9 rows 4-7.
      const spots: Array<[number, number]> = [[0, 0], [9, 0], [7, 0], [8, 7], [2, 0], [0, 4], [0, 6], [1, 4], [4, 4], [5, 0], [0, 2], [9, 5]];
      s.props.setLayout(s.p, s.studio.id, items.map((it, k) => ({ iid: it.iid, item: it.itemId, x: spots[k][0], y: spots[k][1], rot: 0 })));
      const me = () => s.props.selfOf(s.p)[0];
      s.props.setPrices(s.p, s.studio.id, undefined, me().fairNightSen);
      const stars = me().rating.stars;
      const w = s.p.walletSen;
      // Keep it clean, like a player with a cleaner.
      s.props.setStaff(s.p, s.studio.id, 'cleaner', true);
      s.days(40);
      return { stars, earned: s.p.walletSen - w, reviews: me().reviews.length };
    };
    const bare = run(false), nice = run(true);
    expect(nice.stars).toBeGreaterThan(bare.stars);
    expect(nice.reviews).toBeGreaterThan(0);
    expect(nice.earned).toBeGreaterThan(bare.earned);
  });

  it('cleaning takes time, done at the unit', () => {
    const s = setup();
    s.goTo(s.studio);
    s.props.buy(s.p, s.studio.id);
    s.props.clean(s.p, s.studio.id, 'start');
    expect(() => s.props.clean(s.p, s.studio.id, 'finish')).toThrow(/Keep cleaning/);
    s.setNow(s.now() + cfg.properties.airbnb.cleanMs);
    s.props.clean(s.p, s.studio.id, 'finish');
  });
});

describe('offline income (spec §8.7)', () => {
  it('pays for the time away at the offline rate, capped, and the Lucky Spin doubles it once', () => {
    const s = setup();
    s.goTo(s.studio);
    s.props.buy(s.p, s.studio.id);
    s.props.setMode(s.p, s.studio.id, 'rent');
    const me = () => s.props.selfOf(s.p)[0];
    for (let h = 0; h < 72 && !me().tenant; h++) {
      s.setNow(s.now() + 60 * cfg.time.realMsPerGameMinute);
      s.props.tick();
    }
    // Log out for 30 real hours (capped at 8).
    s.p.socketId = '';
    s.world.remove(s.p.id);
    const away = 30 * 3_600_000;
    s.setNow(s.now() + away);
    s.world.add(s.p);
    const w = s.p.walletSen;
    const sum = s.props.welcomeBack(s.p, away, cfg.economy.offline)!;
    expect(sum.earnedSen).toBeGreaterThan(0);
    expect(s.p.walletSen - w).toBe(sum.earnedSen);
    // 8 h of in-game days (20) at 50%: far less than 30 h at 100%.
    const fullDay = me().rentSen;
    expect(sum.earnedSen).toBeLessThan(fullDay * 21);
    expect(() => s.props.luckySpin(s.p)).toThrow(/spinning/);
    s.setNow(s.now() + 10_000);
    const before = s.p.walletSen;
    expect(s.props.luckySpin(s.p).bonusSen).toBe(sum.earnedSen);
    expect(s.p.walletSen - before).toBe(sum.earnedSen);
    expect(() => s.props.luckySpin(s.p)).toThrow();
  });
});

describe('🏪 shop floors (Ventures and kopitiams)', () => {
  const shoplot = () => cfg.map.stallPlots.find((x) => x.tier >= cfg.stalls.cashierFromTier && x.building)!.building!;

  it('a shoplot business gets a shop floor: not a home, not for sale, rated with shop must-haves', () => {
    const { p, props } = setup();
    const b = shoplot();
    expect(props.syncShops(new Map([[b, { owner: p.id, ownerName: 'owner', kind: 'venture' }]]))).toBe(true);
    const unit = `${b}#shop`;
    expect(props.isShop(unit)).toBe(true);
    const s = props.selfOf(p).find((x) => x.unit === unit)!;
    expect(s.mode).toBe('shop');
    expect(s.rating.missing).toEqual(['aircond', 'wifi', 'toilet']);
    expect(() => props.sell(p, unit)).toThrow(GameError);
    expect(() => props.setMode(p, unit, 'airbnb')).toThrow(GameError);
    // Syncing again changes nothing; dropping it closes it.
    expect(props.syncShops(new Map([[b, { owner: p.id, ownerName: 'owner', kind: 'venture' }]]))).toBe(false);
    expect(props.syncShops(new Map())).toBe(true);
    expect(props.isShop(unit)).toBe(false);
  });

  it('stars set the business multiplier; customers dirty it and leave shop reviews', () => {
    const { p, props } = setup();
    const b = shoplot();
    props.syncShops(new Map([[b, { owner: p.id, ownerName: 'owner', kind: 'kopitiam' }]]));
    const c = cfg.properties.shop;
    const stars = props.ratingOf(props.ownedBy(p).find((s) => s.unit === `${b}#shop`)!).stars;
    expect(props.shopMult(b)).toBeCloseTo(c.multBase + c.multPerStar * stars, 6);
    expect(props.shopMult('no-such-building')).toBe(1);
    props.shopVisit(b, c.reviewEvery * 2);
    const s = props.ownedBy(p).find((x) => x.unit === `${b}#shop`)!;
    expect(s.cleanliness).toBeCloseTo(100 - c.dirtPerCustomer * c.reviewEvery * 2, 6);
    expect(s.reviews.length).toBeGreaterThan(0);
    expect(s.reviews.some((r) => /bed|sheets|stay/i.test(r.text))).toBe(false);
  });
});
