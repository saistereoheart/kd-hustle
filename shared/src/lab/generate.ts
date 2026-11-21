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
/** Things lying about a room (looks only; signs can be read). `text`: which of the config's signs. */
export interface LabProp {
  kind: 'sign' | 'skeleton' | 'lamp' | 'oldfire';
  at: [number, number];
  text?: number;
}

/** The entrance hall's furniture (tiles): the tavern counter, a campfire with people round it,
 *  benches. The counter, fire and benches are solid. */
export interface LabHall {
  counter: Array<[number, number]>;
  keeper: [number, number];
  fire: [number, number];
  sitters: Array<[number, number]>;
  benches: Array<[number, number]>;
}

/** A room's inside: its size in tiles, where its doors are, its rock and its roofs. */
export interface RoomLayout {
  w: number;
  h: number;
  /** Tile of each door (on the wall row / column). */
  doorAt: Partial<Record<LabDir, [number, number]>>;
  /** Solid tiles (rock outcrops, boulders, pillars), y * w + x. */
  solid: Set<number>;
  /** Where things stand (tiles): the middle, a loot box, the room's feature (stairs, fire, key) and the
   *  🛒 merchant (entrance hall and rest chambers). */
  spot: { centre: [number, number]; chest: [number, number]; feature: [number, number]; merchant: [number, number]; tavern: [number, number] };
  /** Overhanging rock / ceiling over walkable floor (tile rects): drawn on top, see-through when you're under. */
  roofs: Array<{ x: number; y: number; w: number; h: number }>;
  /** 🌿 Bushes and cobwebs you can walk through (tile → which): each step into one may start a fight. */
  brush: Map<number, 'bush' | 'web'>;
  /** Signs, skeletons, lamps, old campfires. */
  props: LabProp[];
  /** The entrance hall's furniture (floor 1's start room only). */
  hall: LabHall | null;
}

/**
 * A room is a cave, not a box: jagged rock along its edges, and (in ordinary chambers) rock
 * outcrops and walls that make nooks and dead-end passages. Always kept clear: the cross of main
 * paths between the doors (3 tiles wide), every spot and the way to it, so the server's straight-line
 * walking rules and the doors still work. Floor that can't be reached becomes rock.
 */
