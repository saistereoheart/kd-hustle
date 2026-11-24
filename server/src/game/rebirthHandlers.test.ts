import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { rebirthCashMult, rebirthStars } from '@kh/shared';
import { loadConfig } from '../config/loadConfig';
import { openDatabase } from '../db/db';
import { createRepos } from '../db/repos';
import { ROOT } from '../paths';
import { emptyProgress } from '../systems/progression/progression';
import type { GameIO } from './gameServer';
import { createRebirth } from './rebirthHandlers';
import type { OnlinePlayer } from './world';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const rc = cfg.rebirth;

function setup() {
  const repos = createRepos(openDatabase(':memory:'));
  const id = repos.accounts.create('tansri', 'h', false, { x: 0, y: 0 }, 2, 500_000_000_00);
  const p = { id, name: 'tansri', scene: 'town', hasCharacter: true, walletSen: 500_000_000_00, prog: emptyProgress() } as unknown as OnlinePlayer;
  p.prog.stage = 6;
  let wiped = 0;
  let reset = 0;
  let blocker: string | null = null;
  const said: string[] = [];
  const broadcast: Array<[string, unknown]> = [];
  const io = { to: () => ({ emit: () => {} }), emit: (ev: string, d: unknown) => void broadcast.push([ev, d]) } as unknown as GameIO;
  const rb = createRebirth({
    cfg, repos, io, socketOf: () => undefined,
    blocker: () => blocker,
    wipe: () => void wiped++,
    resetSelf: (pl, start) => {
      reset++;
      pl.walletSen = start;
      pl.prog.stage = 1;
    },
    announce: (t) => said.push(t),
  });
  return { p, rb, repos, broadcast, wiped: () => wiped, reset: () => reset, said, block: (b: string | null) => (blocker = b) };
}

/** Run a registered handler like the socket would. */
function handlers(rb: ReturnType<typeof createRebirth>, p: OnlinePlayer) {
  const h = new Map<string, (a: unknown) => unknown>();
  rb.register({} as never, p, ((_s: unknown, ev: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } } | null, fn: (a: unknown) => unknown) => {
    h.set(ev, (a) => {
      if (schema && !schema.safeParse(a).success) throw new Error('bad request');
      return fn(schema ? schema.safeParse(a).data : undefined);
    });
  }) as never);
  return h;
}

describe('rebirth', () => {
  it('stars by the name: one per rebirth up to 5, then ⭐×n', () => {
    expect(rebirthStars(0)).toBe('');
    expect(rebirthStars(2)).toBe('⭐⭐ ');
    expect(rebirthStars(5)).toBe('⭐⭐⭐⭐⭐ ');
    expect(rebirthStars(7)).toBe('⭐×7 ');
  });

  it('everyone gets the stars: in the list for init, and sent out on a rebirth', () => {
    const old = setup();
    old.repos.playerData.save(old.p.id, 'rebirth', { count: 3 }); // saved before this server started
    expect(old.rb.stars()).toEqual({ tansri: 3 });
    const s = setup();
    expect(s.rb.stars()).toEqual({});
    const h = handlers(s.rb, s.p);
    h.get('rebirth:do')!({ confirm: 'REBIRTH' });
    expect(s.rb.stars()).toEqual({ tansri: 1 });
    expect(s.broadcast).toContainEqual(['rebirth:stars', { name: 'tansri', count: 1 }]);
  });

  it('the cash multiplier doubles per rebirth', () => {
    expect(rebirthCashMult(rc, 0)).toBe(1);
    expect(rebirthCashMult(rc, 1)).toBe(2);
    expect(rebirthCashMult(rc, 3)).toBe(8);
  });

  it('needs stage 6, no listings out and a typed REBIRTH; wipes and resets; income ×2', () => {
    const s = setup();
    const h = handlers(s.rb, s.p);
    s.p.prog.stage = 5;
    expect(() => h.get('rebirth:do')!({ confirm: 'REBIRTH' })).toThrow(/stage 6/);
    s.p.prog.stage = 6;
    s.block('Take your items off Pasar Online first.');
    expect(() => h.get('rebirth:do')!({ confirm: 'REBIRTH' })).toThrow(/Pasar Online/);
    s.block(null);
    expect(() => h.get('rebirth:do')!({ confirm: 'yes' })).toThrow(/bad request/);
    const r = h.get('rebirth:do')!({ confirm: 'REBIRTH' }) as { count: number; mult: number };
    expect(r).toEqual({ count: 1, mult: 2 });
    expect(s.wiped()).toBe(1);
    expect(s.reset()).toBe(1);
    expect(s.p.walletSen).toBe(cfg.economy.startingWalletSen);
    expect(s.p.rebirths).toBe(1);
    expect(s.rb.mods(s.p)).toEqual({ luck: 1, income: 2 });
    expect(s.said[0]).toMatch(/was reborn/);
    // The new life must be earned again.
    expect(() => h.get('rebirth:do')!({ confirm: 'REBIRTH' })).toThrow(/stage 6/);
    s.p.prog.stage = 6;
    h.get('rebirth:do')!({ confirm: 'REBIRTH' });
    expect(s.rb.mods(s.p).income).toBe(4);
    // The count survives a reload.
    s.rb.unload(s.p);
    expect(s.rb.mods(s.p).income).toBe(4);
  });

  it('the DB reset keeps XP and level but clears items, Index, shards, skills and stage', () => {
    const { repos, p } = setup();
    repos.inventory.insert(p.id, 'chef_mak_senah', 'normal', null);
    repos.collection.add(p.id, 'chef_mak_senah');
    repos.econ.setMoney(p.id, 123_456, 50);
    repos.econ.setState(p.id, { equipped: { chef: 1 }, pity: {}, jobs: { delivery: { level: 5, xp: 10 } } as never, pages: ['a'], skills: { hustle_harder: 4 } });
    const pr = { ...emptyProgress(), xp: 9_999, level: 12, stage: 6, title: 'boss' };
    repos.progress.save(p.id, pr as never);
    repos.accounts.rebirthReset(p.id, cfg.economy.startingWalletSen);
    expect(repos.inventory.list(p.id)).toEqual([]);
    expect(repos.collection.list(p.id)).toEqual([]);
    const e = repos.econ.load(p.id);
    expect(e).toMatchObject({ walletSen: cfg.economy.startingWalletSen, shards: 0, equipped: {}, jobs: {}, pages: [], skills: {} });
    const after = repos.progress.load(p.id);
    expect(after.xp).toBe(9_999);
    expect(after.level).toBe(12);
    expect(after.stage).toBe(1);
  });
});
