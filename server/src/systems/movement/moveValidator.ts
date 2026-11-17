// Server-side movement validation. The client predicts its own movement and reports its
// position ~15×/s; we check each report against a "movement budget" (a token bucket that
// refills at walkSpeed × tolerance) and against wall collision. Anything impossible is
// rejected and the client is snapped back to the last accepted position.
import { pathClear, type CollisionGrid, type MovementConfig } from '@kh/shared';

export interface MoveState {
  x: number;
  y: number;
  /** Pixels of movement the player may still use. */
  budget: number;
  lastAt: number;
}

export type MoveVerdict = { ok: true } | { ok: false; reason: 'speed' | 'collision' };

export function newMoveState(x: number, y: number, now: number, cfg: MovementConfig): MoveState {
  return { x, y, budget: cfg.walkSpeed * cfg.speedTolerance * cfg.maxBudgetSeconds, lastAt: now };
}

/** Validates a move to (nx, ny) at time `now`, mutating state on success. */
export function validateMove(
  state: MoveState,
  nx: number,
  ny: number,
  now: number,
  grid: CollisionGrid,
  cfg: MovementConfig,
): MoveVerdict {
  const rate = cfg.walkSpeed * cfg.speedTolerance;
  const cap = rate * cfg.maxBudgetSeconds;
  const elapsed = Math.max(0, now - state.lastAt) / 1000;
  const budget = Math.min(cap, state.budget + elapsed * rate);
  const dist = Math.hypot(nx - state.x, ny - state.y);

  if (dist > budget + cfg.slackPx) {
    state.budget = budget;
    state.lastAt = now;
    return { ok: false, reason: 'speed' };
  }
  if (dist > 0 && !pathClear(grid, state.x, state.y, nx, ny, cfg.hitbox)) {
    state.budget = budget;
    state.lastAt = now;
    return { ok: false, reason: 'collision' };
  }
  state.budget = Math.max(0, budget - dist);
  state.lastAt = now;
  state.x = nx;
  state.y = ny;
  return { ok: true };
}
