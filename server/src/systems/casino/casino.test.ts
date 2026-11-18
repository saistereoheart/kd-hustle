import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { betLimits, crashMsFor, handValue, type BlackjackView, type RandInt } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import { World, type OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { Economy } from '../economy/economy';
import { emptyProgress } from '../progression/progression';
import { CasinoSystem } from './casino';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const cc = cfg.casino;

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

function setup(seed = 1) {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const world = new World();
  const econ = new Economy(repos, cfg);
  const mk = (name: string, walletSen = 100_000_000, stage = 4) => {
    const id = repos.accounts.create(name, 'h', false, { x: 0, y: 0 }, 2, walletSen);
    const p = {
      id, name, hasCharacter: true, walletSen, shards: 0, inventory: [], equipped: {}, cosmetics: {}, index: new Set<string>(), pages: new Set<string>(), pity: {}, jobs: {}, skills: {},
      prog: emptyProgress(),
    } as unknown as OnlinePlayer;
    p.prog.stage = stage;
    world.add(p);
    return p;
  };
  let now = 1_000_000_000;
  const announced: string[] = [];
  let lastBj: BlackjackView | null = null;
  const casino = new CasinoSystem(cfg, repos, econ, world, seeded(seed), {
    wallet: () => {}, announce: (t) => announced.push(t), event: () => {}, items: () => {}, session: () => {}, check: () => {},
    table: (game, view) => {
      if (game === 'blackjack') lastBj = view as BlackjackView;
    },
  }, () => now);
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 250) {
      now += 250;
      casino.tick(now);
    }
  };
  return { repos, world, econ, mk, casino, run, announced, now: () => now, bj: () => lastBj };
}

describe('casino: money and limits', () => {
  it('bets must be within your stage limits; slots pay what the reels say', () => {
    const s = setup();
    const p = s.mk('gambler', 100_000_000, 2);
    const [min, max] = betLimits(cc, 2);
    expect(() => s.casino.slots(p, min - 1)).toThrow(/Bets at your wealth stage/);
    expect(() => s.casino.slots(p, max + 1)).toThrow(/Bets at your wealth stage/);
    let wagered = 0, back = 0;
    for (let i = 0; i < 2000; i++) {
      const w = p.walletSen;
      const r = s.casino.slots(p, min);
      wagered += min;
      back += r.paidSen;
      expect(p.walletSen - w).toBe(r.paidSen - min);
    }
    // Sanity only: slots are high-variance (the exact ~95.6% return is tested in shared/casino).
    expect(back / wagered).toBeGreaterThan(0.4);
    expect(back / wagered).toBeLessThan(1.6);
    expect(s.casino.session(p).wageredSen).toBe(wagered);
  });

  it('high-low: a right guess grows the pot, a wrong one loses it; cash out pays the pot', () => {
    const s = setup(3);
    const p = s.mk('hl');
    const [min] = betLimits(cc, 4);
    const w = p.walletSen;
    const { state } = s.casino.hlStart(p, min);
    expect(p.walletSen).toBe(w - min);
    const guess = Math.floor(state.card / 4) <= 7 ? 'higher' : 'lower';
    const r = s.casino.hlGuess(p, guess);
    if (r.correct) {
      expect(r.state!.pot).toBeGreaterThan(min);
      const { paidSen } = s.casino.hlCashout(p);
      expect(p.walletSen).toBe(w - min + paidSen);
    } else {
      expect(r.state).toBeNull();
      expect(p.walletSen).toBe(w - min);
    }
  });
});

