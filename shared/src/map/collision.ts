// Tile collision shared by client prediction and server validation.
// Positions are the character's FEET in world pixels; the hitbox is a small box above the feet.

export interface CollisionGrid {
  width: number;
  height: number;
  tileSize: number;
  /** Tile coords of grid cell (0,0); world positions are relative to the fixed origin. */
  originTx: number;
  originTy: number;
  solid: Uint8Array;
  /** Things that come and go (food stalls, food trucks): exact boxes in world px (same
   *  origin-relative coords as positions), keyed by what put them there. */
  boxes?: Map<string, PxBox[]>;
  /** Optional exact polygons (building outlines, tile coords). Angled walls collide smoothly
   *  instead of in tile-sized steps. Tiles under these polygons are NOT marked in `solid`. */
  polys?: PolyIndex;
}

/** A box in world px (origin-relative, like player positions). */
export interface PxBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Set (or clear, with an empty list) the boxes for `key` on these grids. Returns true if anything changed. */
export function setBoxes(grids: CollisionGrid[], key: string, boxes: PxBox[]): boolean {
  let changed = false;
  for (const g of grids) {
    g.boxes ??= new Map();
    const cur = g.boxes.get(key);
    if (!boxes.length) {
      if (cur) (g.boxes.delete(key), (changed = true));
    } else if (!cur || JSON.stringify(cur) !== JSON.stringify(boxes)) {
      g.boxes.set(key, boxes);
      changed = true;
    }
  }
  return changed;
}

export interface PolyIndex {
  /** Bucket size in tiles. */
  cell: number;
  polys: Array<{ pts: number[]; x0: number; y0: number; x1: number; y1: number }>;
  buckets: Map<number, number[]>;
}

const bucketKey = (bx: number, by: number) => bx * 65536 + by;

export function buildPolyIndex(polys: number[][], cell = 8): PolyIndex {
  const index: PolyIndex = { cell, polys: [], buckets: new Map() };
  polys.forEach((pts, i) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < pts.length; k += 2) {
      x0 = Math.min(x0, pts[k]); x1 = Math.max(x1, pts[k]);
      y0 = Math.min(y0, pts[k + 1]); y1 = Math.max(y1, pts[k + 1]);
    }
    index.polys.push({ pts, x0, y0, x1, y1 });
    for (let by = Math.floor(y0 / cell); by <= Math.floor(y1 / cell); by++)
      for (let bx = Math.floor(x0 / cell); bx <= Math.floor(x1 / cell); bx++) {
        const k = bucketKey(bx, by);
        const list = index.buckets.get(k) ?? [];
        list.push(i);
        index.buckets.set(k, list);
      }
  });
  return index;
}

function inside(px: number, py: number, p: number[]): boolean {
  let hit = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const yi = p[i + 1], yj = p[j + 1];
    if (yi > py !== yj > py && px < ((p[j] - p[i]) * (py - yi)) / (yj - yi) + p[i]) hit = !hit;
  }
  return hit;
}

/** Does segment (ax,ay)-(bx,by) touch the axis-aligned rect? (Liang–Barsky clipping) */
function segHitsRect(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const clip = (pp: number, qq: number) => {
    if (pp === 0) return qq >= 0;
    const r = qq / pp;
    if (pp < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay);
}

/** Does the rect (tile coords) overlap any indexed polygon? */
export function rectHitsPolys(index: PolyIndex, x0: number, y0: number, x1: number, y1: number): boolean {
  const c = index.cell;
  const seen = new Set<number>();
  for (let by = Math.floor(y0 / c); by <= Math.floor(y1 / c); by++)
    for (let bx = Math.floor(x0 / c); bx <= Math.floor(x1 / c); bx++) {
      for (const i of index.buckets.get(bucketKey(bx, by)) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const poly = index.polys[i];
        if (poly.x1 < x0 || poly.x0 > x1 || poly.y1 < y0 || poly.y0 > y1) continue;
        if (inside((x0 + x1) / 2, (y0 + y1) / 2, poly.pts)) return true;
        const p = poly.pts;
        for (let k = 0, j = p.length - 2; k < p.length; j = k, k += 2) {
          if (segHitsRect(p[j], p[j + 1], p[k], p[k + 1], x0, y0, x1, y1)) return true;
        }
      }
    }
  return false;
}

export interface Hitbox {
  w: number;
  h: number;
}

/** True if the hitbox with feet at (x, y) overlaps a solid tile or leaves the map. */
export function collides(grid: CollisionGrid, x: number, y: number, hb: Hitbox): boolean {
  const T = grid.tileSize;
  // Convert world px (origin-relative) to grid px.
  const ox = grid.originTx * T;
  const oy = grid.originTy * T;
  const left = x - ox - hb.w / 2;
  const right = x - ox + hb.w / 2 - 0.001;
  const top = y - oy - hb.h;
  const bottom = y - oy - 0.001;
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
  if (grid.boxes?.size) {
    const l = x - hb.w / 2, r = x + hb.w / 2, t = y - hb.h;
    for (const list of grid.boxes.values()) for (const b of list) if (l < b.x1 && r > b.x0 && t < b.y1 && y > b.y0) return true;
  }
  if (grid.polys) return rectHitsPolys(grid.polys, (x - hb.w / 2) / T, (y - hb.h) / T, (x + hb.w / 2) / T, y / T);
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

  // Angled walls: if the axis moves got (mostly) stuck, glide along the wall instead of
  // stopping dead. Try directions rotated away from the input, slowed by how far they turn
  // (the input projected onto that direction), and take the first that is free.
  const want = Math.hypot(dx, dy);
  const got = Math.hypot(nx - x, ny - y);
  if (want > 0 && got < want * 0.5) {
    for (const deg of SLIDE_ANGLES) {
      const a = (deg * Math.PI) / 180;
      const k = Math.cos(a);
      let best: { x: number; y: number } | null = null;
      for (const s of [1, -1]) {
        const c = Math.cos(a * s), sn = Math.sin(a * s);
        const rx = (dx * c - dy * sn) * k;
        const ry = (dx * sn + dy * c) * k;
        if (!collides(grid, x + rx, y + ry, hb)) {
          // Both sides free (open corner): keep the axis result rather than wobbling.
          if (best) return got > 0 ? { x: nx, y: ny } : best;
          best = { x: x + rx, y: y + ry };
        }
      }
      if (best && Math.hypot(best.x - x, best.y - y) > got) return best;
    }
  }
  return { x: nx, y: ny };
}

const SLIDE_ANGLES = [15, 30, 45, 60, 75];

/**
 * Is there a collision-free route from a to b? Checks the straight line (sliding along angled
 * walls) and the two axis-aligned "L" paths (x then y, or y then x), which match how
 * moveWithCollision slides around corners.
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
  return segClear(ax, ay, bx, by) || (segClear(ax, ay, bx, ay) && segClear(bx, ay, bx, by)) || (segClear(ax, ay, ax, by) && segClear(ax, by, bx, by));
}
