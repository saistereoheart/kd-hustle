// A small software renderer: the vehicle's triangles are turned to face the way it's going,
// projected the way the town camera sees things (from the south, 40° above the ground, no
// perspective), and drawn into a depth buffer with per-pixel lighting. Supersampled for smooth
// edges, with a soft ground shadow and a thin cartoon outline.
import type { Mesh, V3 } from './mesh';
import { ELEV, VIEW, light, setToon, type Frag, type Surf } from './shading';

/** What the game needs to know about a vehicle without building its 3D model: a box that holds
 *  it (model space: x from x0 to x1, |y| ≤ hw, z from 0 to h), its seats and its driven wheels. */
export interface ModelMeta {
  box: { x0: number; x1: number; hw: number; h: number };
  seats: V3[];
  wheels: V3[];
}

export interface Model {
  mesh: Mesh;
  /** Shadow darkness (0..1) on the ground at model point (x, y). */
  shadow: (x: number, y: number) => number;
  /** Where riders sit (model space): the seat(s), front first. */
  seats: V3[];
  /** Where the driven (rear) tyres touch the ground (model space): tyre smoke and marks. */
  wheels: V3[];
}

const SIN = Math.sin(ELEV), COS = Math.cos(ELEV);

/** Model point → screen offset (px, y down) from the origin, and depth (bigger = farther). */
export function project(p: V3, yaw: number, scale: number): [number, number, number] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const X = p[0] * c - p[1] * s, Y = p[0] * s + p[1] * c, Z = p[2];
  return [X * scale, -(Y * SIN + Z * COS) * scale, Y * COS - Z * SIN];
}

export interface RenderOpts {
  /** Output size in pixels and where the model's origin lands. */
  w: number;
  h: number;
  ox: number;
  oy: number;
  /** Pixels per metre. */
  scale: number;
  /** Supersampling (2 → 4 samples a pixel). */
  ss?: number;
  outline?: boolean;
  /** Cartoon look (icons): banded light and a bold outline. */
  toon?: boolean;
}

interface PT {
  x: number;
  y: number;
  z: number;
}

