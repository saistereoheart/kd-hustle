import { describe, expect, it } from 'vitest';
import { collides, moveWithCollision, pathClear, setBoxes, type CollisionGrid } from './collision';
import { stallFootprint } from '../cooking/stall';

const grid = (): CollisionGrid => ({ width: 40, height: 40, tileSize: 32, originTx: -20, originTy: -20, solid: new Uint8Array(1600) });
const hb = { w: 14, h: 8 };

describe('stalls are solid', () => {
  it('a stall footprint blocks walking through it; you walk around it', () => {
    const g = grid();
    const plot = { x: 0, y: 0, tier: 2 };
    expect(collides(g, 0, 0, hb)).toBe(false);
    expect(setBoxes([g], 'stall:t', stallFootprint(plot, 32))).toBe(true);
    expect(setBoxes([g], 'stall:t', stallFootprint(plot, 32))).toBe(false); // nothing changed
    expect(collides(g, 0, 0, hb)).toBe(true);
    // Walking up into the truck stops at its edge.
    let end = { x: 0, y: 120 };
    for (let i = 0; i < 100; i++) end = moveWithCollision(g, end.x, end.y, 0, -3, hb); // ~3 px a frame
    expect(end.y).toBeGreaterThanOrEqual(24 + hb.h - 0.5);
    expect(pathClear(g, 0, 120, 0, -120, hb)).toBe(false);
    // Around the side is fine.
    expect(pathClear(g, 120, 120, 120, -120, hb)).toBe(true);
    // Stall gone: clear again.
    setBoxes([g], 'stall:t', []);
    expect(collides(g, 0, 0, hb)).toBe(false);
  });

  it('a pasar malam table blocks, but its canopy (above it) does not', () => {
    const g = grid();
    setBoxes([g], 'stall:p', stallFootprint({ x: 0, y: 0, tier: 1 }, 32));
    expect(collides(g, 0, 0, hb)).toBe(true);
    expect(collides(g, 0, -40, hb)).toBe(false); // behind the table, under the canopy
  });
});
