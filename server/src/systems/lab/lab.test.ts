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
