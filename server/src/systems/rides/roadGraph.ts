// Ronda routes along the real road network (Malaysian road rules): the rider joins the nearest
// road, follows the roads' own centre lines from junction to junction, and gets off at the road
// nearest the destination.
//  - Bigger roads (2+ lanes, and highways) mapped one-way (most dual carriageways are two
//    one-way roads) only go forwards.
//  - Single-lane roads can be ridden both ways, down the middle (the mapped one-way direction is
//    still preferred: going the other way costs a bit more).
//  - Two-way roads with room for two lanes: keep LEFT (the route runs down the middle of the
//    left half).
//  - Multi-lane one-way roads: the left (slow) lane, where motorbikes belong.
//  - Bigger roads are slightly preferred (they're faster in real life), back lanes avoided.
// The short bits between the road and where you stand use the grid router (./route.ts).
import type { BuiltRoad } from '@kh/shared';
import { planRoute, simplify, type RouteGrid, type RouteOptions } from './route';

interface Edge {
  to: number;
  len: number;
  cost: number;
  road: number;
}

/** A point on a road segment (from pts[i] to pts[i+1] of road `road`), `t` along it. */
interface RoadPoint {
  road: number;
  seg: number;
  t: number;
  x: number;
  y: number;
  d: number;
}

const CLASS_PREF: Record<string, number> = { highway: 1.3, arterial: 1.15, street: 1, service: 0.7 };
/** Riding a single-lane road against its mapped one-way direction costs this much more. */
const SINGLE_LANE_AGAINST = 2.5;

/** Can this road only be ridden forwards? (one-way with 2+ lanes, or any highway) */
export function strictOneWay(r: Pick<BuiltRoad, 'oneway' | 'lanes' | 'cls'>): boolean {
  return r.oneway && (r.lanes >= 2 || r.cls === 'highway');
}

export class RoadGraph {
  private xs: number[] = [];
  private ys: number[] = [];
  private adj: Edge[][] = [];
  private keyToNode = new Map<string, number>();
  /** Node id of every road vertex: vertexNode[road][i]. */
  private vertexNode: number[][] = [];

  constructor(readonly roads: readonly BuiltRoad[]) {
    roads.forEach((r, ri) => {
      const ids: number[] = [];
      for (let i = 0; i < r.pts.length; i += 2) ids.push(this.node(r.pts[i], r.pts[i + 1]));
      this.vertexNode[ri] = ids;
      const pref = CLASS_PREF[r.cls] ?? 1;
      for (let i = 0; i + 1 < ids.length; i++) {
        const a = ids[i], b = ids[i + 1];
        if (a === b) continue;
        const len = Math.hypot(this.xs[b] - this.xs[a], this.ys[b] - this.ys[a]);
        this.adj[a].push({ to: b, len, cost: len / pref, road: ri });
        if (!strictOneWay(r)) this.adj[b].push({ to: a, len, cost: (len / pref) * (r.oneway ? SINGLE_LANE_AGAINST : 1), road: ri });
      }
    });
    this.joinLooseEnds();
    this.openDeadEnds();
  }

  /**
   * A one-way road that leads nowhere (it runs off the edge of the map, or into a car park the
   * data doesn't connect) would trap the rider; there's always room to U-turn at the end, so
   * such a road can be ridden back out. Repeats until nothing changes (one fix can expose another).
   */
  private openDeadEnds() {
    const opened = new Set<number>();
    for (let pass = 0; pass < 6; pass++) {
      const indeg = new Map<number, number>();
      for (const es of this.adj) for (const e of es) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
      let changed = false;
      this.roads.forEach((r, ri) => {
        if (!strictOneWay(r) || opened.has(ri)) return;
        const ids = this.vertexNode[ri];
        const sink = this.adj[ids[ids.length - 1]].length === 0;
        const source = (indeg.get(ids[0]) ?? 0) === 0;
        if (!sink && !source) return;
        const pref = CLASS_PREF[r.cls] ?? 1;
        for (let i = ids.length - 1; i > 0; i--) {
          const a = ids[i], b = ids[i - 1];
          if (a === b) continue;
          const len = Math.hypot(this.xs[b] - this.xs[a], this.ys[b] - this.ys[a]);
          this.adj[a].push({ to: b, len, cost: len / pref, road: ri });
        }
        opened.add(ri);
        changed = true;
      });
      if (!changed) break;
    }
  }

