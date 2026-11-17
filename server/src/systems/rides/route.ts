// Route planning for Ronda rides: A* over the vehicle grid (8-way, no corner cutting), where a
// tile costs 1 / speedMult^pow, so the rider sticks to roads and only cuts across grass when
// it's much shorter. The tile path is then simplified into a few smooth straight segments.

export interface RouteGrid {
  width: number;
  height: number;
  /** Tile coords of grid cell (0, 0). */
  originTx: number;
  originTy: number;
  /** 1 = a vehicle can't be here. */
  blocked: Uint8Array;
  /** Vehicle speed multiplier per cell (0..1). */
  speed: Float32Array;
}

export interface RouteOptions {
  offroadPenaltyPow: number;
  simplifyTiles: number;
  maxSearchNodes: number;
  snapRadiusTiles: number;
}

/** Nearest open cell to (gx, gy) within `radius` cells (preferring fast ones), or -1. */
export function snapToOpen(g: RouteGrid, gx: number, gy: number, radius: number): number {
  let best = -1;
  let bestScore = Infinity;
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const x = gx + dx, y = gy + dy;
      if (x < 0 || y < 0 || x >= g.width || y >= g.height) continue;
      const i = y * g.width + x;
      if (g.blocked[i]) continue;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      // A road a little further away beats grass right here.
      const score = d + (1 - g.speed[i]) * 3;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
  return best;
}

/** Min-heap of cell ids keyed by f-score. */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

const DIRS: Array<[number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/**
 * Cheapest path between two cells, as cell ids (start first), or null if there is none
 * (or the search gave up after maxSearchNodes expansions).
 */
export function findPath(g: RouteGrid, start: number, goal: number, opts: Pick<RouteOptions, 'offroadPenaltyPow' | 'maxSearchNodes'>): number[] | null {
  const W = g.width, H = g.height, N = W * H;
  if (start < 0 || goal < 0 || g.blocked[start] || g.blocked[goal]) return null;
  const cost = new Float32Array(N);
  for (let i = 0; i < N; i++) cost[i] = 1 / Math.pow(Math.max(0.05, g.speed[i]), opts.offroadPenaltyPow);
  const gScore = new Float64Array(N).fill(Infinity);
  const parent = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const gx = goal % W, gy = (goal / W) | 0;
  const h = (i: number) => {
    const dx = Math.abs((i % W) - gx), dy = Math.abs(((i / W) | 0) - gy);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const open = new Heap();
  gScore[start] = 0;
  open.push(start, h(start));
  let expanded = 0;
  while (open.size) {
    const cur = open.pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1;
    if (++expanded > opts.maxSearchNodes) return null;
    const cx = cur % W, cy = (cur / W) | 0;
    for (const [dx, dy, len] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (closed[n] || g.blocked[n]) continue;
      // No squeezing diagonally between two blocked cells.
      if (dx && dy && (g.blocked[cy * W + nx] || g.blocked[ny * W + cx])) continue;
      const tentative = gScore[cur] + len * (cost[cur] + cost[n]) * 0.5;
      if (tentative < gScore[n]) {
        gScore[n] = tentative;
        parent[n] = cur;
        open.push(n, tentative + h(n));
      }
    }
  }
  if (parent[goal] === -1 && goal !== start) return null;
  const path: number[] = [];
  for (let c = goal; c !== -1; c = parent[c]) path.push(c);
  return path.reverse();
}

/** Ramer–Douglas–Peucker on a flat [x, y, ...] polyline. */
export function simplify(pts: number[], eps: number): number[] {
  const n = pts.length / 2;
  if (n <= 2 || eps <= 0) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let worst = -1, worstD = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i * 2] - ax) * dy - (pts[i * 2 + 1] - ay) * dx) / len;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

/** Length of a flat polyline. */
export function polylineLength(pts: number[]): number {
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return len;
}

/**
 * Plan a route between two points in tile coords. Returns the simplified polyline in tile
 * coords (starting at `from`, ending at the open cell nearest `to`), or null.
 */
export function planRoute(g: RouteGrid, from: [number, number], to: [number, number], opts: RouteOptions): number[] | null {
  const cell = (tx: number, ty: number) => [Math.floor(tx) - g.originTx, Math.floor(ty) - g.originTy] as const;
  const [sx, sy] = cell(...from);
  const [ex, ey] = cell(...to);
  const start = snapToOpen(g, sx, sy, opts.snapRadiusTiles);
  const goal = snapToOpen(g, ex, ey, opts.snapRadiusTiles);
  if (start < 0 || goal < 0) return null;
  const path = findPath(g, start, goal, opts);
  if (!path) return null;
  const pts: number[] = [from[0], from[1]];
  for (const c of path) pts.push((c % g.width) + g.originTx + 0.5, ((c / g.width) | 0) + g.originTy + 0.5);
  return simplify(pts, opts.simplifyTiles).map((v) => Math.round(v * 100) / 100);
}
