import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { perkCost, rebirthTokens } from '@kh/shared';
import { loadConfig } from '../config/loadConfig';
import { openDatabase } from '../db/db';
import { createRepos } from '../db/repos';
import { ROOT } from '../paths';
import { Economy } from '../systems/economy/economy';
import { emptyProgress } from '../systems/progression/progression';
import type { GameIO } from './gameServer';
import { createRebirth } from './rebirthHandlers';
import type { OnlinePlayer } from './world';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const rc = cfg.rebirth;
const RM_1B = 100_000_000_000;

function setup(netWorth: number) {
  const repos = createRepos(openDatabase(':memory:'));
  const econ = new Economy(repos, cfg);
  const id = repos.accounts.create('tansri', 'h', false, { x: 0, y: 0 }, 2, netWorth);
  const p = { id, name: 'tansri', scene: 'town', hasCharacter: true, walletSen: netWorth, shards: 0, inventory: [], equipped: {}, cosmetics: {}, index: new Set(), pages: new Set(), pity: {}, jobs: {}, skills: {}, prog: emptyProgress() } as unknown as OnlinePlayer;
  p.prog.stage = 6;
  let wiped = 0;
  const said: string[] = [];
  const io = { to: () => ({ emit: () => {} }) } as unknown as GameIO;
  const rb = createRebirth({
    cfg, repos, econ, io, socketOf: () => undefined, pushWallet: () => {}, netWorth: (pl) => pl.walletSen, heldBids: () => 0,
    wipe: () => void wiped++, announce: (t) => said.push(t), check: () => {}, progress: () => {},
  });
  return { p, rb, repos, wiped: () => wiped, said, sock: (handlers: Map<string, (a: unknown) => unknown>) => handlers };
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
  it('tokens grow with net worth (√), with a minimum', () => {
    expect(rebirthTokens(rc, RM_1B)).toBe(rc.tokens.base);
    expect(rebirthTokens(rc, 4 * RM_1B)).toBe(rc.tokens.base * 2);
    expect(rebirthTokens(rc, 0)).toBe(rc.tokens.min);
  });

  it('needs stage 6 and a typed REBIRTH; resets cash and stage, wipes assets, keeps going with tokens', () => {
    const s = setup(4 * RM_1B);
    const h = handlers(s.rb, s.p);
    s.p.prog.stage = 5;
    expect(() => h.get('rebirth:do')!({ confirm: 'REBIRTH' })).toThrow(/stage 6/);
    s.p.prog.stage = 6;
    expect(() => h.get('rebirth:do')!({ confirm: 'yes' })).toThrow(/bad request/);
    const r = h.get('rebirth:do')!({ confirm: 'REBIRTH' }) as { tokens: number };
    expect(r.tokens).toBe(20);
    expect(s.wiped()).toBe(1);
    expect(s.p.walletSen).toBe(cfg.economy.startingWalletSen);
    expect(s.p.prog.stage).toBe(1);
    expect(s.p.rebirths).toBe(1);
    expect(s.said[0]).toMatch(/was reborn/);
    // The new life must be earned again.
    expect(() => h.get('rebirth:do')!({ confirm: 'REBIRTH' })).toThrow(/stage 6/);
  });

  it('perks cost tokens and change luck, income, starting cash and offline income', () => {
    const s = setup(4 * RM_1B);
    const h = handlers(s.rb, s.p);
    h.get('rebirth:do')!({ confirm: 'REBIRTH' }); // 20 tokens
    expect(s.rb.mods(s.p)).toEqual({ luck: 1, income: 1 });
    h.get('rebirth:buy')!({ perk: 'luck' });
    h.get('rebirth:buy')!({ perk: 'income' });
    h.get('rebirth:buy')!({ perk: 'offlineCap' });
    expect(s.rb.mods(s.p).luck).toBeCloseTo(1.1);
    expect(s.rb.mods(s.p).income).toBeCloseTo(1.1);
    expect(s.rb.offlineFor(s.p).capHours).toBe(cfg.economy.offline.capHours + 2);
    // Out of tokens eventually.
    let spent = perkCost(rc, 'luck', 0) + perkCost(rc, 'income', 0) + perkCost(rc, 'offlineCap', 0);
    let lv = 0;
    while (spent + perkCost(rc, 'startCash', lv) <= 20) spent += perkCost(rc, 'startCash', lv++);
    for (let i = 0; i < lv; i++) h.get('rebirth:buy')!({ perk: 'startCash' });
    expect(() => h.get('rebirth:buy')!({ perk: 'startCash' })).toThrow(/Rebirth Tokens/);
    // Next life starts with Trust Fund cash.
    s.p.prog.stage = 6;
    h.get('rebirth:do')!({ confirm: 'REBIRTH' });
    expect(s.p.walletSen).toBe(cfg.economy.startingWalletSen + lv * 1_000_000);
    expect(s.p.rebirths).toBe(2);
  });
});
