import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import { World, type OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { Economy } from '../economy/economy';
import { emptyProgress } from '../progression/progression';
import { MarketSystem } from './market';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const mc = cfg.market;
const hat = cfg.items.items.find((i) => i.type === 'hat')!;
const HOUR = 60 * cfg.time.realMsPerGameMinute;

function setup() {
  const repos = createRepos(openDatabase(':memory:'));
  const world = new World();
  const econ = new Economy(repos, cfg);
  const mk = (name: string) => {
    const id = repos.accounts.create(name, 'h', false, { x: 0, y: 0 }, 2, 10_000_000);
    const p = { id, name, hasCharacter: true, walletSen: 10_000_000, shards: 0, inventory: [], equipped: {}, cosmetics: {}, index: new Set(), pages: new Set(), pity: {}, jobs: {}, skills: {}, prog: emptyProgress() } as unknown as OnlinePlayer;
    p.prog.stage = 3;
    world.add(p);
    return p;
  };
  const seller = mk('seller'), b1 = mk('b1'), b2 = mk('b2');
  let now = 5_000_000;
  const market = new MarketSystem(cfg, repos, econ, world, { wallet: () => {}, items: () => {}, changed: () => {}, notice: () => {}, lockedIids: () => new Set(), check: () => {} }, () => now);
  const give = () => econ.run(seller, () => econ.grant(seller, hat.id, 'shiny', null, 'C').item);
  return { repos, world, seller, b1, b2, market, give, advance: (ms: number) => ((now += ms), market.tick()) };
}

describe('Pasar Online', () => {
  it('fixed price: the buyer gets the item, the seller the price minus the fee; the sale goes into history', () => {
    const s = setup();
    const it0 = s.give();
    const { listing } = s.market.list(s.seller, it0.iid, 'fixed', 50_000);
    expect(s.seller.inventory).toHaveLength(0);
    expect(() => s.market.buy(s.seller, listing.id)).toThrow(/own listing/);
    s.market.buy(s.b1, listing.id);
    expect(s.b1.inventory).toEqual([expect.objectContaining({ itemId: hat.id, variant: 'shiny', grade: 'C' })]);
    expect(s.b1.walletSen).toBe(10_000_000 - 50_000);
    expect(s.seller.walletSen).toBe(10_000_000 + Math.floor(50_000 * (1 - mc.feeRate)));
    expect(s.market.history(hat.id)).toEqual({ sales: [expect.objectContaining({ priceSen: 50_000, kind: 'fixed' })], avgSen: 50_000 });
    expect(() => s.market.buy(s.b2, listing.id)).toThrow(/gone/);
  });

  it('auction: bids are held, outbid bidders are refunded, the winner gets the item when it closes', () => {
    const s = setup();
    const { listing } = s.market.list(s.seller, s.give().iid, 'auction', 10_000, mc.auctionHours[0]);
    expect(() => s.market.bid(s.b1, listing.id, 9_000)).toThrow(/at least/);
    s.market.bid(s.b1, listing.id, 10_000);
    expect(s.b1.walletSen).toBe(10_000_000 - 10_000); // held
    expect(() => s.market.bid(s.b2, listing.id, 10_100)).toThrow(/at least/); // +5% needed
    s.market.bid(s.b2, listing.id, 20_000);
    expect(s.b1.walletSen).toBe(10_000_000); // refunded
    expect(() => s.market.cancel(s.seller, listing.id)).toThrow(/already bid/);
    s.advance(mc.auctionHours[0] * HOUR + 1000);
    expect(s.market.all()).toEqual([]);
    expect(s.b2.inventory).toHaveLength(1);
    expect(s.b2.walletSen).toBe(10_000_000 - 20_000);
    expect(s.seller.walletSen).toBe(10_000_000 + Math.floor(20_000 * (1 - mc.feeRate)));
  });

  it('a late bid extends the auction (no sniping)', () => {
    const s = setup();
    const { listing } = s.market.list(s.seller, s.give().iid, 'auction', 10_000, mc.auctionHours[0]);
    s.advance(mc.auctionHours[0] * HOUR - 5_000);
    s.market.bid(s.b1, listing.id, 10_000);
    s.advance(10_000); // past the original end, but within the extension
    expect(s.market.all()).toHaveLength(1);
    s.advance(mc.antiSnipeMs);
    expect(s.market.all()).toHaveLength(0);
  });

  it('offline players get their money and items at their next login; no bids returns the item', () => {
    const s = setup();
    const { listing } = s.market.list(s.seller, s.give().iid, 'auction', 10_000, mc.auctionHours[0]);
    const other = s.market.list(s.seller, s.give().iid, 'auction', 10_000, mc.auctionHours[0]).listing;
    s.market.bid(s.b1, listing.id, 30_000);
    s.world.remove(s.seller.id);
    s.world.remove(s.b1.id);
    s.advance(mc.auctionHours[0] * HOUR + 1000);
    s.world.add(s.seller);
    s.world.add(s.b1);
    const sw = s.seller.walletSen;
    const got = s.market.collect(s.seller);
    expect(got.sen).toBe(Math.floor(30_000 * (1 - mc.feeRate)));
    expect(s.seller.walletSen - sw).toBe(got.sen);
    expect(s.seller.inventory).toHaveLength(1); // the one nobody bid on came back
    expect(s.market.collect(s.b1).notes.join()).toMatch(/won the auction/);
    expect(s.b1.inventory).toHaveLength(1);
    void other;
  });
});
