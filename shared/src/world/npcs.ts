// Townsfolk who wander around Dataran Sunway. Each NPC walks a fixed loop between a few spots
// (generated from the map with a seeded RNG), pausing at each. Their position is a pure
// function of the time, so the server and every client agree on where everyone is without
// sending anything over the network: the server can check "are you next to Uncle Lim?".
import { z } from 'zod';
import { Tile, type BuiltMap } from '../map/build';

export const npcsConfigSchema = z.object({
  speedTilesPerSec: z.number().positive(),
  dwellMs: z.number().int().nonnegative(),
  talkRadiusTiles: z.number().positive(),
  /** Where they live: [x0, y0, x1, y1] in tiles. */
  area: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  errandChance: z.number().min(0).max(1),
  errandCooldownMs: z.number().int().positive(),
  errandExpiresMs: z.number().int().positive(),
  errandMaxTiles: z.number().positive(),
  people: z.array(z.object({ name: z.string().min(1).max(24) })).min(1).max(40),
  lines: z.array(z.string().min(1)).min(1),
  errands: z.array(z.object({ id: z.string(), ask: z.string(), pickup: z.string(), thanks: z.string() })).min(1),
  /** Building ids errands can send you to (their door). */
  places: z.array(z.string()).min(1),
  rewardSenByStage: z.array(z.number().int().nonnegative()).min(1),
  rewardXp: z.number().int().nonnegative(),
});
export type NpcsConfig = z.infer<typeof npcsConfigSchema>;

export interface NpcRoute {
  id: number;
  name: string;
  /** Legs between stops: flat tile-centre coords, length in tiles. */
  legs: Array<{ pts: number[]; len: number }>;
  /** Full loop time (ms), including the pauses. */
  cycleMs: number;
  /** Start offset so they don't all move in step. */
  phaseMs: number;
}

/** Deterministic PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ground NPCs like to walk on (no roads, except at crossings). */
const STROLL: ReadonlySet<number> = new Set([Tile.Sidewalk, Tile.Plaza, Tile.Path, Tile.Park, Tile.Crossing, Tile.Parking]);

/** Builds every NPC's loop. Same map + config → same routes on server and client. */
export function buildNpcRoutes(map: Pick<BuiltMap, 'width' | 'height' | 'originTx' | 'originTy' | 'terrain' | 'solid'>, cfg: NpcsConfig): NpcRoute[] {
  const [ax0, ay0, ax1, ay1] = cfg.area;
  const W = map.width;
  const ok = (tx: number, ty: number) => {
    const gx = tx - map.originTx, gy = ty - map.originTy;
    if (gx < 0 || gy < 0 || gx >= W || gy >= map.height || tx < ax0 - 10 || tx > ax1 + 10 || ty < ay0 - 10 || ty > ay1 + 10) return false;
    const i = gy * W + gx;
    return !map.solid[i] && STROLL.has(map.terrain[i]);
  };
  // Candidate stops: strollable tiles in the area.
  const spots: Array<[number, number]> = [];
  for (let ty = ay0; ty <= ay1; ty += 3) for (let tx = ax0; tx <= ax1; tx += 3) if (ok(tx, ty)) spots.push([tx, ty]);
  /** Shortest path (4-neighbour BFS over strollable ground), as tile centres. */
  const path = (from: [number, number], to: [number, number]): number[] | null => {
    const key = (x: number, y: number) => (y - (ay0 - 10)) * 1000 + (x - (ax0 - 10));
    const prev = new Map<number, number>();
    const q: Array<[number, number]> = [from];
    prev.set(key(...from), -1);
    for (let h = 0; h < q.length; h++) {
      const [x, y] = q[h];
      if (x === to[0] && y === to[1]) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (prev.has(k) || !ok(nx, ny)) continue;
        prev.set(k, key(x, y));
        q.push([nx, ny]);
      }
    }
    if (!prev.has(key(...to))) return null;
    const out: number[] = [];
    for (let k = key(...to); k !== -1; k = prev.get(k)!) {
      const x = (k % 1000) + ax0 - 10, y = Math.floor(k / 1000) + ay0 - 10;
      out.push(x + 0.5, y + 0.5);
    }
    // reverse to from→to, then drop points in straight runs
    const pts: number[] = [];
    for (let i = out.length - 2; i >= 0; i -= 2) pts.push(out[i], out[i + 1]);
    return simplify(pts);
  };
  const routes: NpcRoute[] = [];
  if (spots.length < 4) return routes;
  /** Spots reachable from a tile (flood fill over strollable ground). */
  const reachable = (from: [number, number]) => {
    const seen = new Set<number>([from[1] * 100_000 + from[0]]);
    const q: Array<[number, number]> = [from];
    for (let h = 0; h < q.length; h++) {
      const [x, y] = q[h];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = ny * 100_000 + nx;
        if (seen.has(k) || !ok(nx, ny)) continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    return spots.filter(([x, y]) => seen.has(y * 100_000 + x));
  };
  cfg.people.forEach((person, id) => {
    const r = seededRandom(1000 + id * 7919);
    // A start whose patch of pavement is big enough to wander around.
    let start = spots[0];
    let pool: Array<[number, number]> = [];
    for (let k = 0; k < 15 && pool.length < 25; k++) {
      start = spots[Math.floor(r() * spots.length)];
      pool = reachable(start);
    }
    if (pool.length < 4) return;
    const stops: Array<[number, number]> = [start];
    for (let k = 0; k < 40 && stops.length < 4; k++) {
      const c = pool[Math.floor(r() * pool.length)];
      const last = stops[stops.length - 1];
      const d = Math.hypot(c[0] - last[0], c[1] - last[1]);
      if (d > 10 && d < 70) stops.push(c);
    }
    const legs: NpcRoute['legs'] = [];
    for (let k = 0; k < stops.length; k++) {
      const pts = path(stops[k], stops[(k + 1) % stops.length]);
      if (!pts || pts.length < 4) continue;
      let len = 0;
      for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      legs.push({ pts, len });
    }
    if (!legs.length) return;
    const cycleMs = legs.reduce((a, l) => a + (l.len / cfg.speedTilesPerSec) * 1000 + cfg.dwellMs, 0);
    routes.push({ id, name: person.name, legs, cycleMs, phaseMs: Math.floor(r() * cycleMs) });
  });
  return routes;
}

