// How each surface catches the light: car paint with a clear-coat reflection of the sky, tinted
// glass, chrome, rubber, plastic and lamps. A soft "sky above, road below" environment gives the
// curved panels their highlights; colours are pushed a little brighter for the cartoon town.
import type { V3 } from './mesh';

export type RGB = [number, number, number];
export type Kind = 'paint' | 'glass' | 'chrome' | 'metal' | 'rubber' | 'plastic' | 'lamp' | 'matte' | 'cloth';

/** What a pixel is: its model-space point, its (world) normal, its uv, and whether it's a back face. */
export interface Frag {
  p: V3;
  /** World normal (lighting) and model normal (which way the panel faces on the vehicle). */
  n: V3;
  nm: V3;
  u: number;
  v: number;
  back: boolean;
}
export interface Surf {
  kind: Kind;
  color: RGB;
  alpha: number;
  glow: number;
}
export interface Material {
  kind: Kind;
  color: RGB;
  alpha?: number;
  /** Drawn from inside too (a body shell you can see into through the windows). */
  twoSided?: boolean;
  /** Colour of the inside of a two-sided shell. */
  inner?: RGB;
  /** Per-pixel details (lamps, grilles, liveries, spokes). Return false to cut a hole. */
  pattern?: (f: Frag, s: Surf) => boolean | void;
}

export function hex(h: string): RGB {
  const m = /^#([0-9a-f]{6})$/i.exec(h.trim());
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255) as RGB;
  const r = /rgba?\(([^)]+)\)/.exec(h);
  if (r) return r[1].split(',').slice(0, 3).map((x) => Number(x) / 255) as RGB;
  return [0.6, 0.6, 0.6];
}
export const mat = (kind: Kind, color: RGB | string, more: Partial<Material> = {}): Material => ({
  kind,
  color: typeof color === 'string' ? hex(color) : color,
  ...more,
});
export const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scalec = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

/** The camera looks down at 40° (matches the town's ¾ view). */
export const ELEV = (40 * Math.PI) / 180;
/** Towards the camera, and towards the sun (upper left, a little in front), in world space. */
export const VIEW: V3 = [0, -Math.cos(ELEV), Math.sin(ELEV)];
const L0: V3 = [-0.5, -0.45, 0.75];
const LL = Math.hypot(...L0);
export const LIGHT: V3 = [L0[0] / LL, L0[1] / LL, L0[2] / LL];

const SKY_TOP: RGB = [0.42, 0.6, 0.86];
const SKY_LOW: RGB = [0.92, 0.95, 0.98];
const GROUND_NEAR: RGB = [0.36, 0.35, 0.33];
const GROUND_FAR: RGB = [0.2, 0.2, 0.2];

/** The sky (above the horizon) and the road (below) seen in a reflection. */
function env(r: V3): RGB {
  if (r[2] >= 0) {
    const t = Math.sqrt(Math.min(1, r[2] * 1.4));
    return mixc(SKY_LOW, SKY_TOP, t);
  }
  return mixc(GROUND_NEAR, GROUND_FAR, Math.min(1, -r[2] * 2.5));
}

