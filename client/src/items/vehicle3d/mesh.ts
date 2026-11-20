// A tiny triangle-mesh kit for the vehicles: lofts (a body swept through cross-sections), tubes
// (forks, pipes, handlebars), lathes (tyres, lamps, exhaust cans), ellipsoids and boxes.
// Model space is in metres: x forward, y to the vehicle's LEFT, z up; the origin is on the ground
// under the middle of the wheelbase.
import type { Material } from './shading';

export type V3 = [number, number, number];
export interface Vert {
  p: V3;
  n: V3;
  u: number;
  v: number;
}
export interface Tri {
  a: Vert;
  b: Vert;
  c: Vert;
  m: Material;
}

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
}
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

export class Mesh {
  tris: Tri[] = [];
  push(a: Vert, b: Vert, c: Vert, m: Material) {
    this.tris.push({ a, b, c, m });
  }
  add(...others: Mesh[]) {
    for (const o of others) for (const t of o.tris) this.tris.push(t);
    return this;
  }
  /** A mirror image across the centre line (y → −y), with the winding fixed. */
  mirrored(): Mesh {
    const out = new Mesh();
    const f = (q: Vert): Vert => ({ p: [q.p[0], -q.p[1], q.p[2]], n: [q.n[0], -q.n[1], q.n[2]], u: q.u, v: q.v });
    for (const t of this.tris) out.push(f(t.a), f(t.c), f(t.b), t.m);
    return out;
  }
}

/**
 * A grid of points (rows × cols) made into quads with smooth normals. Faces are turned to point
 * away from `inside(i, j)` (a point inside the solid for that quad). `wrap` closes each row.
 */
export function grid(
  rows: V3[][],
  m: Material,
  opts: { wrap?: boolean; uv?: (i: number, j: number) => [number, number]; inside?: (i: number, j: number) => V3; flat?: boolean } = {},
): Mesh {
  const R = rows.length, C = rows[0].length;
  const cols = opts.wrap ? C : C - 1;
  const at = (i: number, j: number) => rows[i][((j % C) + C) % C];
  // Face normals (outward), then vertex normals averaged from the faces around them.
  const fn: V3[][] = [];
  for (let i = 0; i < R - 1; i++) {
    fn.push([]);
    for (let j = 0; j < cols; j++) {
      const p00 = at(i, j), p10 = at(i + 1, j), p11 = at(i + 1, j + 1), p01 = at(i, j + 1);
      let n = cross(sub(p11, p00), sub(p01, p10));
      if (Math.hypot(...n) < 1e-12) n = cross(sub(p10, p00), sub(p01, p00));
      if (opts.inside) {
        const c = mul(add(add(p00, p10), add(p11, p01)), 0.25);
        if (dot(n, sub(c, opts.inside(i, j))) < 0) n = mul(n, -1);
      }
      fn[i].push(n);
    }
  }
  const vn = (i: number, j: number): V3 => {
    let s: V3 = [0, 0, 0];
    for (const di of [-1, 0]) {
      const fi = i + di;
      if (fi < 0 || fi >= R - 1) continue;
      for (const dj of [-1, 0]) {
        let fj = j + dj;
        if (opts.wrap) fj = ((fj % cols) + cols) % cols;
        else if (fj < 0 || fj >= cols) continue;
        const f = fn[fi][fj];
        const l = Math.hypot(...f);
        if (l > 1e-12) s = add(s, mul(f, 1 / l));
      }
    }
    return norm(s);
  };
  const uv = opts.uv ?? ((i: number, j: number) => [i, j] as [number, number]);
  const vert = (i: number, j: number, fl?: V3): Vert => {
    const [u, v] = uv(i, j % C);
    return { p: at(i, j), n: fl ?? vn(i, j % C), u, v };
  };
  const mesh = new Mesh();
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const n = fn[i][j];
      if (Math.hypot(...n) < 1e-12) continue;
      const fl = opts.flat ? norm(n) : undefined;
      const a = vert(i, j, fl), b = vert(i + 1, j, fl), c = vert(i + 1, j + 1, fl), d = vert(i, j + 1, fl);
      // Wind each triangle so its geometric normal agrees with the outward normal.
      const tri = (x: Vert, y: Vert, z: Vert) => {
        const g = cross(sub(y.p, x.p), sub(z.p, x.p));
        if (Math.hypot(...g) < 1e-14) return;
        if (dot(g, n) >= 0) mesh.push(x, y, z, m);
        else mesh.push(x, z, y, m);
      };
      tri(a, b, c);
      tri(a, c, d);
    }
  }
  return mesh;
}