/** Draws the model heading `yaw` (radians; 0 = to the right, π/2 = away from the camera). RGBA out. */
export function renderModel(model: Model, yaw: number, o: RenderOpts): Uint8ClampedArray<ArrayBuffer> {
  const ss = Math.max(1, Math.round(o.ss ?? 2));
  setToon(!!o.toon);
  const W = o.w * ss, H = o.h * ss;
  const sc = o.scale * ss, ox = o.ox * ss, oy = o.oy * ss;
  const col = new Float32Array(W * H * 4);
  const cov = new Float32Array(W * H);
  const dep = new Float32Array(W * H).fill(Infinity);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);

  // Ground shadow (under everything).
  for (let py = 0; py < H; py++) {
    const Y = (oy - (py + 0.5)) / (sc * SIN);
    for (let px = 0; px < W; px++) {
      const X = (px + 0.5 - ox) / sc;
      const mx = X * cy + Y * sy, my = -X * sy + Y * cy;
      const a = model.shadow(mx, my);
      if (a > 0.002) col[(py * W + px) * 4 + 3] = a;
    }
  }

  const rot = (v: V3): V3 => [v[0] * cy - v[1] * sy, v[0] * sy + v[1] * cy, v[2]];
  const toScreen = (p: V3): PT => {
    const X = p[0] * cy - p[1] * sy, Y = p[0] * sy + p[1] * cy, Z = p[2];
    return { x: ox + X * sc, y: oy - (Y * SIN + Z * COS) * sc, z: Y * COS - Z * SIN };
  };
  const surf: Surf = { kind: 'paint', color: [0, 0, 0], alpha: 1, glow: 0 };
  const lit = [0, 0, 0, 1];
  const frag: Frag = { p: [0, 0, 0], n: [0, 0, 1], nm: [0, 0, 1], u: 0, v: 0, back: false };

  type Job = { t: Mesh['tris'][number]; s: [PT, PT, PT]; back: boolean; depth: number };
  const opaque: Job[] = [];
  const clear: Job[] = [];
  for (const t of model.mesh.tris) {
    const s: [PT, PT, PT] = [toScreen(t.a.p), toScreen(t.b.p), toScreen(t.c.p)];
    // Screen-space winding tells front from back (faces wound anticlockwise from outside come out
    // with a negative area, since screen y points down).
    const area = (s[1].x - s[0].x) * (s[2].y - s[0].y) - (s[2].x - s[0].x) * (s[1].y - s[0].y);
    if (Math.abs(area) < 1e-9) continue;
    const back = area > 0;
    if (back && !t.m.twoSided) continue;
    const job = { t, s, back, depth: (s[0].z + s[1].z + s[2].z) / 3 };
    if ((t.m.alpha ?? 1) < 1) clear.push(job);
    else opaque.push(job);
  }

  const draw = (job: Job, blend: boolean) => {
    const { t, s, back } = job;
    const m = t.m;
    const [A, B, C] = s;
    const x0 = Math.max(0, Math.floor(Math.min(A.x, B.x, C.x))), x1 = Math.min(W - 1, Math.ceil(Math.max(A.x, B.x, C.x)));
    const y0 = Math.max(0, Math.floor(Math.min(A.y, B.y, C.y))), y1 = Math.min(H - 1, Math.ceil(Math.max(A.y, B.y, C.y)));
    if (x0 > x1 || y0 > y1) return;
    const area = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
    const inv = 1 / area;
    const na = rot(t.a.n), nb = rot(t.b.n), nc = rot(t.c.n);
    const pa = t.a.p, pb = t.b.p, pc = t.c.p;
    const sgn = back ? -1 : 1;
    for (let py = y0; py <= y1; py++) {
      const fy = py + 0.5;
      for (let px = x0; px <= x1; px++) {
        const fx = px + 0.5;
        const w0 = ((B.x - fx) * (C.y - fy) - (C.x - fx) * (B.y - fy)) * inv;
        const w1 = ((C.x - fx) * (A.y - fy) - (A.x - fx) * (C.y - fy)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = A.z * w0 + B.z * w1 + C.z * w2;
        const i = py * W + px;
        if (z >= dep[i]) continue;
        const fp = frag.p;
        fp[0] = pa[0] * w0 + pb[0] * w1 + pc[0] * w2;
        fp[1] = pa[1] * w0 + pb[1] * w1 + pc[1] * w2;
        fp[2] = pa[2] * w0 + pb[2] * w1 + pc[2] * w2;
        let nx = (na[0] * w0 + nb[0] * w1 + nc[0] * w2) * sgn;
        let ny = (na[1] * w0 + nb[1] * w1 + nc[1] * w2) * sgn;
        let nz = (na[2] * w0 + nb[2] * w1 + nc[2] * w2) * sgn;
        let l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        // Smooth normals can tip away from the camera right at the silhouette: lift them back.
        const dv = nx * VIEW[0] + ny * VIEW[1] + nz * VIEW[2];
        if (dv < 0.05) {
          const k = 0.05 - dv;
          nx += VIEW[0] * k;
          ny += VIEW[1] * k;
          nz += VIEW[2] * k;
          l = Math.hypot(nx, ny, nz) || 1;
          nx /= l;
          ny /= l;
          nz /= l;
        }
        const fn = frag.n, fm = frag.nm;
        fn[0] = nx;
        fn[1] = ny;
        fn[2] = nz;
        // Model-space normal (undo the turn).
        fm[0] = nx * cy + ny * sy;
        fm[1] = -nx * sy + ny * cy;
        fm[2] = nz;
        frag.u = t.a.u * w0 + t.b.u * w1 + t.c.u * w2;
        frag.v = t.a.v * w0 + t.b.v * w1 + t.c.v * w2;
        frag.back = back;
        surf.kind = m.kind;
        surf.color = m.color;
        surf.alpha = m.alpha ?? 1;
        surf.glow = 0;
        if (back && m.inner) {
          surf.kind = 'cloth';
          surf.color = m.inner;
        }
        if (m.pattern && m.pattern(frag, surf) === false) continue;
        light(surf, frag.n, lit);
        const j = i * 4;
        if (blend) {
          const a = lit[3];
          col[j] = col[j] * (1 - a) + lit[0] * a;
          col[j + 1] = col[j + 1] * (1 - a) + lit[1] * a;
          col[j + 2] = col[j + 2] * (1 - a) + lit[2] * a;
          col[j + 3] = col[j + 3] + a * (1 - col[j + 3]);
          cov[i] = Math.max(cov[i], a);
        } else {
          col[j] = lit[0];
          col[j + 1] = lit[1];
          col[j + 2] = lit[2];
          col[j + 3] = 1;
          cov[i] = 1;
          dep[i] = z;
        }
      }
    }
  };
  try {
    for (const j of opaque) draw(j, false);
    clear.sort((a, b) => b.depth - a.depth);
    for (const j of clear) draw(j, true);
  } finally {
    setToon(false);
  }

  // Ink lines where the depth jumps (one part in front of another), like a cartoon.
  if (o.outline !== false) {
    const jump = o.toon ? 0.12 : 0.22;
    const ink = new Uint8Array(W * H);
    for (let py = 1; py < H - 1; py++) {
      for (let px = 1; px < W - 1; px++) {
        const i = py * W + px;
        const d = dep[i];
        if (d === Infinity) continue;
        const r = dep[i + 1], b = dep[i + W];
        if ((r !== Infinity && r - d > jump) || (b !== Infinity && b - d > jump) || (dep[i - 1] !== Infinity && dep[i - 1] - d > jump) || (dep[i - W] !== Infinity && dep[i - W] - d > jump)) ink[i] = 1;
      }
    }
    for (let i = 0; i < W * H; i++) {
      if (!ink[i]) continue;
      col[i * 4] *= 0.55;
      col[i * 4 + 1] *= 0.55;
      col[i * 4 + 2] *= 0.55;
    }
  }

  // Down to the output size (premultiplied average), then a thin dark outline round the vehicle.
  const out = new Uint8ClampedArray(o.w * o.h * 4);
  const cv = new Float32Array(o.w * o.h);
  const acc = new Float32Array(o.w * o.h * 4);
  const n2 = ss * ss;
  for (let y = 0; y < o.h; y++) {
    for (let x = 0; x < o.w; x++) {
      let r = 0, g = 0, b = 0, a = 0, c = 0;
      for (let dy = 0; dy < ss; dy++) {
        for (let dx = 0; dx < ss; dx++) {
          const i = (y * ss + dy) * W + x * ss + dx;
          // The buffer is premultiplied (a shadow pixel is black with some alpha).
          r += col[i * 4];
          g += col[i * 4 + 1];
          b += col[i * 4 + 2];
          a += col[i * 4 + 3];
          c += cov[i];
        }
      }
      const k = (y * o.w + x) * 4;
      acc[k] = r / n2;
      acc[k + 1] = g / n2;
      acc[k + 2] = b / n2;
      acc[k + 3] = a / n2;
      cv[y * o.w + x] = c / n2;
    }
  }
  // A toon outline is two pixels thick: spread the coverage once before the edge test.
  if (o.toon) {
    const grown = new Float32Array(cv);
    for (let y = 0; y < o.h; y++) {
      for (let x = 0; x < o.w; x++) {
        const i = y * o.w + x;
        let m = cv[i];
        if (x > 0) m = Math.max(m, cv[i - 1]);
        if (x < o.w - 1) m = Math.max(m, cv[i + 1]);
        if (y > 0) m = Math.max(m, cv[i - o.w]);
        if (y < o.h - 1) m = Math.max(m, cv[i + o.w]);
        grown[i] = m;
      }
    }
    for (let i = 0; i < cv.length; i++) {
      const extra = grown[i] - cv[i];
      if (extra <= 0) continue;
      const k = i * 4;
      acc[k] = acc[k] * (1 - extra) + 0.09 * extra;
      acc[k + 1] = acc[k + 1] * (1 - extra) + 0.09 * extra;
      acc[k + 2] = acc[k + 2] * (1 - extra) + 0.1 * extra;
      acc[k + 3] = acc[k + 3] + extra * (1 - acc[k + 3]);
      cv[i] = grown[i];
    }
  }
  for (let y = 0; y < o.h; y++) {
    for (let x = 0; x < o.w; x++) {
      const i = y * o.w + x;
      let r = acc[i * 4], g = acc[i * 4 + 1], b = acc[i * 4 + 2], a = acc[i * 4 + 3];
      if (o.outline !== false) {
        let mx = 0;
        if (x > 0) mx = Math.max(mx, cv[i - 1]);
        if (x < o.w - 1) mx = Math.max(mx, cv[i + 1]);
        if (y > 0) mx = Math.max(mx, cv[i - o.w]);
        if (y < o.h - 1) mx = Math.max(mx, cv[i + o.w]);
        const oa = Math.max(0, mx - cv[i]) * 0.75;
        if (oa > 0) {
          const ink = 0.09;
          r = r * (1 - oa) + ink * oa;
          g = g * (1 - oa) + ink * oa;
          b = b * (1 - oa) + ink * 1.1 * oa;
          a = a + oa * (1 - a);
        }
      }
      if (a > 0) {
        out[i * 4] = Math.round(Math.min(1, r / a) * 255);
        out[i * 4 + 1] = Math.round(Math.min(1, g / a) * 255);
        out[i * 4 + 2] = Math.round(Math.min(1, b / a) * 255);
        out[i * 4 + 3] = Math.round(Math.min(1, a) * 255);
      }
    }
  }
  return out;
}
