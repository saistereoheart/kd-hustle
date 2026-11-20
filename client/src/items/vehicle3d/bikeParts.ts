// Parts shared by the bike models (bikes.ts: the big bikes; smallBikes.ts: the basikal and kapcai).
import { M, mat, type Frag, type Material, type RGB, type Surf } from './shading';
import { Mesh, disc, grid, lathe, loft, superRing, tube, box, type Station, type V3 } from './mesh';
import { rimMat, type CarLook } from './cars';

export const rad = (d: number) => (d * Math.PI) / 180;

/** Stations (x, bottom z, top z, half width) → a rounded solid. */
export function body(st: Array<[number, number, number, number]>, m: Material, e = 2.6, n = 18): Mesh {
  const stations: Station[] = st.map(([x, zb, zt, hw]) => ({ x, ring: superRing(n, 0, (zb + zt) / 2, Math.max(0.004, hw), Math.max(0.004, (zt - zb) / 2), e) }));
  return loft(stations, m);
}

/** A bike wheel at (x, 0, R): tyre, rim faces both sides, optional brake discs. */
export function wheel(x: number, R: number, tw: number, rim: RGB, spokes: number, sw: number, discs: 0 | 1 | 2, rimR = R * 0.72): Mesh {
  const o: V3 = [x, 0, R];
  const m = new Mesh();
  // A rounded motorcycle tyre (round crown).
  const prof: Array<[number, number]> = [[rimR, -tw / 2 + 0.012]];
  for (let k = 0; k <= 8; k++) {
    const a = -Math.PI / 2 + (k / 8) * Math.PI;
    prof.push([R - tw * 0.5 + Math.cos(a) * tw * 0.5, Math.sin(a) * tw * 0.5]);
  }
  prof.push([rimR, tw / 2 - 0.012]);
  m.add(lathe(o, [0, 1, 0], prof, M.tyre, 28, { core: (rimR + R) / 2 }));
  const rm = rimMat(x, R, rimR, rim, spokes, sw, false);
  m.add(disc([x, tw / 2 - 0.01, R], [0, 1, 0], rimR + 0.002, rm, 28));
  m.add(disc([x, -tw / 2 + 0.01, R], [0, -1, 0], rimR + 0.002, rm, 28));
  const discMat = mat('metal', '#b8bec4', {
    pattern: (f: Frag, s: Surf) => {
      const r = Math.hypot(f.p[0] - x, f.p[2] - R);
      if (r < 0.1) return false; // the carrier is open
      const a = Math.atan2(f.p[2] - R, f.p[0] - x);
      if (Math.cos(a * 14) > 0.7 && r > 0.115 && r < 0.14) s.color = [0.2, 0.2, 0.22];
    },
  });
  const sides = discs === 2 ? [1, -1] : discs === 1 ? [-1] : [];
  for (const sgn of sides) {
    m.add(disc([x, sgn * (tw / 2 + 0.012), R], [0, sgn, 0], 0.15, discMat, 24));
    m.add(box([x - 0.05, sgn * (tw / 2 + 0.03), R + 0.11], [0.05, 0.018, 0.03], mat('plastic', '#a61e1e'), 0.6));
  }
  return m;
}

/** A fender arching over a wheel from angle a0 to a1 (0 = forward, 90° = up). */
export function fender(x: number, R: number, half: number, a0: number, a1: number, m: Material, drop = 0.04): Mesh {
  const rows: V3[][] = [];
  const cols = 7;
  for (let k = 0; k <= 14; k++) {
    const a = rad(a0 + ((a1 - a0) * k) / 14);
    const row: V3[] = [];
    for (let c = 0; c <= cols; c++) {
      const t = c / cols * 2 - 1;
      const r = R + 0.06 - drop * t * t * 1.0;
      row.push([x + Math.cos(a) * r, t * half, R + Math.sin(a) * r]);
    }
    rows.push(row);
  }
  return grid(rows, { ...m, twoSided: true, inner: [0.12, 0.12, 0.13] }, { inside: () => [x, 0, R] });
}

export type Tip = CarLook['tip'];
export function tipMat(tip: Tip): Material {
  return tip === 'straight' ? mat('metal', '#a5794a') : tip === 'racing' ? mat('plastic', '#25272b') : tip === 'sport' ? M.chrome : mat('metal', '#5c636a');
}
/** An exhaust can along the path's last segment, with a dark mouth. */
export function can(a: V3, b: V3, r: number, m: Material): Mesh {
  const out = new Mesh().add(tube([a, b], [r * 0.85, r], m, 14));
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as V3;
  const l = Math.hypot(...d);
  out.add(disc([b[0] + (d[0] / l) * 0.002, b[1] + (d[1] / l) * 0.002, b[2] + (d[2] / l) * 0.002], d, r * 0.6, mat('matte', '#0b0b0c'), 14));
  return out;
}
