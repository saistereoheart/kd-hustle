import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { variantMult, type RandInt } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { Gacha } from '../gacha/gacha';
import { InventorySystem } from '../inventory/inventory';
import { carwashPay, deliveryPay, gradeCarwash, jobLevel, makeCarwashJob, type CarwashJob } from '../jobs/jobs';
import { Economy, GameError } from './economy';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));

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

function setup(walletSen = 30000, seed = 1) {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const id = repos.accounts.create(`p${seed}`, 'h', false, { x: 0, y: 0 }, 2, walletSen);
  const p = {
    id, name: `p${seed}`, walletSen, shards: 0, inventory: [], equipped: {}, cosmetics: {}, index: new Set<string>(),
    pages: new Set<string>(), pity: {}, jobs: {}, job: null, vehicle: null, skills: {}, manifestBank: 0, manifestSecs: 0, hotbar: [], rideQuote: null, ride: null,
  } as unknown as OnlinePlayer;
  const econ = new Economy(repos, cfg);
  const gacha = new Gacha(repos, cfg, econ, seeded(seed));
  const inv = new InventorySystem(cfg, econ);
  const txSum = () => (db.prepare('SELECT COALESCE(SUM(delta_sen),0) AS s FROM transactions WHERE account_id = ?').get(id) as { s: number }).s;
  return { db, repos, p, econ, gacha, inv, txSum };
}