  /**
   * Some roads stop just short of the road they meet (no shared point in the data, or a road
   * added by hand). Join each loose end to the nearest other ground-level road within ~2 tiles:
   * a short link both ways, and the road it meets gets a junction point there.
   */
  private joinLooseEnds(maxGap = 2.2) {
    const degree = new Map<number, number>();
    this.vertexNode.forEach((ids) => ids.forEach((id) => degree.set(id, (degree.get(id) ?? 0) + 1)));
    this.roads.forEach((r, ri) => {
      if (r.elevated) return;
      const ids = this.vertexNode[ri];
      for (const end of [0, ids.length - 1]) {
        const node = ids[end];
        if ((degree.get(node) ?? 0) > 1) continue; // already a junction
        const x = this.xs[node], y = this.ys[node];
        let best: RoadPoint | null = null;
        for (const p of this.nearest(x, y, maxGap, 6)) if (p.road !== ri && (!best || p.d < best.d)) best = p;
        if (!best) continue;
        const other = this.roads[best.road];
        const a = this.vertexNode[best.road][best.seg], b = this.vertexNode[best.road][best.seg + 1];
        const j = best.t <= 0.001 ? a : best.t >= 0.999 ? b : this.splitAt(best, a, b, other);
        if (j === node) continue;
        const len = Math.hypot(this.xs[j] - x, this.ys[j] - y);
        this.adj[node].push({ to: j, len, cost: len, road: ri });
        this.adj[j].push({ to: node, len, cost: len, road: ri });
      }
    });
  }

  /** A new junction node part-way along segment a→b of a road (keeps its one-way rule). */
  private splitAt(p: RoadPoint, a: number, b: number, r: BuiltRoad): number {
    const id = this.xs.length;
    this.xs.push(p.x);
    this.ys.push(p.y);
    this.adj.push([]);
    const pref = CLASS_PREF[r.cls] ?? 1;
    const link = (u: number, v: number) => {
      const len = Math.hypot(this.xs[v] - this.xs[u], this.ys[v] - this.ys[u]);
      this.adj[u].push({ to: v, len, cost: len / pref, road: p.road });
    };
    link(a, id);
    link(id, b);
    if (!strictOneWay(r)) {
      link(b, id);
      link(id, a);
    }
    return id;
  }

  /** Junctions: roads meet where they share a vertex (same OSM node → same coordinates). */
  private node(x: number, y: number): number {
    const k = `${Math.round(x * 20)},${Math.round(y * 20)}`;
    let id = this.keyToNode.get(k);
    if (id === undefined) {
      id = this.xs.length;
      this.xs.push(x);
      this.ys.push(y);
      this.adj.push([]);
      this.keyToNode.set(k, id);
    }
    return id;
  }

  /** Sizes of the separate road networks (debugging the map: roads that don't connect). */
  components(): number[] {
    const n = this.xs.length;
    const und: number[][] = Array.from({ length: n }, () => []);
    this.adj.forEach((es, a) => es.forEach((e) => (und[a].push(e.to), und[e.to].push(a))));
    const seen = new Uint8Array(n);
    const sizes: number[] = [];
    for (let i = 0; i < n; i++) {
      if (seen[i]) continue;
      let c = 0;
      const st = [i];
      seen[i] = 1;
      while (st.length) {
        const v = st.pop()!;
        c++;
        for (const w of und[v]) if (!seen[w]) (seen[w] = 1), st.push(w);
      }
      sizes.push(c);
    }
    return sizes.sort((a, b) => b - a);
  }

  /** The nearest points on (ground-level) roads to (x, y), one per road, closest first. */
  nearest(x: number, y: number, maxDist: number, n = 4): RoadPoint[] {
    const best = new Map<number, RoadPoint>();
    this.roads.forEach((r, ri) => {
      if (r.elevated) return; // you can't hop onto a flyover from below
      const b = r.bbox;
      if (x < b.x0 - maxDist || x > b.x1 + maxDist || y < b.y0 - maxDist || y > b.y1 + maxDist) return;
      for (let i = 0; i + 3 < r.pts.length; i += 2) {
        const ax = r.pts[i], ay = r.pts[i + 1], bx = r.pts[i + 2], by = r.pts[i + 3];
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
        const px = ax + dx * t, py = ay + dy * t;
        const d = Math.hypot(px - x, py - y);
        if (d > maxDist) continue;
        const cur = best.get(ri);
        if (!cur || d < cur.d) best.set(ri, { road: ri, seg: i / 2, t, x: px, y: py, d });
      }
    });
    return [...best.values()].sort((a, b) => a.d - b.d).slice(0, n);
  }

