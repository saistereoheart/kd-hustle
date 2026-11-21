import { describe, expect, it } from 'vitest';
import labJson from '../../config/labyrinth.json';
import { labConfigSchema } from './config';
import { LAB_DIRS, LAB_OPPOSITE, LAB_STEP, generateFloor, roomLayout, type LabDir, type LabFloor } from './generate';

const cfg = labConfigSchema.parse(labJson);
const floors = cfg.floors.map((_, n) => generateFloor(cfg, n));

/** Rooms reachable from the start, optionally without going through locked doors. */
function reach(f: LabFloor, throughLocks: boolean): Set<number> {
  const seen = new Set([f.start]);
  const q = [f.start];
  while (q.length) {
    const r = f.rooms[q.shift()!];
    for (const d of Object.values(r.doors)) {
      if (!d || seen.has(d.to) || (!throughLocks && d.lock !== undefined)) continue;
      seen.add(d.to);
      q.push(d.to);
    }
  }
  return seen;
}

describe('Labirin Purba floors', () => {
  it('are the same every time (permanent layouts)', () => {
    for (let n = 0; n < cfg.floors.length; n++) {
      const again = generateFloor(cfg, n);
      expect(JSON.stringify(again.rooms)).toBe(JSON.stringify(floors[n].rooms));
    }
  });

  it('are big: about a thousand rooms in all, 80+ a floor', () => {
    const total = floors.reduce((a, f) => a + f.rooms.length, 0);
    for (const f of floors) expect(f.rooms.length).toBeGreaterThanOrEqual(80);
    expect(total).toBeGreaterThanOrEqual(800);
  });

  it('connect every room, with doors that match on both sides', () => {
    for (const f of floors) {
      expect(reach(f, true).size).toBe(f.rooms.length);
      for (const r of f.rooms) {
        for (const d of LAB_DIRS) {
          const door = r.doors[d as LabDir];
          if (!door) continue;
          const o = f.rooms[door.to];
          expect([o.cx - r.cx, o.cy - r.cy]).toEqual(LAB_STEP[d as LabDir]);
          expect(o.doors[LAB_OPPOSITE[d as LabDir]]?.to).toBe(r.id);
          expect(o.doors[LAB_OPPOSITE[d as LabDir]]?.lock).toBe(door.lock);
        }
      }
    }
  });

  it('have one boss room, one rest chamber off the main path, and locked treasure with reachable keys', () => {
    for (const f of floors) {
      expect(f.rooms.filter((r) => r.kind === 'boss')).toHaveLength(1);
      expect(f.rooms.filter((r) => r.kind === 'rest')).toHaveLength(1);
      // The boss room: one door, and among the deepest rooms on the floor.
      expect(Object.keys(f.rooms[f.boss].doors)).toHaveLength(1);
      expect(f.rooms[f.boss].dist).toBeGreaterThanOrEqual(0.85 * Math.max(...f.rooms.map((r) => r.dist)));
      // Hard to find: well away from the start.
      expect(f.rooms[f.rest].dist).toBeGreaterThanOrEqual(5);
      const open = reach(f, false);
      expect(open.has(f.boss)).toBe(true);
      expect(open.has(f.rest)).toBe(true);
      f.treasure.forEach((t, i) => {
        expect(open.has(t)).toBe(false); // behind its lock
        const keyRoom = f.rooms.find((r) => r.key === i)!;
        expect(keyRoom).toBeDefined();
        expect(open.has(keyRoom.id)).toBe(true); // the key can be fetched without it
      });
    }
  });

  it('keep the paths between doors clear of pillars', () => {
    for (const f of floors.slice(0, 2)) {
      for (const r of f.rooms) {
        const L = roomLayout(cfg, f, r);
        const mx = Math.floor(L.w / 2), my = Math.floor(L.h / 2);
        for (let x = 0; x < L.w; x++) expect(L.solid.has(my * L.w + x)).toBe(false);
        for (let y = 0; y < L.h; y++) expect(L.solid.has(y * L.w + mx)).toBe(false);
      }
    }
  });

  it('rooms are caves (rock that makes nooks), but every spot is clear and all floor is reachable', () => {
    let rockTiles = 0, rooms = 0;
    for (const f of floors.slice(0, 3)) {
      for (const r of f.rooms) {
        const L = roomLayout(cfg, f, r);
        rooms++;
        rockTiles += L.solid.size;
        for (const [k, s] of Object.entries(L.spot)) if (L.hall ? k !== 'chest' : k !== 'tavern' && (k !== 'portal' || r.kind === 'rest')) expect(L.solid.has(s[1] * L.w + s[0])).toBe(false);
        expect(L.roofs.length).toBeGreaterThanOrEqual(Object.keys(L.doorAt).length);
        // Every open inner tile is reachable from the middle.
        const open = new Set<number>();
        for (let y = 1; y < L.h - 1; y++) for (let x = 1; x < L.w - 1; x++) if (!L.solid.has(y * L.w + x)) open.add(y * L.w + x);
        const start = L.spot.centre[1] * L.w + L.spot.centre[0];
        const seen = new Set([start]);
        const q = [start];
        while (q.length) {
          const i = q.pop()!;
          for (const j of [i + 1, i - 1, i + L.w, i - L.w]) if (open.has(j) && !seen.has(j)) (seen.add(j), q.push(j));
        }
        expect(seen.size).toBe(open.size);
      }
    }
    expect(rockTiles / rooms).toBeGreaterThan(12); // not a plain box
  });
});
