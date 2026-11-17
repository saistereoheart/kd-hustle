import { describe, expect, it } from 'vitest';
import { newMoveState, validateMove } from './moveValidator';

const cfg = { walkSpeed: 100, speedTolerance: 1.25, slackPx: 10, maxBudgetSeconds: 0.5, hitbox: { w: 16, h: 10 }, sendRateHz: 15 };
// 10x10 open grid with a wall column at tile x=5.
const solid = new Uint8Array(100);
for (let y = 0; y < 10; y++) solid[y * 10 + 5] = 1;
const grid = { width: 10, height: 10, tileSize: 32, solid };

describe('validateMove', () => {
  it('accepts normal walking at the configured speed', () => {
    const s = newMoveState(48, 48, 0, cfg);
    let t = 0;
    let x = 48;
    for (let i = 0; i < 15; i++) {
      t += 66;
      x += 100 * 0.066;
      expect(validateMove(s, x, 48, t, grid, cfg).ok).toBe(true);
    }
    expect(s.x).toBeCloseTo(x);
  });

  it('tolerates two packets arriving together (jitter)', () => {
    const s = newMoveState(48, 48, 0, cfg);
    expect(validateMove(s, 54.6, 48, 1000, grid, cfg).ok).toBe(true);
    expect(validateMove(s, 61.2, 48, 1000, grid, cfg).ok).toBe(true);
  });

  it('rejects teleports / speed hacks', () => {
    const s = newMoveState(48, 48, 0, cfg);
    const r = validateMove(s, 140, 48, 100, grid, cfg);
    expect(r).toEqual({ ok: false, reason: 'speed' });
    expect(s.x).toBe(48);
  });

  it('does not let idle time be banked into a teleport', () => {
    const s = newMoveState(48, 48, 0, cfg);
    // Idle for 60 s, then try to jump 200 px at once.
    expect(validateMove(s, 48, 248, 60_000, grid, cfg).ok).toBe(false);
  });

  it('rejects moving through walls', () => {
    const s = newMoveState(150, 48, 0, cfg);
    const r = validateMove(s, 190, 48, 500, grid, cfg);
    expect(r).toEqual({ ok: false, reason: 'collision' });
  });
});