  /**
   * Cheapest way along the roads from one road point to another. Returns the points (tile
   * coords) and, for each leg, the road it runs along; null if the one-way rules make it impossible.
   */
  route(from: RoadPoint, to: RoadPoint, maxNodes = 200_000): { pts: number[]; roads: number[] } | null {
    const N = this.xs.length;
    const S = N, G = N + 1; // virtual nodes for the two points
    const xs = (i: number) => (i === S ? from.x : i === G ? to.x : this.xs[i]);
    const ys = (i: number) => (i === S ? from.y : i === G ? to.y : this.ys[i]);
    const extra = new Map<number, Edge[]>();
    const add = (a: number, b: number, road: number, against = false) => {
      const len = Math.hypot(xs(b) - xs(a), ys(b) - ys(a));
      const r = this.roads[road];
      const e = { to: b, len, cost: (len / (CLASS_PREF[r.cls] ?? 1)) * (against && r.oneway ? SINGLE_LANE_AGAINST : 1), road };
      if (a >= N) (extra.get(a) ?? extra.set(a, []).get(a)!).push(e);
      else (extra.get(a) ?? extra.set(a, [...this.adj[a]]).get(a)!).push(e);
    };
    const fr = this.roads[from.road], tr = this.roads[to.road];
    const fa = this.vertexNode[from.road][from.seg], fb = this.vertexNode[from.road][from.seg + 1];
    const ta = this.vertexNode[to.road][to.seg], tb = this.vertexNode[to.road][to.seg + 1];
    add(S, fb, from.road);
    if (!strictOneWay(fr)) add(S, fa, from.road, true);
    add(ta, G, to.road);
    if (!strictOneWay(tr)) add(tb, G, to.road, true);
    // Both on the same stretch of road: straight there (if the one-way rule allows).
    if (from.road === to.road && from.seg === to.seg && (!strictOneWay(fr) || to.t >= from.t)) add(S, G, from.road, to.t < from.t);

    const edges = (i: number) => extra.get(i) ?? (i < N ? this.adj[i] : []);
    const gScore = new Map<number, number>([[S, 0]]);
    const parent = new Map<number, { from: number; road: number }>();
    const h = (i: number) => Math.hypot(xs(i) - to.x, ys(i) - to.y) / 1.3;
    const open: Array<[number, number]> = [[h(S), S]];
    const closed = new Set<number>();
    let expanded = 0;
    while (open.length) {
      // Small binary heap on [f, id].
      const top = open[0];
      const last = open.pop()!;
      if (open.length) {
        open[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < open.length && open[l][0] < open[m][0]) m = l;
          if (r < open.length && open[r][0] < open[m][0]) m = r;
          if (m === i) break;
          [open[i], open[m]] = [open[m], open[i]];
          i = m;
        }
      }
      const cur = top[1];
      if (closed.has(cur)) continue;
      if (cur === G) break;
      closed.add(cur);
      if (++expanded > maxNodes) return null;
      const g0 = gScore.get(cur)!;
      for (const e of edges(cur)) {
        if (closed.has(e.to)) continue;
        const g = g0 + e.cost;
        if (g < (gScore.get(e.to) ?? Infinity)) {
          gScore.set(e.to, g);
          parent.set(e.to, { from: cur, road: e.road });
          const item: [number, number] = [g + h(e.to), e.to];
          open.push(item);
          for (let i = open.length - 1; i > 0; ) {
            const p = (i - 1) >> 1;
            if (open[p][0] <= item[0]) break;
            [open[i], open[p]] = [open[p], open[i]];
            i = p;
          }
        }
      }
    }
    if (!parent.has(G)) return null;
    const ids: number[] = [];
    const roads: number[] = [];
    for (let c = G; c !== S; ) {
      const p = parent.get(c)!;
      ids.push(c);
      roads.push(p.road);
      c = p.from;
    }
    ids.push(S);
    ids.reverse();
    roads.reverse();
    const pts: number[] = [];
    for (const i of ids) pts.push(xs(i), ys(i));
    return { pts, roads };
  }
}

/** Sideways offset (tiles, to the LEFT of travel) for driving along this road. */
export function laneOffset(r: Pick<BuiltRoad, 'oneway' | 'lanes' | 'width'>): number {
  if (r.oneway) return r.lanes >= 2 ? r.width / 2 - r.width / (2 * r.lanes) : 0;
  return r.lanes >= 2 && r.width >= 3 ? r.width / 4 : 0;
}

/**
 * Shifts each leg of a path sideways by its lane offset (left of the direction of travel, so
 * screen-left of "up" is -x) and joins neighbouring legs at their crossing point.
 */
