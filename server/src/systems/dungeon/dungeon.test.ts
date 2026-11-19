import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { floorLoot, hitLandsAt, type DungeonTurn, type RandInt } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import { World, type OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { Economy } from '../economy/economy';
import { emptyProgress, ProgressionSystem } from '../progression/progression';
import { DungeonSystem } from './dungeon';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const dc = cfg.dungeon;

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

function setup() {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const id = repos.accounts.create('hunter', 'h', false, { x: 0, y: 0 }, 2, 10_000);
  const p = {
    id, name: 'hunter', hasCharacter: true, walletSen: 10_000, shards: 0, inventory: [], equipped: {}, cosmetics: {}, index: new Set<string>(), pages: new Set<string>(), pity: {}, jobs: {}, skills: {},
    prog: emptyProgress(),
  } as unknown as OnlinePlayer;
  const world = new World();
  world.add(p);
  let now = 1_700_000_000_000;
  const clock = () => now;
  const econ = new Economy(repos, cfg);
  const rand = seeded(9);
  const prog = new ProgressionSystem(cfg, repos, econ, rand, {
    wallet: () => {}, items: () => {}, progress: () => {}, publicChanged: () => {}, announce: () => {}, freeRoll: () => ({ crateId: '', results: [] }),
  }, clock);
  prog.load(p);
  p.prog.goalsDone = cfg.goals.goals.map((g) => g.id); // keep Hustle Path rewards out of the sums
  p.prog.level = 10;
  p.prog.stage = 1;
  const wallets: number[] = [];
  const dungeon = new DungeonSystem(cfg, repos, econ, prog, rand, { wallet: (_p, d) => wallets.push(d) }, clock);
  /** Play one turn perfectly (or with these taps), `wait` ms after it appeared. */
  const play = (taps?: { strike: number | null; block: number | null }) => {
    const t = dungeon.view(p).run!.turn as DungeonTurn;
    const strike = taps ? taps.strike : t.zone * t.sweepMs;
    const block = taps ? taps.block : strike === null ? null : hitLandsAt(dc, t, strike);
    now += Math.max(strike ?? 0, block ?? 0) + 50;
    return dungeon.turn(p, t.nonce, strike, block);
  };
  return { repos, p, dungeon, play, wallets, tick: (ms: number) => (now += ms), setNow: (t: number) => (now = t) };
}

describe('dungeon (server)', () => {
  it('a run: fight, clear the floor, go deeper, cash out with all the loot', () => {
    const s = setup();
    const v = s.dungeon.enter(s.p);
    expect(v.runsLeft).toBe(dc.runsPerDay - 1);
    expect(v.run!.phase).toBe('fight');
    expect(() => s.dungeon.enter(s.p)).toThrow(/already/);
    expect(() => s.dungeon.deeper(s.p)).toThrow(/Beat this floor/);
    while (s.dungeon.view(s.p).run!.phase === 'fight') s.play();
    expect(s.dungeon.view(s.p).run!.phase).toBe('cleared');
    s.dungeon.deeper(s.p);
    while (s.dungeon.view(s.p).run!.phase === 'fight') s.play();
    const loot1 = floorLoot(dc, 1, 1), loot2 = floorLoot(dc, 1, 2);
    expect(s.dungeon.view(s.p).run!.loot.sen).toBe(loot1.sen + loot2.sen);
    const w = s.p.walletSen, xp = s.p.prog.xp;
    const { paid } = s.dungeon.leave(s.p);
    expect(paid.sen).toBe(loot1.sen + loot2.sen);
    expect(s.p.walletSen).toBe(w + paid.sen);
    expect(s.p.prog.xp).toBeGreaterThan(xp);
    expect(s.p.prog.stats.dungeonFloors).toBe(2);
    expect(s.dungeon.view(s.p).best).toBe(2);
    expect(s.dungeon.view(s.p).run).toBeNull();
  });

  it('taps that are impossible (before the turn, later than real time, too fast) count as misses', () => {
    const s = setup();
    s.dungeon.enter(s.p);
    const t = s.dungeon.view(s.p).run!.turn!;
    // Claims a perfect strike 3 s in, but only 100 ms have passed: it's a miss.
    s.tick(100);
    const r = s.dungeon.turn(s.p, t.nonce, 3000, 3500).result;
    expect(r.strike).toBe('miss');
    // The old turn can't be replayed.
    expect(() => s.dungeon.turn(s.p, t.nonce, 10, 20)).toThrow(/turn is over/);
    // Inhumanly fast strike.
    const t2 = s.dungeon.view(s.p).run!.turn!;
    s.tick(5000);
    expect(s.dungeon.turn(s.p, t2.nonce, 50, null).result.strike).toBe('miss');
  });

  it('falling keeps half the loot; fleeing too; a cleared floor at logout is paid in full', () => {
    const s = setup();
    s.dungeon.enter(s.p);
    while (s.dungeon.view(s.p).run!.phase === 'fight') s.play();
    const loot = s.dungeon.view(s.p).run!.loot.sen;
    s.dungeon.deeper(s.p);
    const w = s.p.walletSen;
    // Never block, never hit: down you go.
    let paid = 0;
    for (let i = 0; i < 200 && s.dungeon.view(s.p).run!.phase === 'fight'; i++) {
      const r = s.play({ strike: null, block: null });
      if (r.paid) paid = r.paid.sen;
    }
    expect(s.dungeon.view(s.p).run!.phase).toBe('dead');
    expect(paid).toBe(Math.floor(loot * dc.deathKeep));
    expect(s.p.walletSen).toBe(w + paid);
    // Leaving after falling pays nothing more.
    expect(s.dungeon.leave(s.p).paid.sen).toBe(0);
    // Fleeing mid-fight: half.
    s.dungeon.enter(s.p);
    while (s.dungeon.view(s.p).run!.phase === 'fight') s.play();
    const l2 = s.dungeon.view(s.p).run!.loot.sen;
    s.dungeon.deeper(s.p);
    expect(s.dungeon.leave(s.p).paid.sen).toBe(Math.floor(l2 * dc.deathKeep));
    // Logging off between floors: everything.
    s.dungeon.enter(s.p);
    while (s.dungeon.view(s.p).run!.phase === 'fight') s.play();
    const l3 = s.dungeon.view(s.p).run!.loot.sen;
    const w3 = s.p.walletSen;
    s.dungeon.unload(s.p);
    expect(s.p.walletSen).toBe(w3 + l3);
  });

  it('only so many runs a day; they come back the next day', () => {
    const s = setup();
    for (let i = 0; i < dc.runsPerDay; i++) {
      s.dungeon.enter(s.p);
      s.dungeon.leave(s.p);
    }
    expect(() => s.dungeon.enter(s.p)).toThrow(/runs for today/);
    s.tick(26 * 3600_000);
    expect(s.dungeon.enter(s.p).runsLeft).toBe(dc.runsPerDay - 1);
  });
});
