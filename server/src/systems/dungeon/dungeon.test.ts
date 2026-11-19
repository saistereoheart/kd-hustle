import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { floorLoot, type RandInt } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import { World, type OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { Economy } from '../economy/economy';
import { emptyProgress, ProgressionSystem } from '../progression/progression';
import { PetSystem } from '../pets/pets';
import { DungeonSystem } from './dungeon';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const dc = cfg.dungeon;
const pc = cfg.pets;

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

function setup(walletSen = 50_000_000) {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const id = repos.accounts.create('hunter', 'h', false, { x: 0, y: 0 }, 2, walletSen);
  const p = {
    id, name: 'hunter', hasCharacter: true, walletSen, shards: 0, inventory: [], equipped: {}, cosmetics: {}, index: new Set<string>(), pages: new Set<string>(), pity: {}, jobs: {}, skills: {},
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
  p.prog.goalsDone = cfg.goals.goals.map((g) => g.id);
  p.prog.stage = 1;
  const pets = new PetSystem(cfg, repos, econ, { wallet: () => {}, items: () => {}, check: () => {} });
  const dungeon = new DungeonSystem(cfg, repos, econ, prog, pets, rand, { wallet: () => {} }, clock);
  return { repos, p, pets, dungeon, econ, tick: (ms: number) => (now += ms) };
}

describe('pets (server)', () => {
  it('buy a starter (it joins the team), train it, upgrade it, give it gear; team pets are locked', () => {
    const s = setup();
    expect(() => s.pets.buyStarter(s.p, 'pet_naga')).toThrow(/Telur Teman/);
    const w = s.p.walletSen;
    const v = s.pets.buyStarter(s.p, pc.starters.ids[0]);
    expect(s.p.walletSen).toBe(w - pc.starters.priceSen);
    expect(v.pets).toHaveLength(1);
    const iid = v.pets[0].iid;
    expect(v.team).toEqual([iid]);
    const before = v.pets[0].stats;
    const t = s.pets.train(s.p, iid);
    expect(t.level).toBe(2);
    expect(t.view.pets[0].stats.atk).toBeGreaterThanOrEqual(before.atk);
    const u = s.pets.upgrade(s.p, iid, 'atk');
    expect(u.pets[0].up.atk).toBe(1);
    const gear = s.econ.run(s.p, () => s.econ.grant(s.p, 'pg_taring', 'normal', null)).item;
    const g = s.pets.setGear(s.p, iid, gear.iid);
    expect(g.pets[0].gear).toBe(gear.iid);
    expect(g.pets[0].stats.atk).toBeGreaterThan(u.pets[0].stats.atk);
    expect(s.pets.lockedIids(s.p)).toEqual(new Set([iid, gear.iid]));
    expect(() => s.pets.setGear(s.p, iid, iid)).toThrow(/pet gear/);
  });
});

describe('dungeon (server, turn-based)', () => {
  it('needs a team; fights round by round; a win banks the loot; cash out pays it all', () => {
    const s = setup();
    expect(() => s.dungeon.enter(s.p)).toThrow(/Teman/);
    s.pets.buyStarter(s.p, 'pet_kucing');
    const v = s.dungeon.enter(s.p);
    expect(v.run!.phase).toBe('fight');
    expect(v.run!.team).toHaveLength(1);
    let guard = 0;
    while (s.dungeon.view(s.p).run!.phase === 'fight' && guard++ < 100) {
      const r = s.dungeon.act(s.p, 'auto');
      expect(r.events.length).toBeGreaterThan(0);
    }
    const run = s.dungeon.view(s.p).run!;
    if (run.phase === 'cleared') {
      expect(run.loot.sen).toBe(floorLoot(dc, 1, 1, pc.xp.perFloor, pc.xp.bossMult).sen);
      const w = s.p.walletSen;
      const { paid } = s.dungeon.leave(s.p);
      expect(s.p.walletSen).toBeGreaterThanOrEqual(w + paid.sen); // (plus any level-up reward from the XP)
      // The pet got XP for the win.
      expect(s.pets.view(s.p).pets[0].level > 1 || s.pets.view(s.p).pets[0].xp > 0).toBe(true);
    }
  });

  it('Skip plays the fight out at once; deeper heals; falling keeps half', () => {
    const s = setup();
    s.pets.buyStarter(s.p, 'pet_kucing');
    s.dungeon.enter(s.p);
    const r1 = s.dungeon.act(s.p, 'auto', true);
    expect(['cleared', 'dead']).toContain(s.dungeon.view(s.p).run!.phase);
    expect(r1.events.some((e) => e.kind === 'win' || e.kind === 'lose' || e.kind === 'flee')).toBe(true);
    // Keep going until the team falls.
    let loot = 0, paid = 0;
    for (let i = 0; i < 40 && s.dungeon.view(s.p).run?.phase === 'cleared'; i++) {
      loot = s.dungeon.view(s.p).run!.loot.sen;
      s.dungeon.deeper(s.p);
      const r = s.dungeon.act(s.p, 'auto', true);
      if (r.paid) paid = r.paid.sen;
    }
    if (s.dungeon.view(s.p).run?.phase === 'dead') expect(paid).toBe(Math.floor(loot * dc.deathKeep));
  });

  it('only so many runs a day', () => {
    const s = setup();
    s.pets.buyStarter(s.p, 'pet_ayam');
    for (let i = 0; i < dc.runsPerDay; i++) {
      s.dungeon.enter(s.p);
      s.dungeon.leave(s.p);
    }
    expect(() => s.dungeon.enter(s.p)).toThrow(/runs for today/);
    s.tick(26 * 3600_000);
    expect(s.dungeon.enter(s.p).runsLeft).toBe(dc.runsPerDay - 1);
  });
});