/** A flat cap closing a ring of points (a fan from its middle), facing `dir`. */
export function cap(ring: V3[], m: Material, dir: V3, uv?: (p: V3) => [number, number]): Mesh {
  const c = mul(ring.reduce((s, p) => add(s, p), [0, 0, 0] as V3), 1 / ring.length);
  const n = norm(dir);
  const mesh = new Mesh();
  const vt = (p: V3): Vert => {
    const [u, v] = uv ? uv(p) : [p[0], -1];
    return { p, n, u, v };
  };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const g = cross(sub(a, c), sub(b, c));
    if (Math.hypot(...g) < 1e-14) continue;
    if (dot(g, n) >= 0) mesh.push(vt(c), vt(a), vt(b), m);
    else mesh.push(vt(c), vt(b), vt(a), m);
  }
  return mesh;
}

/** A rounded-rectangle ("superellipse") ring around (cy, cz): half sizes hw × hh, exponent e. */
export function superRing(n: number, cy: number, cz: number, hw: number, hh: number, e = 2.5): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2 - Math.PI / 2;
    const c = Math.cos(t), s = Math.sin(t);
    out.push([cy + hw * Math.sign(c) * Math.abs(c) ** (2 / e), cz + hh * Math.sign(s) * Math.abs(s) ** (2 / e)]);
  }
  return out;
}

export interface Station {
  x: number;
  ring: Array<[number, number]>; // (y, z)
}
/** A solid swept along x through cross-sections (all rings the same length). */
export function loft(st: Station[], m: Material, opts: { caps?: boolean; capMat?: Material; v?: (j: number) => number } = {}): Mesh {
  const rows = st.map((s) => s.ring.map(([y, z]) => [s.x, y, z] as V3));
  const C = st[0].ring.length;
  const mid = st.map((s) => {
    const yc = s.ring.reduce((a, q) => a + q[0], 0) / C;
    const zc = s.ring.reduce((a, q) => a + q[1], 0) / C;
    return [s.x, yc, zc] as V3;
  });
  const mesh = grid(rows, m, {
    wrap: true,
    uv: (i, j) => [st[i].x, opts.v ? opts.v(j) : j / C],
    inside: (i) => mul(add(mid[i], mid[i + 1]), 0.5),
  });
  if (opts.caps !== false) {
    const cm = opts.capMat ?? m;
    mesh.add(cap(rows[0], cm, [-1, 0, 0]), cap(rows[rows.length - 1], cm, [1, 0, 0]));
  }
  return mesh;
}

/** An orthonormal frame around a direction. */
function frame(d: V3): [V3, V3] {
  const a: V3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(d, a));
  return [u, cross(d, u)];
}

/** A round tube along a polyline (radius per point or one radius). */
export function tube(path: V3[], radius: number | number[], m: Material, segs = 10, caps = true): Mesh {
  const r = (i: number) => (Array.isArray(radius) ? radius[i] : radius);
  const rows: V3[][] = [];
  let [u, w] = frame(norm(sub(path[1], path[0])));
  for (let i = 0; i < path.length; i++) {
    const d = norm(i === 0 ? sub(path[1], path[0]) : i === path.length - 1 ? sub(path[i], path[i - 1]) : sub(path[i + 1], path[i - 1]));
    // Parallel transport keeps the ring from twisting.
    u = norm(sub(u, mul(d, dot(u, d))));
    w = cross(d, u);
    const row: V3[] = [];
    for (let k = 0; k < segs; k++) {
      const t = (k / segs) * Math.PI * 2;
      row.push(add(path[i], add(mul(u, Math.cos(t) * r(i)), mul(w, Math.sin(t) * r(i)))));
    }
    rows.push(row);
  }
  const mesh = grid(rows, m, { wrap: true, uv: (i, j) => [i, j / segs], inside: (i) => mul(add(path[i], path[i + 1]), 0.5) });
  if (caps) {
    mesh.add(cap(rows[0], m, sub(path[0], path[1])), cap(rows[rows.length - 1], m, sub(path[path.length - 1], path[path.length - 2])));
  }
  return mesh;
}

/**
 * Turned around an axis: `profile` is a list of (radius, distance along the axis). Closed shapes
 * (a tyre) list their outline all the way round. uv: u = profile index, v = angle (0..1).
 */
export function lathe(origin: V3, axis: V3, profile: Array<[number, number]>, m: Material, segs = 24, opts: { flat?: boolean; core?: number; coreT?: number } = {}): Mesh {
  const d = norm(axis);
  const [u, w] = frame(d);
  const rows = profile.map(([r, t]) => {
    const row: V3[] = [];
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      row.push(add(origin, add(mul(d, t), add(mul(u, Math.cos(a) * r), mul(w, Math.sin(a) * r)))));
    }
    return row;
  });
  return grid(rows, m, {
    wrap: true,
    flat: opts.flat,
    uv: (i, j) => [i, j / segs],
    // A ring-shaped solid (a tyre) has its inside on a circle, not on the axis.
    inside: (i, j) => {
      if (opts.core === undefined) return add(origin, mul(d, (profile[i][1] + profile[i + 1][1]) / 2));
      const a = ((j + 0.5) / segs) * Math.PI * 2;
      return add(origin, add(mul(d, opts.coreT ?? 0), add(mul(u, Math.cos(a) * opts.core), mul(w, Math.sin(a) * opts.core))));
    },
  });
}

