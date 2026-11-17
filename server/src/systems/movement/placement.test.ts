import { describe, expect, it } from 'vitest';
import { placePlayer } from './placement';

// 6×6 grid at tile origin (-3,-3); a 2×2 building at tiles (0,0)-(1,1).
const solid = new Uint8Array(36);
for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) solid[(y + 3) * 6 + (x + 3)] = 1;
const grid = { width: 6, height: 6, tileSize: 32, originTx: -3, originTy: -3, solid };
const hb = { w: 16, h: 10 };
const current = { mapVersion: 2, spawn: { x: -80, y: -60 } };

describe('placePlayer', () => {
  it('keeps a valid saved position', () => {
    expect(placePlayer(grid, hb, { x: -48, y: -40, mapVersion: 2 }, current)).toMatchObject({ x: -48, y: -40, moved: false });
  });

  it('nudges a player out of a building that appeared where they stood', () => {
    const p = placePlayer(grid, hb, { x: 30, y: 40, mapVersion: 2 }, current);
    expect(p.reason).toBe('nudged');
    expect(p.moved).toBe(true);
  });

  it('sends players from an older map version to spawn', () => {
    expect(placePlayer(grid, hb, { x: -48, y: -40, mapVersion: 1 }, current)).toMatchObject({ x: -80, y: -60, reason: 'map-version' });
  });

  it('handles corrupt coordinates', () => {
    expect(placePlayer(grid, hb, { x: NaN, y: 0, mapVersion: 2 }, current).reason).toBe('invalid');
  });
});
