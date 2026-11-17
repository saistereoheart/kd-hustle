import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { rideFareSen, type Direction } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { withoutMotorbike } from '../../db/migrations';
import { ROOT } from '../../paths';
import { GameError } from '../economy/economy';
import { findPath, planRoute, polylineLength, simplify, type RouteGrid } from './route';
import { RideSystem, type RidePlayer } from './rides';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const map = cfg.map;
const T = map.tileSize;

/** A tiny grid from ASCII: '#' blocked, '.' grass (slow), '=' road (fast). */
function grid(rows: string[]): RouteGrid {
  const H = rows.length, W = rows[0].length;
  const blocked = new Uint8Array(W * H);
  const speed = new Float32Array(W * H);
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    blocked[y * W + x] = c === '#' ? 1 : 0;
    speed[y * W + x] = c === '=' ? 1 : 0.4;
  }));
  return { width: W, height: H, originTx: 0, originTy: 0, blocked, speed };
}
const opts = { offroadPenaltyPow: 2, maxSearchNodes: 100000, simplifyTiles: 0.5, snapRadiusTiles: 3 };

const player = (x: number, y: number): RidePlayer => ({ x, y, dir: 'down' as Direction, moving: false, dirty: false, rideQuote: null, ride: null });

describe('ride routes', () => {
  it('goes around walls and never through a blocked cell or a diagonal gap', () => {
    const g = grid([
      '.....',
      '.###.',
      '.#.#.',
      '.###.',
      '.....',
    ]);
    const path = findPath(g, 0, 4 * 5 + 4, opts)!;
    expect(path).not.toBeNull();
    for (const c of path) expect(g.blocked[c]).toBe(0);
    expect(findPath(g, 0, 2 * 5 + 2, opts)).toBeNull(); // the walled-in middle cell
  });

  it('prefers a longer road over a short cut across grass', () => {
    const g = grid([
      '=======',
      '=.....=',
      '=.....=',
      '=.....=',
      '=======',
    ]);
    // From the left middle to the right middle: across the grass is 6 tiles, round by road ~10.
    const path = findPath(g, 2 * 7 + 0, 2 * 7 + 6, opts)!;
    const onGrass = path.filter((c) => g.speed[c] < 1).length;
    expect(onGrass).toBe(0);
  });

  it('simplifies straight runs to their end points', () => {
    expect(simplify([0, 0, 1, 0, 2, 0, 3, 0, 3, 1, 3, 2], 0.1)).toEqual([0, 0, 3, 0, 3, 2]);
    expect(polylineLength([0, 0, 3, 0, 3, 4])).toBe(7);
  });

  it('plans a real route from spawn to Menara Mitraland that stays drivable', () => {
    const from: [number, number] = [map.spawnPx.x / T, map.spawnPx.y / T];
    const rides = new RideSystem(cfg.rides, map, cfg.terrain);
    const route = planRoute((rides as unknown as { grid: RouteGrid }).grid, from, [2, 6], cfg.rides)!;
    expect(route).not.toBeNull();
    expect(route.slice(0, 2)).toEqual(from.map((v) => Math.round(v * 100) / 100));
    // Every corner of the route is on a tile a vehicle can use.
    for (let i = 2; i < route.length; i += 2) {
      const gi = (Math.floor(route[i + 1]) - map.originTy) * map.width + (Math.floor(route[i]) - map.originTx);
      expect(map.driveSolid[gi]).toBe(0);
    }
  });
});

describe('ride fares', () => {
  const r = cfg.rides;
  it('charges base + per km, at least the minimum, rounded', () => {
    expect(rideFareSen(r, 0)).toBe(r.minFareSen);
    const fare = rideFareSen(r, 2500);
    expect(fare).toBe(Math.max(r.minFareSen, Math.round((r.baseFareSen + r.perKmSen * 2.5) / r.fareRoundSen) * r.fareRoundSen));
    expect(fare % r.fareRoundSen).toBe(0);
    expect(rideFareSen(r, 3000)).toBeGreaterThan(rideFareSen(r, 1000));
  });
});

describe('ride system', () => {
  const rides = new RideSystem(cfg.rides, map, cfg.terrain);
  const spawn = () => player(map.spawnPx.x, map.spawnPx.y);

  it('quotes, books and drives the player along the route to the end', () => {
    const p = spawn();
    const q = rides.quote(p, 2, 6, 1000);
    expect(q.fareSen).toBe(rideFareSen(cfg.rides, q.meters));
    expect(q.destName).toBeTruthy();
    const booked = rides.checkBooking(p, q.quoteId, 2000);
    const ride = rides.start(p, booked, 2000);
    expect(p.rideQuote).toBeNull();
    // Waiting for the rider: not moving yet.
    expect(rides.step(p, 2000 + cfg.rides.pickupMs - 10)).toBe(false);
    expect(Math.hypot(p.x - map.spawnPx.x, p.y - map.spawnPx.y)).toBeLessThan(1);
    // Half way: somewhere in between, moving.
    const total = rides.durationMs(ride);
    expect(rides.step(p, 2000 + cfg.rides.pickupMs + (total - cfg.rides.pickupMs) / 2)).toBe(false);
    expect(p.moving).toBe(true);
    // Done: at the end of the route.
    expect(rides.step(p, 2000 + total + 50)).toBe(true);
    expect(p.x).toBeCloseTo(q.route[q.route.length - 2] * T, 0);
    expect(p.y).toBeCloseTo(q.route[q.route.length - 1] * T, 0);
    rides.end(p);
    expect(p.ride).toBeNull();
  });

  it('refuses expired quotes, stale quote ids, walking away, and booking twice', () => {
    const p = spawn();
    const q = rides.quote(p, 2, 6, 0);
    expect(() => rides.checkBooking(p, 'nope', 10)).toThrow(GameError);
    expect(() => rides.checkBooking(p, q.quoteId, cfg.rides.quoteTtlSec * 1000 + 1)).toThrow(/expired/);
    const q2 = rides.quote(p, 2, 6, 0);
    p.x += (cfg.rides.maxQuoteDriftTiles + 1) * T;
    expect(() => rides.checkBooking(p, q2.quoteId, 10)).toThrow(/moved away/);
    p.x -= (cfg.rides.maxQuoteDriftTiles + 1) * T;
    const q3 = rides.quote(p, 2, 6, 0);
    rides.start(p, rides.checkBooking(p, q3.quoteId, 10), 10);
    expect(() => rides.quote(p, 2, 6, 20)).toThrow(/already/);
  });

  it('refuses trips that are off the map or just around the corner', () => {
    const p = spawn();
    expect(() => rides.quote(p, map.originTx - 5, 0)).toThrow(/off the map/);
    expect(() => rides.quote(p, p.x / T + 1, p.y / T)).toThrow(GameError);
  });
});

describe('hotbar migration (drop the leftover motorbike)', () => {
  const bike = { kind: 'vehicle', id: 'bicycle' };
  const moto = { kind: 'vehicle', id: 'motorbike' };
  const hat = { kind: 'item', itemId: 'beret', variant: 'normal' };
  it('removes the motorbike wherever it is and keeps everything else in place', () => {
    const out = withoutMotorbike([bike, moto, hat, null, moto]);
    expect(out).toEqual([bike, null, hat, null, null, null, null, null, null, null]);
  });
  it('leaves a hotbar without a motorbike unchanged', () => {
    const bar = [bike, hat, null, null, null, null, null, null, null, null];
    expect(withoutMotorbike(bar)).toEqual(bar);
  });
});