export function offsetPath(pts: number[], offsets: number[]): number[] {
  const n = pts.length / 2;
  if (n < 2) return pts.slice();
  const legs: Array<[number, number, number, number]> = [];
  for (let i = 0; i + 1 < n; i++) {
    const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[i * 2 + 2], by = pts[i * 2 + 3];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    // Left of travel with y pointing down the screen: (dy, -dx).
    const nx = (by - ay) / l, ny = -(bx - ax) / l;
    const o = offsets[i] ?? 0;
    legs.push([ax + nx * o, ay + ny * o, bx + nx * o, by + ny * o]);
  }
  const out: number[] = [legs[0][0], legs[0][1]];
  for (let i = 1; i < legs.length; i++) {
    const [a0x, a0y, a1x, a1y] = legs[i - 1];
    const [b0x, b0y, b1x, b1y] = legs[i];
    const d1x = a1x - a0x, d1y = a1y - a0y, d2x = b1x - b0x, d2y = b1y - b0y;
    const den = d1x * d2y - d1y * d2x;
    const vx = pts[i * 2], vy = pts[i * 2 + 1];
    if (Math.abs(den) > 1e-6) {
      const s = ((b0x - a0x) * d2y - (b0y - a0y) * d2x) / den;
      const ix = a0x + d1x * s, iy = a0y + d1y * s;
      if (Math.hypot(ix - vx, iy - vy) < 4) {
        out.push(ix, iy);
        continue;
      }
    }
    out.push(a1x, a1y);
    if (Math.hypot(b0x - a1x, b0y - a1y) > 0.01) out.push(b0x, b0y);
  }
  const last = legs[legs.length - 1];
  out.push(last[2], last[3]);
  return out;
}

/** Is every point along the polyline (sampled every ~0.3 tiles) drivable? */
export function pathClear(g: RouteGrid, pts: number[]): boolean {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.3));
    for (let k = 0; k <= steps; k++) {
      const x = Math.floor(ax + ((bx - ax) * k) / steps) - g.originTx;
      const y = Math.floor(ay + ((by - ay) * k) / steps) - g.originTy;
      if (x < 0 || y < 0 || x >= g.width || y >= g.height || g.blocked[y * g.width + x]) return false;
    }
  }
  return true;
}

/** Joins polylines, dropping a repeated point where they meet. */
function join(...parts: number[][]): number[] {
  const out: number[] = [];
  for (const p of parts)
    for (let i = 0; i < p.length; i += 2) {
      const n = out.length;
      if (n && Math.hypot(out[n - 2] - p[i], out[n - 1] - p[i + 1]) < 0.05) continue;
      out.push(p[i], p[i + 1]);
    }
  return out;
}

/** From a spot to a point on a road: straight if nothing's in the way, else the grid router. */
function connector(g: RouteGrid, from: [number, number], to: [number, number], opts: RouteOptions, reverse = false): number[] | null {
  const direct = [from[0], from[1], to[0], to[1]];
  if (pathClear(g, direct)) return reverse ? [to[0], to[1], from[0], from[1]] : direct;
  const r = reverse ? planRoute(g, to, from, opts) : planRoute(g, from, to, opts);
  if (!r) return null;
  return reverse ? r : [...r, to[0], to[1]];
}

/**
 * A ride from `from` to `to` (tile coords) along the roads, keeping left. Null if there's no
 * road nearby or no legal way through; the caller then falls back to the plain grid route.
 */
export function planRoadRoute(graph: RoadGraph, g: RouteGrid, from: [number, number], to: [number, number], opts: RouteOptions, maxLen = Infinity): number[] | null {
  const snap = Math.max(opts.snapRadiusTiles * 2.5, 12);
  const starts = graph.nearest(from[0], from[1], snap, 5);
  const ends = graph.nearest(to[0], to[1], snap, 5);
  let best: { pts: number[]; roads: number[]; s: (typeof starts)[number]; e: (typeof ends)[number]; score: number } | null = null;
  for (const s of starts)
    for (const e of ends) {
      const r = graph.route(s, e);
      if (!r) continue;
      let len = 0;
      for (let i = 2; i < r.pts.length; i += 2) len += Math.hypot(r.pts[i] - r.pts[i - 2], r.pts[i + 1] - r.pts[i - 1]);
      // Walking-pace bits to and from the road count extra (riders don't like dirt tracks).
      const score = len + (s.d + e.d) * 3;
      if (!best || score < best.score) best = { ...r, s, e, score };
    }
  if (!best || best.score > maxLen) return null;
  // Lane discipline on the road part; fall back to the centre line if the offset clips something.
  const offs = best.roads.map((ri) => laneOffset(graph.roads[ri]));
  let road = offsetPath(best.pts, offs);
  if (!pathClear(g, road)) road = best.pts;
  road = simplify(road, 0.15);
  const head = connector(g, from, [road[0], road[1]], opts);
  const tail = connector(g, [road[road.length - 2], road[road.length - 1]], to, opts);
  if (!head || !tail) return null;
  // The tail ends at the open cell nearest the destination, like the grid router.
  return join(head, road, tail).map((v) => Math.round(v * 100) / 100);
}
