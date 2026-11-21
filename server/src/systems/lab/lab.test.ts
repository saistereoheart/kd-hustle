import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAB_DIRS, roomLayout, seenHas, type LabDir } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { LabSystem } from './lab';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const lc = cfg.lab;
const T = lc.tile;

function setup() {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const id = repos.accounts.create('delver', 'h', false, { x: 0, y: 0 }, 2, 0);
  const p = { id, name: 'delver', hasCharacter: true, lab: null } as unknown as OnlinePlayer;
  let now = 1_700_000_000_000;
  const lab = new LabSystem(lc, repos, () => 0.5, () => now);
  return { lab, p, repos, tick: (ms: number) => (now += ms) };
}

/** Teleport-free: walk to a tile in small legal steps (straight lines are clear: the cross of paths). */
function walkTo(s: ReturnType<typeof setup>, tile: [number, number]) {
  const pos = s.p.lab!;
  const tx = (tile[0] + 0.5) * T, ty = (tile[1] + 0.5) * T;
  for (let i = 0; i < 400 && Math.hypot(pos.x - tx, pos.y - ty) > 4; i++) {
    s.tick(100);
    const k = Math.min(1, (lc.walkSpeed * 0.1) / Math.hypot(tx - pos.x, ty - pos.y));
    // Go along the middle lines: first across to the centre column / row, then along.
    const nx = pos.x + (tx - pos.x) * k, ny = pos.y + (ty - pos.y) * k;
    expect(s.lab.move(s.p, nx, ny, 'down', true)).toBe(true);
  }
}

/** Through a door: walk to it (via the room's centre), then go through. */
function through(s: ReturnType<typeof setup>, dir: LabDir) {
  const f = s.lab.floor(s.p.lab!.floor);
  const L = roomLayout(lc, f, f.rooms[s.p.lab!.room]);
  walkTo(s, L.spot.centre);
  const d = L.doorAt[dir]!;
  walkTo(s, [Math.max(1, Math.min(L.w - 2, d[0])), Math.max(1, Math.min(L.h - 2, d[1]))]);
  return s.lab.door(s.p, dir);
}

describe('Labirin Purba (server)', () => {
  it('enters at the entrance hall and marks it seen', () => {
    const s = setup();
    const v = s.lab.enter(s.p, 'save');
    expect(v.floor).toBe(0);
    expect(v.room).toBe(s.lab.floor(0).start);
    expect(seenHas(v.seen, v.room)).toBe(true);
    expect(() => s.lab.enter(s.p, 'save')).toThrow(/already/);
  });

  it('only lets you through a door you are standing at, into the right room by the opposite door', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const f = s.lab.floor(0);
    const start = f.rooms[f.start];
    const dir = LAB_DIRS.find((d) => start.doors[d] && start.doors[d]!.lock === undefined)!;
    expect(() => s.lab.door(s.p, dir === 'n' ? 's' : 'n')).toThrow(); // not at that door (or no door)
    const v = through(s, dir);
    expect(v.room).toBe(start.doors[dir]!.to);
    expect(seenHas(v.seen, v.room)).toBe(true);
  });

  it('refuses steps that are too long or into a wall', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const pos = { ...s.p.lab! };
    s.tick(100);
    expect(s.lab.move(s.p, pos.x + T * 6, pos.y, 'right', true)).toBe(false);
    s.tick(100);
    expect(s.lab.move(s.p, pos.x, -50, 'up', true)).toBe(false);
  });

  it('pays a loot box once a day, carried until you rest; dying would cost the carried part', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const f = s.lab.floor(0);
    // Walk (by the map) to the nearest room with a chest.
    const target = f.rooms.filter((r) => r.chest && r.kind === 'chamber').sort((a, b) => a.dist - b.dist)[0];
    const prev = new Map<number, [number, LabDir]>();
    const q = [f.start];
    prev.set(f.start, [-1, 'n']);
    while (q.length) {
      const r = f.rooms[q.shift()!];
      for (const d of LAB_DIRS) {
        const door = r.doors[d];
        if (door && door.lock === undefined && !prev.has(door.to)) {
          prev.set(door.to, [r.id, d]);
          q.push(door.to);
        }
      }
    }
    const path: LabDir[] = [];
    for (let at = target.id; at !== f.start; at = prev.get(at)![0]) path.unshift(prev.get(at)![1]);
    for (const d of path) through(s, d);
    expect(s.p.lab!.room).toBe(target.id);
    const L = roomLayout(lc, f, target);
    walkTo(s, L.spot.centre);
    walkTo(s, [L.spot.chest[0], L.spot.centre[1]]);
    walkTo(s, [L.spot.chest[0], L.spot.chest[1] + 1]);
    const r = s.lab.use(s.p, 'chest');
    expect(r.text).toMatch(/Syiling/);
    expect(s.lab.self(s.p).carried).toBeGreaterThan(0);
    expect(s.lab.self(s.p).coins).toBe(0);
    expect(() => s.lab.use(s.p, 'chest')).toThrow(/tomorrow/);
    // Leaving is only from the entrance hall or a rest chamber.
    expect(() => s.lab.leave(s.p)).toThrow(/rest chamber/);
  });

  it('keeps your save point and banked coins across a reload', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    s.lab.state(s.p).carried = 40;
    s.lab.leave(s.p); // the entrance hall: banks it
    expect(s.lab.self(s.p).coins).toBe(40);
    s.lab.forget(s.p.id);
    expect(s.lab.self(s.p).coins).toBe(40); // read back from the database
  });
});

