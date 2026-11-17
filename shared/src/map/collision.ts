// Tile collision shared by client prediction and server validation.
// Positions are the character's FEET in world pixels; the hitbox is a small box above the feet.

export interface CollisionGrid {
  width: number;
  height: number;
  tileSize: number;
  solid: Uint8Array;
}

export interface Hitbox {
  w: number;
  h: number;
}

/** True if the hitbox with feet at (x, y) overlaps a solid tile or leaves the map. */
export function collides(grid: CollisionGrid, x: number, y: number, hb: Hitbox): boolean {
  const T = grid.tileSize;
  const left = x - hb.w / 2;
  const right = x + hb.w / 2 - 0.001;
  const top = y - hb.h;
  const bottom = y - 0.001;
  if (left < 0 || top < 0 || right >= grid.width * T || bottom >= grid.height * T) return true;
  const tx0 = Math.floor(left / T);
  const tx1 = Math.floor(right / T);
  const ty0 = Math.floor(top / T);
  const ty1 = Math.floor(bottom / T);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (grid.solid[ty * grid.width + tx]) return true;
    }
  }
  return false;
}

/**
 * Moves by (dx, dy), resolving each axis separately so the player slides along walls.
 * When an axis is blocked we binary-search the largest step that still fits, so the
 * player ends up flush against the wall instead of stopping a few pixels short.
 */
export function moveWithCollision(grid: CollisionGrid, x: number, y: number, dx: number, dy: number, hb: Hitbox) {
  let nx = x;
  let ny = y;
  const axis = (cx: number, cy: number, d: number, horizontal: boolean): number => {
    if (d === 0) return 0;
    const test = (step: number) => (horizontal ? collides(grid, cx + step, cy, hb) : collides(grid, cx, cy + step, hb));
    if (!test(d)) return d;
    let lo = 0;
    let hi = d;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      if (test(mid)) hi = mid;
      else lo = mid;
    }
    return lo;
  };
  nx += axis(nx, ny, dx, true);
  ny += axis(nx, ny, dy, false);
  return { x: nx, y: ny };
}

/**
 * Is there a collision-free route from a to b? Checks the two axis-aligned "L" paths
 * (x then y, or y then x), which matches how moveWithCollision slides around corners.
 */
export function pathClear(grid: CollisionGrid, ax: number, ay: number, bx: number, by: number, hb: Hitbox, step = 4): boolean {
  const segClear = (x0: number, y0: number, x1: number, y1: number) => {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      if (collides(grid, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, hb)) return false;
    }
    return true;
  };
  if (collides(grid, bx, by, hb)) return false;
  return (segClear(ax, ay, bx, ay) && segClear(bx, ay, bx, by)) || (segClear(ax, ay, ax, by) && segClear(ax, by, bx, by));
}