function simplify(pts: number[]): number[] {
  if (pts.length <= 4) return pts;
  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length - 2; i += 2) {
    const dx1 = pts[i] - pts[i - 2], dy1 = pts[i + 1] - pts[i - 1];
    const dx2 = pts[i + 2] - pts[i], dy2 = pts[i + 3] - pts[i + 1];
    if (dx1 !== dx2 || dy1 !== dy2) out.push(pts[i], pts[i + 1]);
  }
  out.push(pts[pts.length - 2], pts[pts.length - 1]);
  return out;
}

export interface NpcPose {
  x: number;
  y: number;
  dir: 'up' | 'down' | 'left' | 'right';
  moving: boolean;
}

/** Where an NPC is (tile coords) at server time `nowMs`. */
export function npcPose(route: NpcRoute, cfg: NpcsConfig, nowMs: number): NpcPose {
  let u = (nowMs + route.phaseMs) % route.cycleMs;
  for (const leg of route.legs) {
    const walkMs = (leg.len / cfg.speedTilesPerSec) * 1000;
    if (u < walkMs) {
      let d = (u / walkMs) * leg.len;
      for (let i = 2; i < leg.pts.length; i += 2) {
        const ax = leg.pts[i - 2], ay = leg.pts[i - 1], bx = leg.pts[i], by = leg.pts[i + 1];
        const l = Math.hypot(bx - ax, by - ay);
        if (d <= l || i === leg.pts.length - 2) {
          const k = l > 0 ? Math.min(1, d / l) : 0;
          const dx = bx - ax, dy = by - ay;
          return { x: ax + dx * k, y: ay + dy * k, dir: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up', moving: true };
        }
        d -= l;
      }
    }
    u -= walkMs;
    if (u < cfg.dwellMs) {
      const n = leg.pts.length;
      return { x: leg.pts[n - 2], y: leg.pts[n - 1], dir: 'down', moving: false };
    }
    u -= cfg.dwellMs;
  }
  const first = route.legs[0];
  return { x: first.pts[0], y: first.pts[1], dir: 'down', moving: false };
}

/**
 * Does this NPC have an errand for this player right now? Deterministic for a time slot, so
 * talking again doesn't re-roll. Returns the errand template index and the place (building id).
 */
export function errandOffer(cfg: NpcsConfig, npcId: number, playerId: number, nowMs: number): { errand: number; slot: number } | null {
  const slot = Math.floor(nowMs / cfg.errandCooldownMs);
  const r = seededRandom(npcId * 92821 + playerId * 68917 + slot * 31);
  if (r() >= cfg.errandChance) return null;
  return { errand: Math.floor(r() * cfg.errands.length), slot };
}