const pow = Math.pow;
/** Cel shading (icons): light in flat bands and crisp highlights, like a cartoon. */
let toon = false;
export function setToon(on: boolean) {
  toon = on;
}
/** The lit colour (0..1, may go over 1 before clamping) and alpha of a surface. */
export function light(s: Surf, n: V3, out: number[]): void {
  const [nx, ny, nz] = n;
  let ndl = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
  const ndv = Math.max(0, nx * VIEW[0] + ny * VIEW[1] + nz * VIEW[2]);
  // Reflection of the view ray.
  const r: V3 = [2 * ndv * nx - VIEW[0], 2 * ndv * ny - VIEW[1], 2 * ndv * nz - VIEW[2]];
  let rdl = Math.max(0, r[0] * LIGHT[0] + r[1] * LIGHT[1] + r[2] * LIGHT[2]);
  if (toon) {
    ndl = ndl > 0.5 ? 0.95 : ndl > 0.12 ? 0.55 : 0.2;
    rdl = rdl > 0.975 ? 1 : 0;
    if (r[2] > 0) r[2] = r[2] > 0.35 ? 0.8 : 0.15; // two flat sky bands in reflections
  }
  const amb = 0.42 + 0.2 * (nz * 0.5 + 0.5);
  const c = s.color;
  const fres = pow(1 - ndv, 4);
  let k: RGB;
  let a = s.alpha;
  switch (s.kind) {
    case 'paint': {
      const e = env(r);
      const refl = 0.07 + 0.42 * fres;
      const sp = pow(rdl, 50) * 0.75 + pow(rdl, 8) * 0.06;
      const d = amb + 0.62 * ndl;
      k = [c[0] * d * (1 - refl) + e[0] * refl + sp, c[1] * d * (1 - refl) + e[1] * refl + sp, c[2] * d * (1 - refl) + e[2] * refl + sp];
      break;
    }
    case 'glass': {
      const e = env(r);
      const refl = 0.3 + 0.55 * fres;
      const sp = pow(rdl, 90) * 1.1;
      k = [c[0] * (1 - refl) + e[0] * refl + sp, c[1] * (1 - refl) + e[1] * refl + sp, c[2] * (1 - refl) + e[2] * refl + sp];
      a = Math.min(1, a + 0.35 * fres + sp);
      break;
    }
    case 'chrome': {
      const e = env(r);
      const sp = pow(rdl, 40) * 1.2;
      // A crisp horizon line makes chrome read as chrome.
      const hz = Math.abs(r[2]) < 0.06 ? 0.25 : 0;
      k = [e[0] * c[0] * 0.95 + 0.05 * ndl + sp + hz, e[1] * c[1] * 0.95 + 0.05 * ndl + sp + hz, e[2] * c[2] * 0.95 + 0.05 * ndl + sp + hz];
      break;
    }
    case 'metal': {
      const e = env(r);
      const d = amb + 0.55 * ndl;
      const sp = pow(rdl, 30) * 0.55;
      k = [c[0] * (d * 0.65 + e[0] * 0.4) + sp, c[1] * (d * 0.65 + e[1] * 0.4) + sp, c[2] * (d * 0.65 + e[2] * 0.4) + sp];
      break;
    }
    case 'rubber': {
      const d = amb * 0.9 + 0.5 * ndl;
      const sp = pow(rdl, 6) * 0.05;
      k = [c[0] * d + sp, c[1] * d + sp, c[2] * d + sp];
      break;
    }
    case 'plastic': {
      const e = env(r);
      const d = amb + 0.55 * ndl;
      const sp = pow(rdl, 30) * 0.3;
      const refl = 0.05 + 0.2 * fres;
      k = [c[0] * d + e[0] * refl + sp, c[1] * d + e[1] * refl + sp, c[2] * d + e[2] * refl + sp];
      break;
    }
    case 'cloth': {
      const d = amb + 0.45 * ndl;
      k = [c[0] * d, c[1] * d, c[2] * d];
      break;
    }
    case 'lamp': {
      const e = env(r);
      const sp = pow(rdl, 60) * 1.0;
      k = [c[0] * (0.75 + 0.3 * ndl) + e[0] * 0.18 + sp, c[1] * (0.75 + 0.3 * ndl) + e[1] * 0.18 + sp, c[2] * (0.75 + 0.3 * ndl) + e[2] * 0.18 + sp];
      break;
    }
    default: {
      const d = amb + 0.6 * ndl;
      k = [c[0] * d, c[1] * d, c[2] * d];
    }
  }
  if (s.glow) k = [k[0] + c[0] * s.glow, k[1] + c[1] * s.glow, k[2] + c[2] * s.glow];
  out[0] = k[0];
  out[1] = k[1];
  out[2] = k[2];
  out[3] = a;
}

// Shared materials.
export const M = {
  tyre: mat('rubber', '#1f2023'),
  black: mat('plastic', '#1d1f22'),
  trim: mat('plastic', '#141518'),
  grey: mat('plastic', '#3a3d42'),
  chrome: mat('chrome', '#ffffff'),
  steel: mat('metal', '#9aa1a8'),
  darkMetal: mat('metal', '#3d4247'),
  seat: mat('cloth', '#2a2b2e'),
  leather: mat('cloth', '#26201c'),
  interior: mat('cloth', '#2b2d31', { twoSided: true }),
  glass: mat('glass', [0.07, 0.1, 0.13], { alpha: 0.62, twoSided: true }),
  clearGlass: mat('glass', [0.55, 0.68, 0.78], { alpha: 0.28, twoSided: true }),
  head: mat('lamp', '#fff8e1'),
  red: mat('lamp', '#e3262d'),
  amber: mat('lamp', '#ff9f1c'),
};
