import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TradeView } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import { World, type OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { Economy } from '../economy/economy';
import { emptyProgress } from '../progression/progression';
import { TradeSystem } from './trade';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const hat = cfg.items.items.find((i) => i.type === 'hat')!;

function setup() {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const world = new World();
  const econ = new Economy(repos, cfg);
  const mk = (name: string, walletSen: number) => {
    const id = repos.accounts.create(name, 'h', false, { x: 0, y: 0 }, 2, walletSen);
    const p = {
      id, name, hasCharacter: true, walletSen, shards: 0, inventory: [], equipped: {}, cosmetics: {}, index: new Set<string>(), pages: new Set<string>(), pity: {}, jobs: {}, skills: {},
      prog: emptyProgress(),
    } as unknown as OnlinePlayer;
    world.add(p);
    return p;
  };
  const a = mk('ali', 1_000_000), b = mk('bala', 500_000);
  const views = new Map<number, { v: TradeView | null; done?: boolean; reason?: string }>();
  const requests: number[] = [];
  const notices: string[] = [];
  const trade = new TradeSystem(econ, world, {
    view: (p, v, done, reason) => views.set(p.id, { v, done, reason }), request: (to) => requests.push(to.id), notice: (_p, t) => notices.push(t),
    wallet: () => {}, items: () => {}, removed: () => {}, lockedIids: () => new Set(), cosmeticsChanged: () => {}, check: () => {},
  });
  const give = (p: OnlinePlayer, variant = 'golden', grade = 'B') => econ.run(p, () => econ.grant(p, hat.id, variant, null, grade).item);
  const open = () => {
    trade.request(a, b.id);
    trade.respond(b, a.id, true);
  };
  return { repos, world, econ, a, b, trade, views, requests, notices, give, open };
}

describe('trading', () => {
  it('request → accept opens a window for both', () => {
    const s = setup();
    expect(() => s.trade.request(s.a, s.a.id)).toThrow(/yourself/);
    s.open();
    expect(s.requests).toEqual([s.b.id]);
    expect(s.views.get(s.a.id)!.v!.them.name).toBe('bala');
    expect(s.views.get(s.b.id)!.v!.them.name).toBe('ali');
  });

  it('both lock and confirm: items and money swap atomically (tier and variant kept)', () => {
    const s = setup();
    const item = s.give(s.a);
    s.open();
    s.trade.offer(s.a, [item.iid], 0);
    s.trade.offer(s.b, [], 200_000);
    expect(() => s.trade.confirm(s.a)).toThrow(/lock/);
    s.trade.lock(s.a);
    s.trade.lock(s.b);
    s.trade.confirm(s.a);
    expect(s.a.inventory).toHaveLength(1); // not yet: waiting for bala
    s.trade.confirm(s.b);
    expect(s.a.inventory).toHaveLength(0);
    expect(s.b.inventory).toEqual([expect.objectContaining({ itemId: hat.id, variant: 'golden', grade: 'B' })]);
    expect(s.a.walletSen).toBe(1_200_000);
    expect(s.b.walletSen).toBe(300_000);
    expect(s.views.get(s.a.id)).toMatchObject({ v: null, done: true });
    // The database agrees.
    expect(s.repos.inventory.list(s.b.id)).toHaveLength(1);
    expect(s.repos.inventory.list(s.a.id)).toHaveLength(0);
  });

  it('changing an offer unlocks both sides (no last-second switch)', () => {
    const s = setup();
    const i1 = s.give(s.a), i2 = s.give(s.a, 'normal', 'D');
    s.open();
    s.trade.offer(s.a, [i1.iid], 0);
    s.trade.lock(s.a);
    s.trade.lock(s.b);
    s.trade.offer(s.a, [i2.iid], 0); // swap in the worse one
    const v = s.views.get(s.b.id)!.v!;
    expect(v.me.locked).toBe(false);
    expect(v.them.locked).toBe(false);
    expect(() => s.trade.confirm(s.b)).toThrow(/lock/);
  });

  it('if anything is off at the swap, nothing changes for anyone', () => {
    const s = setup();
    const item = s.give(s.a);
    s.open();
    s.trade.offer(s.a, [item.iid], 0);
    s.trade.offer(s.b, [], 400_000);
    s.trade.lock(s.a);
    s.trade.lock(s.b);
    // bala spends the money before confirming.
    s.econ.run(s.b, () => s.econ.change(s.b, -300_000, 0, 'test', null));
    s.trade.confirm(s.a);
    s.trade.confirm(s.b);
    expect(s.a.inventory).toHaveLength(1);
    expect(s.a.walletSen).toBe(1_000_000);
    expect(s.b.walletSen).toBe(200_000);
    expect(s.views.get(s.a.id)).toMatchObject({ v: null, done: false });
  });

  it("worn items and other people's items can't be offered; leaving cancels", () => {
    const s = setup();
    const item = s.give(s.a);
    s.open();
    s.a.equipped = { hat: item.iid };
    expect(() => s.trade.offer(s.a, [item.iid], 0)).toThrow(/Take it off/);
    s.a.equipped = {};
    expect(() => s.trade.offer(s.b, [item.iid], 0)).toThrow(/no longer have/);
    expect(() => s.trade.offer(s.b, [], 10_000_000)).toThrow(/Not enough/);
    s.trade.leave(s.b);
    expect(s.views.get(s.a.id)).toMatchObject({ v: null, reason: 'bala left.' });
  });
});

describe('gifting', () => {
  it('sends money and items straight away', () => {
    const s = setup();
    const item = s.give(s.a);
    s.trade.gift(s.a, s.b.id, 50_000, [item.iid]);
    expect(s.a.walletSen).toBe(950_000);
    expect(s.b.walletSen).toBe(550_000);
    expect(s.b.inventory).toEqual([expect.objectContaining({ itemId: hat.id, variant: 'golden' })]);
    expect(s.notices.some((n) => /ali sent you RM 500 and 1 item/.test(n))).toBe(true);
    expect(() => s.trade.gift(s.a, s.b.id, 0, [])).toThrow(/Pick something/);
  });
});