describe('Labirin Purba fights (server)', () => {
  it('a monster room starts a fight; winning pays carried Syiling and quiets the room for a while', async () => {
    const { LabBattles } = await import('./labBattles');
    const s = setup();
    const events: string[] = [];
    let ended: { outcome: string; coins: number } | undefined;
    const timers: Array<() => void> = [];
    const battles = new LabBattles(lc, s.lab, {
      started: () => events.push('start'),
      picked: () => events.push('picked'),
      round: (_ps, _ev, _v, ends) => {
        events.push('round');
        ended = ends.get(s.p.id) ?? ended;
      },
    }, () => 0.3, () => 1_700_000_000_000, (fn) => (timers.push(fn), 0 as never), () => {});
    s.lab.enter(s.p, 'entrance');
    const f = s.lab.floor(0);
    // Stand in the nearest monster room (placed directly: walking is tested above).
    const room = f.rooms.filter((r) => r.monsters).sort((a, b) => a.dist - b.dist)[0];
    s.p.lab = { ...s.p.lab!, room: room.id };
    expect(s.lab.monstersHere(s.p)).toBe(true);
    expect(battles.encounter([s.p])).toBe(true);
    expect(() => s.lab.use(s.p, 'chest')).toThrow(/fight/);
    // Strong enough to win quickly.
    for (let i = 0; i < 40 && !ended; i++) battles.act(s.p, { kind: 'attack' });
    expect(ended?.outcome).toBe('win');
    expect(ended!.coins).toBeGreaterThan(0);
    expect(s.lab.self(s.p).carried).toBe(ended!.coins);
    expect(s.lab.monstersHere(s.p)).toBe(false);
    expect(s.lab.hp(s.p)).toBeLessThanOrEqual(lc.player.hp);
  });

  it('falling costs half the carried Syiling and wakes you at your save point, healed', async () => {
    const { LabBattles } = await import('./labBattles');
    const s = setup();
    let ended: { outcome: string; lost: number } | undefined;
    const battles = new LabBattles(lc, s.lab, { started: () => {}, picked: () => {}, round: (_p, _e, _v, ends) => (ended = ends.get(s.p.id) ?? ended) }, () => 0.5, () => 1_700_000_000_000, () => 0 as never, () => {});
    s.lab.enter(s.p, 'entrance');
    s.lab.state(s.p).carried = 100;
    const deep = s.lab.floor(7);
    s.p.lab = { ...s.p.lab!, floor: 7, room: deep.rooms.find((r) => r.monsters)!.id };
    battles.encounter([s.p]);
    for (let i = 0; i < 60 && !ended; i++) battles.act(s.p, { kind: 'guard' });
    expect(ended?.outcome).toBe('wipe');
    expect(ended!.lost).toBe(50);
    expect(s.lab.self(s.p).carried).toBe(50);
    expect(s.p.lab!.floor).toBe(0);
    expect(s.p.lab!.room).toBe(s.lab.floor(0).start);
    expect(s.lab.hp(s.p)).toBe(s.lab.stats(s.p).hp);
  });
});