describe('crate rolls', () => {
  it('charges exactly price × count, grants items and logs everything', () => {
    const { p, gacha, repos, txSum } = setup(30000);
    const batch = gacha.roll(p, 'capsule', 10);
    expect(batch.results).toHaveLength(10);
    expect(p.walletSen).toBe(30000 - 2000 * 10 + (batch.pageReward?.sen ?? 0));
    expect(p.inventory).toHaveLength(10);
    expect(repos.inventory.list(p.id)).toHaveLength(10);
    expect(repos.econ.load(p.id).walletSen).toBe(p.walletSen);
    expect(30000 + txSum()).toBe(p.walletSen); // the economy log adds up
    expect(Number.isSafeInteger(p.walletSen)).toBe(true);
  });

  it('refuses a roll you cannot afford and changes nothing', () => {
    const { p, gacha, repos } = setup(1500);
    expect(() => gacha.roll(p, 'capsule', 1)).toThrow(GameError);
    expect(p.walletSen).toBe(1500);
    expect(p.inventory).toHaveLength(0);
    expect(repos.econ.load(p.id).walletSen).toBe(1500);
  });

  it('rolls back the DB and the in-memory player if something fails mid-transaction', () => {
    const { p, econ, repos } = setup(10000);
    expect(() =>
      econ.run(p, () => {
        econ.change(p, -5000, 0, 'test');
        econ.grant(p, 'rubber_duck', 'normal', null);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(p.walletSen).toBe(10000);
    expect(p.inventory).toHaveLength(0);
    expect(p.index.size).toBe(0);
    expect(repos.econ.load(p.id).walletSen).toBe(10000);
    expect(repos.inventory.list(p.id)).toHaveLength(0);
  });

  it('keeps and persists pity counters per crate', () => {
    const { p, gacha, repos } = setup(10_000_000);
    gacha.roll(p, 'capsule', 5);
    const pity = p.pity.capsule;
    expect(pity.sinceEpic + pity.sinceLegendary).toBeGreaterThan(0);
    expect(repos.econ.load(p.id).pity.capsule).toEqual(pity);
  });

  it('gives limited items rising serial numbers and stops at the limit', () => {
    const { p, econ, gacha } = setup(1);
    // Simulate the server having already handed out 4 of the 5 Durian Crowns.
    const g = gacha as unknown as { limitedCount: Map<string, number> };
    g.limitedCount.set('durian_crown', 5);
    econ.run(p, () => econ.change(p, 1_000_000_000, 0, 'test'));
    for (let i = 0; i < 30; i++) {
      for (const r of gacha.roll(p, 'mallbox', 10).results) expect(r.itemId).not.toBe('durian_crown');
    }
  });

  it('pays the Item Index page reward once when a crate page is completed', () => {
    const { p, econ, gacha } = setup(1_000_000_000);
    const crate = cfg.crateById.get('capsule')!;
    // Already found everything except one item...
    econ.run(p, () => {
      for (const id of crate.pool.slice(1)) econ.grant(p, id, 'normal', null);
    });
    let reward: { sen: number } | undefined;
    for (let i = 0; i < 400 && !reward; i++) reward = gacha.roll(p, 'capsule', 10).pageReward;
    expect(reward?.sen).toBe(crate.priceSen * cfg.economy.indexPageRewardMultiplier);
    expect(p.pages.has('capsule')).toBe(true);
    expect(gacha.roll(p, 'capsule', 1).pageReward).toBeUndefined();
  });
});

describe('inventory, pawn shop and shards', () => {
  it('equips cosmetics only, and unequips when sold', () => {
    const { p, econ, inv } = setup(0);
    const { item: hat } = econ.run(p, () => econ.grant(p, 'party_hat', 'golden', null));
    const { item: duck } = econ.run(p, () => econ.grant(p, 'rubber_duck', 'normal', null));
    expect(inv.equip(p, hat.iid)).toBe(true);
    expect(p.cosmetics.hat).toEqual({ itemId: 'party_hat', variant: 'golden' });
    expect(() => inv.equip(p, duck.iid)).toThrow(GameError);
    const r = inv.sell(p, 'party_hat', 'golden', 1);
    expect(r.cosmeticsChanged).toBe(true);
    expect(p.cosmetics.hat).toBeUndefined();
    // Golden = 5× value; Capsule common = RM 20 × 0.3 = RM 6; pawn pays 50%.
    expect(r.gainedSen).toBe(Math.floor(2000 * 0.3 * 5 * cfg.economy.pawnRate));
    expect(p.walletSen).toBe(r.gainedSen);
  });

  it('scraps into shards and buys discovered items in the Shard Shop', () => {
    const { p, econ, inv } = setup(0);
    econ.run(p, () => {
      for (let i = 0; i < 12; i++) econ.grant(p, 'rubber_duck', 'normal', null);
    });
    // Asking for all 12 scraps 11: you always keep your last copy.
    const r = inv.scrap(p, 'rubber_duck', 'normal', 12);
    expect(r.gainedShards).toBe(11 * cfg.rarities.tiers.find((t) => t.id === 'common')!.shards);
    expect(r.keptLast).toBe(cfg.itemById.get('rubber_duck')!.name);
    expect(p.inventory).toHaveLength(1);
    expect(() => inv.shardBuy(p, 'bucket_hat')).toThrow(/Discover/); // not found yet
    expect(() => inv.scrap(p, 'rubber_duck', 'normal', 1)).toThrow(/last copy of/);
    const shardsBefore = p.shards;
    inv.shardBuy(p, 'rubber_duck'); // common = 10 shards
    expect(p.shards).toBe(shardsBefore - 10);
    expect(() => inv.shardBuy(p, 'halo')).toThrow(GameError); // mythic isn't sold
  });

  it('the Chef Search costs shards, not RM, and chefs are stall buffs', () => {
    const { p, gacha } = setup(500_000);
    expect(() => gacha.roll(p, 'chefs', 1)).toThrow(/shards/);
    p.shards = 200;
    const before = p.walletSen;
    const r = gacha.roll(p, 'chefs', 1);
    expect(p.walletSen).toBe(before);
    expect(p.shards).toBe(200 - cfg.crateById.get('chefs')!.priceShards!);
    expect(cfg.itemById.get(r.results[0].itemId)!.type).toBe('chef');
  });

  it('merging 3 copies of an item at the same tier goes a tier up and keeps every variant', () => {
    const { p, econ, inv } = setup(0);
    const ids = econ.run(p, () => [
      econ.grant(p, 'rubber_duck', 'normal', null, 'D').item.iid,
      econ.grant(p, 'rubber_duck', 'shiny', null, 'D').item.iid,
      econ.grant(p, 'rubber_duck', 'golden', null, 'D').item.iid,
      econ.grant(p, 'party_hat', 'normal', null, 'D').item.iid,
      econ.grant(p, 'rubber_duck', 'normal', null, 'C').item.iid,
      econ.grant(p, 'rubber_duck', 'normal', null, 'S').item.iid,
      econ.grant(p, 'rubber_duck', 'normal', null, 'S').item.iid,
      econ.grant(p, 'rubber_duck', 'normal', null, 'S').item.iid,
    ]);
    expect(() => inv.merge(p, [ids[0], ids[1], ids[3]], () => 0)).toThrow(/same item/);
    expect(() => inv.merge(p, [ids[0], ids[1]], () => 0)).toThrow(/Pick 3/);
    // Mixed tiers are refused; so is the top tier (nowhere to go).
    expect(() => inv.merge(p, [ids[0], ids[1], ids[4]], () => 0)).toThrow(/same tier/);
    expect(() => inv.merge(p, [ids[5], ids[6], ids[7]], () => 0)).toThrow(/top tier/);
    const never = () => 999_999; // no bonus variant
    const r = inv.merge(p, [ids[0], ids[1], ids[2]], never);
    expect(r.removed).toHaveLength(3);
    // D × 3 → C; Shiny + Golden both kept.
    expect(r.item).toMatchObject({ itemId: 'rubber_duck', grade: 'C', variant: 'shiny+golden' });
    expect(variantMult(cfg.rarities, 'shiny+golden')).toBe(variantMult(cfg.rarities, 'shiny') * variantMult(cfg.rarities, 'golden'));
  });

  it('a tier multiplies what the pawn shop pays; rerolls cost shards and never make it worse', () => {
    const { p, econ, inv } = setup(0);
    econ.run(p, () => {
      econ.grant(p, 'rubber_duck', 'normal', null, 'D');
      econ.grant(p, 'rubber_duck', 'normal', null, 'S');
    });
    const d = inv.sell(p, 'rubber_duck', 'normal', 1, 'D').gainedSen;
    const s5 = inv.sell(p, 'rubber_duck', 'normal', 1, 'S').gainedSen;
    expect(s5).toBeGreaterThanOrEqual(d * 4); // tier S is ×5 (rounding aside)
    const { item } = econ.run(p, () => econ.grant(p, 'rubber_duck', 'shiny', null, 'B'));
    expect(() => inv.reroll(p, item.iid, 'grade', () => 0)).toThrow(/shards/);
    p.shards = 1000;
    let n = 0;
    for (let k = 0; k < 20 && item.grade !== 'S'; k++, n++) {
      const r = inv.reroll(p, item.iid, 'grade', (max) => Math.floor(Math.random() * max));
      expect(['B', 'A', 'S']).toContain(r.item.grade);
      item.grade = r.item.grade;
    }
    expect(p.shards).toBe(1000 - n * cfg.prog.grades.shards.rerollGrade.common);
    // Hard pity: after enough misses the next reroll always upgrades.
    const hard = cfg.prog.grades.rerollPity.grade.hard;
    const { item: low } = econ.run(p, () => econ.grant(p, 'rubber_duck', 'normal', null, 'D'));
    const r = inv.reroll(p, low.iid, 'grade', () => 0, 1, hard - 1);
    expect(r).toMatchObject({ improved: true, forced: true });
    expect(r.item.grade).toBe('C');
  });

  it('merge all merges every full set, tier by tier, up to the chosen tier', () => {
    const { p, econ, inv } = setup(0);
    econ.run(p, () => {
      for (let i = 0; i < 9; i++) econ.grant(p, 'rubber_duck', i === 0 ? 'shiny' : 'normal', null, 'D');
      for (let i = 0; i < 2; i++) econ.grant(p, 'party_hat', 'normal', null, 'D'); // not a full set
    });
    const worn = econ.run(p, () => econ.grant(p, 'rubber_duck', 'normal', null, 'D')).item;
    p.equipped = { hat: worn.iid }; // worn copies stay out of it
    // 9 D → 3 C → 1 B (mergeCount 3)
    const r = inv.mergeAll(p, ['rubber_duck', 'party_hat'], 'S', () => 999_999);
    expect(r.merges).toBe(4);
    const ducks = p.inventory.filter((i) => i.itemId === 'rubber_duck');
    expect(ducks.map((d) => d.grade).sort()).toEqual(['B', 'D']); // the merged B + the worn D
    expect(ducks.find((d) => d.grade === 'B')!.variant).toBe('shiny'); // the variant made it up
    expect(p.inventory.filter((i) => i.itemId === 'party_hat')).toHaveLength(2);
    expect(r.items.map((i) => i.grade)).toEqual(['B']); // only what's left at the end
    // Stopping at C:
    econ.run(p, () => {
      for (let i = 0; i < 9; i++) econ.grant(p, 'bucket_hat', 'normal', null, 'D');
    });
    expect(inv.mergeAll(p, ['bucket_hat'], 'C', () => 999_999).merges).toBe(3);
    expect(p.inventory.filter((i) => i.itemId === 'bucket_hat').map((i) => i.grade)).toEqual(['C', 'C', 'C']);
    expect(() => inv.mergeAll(p, ['party_hat'], 'S', () => 0)).toThrow(/Nothing to merge/);
  });

  it('scrap all follows the filters and always keeps one copy of each item', () => {
    const { p, econ, inv } = setup(0);
    econ.run(p, () => {
      for (let i = 0; i < 3; i++) econ.grant(p, 'rubber_duck', 'normal', null, 'D');
      econ.grant(p, 'rubber_duck', 'golden', null, 'D');
      econ.grant(p, 'rubber_duck', 'normal', null, 'B');
      econ.grant(p, 'party_hat', 'normal', null, 'D'); // the only one
    });
    const r = inv.scrapAll(p, ['rubber_duck', 'party_hat'], { maxGrade: 'D', keepVariants: true });
    expect(r.count).toBe(3); // the plain D ducks; not the golden one, not the B
    expect(r.kept).toEqual([cfg.itemById.get('party_hat')!.name]);
    expect(p.inventory.map((i) => `${i.itemId}:${i.grade}:${i.variant}`).sort()).toEqual(['party_hat:D:normal', 'rubber_duck:B:normal', 'rubber_duck:D:golden']);
    expect(() => inv.scrapAll(p, ['party_hat'], { maxGrade: 'S', keepVariants: false })).toThrow(/last copy/);
    // Everything goes but the best duck.
    inv.scrapAll(p, ['rubber_duck'], { maxGrade: 'S', keepVariants: false });
    expect(p.inventory.filter((i) => i.itemId === 'rubber_duck').map((i) => i.grade)).toEqual(['B']);
  });

  it('remembers the best tier and variant ever had (the Item Index), even after scrapping', () => {
    const { p, econ, inv, repos } = setup(0);
    econ.run(p, () => {
      econ.grant(p, 'rubber_duck', 'golden', null, 'D');
      econ.grant(p, 'rubber_duck', 'normal', null, 'B');
      econ.grant(p, 'rubber_duck', 'normal', null, 'D');
    });
    expect(p.best?.get('rubber_duck')).toEqual({ grade: 'B', variant: 'golden' });
    inv.scrapAll(p, ['rubber_duck'], { maxGrade: 'S', keepVariants: false });
    expect(repos.collection.best(p.id).get('rubber_duck')).toEqual({ grade: 'B', variant: 'golden' });
  });

  it("can't sell more than you have", () => {
    const { p, econ, inv } = setup(0);
    econ.run(p, () => econ.grant(p, 'rubber_duck', 'normal', null));
    expect(() => inv.sell(p, 'rubber_duck', 'normal', 2)).toThrow(/only have 1/);
  });
});

describe('job pay and grading', () => {
  const jobs = cfg.jobs;

  it('levels up every N jobs', () => {
    expect(jobLevel(jobs, 0)).toBe(1);
    expect(jobLevel(jobs, jobs.levelUpEvery)).toBe(2);
    expect(jobLevel(jobs, 10_000)).toBe(jobs.maxLevel);
  });

  it('pays deliveries by distance, tips fast riders and docks late ones', () => {
    const fast = deliveryPay(jobs, 400, 1, 10_000, 60_000);
    const slow = deliveryPay(jobs, 400, 1, 55_000, 60_000);
    const late = deliveryPay(jobs, 400, 1, 70_000, 60_000);
    expect(fast.paySen).toBe(jobs.delivery.baseSen + jobs.delivery.perMeterSen * 400);
    expect(fast.tipSen).toBeGreaterThan(slow.tipSen);
    expect(late.tipSen).toBe(0);
    expect(late.paySen).toBeLessThan(fast.paySen);
    expect(deliveryPay(jobs, 400, 5, 10_000, 60_000).paySen).toBeGreaterThan(fast.paySen);
  });

  // A small hand-made car wash: 2 dirt spots (one stubborn), a 2×1 rinse grid, 2 shine marks.
  const job: CarwashJob = {
    kind: 'carwash', jobId: 'cw-test', color: '#e03131', startedAt: 0, timeLimitSec: 60,
    spots: [[0.3, 0.5, 6], [0.7, 0.5, 14]],
    spotRadius: 0.065,
    rinse: { cols: 2, rows: 1, hitsPerCell: 3, area: [0.1, 0.3, 0.9, 0.7] },
    polish: { spots: [[0.4, 0.5], [0.6, 0.5]], intervalMs: 1000, windowMs: 1500, hits: 4, radius: 0.075 },
  };
  /** Scrubbing back and forth around (cx, cy): n points, 40 ms apart, from t0. */
  const scrub = (cx: number, cy: number, t0: number, n: number) => {
    const pts: number[] = [];
    for (let i = 0; i < n; i++) pts.push(cx + (i % 2 ? 0.02 : -0.02), cy, t0 + i * 40);
    return pts;
  };
  const perfect = () => ({
    soap: [...scrub(0.3, 0.5, 0, 10), ...scrub(0.7, 0.5, 600, 20)],
    rinse: [...scrub(0.3, 0.5, 1600, 6), ...scrub(0.7, 0.5, 2000, 6)],
    polishStartMs: 2500,
    polish: [...scrub(0.4, 0.5, 2600, 8), ...scrub(0.6, 0.5, 3600, 8)],
  });

  it('grades all three car wash stages from raw input', () => {
    const g = gradeCarwash(jobs.carwash, job, perfect(), 6000);
    expect(g).toMatchObject({ soap: 1, rinse: 1, polish: 1, cleaned: 1, valid: true });
    expect(carwashPay(jobs, 1, 2000, 1)).toBeGreaterThan(carwashPay(jobs, 1, 20000, 1));
    expect(carwashPay(jobs, 0.1, 2000, 1)).toBe(0);
  });

  it('needs extra scrubbing for stubborn dirt, every rinse cell, and polishing on time', () => {
    const p = perfect();
    // Stubborn spot only scrubbed 8 times (needs 14): half the soap stage.
    const lightSoap = gradeCarwash(jobs.carwash, job, { ...p, soap: [...scrub(0.3, 0.5, 0, 10), ...scrub(0.7, 0.5, 600, 9)] }, 6000);
    expect(lightSoap.soap).toBe(0.5);
    expect(lightSoap.cleaned).toBeCloseTo(1 - jobs.carwash.weights.soap / 2);
    // Rinsed only the left half of the car.
    expect(gradeCarwash(jobs.carwash, job, { ...p, rinse: scrub(0.3, 0.5, 1600, 6) }, 6000).rinse).toBe(0.5);
    // Buffed the second mark before it appeared (it shows from 3500 ms): doesn't count.
    const early = gradeCarwash(jobs.carwash, job, { ...p, polish: [...scrub(0.4, 0.5, 2600, 8), ...scrub(0.6, 0.5, 2950, 8)] }, 6000);
    expect(early.polish).toBe(0.5);
  });

  it('rejects impossible car wash input', () => {
    const p = perfect();
    // Timestamps from the future (longer than the server says the game has run).
    expect(gradeCarwash(jobs.carwash, job, p, 1500).valid).toBe(false);
    // Out-of-order timestamps.
    expect(gradeCarwash(jobs.carwash, job, { ...p, soap: [0.3, 0.5, 100, 0.32, 0.5, 50] }, 6000).valid).toBe(false);
    // Rinsing before soaping is finished (stages out of order).
    expect(gradeCarwash(jobs.carwash, job, { ...p, rinse: scrub(0.3, 0.5, 200, 6) }, 6000).valid).toBe(false);
    // Superhuman speed: 2,000 points in 1 second.
    const bot: number[] = [];
    for (let i = 0; i < 2000; i++) bot.push(0.3 + (i % 2) * 0.01, 0.5, i * 0.5);
    expect(gradeCarwash(jobs.carwash, job, { soap: bot, rinse: [], polish: [], polishStartMs: 0 }, 3000).valid).toBe(false);
  });

  it('builds a car wash with the configured stubborn spots and shine marks', () => {
    const cw = makeCarwashJob(jobs.carwash, seeded(3), 'cw', 0);
    expect(cw.spots).toHaveLength(jobs.carwash.spots);
    expect(cw.spots.filter((s) => s[2] === jobs.carwash.stubbornHits)).toHaveLength(jobs.carwash.stubbornSpots);
    expect(cw.polish.spots).toHaveLength(jobs.carwash.polishSpots);
    for (const [x, y] of [...cw.spots, ...cw.polish.spots]) {
      expect(x).toBeGreaterThan(0.1);
      expect(x).toBeLessThan(0.9);
      expect(y).toBeGreaterThan(0.25);
      expect(y).toBeLessThan(0.8);
    }
  });
});