/** A flat disc facing `axis`. */
export function disc(c: V3, axis: V3, r: number, m: Material, segs = 24): Mesh {
  const d = norm(axis);
  const [u, w] = frame(d);
  const ring: V3[] = [];
  for (let k = 0; k < segs; k++) {
    const a = (k / segs) * Math.PI * 2;
    ring.push(add(c, add(mul(u, Math.cos(a) * r), mul(w, Math.sin(a) * r))));
  }
  return cap(ring, m, d);
}

/** An ellipsoid. */
export function blob(c: V3, r: V3, m: Material, segs = 14): Mesh {
  const rows: V3[][] = [];
  const st = Math.max(6, Math.round(segs / 2));
  for (let i = 0; i <= st; i++) {
    const ph = -Math.PI / 2 + (i / st) * Math.PI;
    const row: V3[] = [];
    for (let k = 0; k < segs; k++) {
      const t = (k / segs) * Math.PI * 2;
      row.push([c[0] + r[0] * Math.cos(ph) * Math.cos(t), c[1] + r[1] * Math.cos(ph) * Math.sin(t), c[2] + r[2] * Math.sin(ph)]);
    }
    rows.push(row);
  }
  return grid(rows, m, { wrap: true, inside: () => c });
}

/** A box (flat faces) from its centre and half sizes, optionally turned about y (pitch). */
export function box(c: V3, h: V3, m: Material, pitch = 0): Mesh {
  const cs = Math.cos(pitch), sn = Math.sin(pitch);
  const P = (x: number, y: number, z: number): V3 => [c[0] + x * cs - z * sn, c[1] + y, c[2] + x * sn + z * cs];
  const mesh = new Mesh();
  const faces: Array<[V3, V3, V3, V3]> = [];
  const [a, b, e] = h;
  faces.push([P(a, -b, -e), P(a, b, -e), P(a, b, e), P(a, -b, e)]);
  faces.push([P(-a, b, -e), P(-a, -b, -e), P(-a, -b, e), P(-a, b, e)]);
  faces.push([P(-a, b, -e), P(a, b, -e), P(a, b, e), P(-a, b, e)].reverse() as [V3, V3, V3, V3]);
  faces.push([P(-a, -b, -e), P(a, -b, -e), P(a, -b, e), P(-a, -b, e)]);
  faces.push([P(-a, -b, e), P(a, -b, e), P(a, b, e), P(-a, b, e)]);
  faces.push([P(-a, -b, -e), P(-a, b, -e), P(a, b, -e), P(a, -b, -e)]);
  for (const f of faces) {
    const fc = mul(add(add(f[0], f[1]), add(f[2], f[3])), 0.25);
    let n = norm(cross(sub(f[1], f[0]), sub(f[2], f[0])));
    if (dot(n, sub(fc, c)) < 0) n = mul(n, -1);
    const vt = (p: V3): Vert => ({ p, n, u: 0, v: 0 });
    const tri = (x: V3, y: V3, z: V3) => {
      const g = cross(sub(y, x), sub(z, x));
      if (dot(g, n) >= 0) mesh.push(vt(x), vt(y), vt(z), m);
      else mesh.push(vt(x), vt(z), vt(y), m);
    };
    tri(f[0], f[1], f[2]);
    tri(f[0], f[2], f[3]);
  }
  return mesh;
}

/** Catmull-Rom through (s, value) knots, sampled at s. */
export function curve(knots: Array<[number, number]>, s: number): number {
  if (s <= knots[0][0]) return knots[0][1];
  const n = knots.length;
  if (s >= knots[n - 1][0]) return knots[n - 1][1];
  let i = 0;
  while (i < n - 2 && s > knots[i + 1][0]) i++;
  const p0 = knots[Math.max(0, i - 1)], p1 = knots[i], p2 = knots[i + 1], p3 = knots[Math.min(n - 1, i + 2)];
  const t = (s - p1[0]) / (p2[0] - p1[0] || 1);
  // Tangents scaled to the knot spacing (no overshoot on uneven spacing), then damped a little.
  const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0] || 1)) * (p2[0] - p1[0]) * 0.8;
  const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0] || 1)) * (p2[0] - p1[0]) * 0.8;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
}
/** Straight lines between (s, value) knots. */
export function linear(knots: Array<[number, number]>, s: number): number {
  if (s <= knots[0][0]) return knots[0][1];
  for (let i = 0; i < knots.length - 1; i++) {
    const [s0, v0] = knots[i], [s1, v1] = knots[i + 1];
    if (s <= s1) return v0 + (v1 - v0) * ((s - s0) / (s1 - s0 || 1));
  }
  return knots[knots.length - 1][1];
}
