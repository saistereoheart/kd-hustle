// 🗝️ Labirin Purba: builds a floor from its seed. Pure and deterministic: the server and every
// client build exactly the same floor, so the layout is permanent (see docs/LABYRINTH.md §1).
//
//   1. a ragged outline (some grid cells left out),
//   2. a maze over it (randomised depth-first, from the start), so every room is reachable,
//   3. some extra doors (loops), so there's more than one way round,
//   4. the special rooms on dead ends: the boss room (furthest from the start, it guards the stairs
//      down), the rest chamber (furthest from both, hard to find), locked treasure rooms,
//   5. keys, loot boxes and monster groups in ordinary rooms.
import type { LabConfig } from './config';

export type LabDir = 'n' | 'e' | 's' | 'w';
export const LAB_DIRS: LabDir[] = ['n', 'e', 's', 'w'];
export const LAB_STEP: Record<LabDir, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
export const LAB_OPPOSITE: Record<LabDir, LabDir> = { n: 's', e: 'w', s: 'n', w: 'e' };

export type LabRoomKind = 'start' | 'chamber' | 'rest' | 'boss' | 'treasure';

export interface LabDoor {
  /** The room on the other side. */
  to: number;
  /** A treasure room's door: opens with that floor's key for it (`lock` = which treasure). */
  lock?: number;
}

export interface LabRoom {
  id: number;
  /** Grid cell. */
  cx: number;
  cy: number;
  kind: LabRoomKind;
  doors: Partial<Record<LabDir, LabDoor>>;
  /** Steps from the start room. */
  dist: number;
  chest: boolean;
  monsters: boolean;
  /** Holds the key to treasure room `key` (an index into floor.treasure). */
  key?: number;
}

export interface LabFloor {
  /** 0-based floor index. */
  n: number;
  w: number;
  h: number;
  rooms: LabRoom[];
  /** Room id per grid cell (y * w + x), −1 for none. */
  byCell: Int16Array;
  start: number;
  boss: number;
  rest: number;
  /** Treasure room ids (their keys: rooms with `key` = the index here). */
  treasure: number[];
}

/** Deterministic PRNG (mulberry32). */
export function labRng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateFloor(cfg: LabConfig, n: number): LabFloor {
  const fc = cfg.floors[n];
  const g = cfg.gen;
  const W = fc.w, H = fc.h;
  const rnd = labRng(fc.seed);
  const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
  const cell = (x: number, y: number) => y * W + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

  // 1. The outline: leave some cells out (never the start, the middle of the bottom row).
  const sx = Math.floor(W / 2), sy = H - 1;
  const keep = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) keep[cell(x, y)] = rnd() >= g.holes ? 1 : 0;
  keep[cell(sx, sy)] = 1;

  // 2. The maze: depth-first from the start over kept cells (cells it can't reach are dropped).
  const links = new Map<number, Set<LabDir>>();
  const link = (a: number, d: LabDir) => {
    const [dx, dy] = LAB_STEP[d];
    const b = cell((a % W) + dx, Math.floor(a / W) + dy);
    (links.get(a) ?? links.set(a, new Set()).get(a)!).add(d);
    (links.get(b) ?? links.set(b, new Set()).get(b)!).add(LAB_OPPOSITE[d]);
  };
  const seen = new Uint8Array(W * H);
  const stack = [cell(sx, sy)];
  seen[stack[0]] = 1;
  links.set(stack[0], new Set());
  while (stack.length) {
    const c = stack[stack.length - 1];
    const x = c % W, y = Math.floor(c / W);
    const next = LAB_DIRS.filter((d) => {
      const [dx, dy] = LAB_STEP[d];
      return inside(x + dx, y + dy) && keep[cell(x + dx, y + dy)] && !seen[cell(x + dx, y + dy)];
    });
    if (!next.length) {
      stack.pop();
      continue;
    }
    const d = pick(next);
    const [dx, dy] = LAB_STEP[d];
    const nc = cell(x + dx, y + dy);
    seen[nc] = 1;
    link(c, d);
    stack.push(nc);
  }

  // 3. Loops: a few more doors between neighbouring rooms.
  for (const c of [...links.keys()].sort((a, b) => a - b)) {
    const x = c % W, y = Math.floor(c / W);
    for (const d of ['e', 's'] as LabDir[]) {
      const [dx, dy] = LAB_STEP[d];
      const nc = cell(x + dx, y + dy);
      if (!inside(x + dx, y + dy) || !seen[nc] || links.get(c)!.has(d)) continue;
      if (rnd() < g.loops) link(c, d);
    }
  }

  // Rooms, numbered in grid order.
  const byCell = new Int16Array(W * H).fill(-1);
  const rooms: LabRoom[] = [];
  for (let c = 0; c < W * H; c++) {
    if (!seen[c]) continue;
    byCell[c] = rooms.length;
    rooms.push({ id: rooms.length, cx: c % W, cy: Math.floor(c / W), kind: 'chamber', doors: {}, dist: -1, chest: false, monsters: false });
  }
  for (const r of rooms) {
    for (const d of links.get(cell(r.cx, r.cy)) ?? []) {
      const [dx, dy] = LAB_STEP[d];
      r.doors[d] = { to: byCell[cell(r.cx + dx, r.cy + dy)] };
    }
  }
  const start = byCell[cell(sx, sy)];
  const distFrom = (from: number): Int32Array => {
    const dist = new Int32Array(rooms.length).fill(-1);
    dist[from] = 0;
    const q = [from];
    for (let i = 0; i < q.length; i++) {
      for (const door of Object.values(rooms[q[i]].doors)) {
        if (dist[door!.to] < 0) {
          dist[door!.to] = dist[q[i]] + 1;
          q.push(door!.to);
        }
      }
    }
    return dist;
  };
  const d0 = distFrom(start);
  for (const r of rooms) r.dist = d0[r.id];
  rooms[start].kind = 'start';

  // 4. Special rooms on dead ends (one door). Ties go to the lower id (deterministic).
  const deadEnds = () => rooms.filter((r) => r.kind === 'chamber' && Object.keys(r.doors).length === 1);
  const best = (list: LabRoom[], score: (r: LabRoom) => number) => list.reduce<LabRoom | null>((b, r) => (!b || score(r) > score(b) ? r : b), null);
  // The boss room (guarding the stairs down): the furthest dead end (or the furthest room at all).
  const bossRoom = best(deadEnds(), (r) => r.dist) ?? best(rooms.filter((r) => r.kind === 'chamber'), (r) => r.dist)!;
  bossRoom.kind = 'boss';
  const dBoss = distFrom(bossRoom.id);
  // The rest chamber: far from the start AND from the boss (off the beaten track).
  const restRoom = best(deadEnds(), (r) => Math.min(r.dist, dBoss[r.id]) * 2 + r.dist) ?? best(rooms.filter((r) => r.kind === 'chamber'), (r) => Math.min(r.dist, dBoss[r.id]))!;
  restRoom.kind = 'rest';
  // Treasure rooms: dead ends a fair way in, their only door locked.
  const treasure: number[] = [];
  const candidates = deadEnds().filter((r) => r.dist >= 4);
  for (let i = 0; i < g.treasure && candidates.length; i++) {
    const r = candidates.splice(Math.floor(rnd() * candidates.length), 1)[0];
    r.kind = 'treasure';
    const [d, door] = Object.entries(r.doors)[0] as [LabDir, LabDoor];
    door.lock = treasure.length;
    rooms[door.to].doors[LAB_OPPOSITE[d]]!.lock = treasure.length;
    treasure.push(r.id);
  }

  // 5. Keys (in ordinary rooms not right next to the start), loot boxes, monster groups.
  const ordinary = () => rooms.filter((r) => r.kind === 'chamber');
  treasure.forEach((t, i) => {
    const spots = ordinary().filter((r) => r.key === undefined && r.dist >= 3 && r.id !== rooms[t].doors[Object.keys(rooms[t].doors)[0] as LabDir]!.to);
    const at = spots.length ? spots[Math.floor(rnd() * spots.length)] : ordinary()[0];
    if (at) at.key = i;
  });
  for (const r of rooms) {
    if (r.kind !== 'chamber') continue;
    r.chest = rnd() < g.chests;
    r.monsters = r.key === undefined && r.dist >= 1 && rnd() < g.monsters;
  }
  return { n, w: W, h: H, rooms, byCell, start, boss: bossRoom.id, rest: restRoom.id, treasure };
}