export function roomLayout(cfg: LabConfig, floor: LabFloor, room: LabRoom): RoomLayout {
  const w = cfg.room.w, h = cfg.room.h;
  const mx = Math.floor(w / 2), my = Math.floor(h / 2);
  const doorAt: RoomLayout['doorAt'] = {};
  if (room.doors.n) doorAt.n = [mx, 0];
  if (room.doors.s) doorAt.s = [mx, h - 1];
  if (room.doors.w) doorAt.w = [0, my];
  if (room.doors.e) doorAt.e = [w - 1, my];
  const spot: RoomLayout['spot'] = { centre: [mx, my], chest: [w - 3, 2], feature: [mx, 2], merchant: [3, 2], tavern: [w - 4, 3] };
  const isHall = floor.n === 0 && room.kind === 'start';
  const rnd = labRng(cfg.floors[floor.n].seed * 7919 + room.id * 104729);
  const idx = (x: number, y: number) => y * w + x;
  // Never rock: the cross of paths, each spot and its neighbours, the way from the cross to the loot box.
  const keep = new Set<number>();
  const keepRect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) keep.add(idx(x, y));
  };
  keepRect(mx - 1, 0, mx + 1, h - 1);
  keepRect(0, my - 1, w - 1, my + 1);
  for (const [x, y] of [spot.feature, spot.merchant, [spot.feature[0] + 3, spot.feature[1]] as [number, number], [spot.feature[0], spot.feature[1] + 2] as [number, number]]) keepRect(x - 1, y - 1, x + 1, y + 1);
  keepRect(spot.chest[0] - 1, spot.chest[1] - 1, spot.chest[0] + 1, my);
  // The entrance hall: room for the tavern, the campfire circle and the benches.
  let hall: LabHall | null = null;
  if (isHall) {
    const tx = spot.tavern[0];
    hall = {
      counter: [[tx - 1, 2], [tx, 2], [tx + 1, 2]],
      keeper: [tx, 1],
      fire: [4, h - 4],
      sitters: [[3, h - 4], [5, h - 4], [4, h - 3]],
      benches: [[w - 5, h - 4], [w - 4, h - 4]],
    };
    keepRect(tx - 2, 1, tx + 2, 3);
    keepRect(2, h - 5, 6, h - 3);
    keepRect(w - 6, h - 5, w - 3, h - 3);
  }
  const solid = new Set<number>();
  const rock = (x: number, y: number) => {
    if (x >= 1 && y >= 1 && x <= w - 2 && y <= h - 2 && !keep.has(idx(x, y))) solid.add(idx(x, y));
  };
  // 1. Jagged edges: rock juts in from the walls (a second layer here and there).
  for (let x = 1; x <= w - 2; x++)
    for (const [y, y2] of [[1, 2], [h - 2, h - 3]]) {
      if (rnd() < 0.5) {
        rock(x, y);
        if (rnd() < 0.3) rock(x, y2);
      }
    }
  for (let y = 1; y <= h - 2; y++)
    for (const [x, x2] of [[1, 2], [w - 2, w - 3]]) {
      if (rnd() < 0.5) {
        rock(x, y);
        if (rnd() < 0.3) rock(x2, y);
      }
    }
  // 2. Ordinary chambers: each corner area gets an outcrop, a bent wall (a dead-end nook) or boulders.
  if (room.kind === 'chamber') {
    const quads: Array<[number, number, number, number]> = [
      [2, 2, mx - 2, my - 2], [mx + 2, 2, w - 3, my - 2], [2, my + 2, mx - 2, h - 3], [mx + 2, my + 2, w - 3, h - 3],
    ];
    for (const [x0, y0, x1, y1] of quads) {
      const kind = Math.floor(rnd() * 4);
      const rx = () => x0 + Math.floor(rnd() * (x1 - x0 + 1));
      const ry = () => y0 + Math.floor(rnd() * (y1 - y0 + 1));
      if (kind === 0) {
        // An outcrop: a blob of rock that grows from a wall.
        let x = rx(), y = rnd() < 0.5 ? y0 : y1;
        for (let k = 0; k < 6; k++) {
          rock(x, y);
          if (rnd() < 0.5) x = Math.max(x0, Math.min(x1, x + (rnd() < 0.5 ? -1 : 1)));
          else y = Math.max(y0, Math.min(y1, y + (rnd() < 0.5 ? -1 : 1)));
        }
      } else if (kind === 1) {
        // A bent wall: an L of rock that closes off a little nook.
        const y = ry(), x = rx();
        for (let xx = x0; xx <= x1; xx++) if (xx !== x) rock(xx, y);
        const down = y === y0 ? 1 : -1;
        rock(x1, y + down);
      } else if (kind === 2) {
        // Boulders.
        for (let k = 0; k < 3; k++) rock(rx(), ry());
      }
      // kind 3: an open corner.
    }
  }
  if (hall) for (const [x, y] of [...hall.counter, hall.fire, ...hall.benches]) solid.add(idx(x, y));
  // 3. Floor you can't reach from the middle becomes rock (no sealed-off pockets).
  const seen = new Set<number>([idx(mx, my)]);
  const q = [idx(mx, my)];
  while (q.length) {
    const i = q.pop()!;
    const x = i % w, y = (i - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || ny < 1 || nx > w - 2 || ny > h - 2) continue;
      const j = idx(nx, ny);
      if (!seen.has(j) && !solid.has(j)) (seen.add(j), q.push(j));
    }
  }
  for (let y = 1; y <= h - 2; y++) for (let x = 1; x <= w - 2; x++) if (!seen.has(idx(x, y)) && !(hall && solid.has(idx(x, y)))) solid.add(idx(x, y));
  // 4. Roofs: a rock tunnel over each doorway's passage, and in chambers sometimes an overhang.
  const roofs: RoomLayout['roofs'] = [];
  if (doorAt.n) roofs.push({ x: mx - 1, y: 0, w: 3, h: 2 });
  if (doorAt.s) roofs.push({ x: mx - 1, y: h - 2, w: 3, h: 2 });
  if (doorAt.w) roofs.push({ x: 0, y: my - 1, w: 2, h: 3 });
  if (doorAt.e) roofs.push({ x: w - 2, y: my - 1, w: 2, h: 3 });
  if (room.kind === 'chamber' && rnd() < 0.6) {
    // An overhang across one arm of the cross (never over the loot box or the feature).
    const left = rnd() < 0.5;
    roofs.push(left ? { x: 3, y: my - 1, w: 3, h: 3 } : { x: w - 6, y: my - 1, w: 3, h: 3 });
  }
  // 5. Bushes and cobwebs (ordinary chambers): a few clumps, never on a spot or right in a doorway.
  const open = (x: number, y: number) => x >= 1 && y >= 1 && x <= w - 2 && y <= h - 2 && !solid.has(idx(x, y));
  const spotTiles = new Set<number>([spot.centre, spot.chest, spot.feature, spot.merchant].map(([x, y]) => idx(x, y)));
  const doorStep = new Set<number>();
  for (const [x, y] of Object.values(doorAt) as Array<[number, number]>)
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 2) doorStep.add(idx(x + dx, y + dy));
  const nearRock = (x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => x + dx < 1 || y + dy < 1 || x + dx > w - 2 || y + dy > h - 2 || solid.has(idx(x + dx, y + dy)));
  const brush: RoomLayout['brush'] = new Map();
  if (room.kind === 'chamber') {
    const clumps = 1 + Math.floor(rnd() * 3);
    for (let c = 0; c < clumps; c++) {
      let x = 1 + Math.floor(rnd() * (w - 2)), y = 1 + Math.floor(rnd() * (h - 2));
      if (!open(x, y)) continue;
      const kind = nearRock(x, y) ? 'web' : 'bush';
      const n = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < n * 3 && n > 0; k++) {
        const i = idx(x, y);
        if (open(x, y) && !spotTiles.has(i) && !doorStep.has(i)) brush.set(i, kind);
        const d = Math.floor(rnd() * 4);
        const nx = x + [1, -1, 0, 0][d], ny = y + [0, 0, 1, -1][d];
        if (open(nx, ny)) (x = nx), (y = ny);
        if ([...brush.values()].length >= 14) break;
      }
    }
  }
  // 6. Things lying about: lamps on the walls everywhere; in chambers sometimes a sign left by an
  //    adventurer, a skeleton, a cold campfire.
  const props: LabProp[] = [];
  const used = new Set<number>([...spotTiles, ...brush.keys()]);
  const spotFor = (byWall: boolean): [number, number] | null => {
    for (let k = 0; k < 40; k++) {
      const x = 1 + Math.floor(rnd() * (w - 2)), y = 1 + Math.floor(rnd() * (h - 2));
      const i = idx(x, y);
      if (!open(x, y) || used.has(i) || doorStep.has(i) || keep.has(i) && Math.abs(x - mx) <= 1 && Math.abs(y - my) <= 1) continue;
      if (hall && Math.abs(x - spot.tavern[0]) <= 2 && y <= 3) continue;
      if (byWall && !nearRock(x, y)) continue;
      used.add(i);
      return [x, y];
    }
    return null;
  };
  const put = (kind: LabProp['kind'], byWall: boolean, extra: Partial<LabProp> = {}) => {
    const at = spotFor(byWall);
    if (at) props.push({ kind, at, ...extra });
  };
  const lamps = room.kind === 'chamber' ? 1 + Math.floor(rnd() * 2) : 2;
  for (let i = 0; i < lamps; i++) put('lamp', true);
  if (room.kind === 'chamber') {
    if (rnd() < 0.45 && cfg.signs.length) put('sign', true, { text: Math.floor(rnd() * cfg.signs.length) });
    if (rnd() < 0.35) put('skeleton', true);
    if (rnd() < 0.15) put('oldfire', false);
  }
  return { w, h, doorAt, solid, spot, roofs, brush, props, hall };
}