describe('Labirin Purba merchant, gear and potions', () => {
  it('sells only at the merchant, spends carried Syiling first, and wears better gear at once', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const st = s.lab.state(s.p);
    st.carried = 20;
    st.coins = 500;
    expect(() => s.lab.buy(s.p, 'weapon_kayu')).toThrow(/Tok Peraih|merchant/); // not next to the merchant yet
    const f = s.lab.floor(0);
    walkTo(s, roomLayout(lc, f, f.rooms[f.start]).spot.merchant);
    const atk0 = s.lab.stats(s.p).atk;
    s.lab.buy(s.p, 'weapon_kayu'); // 30: 20 carried + 10 banked
    expect(st.carried).toBe(0);
    expect(st.coins).toBe(490);
    expect(st.gear.weapon).toBe('weapon_kayu');
    expect(s.lab.stats(s.p).atk).toBeGreaterThan(atk0);
    expect(() => s.lab.buy(s.p, 'weapon_kayu')).toThrow(/already/);
    expect(() => s.lab.buy(s.p, 'weapon_gangsa')).toThrow(/floor 2/); // not deep enough yet
    s.lab.buy(s.p, 'weapon_besi');
    expect(st.gear.weapon).toBe('weapon_besi');
    // Back to the old one if you like; a slot can be emptied.
    s.lab.equip(s.p, 'weapon', 'weapon_kayu');
    expect(st.gear.weapon).toBe('weapon_kayu');
    s.lab.equip(s.p, 'weapon', null);
    expect(st.gear.weapon).toBeUndefined();
    expect(() => s.lab.equip(s.p, 'shield', 'shield_besi')).toThrow(/don't have/);
  });

  it('potions: carry limit, heal out of a fight, Tali Pulang home from anywhere', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const st = s.lab.state(s.p);
    st.coins = 5000;
    const f = s.lab.floor(0);
    walkTo(s, roomLayout(lc, f, f.rooms[f.start]).spot.merchant);
    s.lab.buy(s.p, 'jamu_kecil', 20);
    expect(st.potions.jamu_kecil).toBe(lc.potions.max);
    expect(() => s.lab.buy(s.p, 'jamu_kecil')).toThrow(/at most/);
    expect(() => s.lab.useItem(s.p, 'jamu_kecil')).toThrow(/full HP/);
    s.lab.setHp(s.p, 10);
    const r = s.lab.useItem(s.p, 'jamu_kecil');
    expect(r.text).toMatch(/\+30 HP/);
    expect(st.potions.jamu_kecil).toBe(lc.potions.max - 1);
    expect(() => s.lab.useItem(s.p, 'asap_lari')).toThrow(/no Asap Lari/);
    s.lab.buy(s.p, 'tali_pulang');
    st.carried = 40;
    const home = s.lab.useItem(s.p, 'tali_pulang');
    expect(home.left).toBe(true);
    expect(s.p.lab).toBeNull();
    expect(st.carried).toBe(0);
    expect(st.potions.tali_pulang).toBeUndefined();
  });
});