/** Floors are built once and kept (they never change). */
const cache = new WeakMap<LabConfig, LabFloor[]>();
export function labFloor(cfg: LabConfig, n: number): LabFloor {
  let list = cache.get(cfg);
  if (!list) cache.set(cfg, (list = []));
  return (list[n] ??= generateFloor(cfg, n));
}

// ------------------------------------------------------------------ inside a room
/** A room's inside: its size in tiles, where its doors are, and its pillars / rubble. */
export interface RoomLayout {
  w: number;
  h: number;
  /** Tile of each door (on the wall row / column). */
  doorAt: Partial<Record<LabDir, [number, number]>>;
  /** Solid tiles (pillars, rubble), y * w + x. */
  solid: Set<number>;
  /** Where things stand (tile centres): the chest, the key, the fire, the stairs, the monsters. */
  spot: { centre: [number, number]; chest: [number, number]; feature: [number, number] };
}

export function roomLayout(cfg: LabConfig, floor: LabFloor, room: LabRoom): RoomLayout {
  const w = cfg.room.w, h = cfg.room.h;
  const mx = Math.floor(w / 2), my = Math.floor(h / 2);
  const doorAt: RoomLayout['doorAt'] = {};
  if (room.doors.n) doorAt.n = [mx, 0];
  if (room.doors.s) doorAt.s = [mx, h - 1];
  if (room.doors.w) doorAt.w = [0, my];
  if (room.doors.e) doorAt.e = [w - 1, my];
  const solid = new Set<number>();
  // Pillars in ordinary rooms only, never on the cross of paths between the doors or by the walls.
  if (room.kind === 'chamber') {
    const rnd = labRng(cfg.floors[floor.n].seed * 7919 + room.id * 104729);
    const pattern = Math.floor(rnd() * 4);
    const clear = (x: number, y: number) => x <= 1 || y <= 1 || x >= w - 2 || y >= h - 2 || Math.abs(x - mx) <= 1 || Math.abs(y - my) <= 1;
    const add = (x: number, y: number) => {
      if (!clear(x, y)) solid.add(y * w + x);
    };
    if (pattern === 1) {
      // four pillars
      for (const [x, y] of [[mx - 4, my - 2], [mx + 4, my - 2], [mx - 4, my + 2], [mx + 4, my + 2]]) add(x, y);
    } else if (pattern === 2) {
      // a colonnade
      for (let x = 3; x < w - 3; x += 3) (add(x, 2), add(x, h - 3));
    } else if (pattern === 3) {
      // scattered rubble
      for (let i = 0; i < 6; i++) add(2 + Math.floor(rnd() * (w - 4)), 2 + Math.floor(rnd() * (h - 4)));
    }
  }
  return { w, h, doorAt, solid, spot: { centre: [mx, my], chest: [w - 3, 2], feature: [mx, 2] } };
}
