import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import { World, type OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { Economy } from '../economy/economy';
import { emptyProgress } from '../progression/progression';
import { BoutiqueSystem } from './boutique';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const bq = cfg.businesses.boutique;
const anItem = cfg.items.items.find((i) => i.type === 'hat')!;

function setup() {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const world = new World();
  const mk = (name: string, walletSen: number) => {
    const id = repos.accounts.create(name, 'h', false, { x: 0, y: 0 }, 2, walletSen);
    const p = {
      id, name, hasCharacter: true, walletSen, shards: 0, inventory: [], equipped: {}, cosmetics: {}, index: new Set<string>(), pages: new Set<string>(), pity: {}, jobs: {}, skills: {},
      prog: emptyProgress(),
    } as unknown as OnlinePlayer;
    p.prog.stage = 3;
    world.add(p);
    return p;
  };
  const seller = mk('seller', 10_000_000);
  const buyer = mk('buyer', 10_000_000);
  const econ = new Economy(repos, cfg);
  const events: string[] = [];
  const mkSys = () =>
    new BoutiqueSystem(cfg, repos, econ, world, {
      wallet: () => {}, items: () => {}, removed: () => {}, listingsChanged: () => {}, selfChanged: () => {}, event: (_p, t) => events.push(t), lockedIids: () => new Set(), check: () => {},
    });
  const sys = mkSys();
  const give = (p: OnlinePlayer) => econ.run(p, () => econ.grant(p, anItem.id, 'golden', null, 'B').item);
  return { repos, world, seller, buyer, econ, sys, give, events, mkSys };
}

describe('the boutique', () => {
  it('needs to be opened (stage + fee), and listing takes the item out of your bag', () => {
    const s = setup();
    const it0 = s.give(s.seller);
    expect(() => s.sys.list(s.seller, it0.iid, 50_000)).toThrow(/Open/);
    s.seller.prog.stage = 1;
    expect(() => s.sys.open(s.seller)).toThrow(/stage/);
    s.seller.prog.stage = 3;
    const w = s.seller.walletSen;
    s.sys.open(s.seller);
    expect(w - s.seller.walletSen).toBe(bq.openSen);
    const { listing } = s.sys.list(s.seller, it0.iid, 50_000);
    expect(s.seller.inventory.find((i) => i.iid === it0.iid)).toBeUndefined();
    expect(listing).toMatchObject({ itemId: anItem.id, variant: 'golden', grade: 'B', priceSen: 50_000, sellerName: 'seller' });
    // Cancel: it comes back (same item, tier and variant).
    const { item } = s.sys.cancel(s.seller, listing.id);
    expect(item).toMatchObject({ itemId: anItem.id, variant: 'golden', grade: 'B' });
    expect(s.sys.all()).toEqual([]);
  });

  it('a sale moves the item to the buyer and pays the seller minus the fee (right away if online)', () => {
    const s = setup();
    s.sys.open(s.seller);
    const it0 = s.give(s.seller);
    const { listing } = s.sys.list(s.seller, it0.iid, 100_000);
    expect(() => s.sys.buy(s.seller, listing.id)).toThrow(/your own/);
    const ws = s.seller.walletSen, wb = s.buyer.walletSen;
    const { item } = s.sys.buy(s.buyer, listing.id);
    expect(item).toMatchObject({ itemId: anItem.id, variant: 'golden', grade: 'B' });
    expect(s.buyer.inventory.some((i) => i.iid === item.iid)).toBe(true);
    expect(wb - s.buyer.walletSen).toBe(100_000);
    expect(s.seller.walletSen - ws).toBe(Math.floor(100_000 * (1 - bq.feeRate)));
    expect(s.events.some((e) => /bought your/.test(e))).toBe(true);
    expect(() => s.sys.buy(s.buyer, listing.id)).toThrow(/already bought/);
  });

  it('an offline seller is paid at their next login; listings survive a restart', () => {
    const s = setup();
    s.sys.open(s.seller);
    const { listing } = s.sys.list(s.seller, s.give(s.seller).iid, 200_000);
    s.world.remove(s.seller.id);
    const again = s.mkSys(); // the server restarted
    expect(again.all()).toHaveLength(1);
    const ws = s.seller.walletSen;
    again.buy(s.buyer, listing.id);
    expect(s.seller.walletSen).toBe(ws); // not online: owed, not paid yet
    expect(again.selfOf(s.seller.id).pendingSen).toBe(Math.floor(200_000 * (1 - bq.feeRate)));
    s.world.add(s.seller);
    const r = again.collect(s.seller);
    expect(r.sales).toEqual([{ itemId: anItem.id, priceSen: 200_000, buyer: 'buyer' }]);
    expect(s.seller.walletSen - ws).toBe(r.sen);
    expect(again.selfOf(s.seller.id).pendingSen).toBe(0);
  });

  it('refuses worn items, silly prices and a full display', () => {
    const s = setup();
    s.sys.open(s.seller);
    const worn = s.give(s.seller);
    s.seller.equipped = { hat: worn.iid };
    expect(() => s.sys.list(s.seller, worn.iid, 10_000)).toThrow(/Take it off/);
    s.seller.equipped = {};
    expect(() => s.sys.list(s.seller, worn.iid, 1)).toThrow(/between/);
    for (let i = 0; i < bq.slots; i++) s.sys.list(s.seller, s.give(s.seller).iid, 10_000);
    expect(() => s.sys.list(s.seller, worn.iid, 10_000)).toThrow(/slots/);
  });
});
