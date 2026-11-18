import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BuiltRoad } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { ROOT } from '../../paths';
import { laneOffset, offsetPath, planRoadRoute, RoadGraph } from './roadGraph';
import type { RouteGrid } from './route';
import { RideSystem } from './rides';

const road = (pts: number[], o: Partial<BuiltRoad> = {}): BuiltRoad => {
  const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
  return {
    id: `r${Math.random()}`, cls: 'street', lanes: 2, oneway: false, elevated: false, pts, width: 4, sidewalk: 0,
    bbox: { x0: Math.min(...xs) - 2, y0: Math.min(...ys) - 2, x1: Math.max(...xs) + 2, y1: Math.max(...ys) + 2 }, ...o,
  } as BuiltRoad;
};
/** An open grid (nothing blocked), all road speed. */
const open = (w: number, h: number): RouteGrid => ({ width: w, height: h, originTx: 0, originTy: 0, blocked: new Uint8Array(w * h), speed: new Float32Array(w * h).fill(1) });
const opts = { offroadPenaltyPow: 2, maxSearchNodes: 100000, simplifyTiles: 0.5, snapRadiusTiles: 3 };

describe('lanes (Malaysia: keep left)', () => {
  it('two-way roads with two lanes drive in the left half; single-lane ones down the middle', () => {
    expect(laneOffset({ oneway: false, lanes: 2, width: 4 })).toBe(1);
    expect(laneOffset({ oneway: false, lanes: 1, width: 2.5 })).toBe(0);
    // A one-way road with 3 lanes: the left (slow) lane.
    expect(laneOffset({ oneway: true, lanes: 3, width: 6 })).toBeCloseTo(2);
    expect(laneOffset({ oneway: true, lanes: 1, width: 2 })).toBe(0);
  });

  it('left of travel: heading east shifts north (up the screen), heading west shifts south', () => {
    expect(offsetPath([0, 5, 10, 5], [1])).toEqual([0, 4, 10, 4]);
    expect(offsetPath([10, 5, 0, 5], [1])).toEqual([10, 6, 0, 6]);
  });

  it('a ride along a two-way road keeps left in both directions', () => {
    const g = new RoadGraph([road([0, 5, 10, 5, 20, 5])]);
    const east = planRoadRoute(g, open(24, 12), [2, 5.5], [18, 5.5], opts)!;
    const west = planRoadRoute(g, open(24, 12), [18, 5.5], [2, 5.5], opts)!;
    const mid = (r: number[]) => r.filter((_, i) => i % 2 === 1).slice(1, -1);
    for (const y of mid(east)) expect(y).toBeCloseTo(4, 1);
    for (const y of mid(west)) expect(y).toBeCloseTo(6, 1);
  });
});

describe('road graph', () => {
  it('never goes the wrong way down a one-way road: it goes round the block', () => {
    // One-way east along y=5; a two-way loop back round by y=15.
    const g = new RoadGraph([road([0, 5, 20, 5], { oneway: true, lanes: 2, width: 3.6 }), road([20, 5, 20, 15, 0, 15, 0, 5])]);
    const len = (r: { pts: number[] }) => r.pts.reduce((a, _, i) => (i >= 2 && i % 2 === 0 ? a + Math.hypot(r.pts[i] - r.pts[i - 2], r.pts[i + 1] - r.pts[i - 1]) : a), 0);
    const fwd = g.route(g.nearest(2, 5, 1)[0], g.nearest(18, 5, 1)[0])!;
    expect(len(fwd)).toBeCloseTo(16, 0);
    const back = g.route(g.nearest(18, 5, 1)[0], g.nearest(2, 5, 1)[0])!;
    expect(len(back)).toBeGreaterThan(40); // 2 + 10 + 20 + 10 + 2
  });

  it('a one-way road that leads nowhere can be ridden back out (U-turn at the end)', () => {
    const g = new RoadGraph([road([0, 5, 20, 5], { oneway: true, lanes: 2, width: 3.6 })]);
    expect(g.route(g.nearest(18, 5, 3)[0], g.nearest(2, 5, 3)[0])).not.toBeNull();
  });

  it('single-lane roads go both ways (but the mapped direction is preferred)', () => {
    const lane = road([0, 5, 20, 5], { oneway: true, lanes: 1, width: 2 });
    // A two-way detour the same length as going against the one-way lane.
    const g = new RoadGraph([lane, road([20, 5, 20, 6, 0, 6, 0, 5])]);
    const back = g.route(g.nearest(18, 5, 0.5)[0], g.nearest(2, 5, 0.5)[0])!;
    expect(back.roads).toContain(1); // round the side, not against the lane
    const solo = new RoadGraph([lane]);
    expect(solo.route(solo.nearest(18, 5, 3)[0], solo.nearest(2, 5, 3)[0])).not.toBeNull();
  });

  it('turns at junctions where roads share a point', () => {
    // An L: east along y=5 then south along x=20.
    const g = new RoadGraph([road([0, 5, 20, 5]), road([20, 5, 20, 25])]);
    const r = g.route(g.nearest(2, 5, 3)[0], g.nearest(20, 22, 3)[0])!;
    expect(r).not.toBeNull();
    expect(r.pts).toContain(20);
    expect(new Set(r.roads).size).toBe(2);
  });

  it('plans real rides on the town map along the roads', () => {
    const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
    const map = cfg.map;
    const T = map.tileSize;
    const rides = new RideSystem(cfg.rides, map, cfg.terrain);
    const grid = (rides as unknown as { grid: RouteGrid }).grid;
    const graph = new RoadGraph(map.roads);
    const from: [number, number] = [map.spawnPx.x / T, map.spawnPx.y / T];
    const route = planRoadRoute(graph, grid, from, [2, 6], cfg.rides)!;
    expect(route).not.toBeNull();
    expect(route.slice(0, 2)).toEqual(from.map((v) => Math.round(v * 100) / 100));
    let onRoad = 0;
    for (let i = 2; i < route.length; i += 2) {
      const gi = (Math.floor(route[i + 1]) - map.originTy) * map.width + (Math.floor(route[i]) - map.originTx);
      if (!map.driveSolid[gi]) onRoad++;
    }
    expect(onRoad / (route.length / 2 - 1)).toBeGreaterThan(0.95);
  });
});