describe('casino: shared tables', () => {
  it('roulette: bets close, the result is settled at once, then a new round opens', () => {
    const s = setup(5);
    const a = s.mk('a'), b = s.mk('b');
    const [min] = betLimits(cc, 4);
    s.casino.rouletteBet(a, 'red', min);
    s.casino.rouletteBet(b, 'black', min);
    const wa = a.walletSen, wb = b.walletSen;
    s.run(cc.roulette.bettingMs + 250);
    const v = s.casino.rouletteView();
    expect(v.phase).toBe('spinning');
    expect(() => s.casino.rouletteBet(a, 'red', min)).toThrow(/No more bets/);
    // Exactly one of red/black wins unless it's 0.
    const won = (a.walletSen - wa) + (b.walletSen - wb);
    expect(won).toBe(v.result === 0 ? 0 : 2 * min);
    s.run(cc.roulette.spinMs + cc.roulette.resultMs + 500);
    expect(s.casino.rouletteView()).toMatchObject({ phase: 'betting', bets: [] });
  });

  it('crash: cash out before it crashes and win bet × multiplier; auto cash-out too', () => {
    // Find a seed whose crash point is high enough to cash out at 1.5×.
    for (let seed = 1; seed < 50; seed++) {
      const s = setup(seed);
      const p = s.mk('c'), q = s.mk('q');
      const [min] = betLimits(cc, 4);
      s.casino.crashBet(p, min, null);
      s.casino.crashBet(q, min, 1.3);
      s.run(cc.crash.bettingMs + 250);
      const point = (s.casino as unknown as { crash: { point: number } }).crash.point;
      if (point < 1.6) continue;
      const w = p.walletSen, wq = q.walletSen;
      s.run(crashMsFor(cc, 1.5));
      const r = s.casino.crashCashout(p);
      expect(r.mult).toBeGreaterThanOrEqual(1.5);
      expect(p.walletSen - w).toBe(Math.floor(min * r.mult));
      expect(q.walletSen - wq).toBe(Math.floor(min * 1.3)); // auto cashed out at 1.3×
      return;
    }
    throw new Error('no seed crashed above 1.6×');
  });

  it('blackjack: 3 players at one table, everyone acts in turn and gets settled', () => {
    const s = setup(11);
    const ps = [s.mk('ali'), s.mk('bala'), s.mk('chong')];
    const [min] = betLimits(cc, 4);
    ps.forEach((p, i) => s.casino.bjSit(p, i));
    expect(() => s.casino.bjSit(s.mk('dave'), 0)).toThrow(/taken/);
    const before = ps.map((p) => p.walletSen);
    for (const p of ps) s.casino.bjBet(p, min);
    // Everyone bet: cards are dealt; play every hand: hit below 15, else stand.
    for (let guard = 0; guard < 50; guard++) {
      const v = s.casino.bjView();
      if (v.phase !== 'playing' || !v.turn) break;
      const seat = v.seats[v.turn.seat]!;
      const h = seat.hands[v.turn.hand];
      const p = ps.find((x) => x.id === seat.player)!;
      expect(() => s.casino.bjAction(ps.find((x) => x.id !== seat.player)!, 'hit')).toThrow(/your turn/);
      s.casino.bjAction(p, handValue(h.cards).total < 15 ? 'hit' : 'stand');
    }
    const v = s.casino.bjView();
    expect(v.phase).toBe('result');
    expect(v.dealer.every((c) => c >= 0)).toBe(true); // the hole card is shown
    for (let i = 0; i < 3; i++) {
      const hand = v.seats[i]!.hands[0];
      expect(hand.result).toBeDefined();
      expect(ps[i].walletSen - before[i]).toBe(hand.paid! - min);
    }
    s.run(cc.blackjack.resultMs + 500);
    expect(s.casino.bjView()).toMatchObject({ phase: 'waiting' });
    expect(s.casino.bjView().seats.filter(Boolean)).toHaveLength(3); // still seated for the next hand
  });

  it('winnings for someone who left are paid at their next login; shutdown refunds open bets', () => {
    const s = setup(5);
    const a = s.mk('a');
    const [min] = betLimits(cc, 4);
    s.casino.rouletteBet(a, 'red', min);
    s.casino.rouletteBet(a, 'black', min);
    s.casino.rouletteBet(a, 'n:0', min);
    s.world.remove(a.id);
    s.run(cc.roulette.bettingMs + 250);
    s.world.add(a);
    const w = a.walletSen;
    const paid = s.casino.collect(a);
    expect(paid).toBeGreaterThan(0); // one of the three always wins
    expect(a.walletSen - w).toBe(paid);
    // Bets on the next round are refunded if the server stops.
    s.run(cc.roulette.spinMs + cc.roulette.resultMs + 500);
    s.casino.rouletteBet(a, 'red', min);
    const w2 = a.walletSen;
    s.casino.refundOpenBets();
    expect(a.walletSen - w2).toBe(min);
  });

  it('the daily free spin works once a day', () => {
    const s = setup();
    const p = s.mk('spinner');
    const r = s.casino.dailySpin(p);
    expect(cc.dailySpin.prizes[r.index]).toBeDefined();
    expect(() => s.casino.dailySpin(p)).toThrow(/already spun/);
  });
});
