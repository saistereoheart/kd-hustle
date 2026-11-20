// The four cars as 3D models, built from their real dimensions (length, width, height, wheelbase,
// wheel size). The body is one shell swept front to back through cross-sections that follow a
// side profile (bumper, bonnet, windscreen, roof, rear window, boot); windows, lamps, grille,
// number plates and door lines are painted onto it per pixel. Parody makes, no real badges.
import { M, hex, mat, mixc, scalec, type Frag, type Material, type RGB, type Surf } from './shading';
import { Mesh, blob, box, grid, lathe, disc, linear, loft, smooth, tube, type V3 } from './mesh';
import type { Model, ModelMeta } from './render';

export interface CarLook {
  paint: string;
  wheel: string;
  tip: 'stock' | 'sport' | 'racing' | 'straight';
}

type K = Array<[number, number]>;
interface CarSpec {
  L: number; // length
  hw: number; // half width
  wb: number; // wheelbase
  rr: number; // rear overhang
  wheelD: number;
  tyreW: number;
  /** Side profile from the rear (s = 0) to the front (s = L): roof / bonnet / boot line, underside, belt line. */
  top: K;
  bot: K;
  belt: K;
  sB: number; // B-pillar
  windscreen: [number, number];
  rearGlass: [number, number];
  hatch?: boolean;
  /** Headlamps: inner edge (|y|), height, how far they wrap back round the corner. */
  head: { inner: number; h: number; wrap: number; slim?: boolean };
  grille: { w: number; z0: number; z1: number; chromeBar?: boolean; big?: boolean };
  tail: { inner: number; h: number; wrap: number; z0?: number; z1?: number; bar?: boolean };
  plateF: number;
  plateR: number;
  spokes: number;
  spokeW: number;
  twinSpokes?: boolean;
  blackPillars?: boolean;
  fin?: boolean;
  spoiler?: boolean;
}

const SPECS: Record<string, CarSpec> = {
  // Proton Saga-ish: 4331 × 1689 × 1491 mm, wheelbase 2465, 185/55 R15. Three-box sedan.
  car_sega: {
    L: 4.331, hw: 0.845, wb: 2.465, rr: 1.006, wheelD: 0.585, tyreW: 0.185,
    top: [[0, 0.72], [0.03, 0.86], [0.08, 0.96], [0.2, 1.02], [0.5, 1.045], [0.66, 1.055], [1.0, 1.27], [1.3, 1.44], [1.45, 1.478], [1.8, 1.491], [2.3, 1.485], [2.5, 1.455], [2.62, 1.41], [3.22, 1.0], [3.3, 0.985], [3.8, 0.94], [4.1, 0.88], [4.25, 0.8], [4.31, 0.72], [4.331, 0.62]],
    bot: [[0, 0.4], [0.15, 0.34], [0.45, 0.25], [0.7, 0.19], [1.6, 0.17], [3.2, 0.17], [3.75, 0.2], [4.05, 0.25], [4.25, 0.3], [4.331, 0.34]],
    belt: [[0, 1.02], [0.66, 1.06], [1.3, 1.05], [2.2, 1.02], [3.24, 0.99], [4.331, 0.9]],
    sB: 2.02, windscreen: [2.6, 3.23], rearGlass: [0.68, 1.36],
    head: { inner: 0.42, h: 0.12, wrap: 0.34 }, grille: { w: 0.4, z0: 0.43, z1: 0.6, chromeBar: true },
    tail: { inner: 0.36, h: 0.15, wrap: 0.22 }, plateF: 0.36, plateR: 0.47,
    spokes: 5, spokeW: 0.3,
  },
  // Perodua Bezza-ish: 4150 × 1620 × 1515, wheelbase 2500, 175/65 R14. Short nose, tall cabin, stubby boot.
  car_bezzo: {
    L: 4.15, hw: 0.81, wb: 2.5, rr: 0.92, wheelD: 0.583, tyreW: 0.175,
    top: [[0, 0.74], [0.03, 0.88], [0.08, 0.98], [0.2, 1.04], [0.45, 1.07], [0.58, 1.08], [0.92, 1.3], [1.2, 1.47], [1.35, 1.505], [1.7, 1.515], [2.25, 1.51], [2.45, 1.48], [2.58, 1.43], [3.2, 1.02], [3.28, 1.0], [3.7, 0.95], [3.95, 0.89], [4.08, 0.8], [4.13, 0.72], [4.15, 0.62]],
    bot: [[0, 0.41], [0.15, 0.34], [0.42, 0.25], [0.65, 0.19], [1.5, 0.17], [3.2, 0.17], [3.6, 0.2], [3.9, 0.26], [4.15, 0.34]],
    belt: [[0, 1.04], [0.58, 1.09], [1.3, 1.08], [3.2, 1.0], [4.15, 0.9]],
    sB: 1.98, windscreen: [2.55, 3.19], rearGlass: [0.6, 1.2],
    head: { inner: 0.36, h: 0.13, wrap: 0.3 }, grille: { w: 0.34, z0: 0.44, z1: 0.58 },
    tail: { inner: 0.34, h: 0.16, wrap: 0.2 }, plateF: 0.36, plateR: 0.48,
    spokes: 8, spokeW: 0.24,
  },
  // Perodua Myvi-ish: 3895 × 1735 × 1515, wheelbase 2500, 185/55 R15. Five-door hatchback.
  car_mivy: {
    L: 3.895, hw: 0.867, wb: 2.5, rr: 0.615, wheelD: 0.6, tyreW: 0.185,
    top: [[0, 0.62], [0.02, 0.8], [0.05, 0.97], [0.09, 1.12], [0.14, 1.3], [0.2, 1.42], [0.28, 1.49], [0.5, 1.515], [1.4, 1.51], [1.8, 1.49], [2.0, 1.45], [2.12, 1.39], [2.85, 0.99], [2.95, 0.97], [3.4, 0.92], [3.7, 0.85], [3.84, 0.74], [3.895, 0.62]],
    bot: [[0, 0.42], [0.1, 0.33], [0.3, 0.22], [0.5, 0.18], [3.0, 0.18], [3.4, 0.21], [3.7, 0.27], [3.895, 0.35]],
    belt: [[0, 1.06], [0.3, 1.07], [1.0, 1.04], [2.9, 0.98], [3.895, 0.9]],
    sB: 1.42, windscreen: [2.08, 2.88], rearGlass: [0.1, 0.27], hatch: true,
    head: { inner: 0.4, h: 0.13, wrap: 0.36 }, grille: { w: 0.36, z0: 0.38, z1: 0.56 },
    tail: { inner: 0.52, h: 0.3, wrap: 0.14, z0: 0.82, z1: 1.14 }, plateF: 0.33, plateR: 0.6,
    spokes: 5, spokeW: 0.18, twinSpokes: true, blackPillars: true, spoiler: true,
  },
  // Proton S70-ish: 4545 × 1798 × 1470, wheelbase 2627, 215/45 R17. Low fastback sedan, light bar.
  car_s7o: {
    L: 4.545, hw: 0.899, wb: 2.627, rr: 0.998, wheelD: 0.64, tyreW: 0.215,
    top: [[0, 0.76], [0.03, 0.9], [0.08, 0.99], [0.2, 1.04], [0.38, 1.05], [0.5, 1.06], [0.9, 1.22], [1.3, 1.4], [1.6, 1.462], [1.95, 1.47], [2.35, 1.462], [2.55, 1.43], [2.7, 1.37], [3.38, 0.97], [3.45, 0.955], [3.95, 0.9], [4.3, 0.84], [4.47, 0.76], [4.53, 0.68], [4.545, 0.6]],
    bot: [[0, 0.42], [0.15, 0.34], [0.45, 0.24], [0.75, 0.17], [3.6, 0.16], [3.95, 0.19], [4.3, 0.25], [4.545, 0.3]],
    belt: [[0, 1.04], [0.5, 1.07], [1.5, 1.04], [3.4, 0.97], [4.545, 0.86]],
    sB: 2.1, windscreen: [2.66, 3.37], rearGlass: [0.52, 1.58],
    head: { inner: 0.46, h: 0.07, wrap: 0.42, slim: true }, grille: { w: 0.52, z0: 0.32, z1: 0.6, big: true },
    tail: { inner: 0.5, h: 0.1, wrap: 0.3, bar: true }, plateF: 0.24, plateR: 0.5,
    spokes: 10, spokeW: 0.16, fin: true,
  },
};

export const CAR_IDS = Object.keys(SPECS);
export const carLength = (id: string) => (SPECS[id] ?? SPECS.car_sega).L;
export const carWidth = (id: string) => (SPECS[id] ?? SPECS.car_sega).hw * 2;

const STEP = 0.005;
/** Side profile lookups (sampled once, smoothed a touch so the corners are rounded). */
function tables(sp: CarSpec) {
  const n = Math.ceil(sp.L / STEP) + 1;
  const raw = (k: K) => Array.from({ length: n }, (_, i) => linear(k, i * STEP));
  const soft = (a: number[], r: number) =>
    a.map((_, i) => {
      let s = 0, c = 0;
      for (let d = -r; d <= r; d++) {
        const j = Math.min(n - 1, Math.max(0, i + d));
        s += a[j];
        c++;
      }
      return s / c;
    });
  const top = soft(raw(sp.top), 6);
  const bot = soft(raw(sp.bot), 8);
  const belt = soft(raw(sp.belt), 8);
  const at = (a: number[], s: number) => {
    const f = Math.min(n - 1, Math.max(0, s / STEP));
    const i = Math.floor(f), t = f - i;
    return i >= n - 1 ? a[n - 1] : a[i] * (1 - t) + a[i + 1] * t;
  };
  return { top: (s: number) => at(top, s), bot: (s: number) => at(bot, s), belt: (s: number) => at(belt, s) };
}

/** Half width in plan (the corners are rounded). */
function planHalf(sp: CarSpec, s: number) {
  const dF = sp.L - s, dR = s;
  const r = (d: number, rc: number, end: number) => (d >= rc ? 1 : end + (1 - end) * Math.sqrt(1 - (1 - d / rc) ** 2));
  return sp.hw * Math.min(r(dF, 0.42, 0.8), r(dR, 0.3, 0.84));
}

/** The cross-section at s: left half from the bottom middle up to the roof middle (11 points). */
function section(sp: CarSpec, T: ReturnType<typeof tables>, s: number): Array<[number, number]> {
  const w = planHalf(sp, s);
  const zb = T.bot(s), t = T.top(s), b0 = T.belt(s);
  const b = Math.min(t, b0);
  const g = Math.max(0, t - b0);
  const tum = 0.2 * smooth(0, 0.3, g) * (w / sp.hw);
  const crown = 0.035;
  const gy = w * 0.965 - 0.06;
  const q: Array<[number, number]> = [
    [0, zb],
    [w * 0.9, zb],
    [w * 0.985, zb + 0.07],
    [w, zb + (b - zb) * 0.42],
    [w * 0.995, b - 0.1],
    [w * 0.975, b - 0.025],
    [gy, b],
    [gy - tum * 0.5, b + g * 0.55],
    [gy - tum, b + g - 0.03 * smooth(0, 0.2, g)],
    [(gy - tum) * 0.55, b + g + crown * 0.75],
    [0, b + g + crown],
  ];
  // Near the very ends the shell pulls in so the bumper corners round off.
  return q;
}

export function rimMat(cx: number, cz: number, rr: number, rim: RGB, spokes: number, sw: number, twin: boolean): Material {
  const disc: RGB = [0.42, 0.43, 0.45];
  return mat('metal', rim, {
    pattern: (f: Frag, s: Surf) => {
      const dx = f.p[0] - cx, dz = f.p[2] - cz;
      const r = Math.hypot(dx, dz) / rr;
      const a = Math.atan2(dz, dx);
      if (r > 0.9) {
        s.color = scalec(rim, 1.08);
        return;
      }
      if (r < 0.2) {
        s.color = r < 0.09 ? scalec(rim, 0.6) : rim;
        if (r > 0.12 && r < 0.17 && Math.cos(a * 5) > 0.85) s.color = [0.15, 0.15, 0.16];
        return;
      }
      const k = twin ? spokes * 2 : spokes;
      let ph = ((a / (Math.PI * 2)) * spokes) % 1;
      if (ph < 0) ph += 1;
      let on: boolean;
      if (twin) {
        const d1 = Math.abs(ph - 0.38), d2 = Math.abs(ph - 0.62);
        on = Math.min(d1, d2) < (sw / 2) * (1.15 - 0.35 * r);
      } else on = Math.abs(ph - 0.5) < (sw / 2) * (1.2 - 0.45 * r) + (k > 8 ? 0 : 0.02);
      if (on) {
        // A shaded edge on the spokes gives them depth.
        s.color = mixc(rim, scalec(rim, 0.7), smooth(0.3, 0.85, r) * 0.4);
        return;
      }
      // Between the spokes: the brake disc, and the dark inside of the wheel.
      s.kind = 'metal';
      s.color = r < 0.78 ? disc : [0.1, 0.1, 0.11];
      if (r > 0.42 && r < 0.62 && Math.cos(a - 0.6) > 0.93) {
        s.kind = 'plastic';
        s.color = [0.62, 0.1, 0.1]; // caliper
      }
    },
  });
}

/** One wheel (tyre + rim) on the left side, centred at (x, y, z); its face looks out (+y). */
function wheel(x: number, y: number, R: number, tw: number, rim: RGB, sp: CarSpec): Mesh {
  const rRim = R * 0.66;
  const o: V3 = [x, y, R];
  const prof: Array<[number, number]> = [
    [rRim, -tw / 2 + 0.01],
    [R - 0.05, -tw / 2],
    [R - 0.012, -tw / 2 + 0.018],
    [R, -tw / 2 + 0.045],
    [R, tw / 2 - 0.045],
    [R - 0.012, tw / 2 - 0.018],
    [R - 0.05, tw / 2],
    [rRim + 0.012, tw / 2 - 0.004],
  ];
  const m = new Mesh();
  // Tyre (a closed ring: faces turned away from the middle of the rubber).
  m.add(lathe(o, [0, 1, 0], prof, M.tyre, 28, { core: (rRim + R) / 2 }));
  m.add(lathe(o, [0, 1, 0], [[rRim + 0.012, tw / 2 - 0.004], [rRim, tw / 2 - 0.02]], mat('metal', '#3d4247', { twoSided: true }), 28));
  m.add(disc([x, y + tw / 2 - 0.02, R], [0, 1, 0], rRim + 0.001, rimMat(x, R, rRim, rim, sp.spokes, sp.spokeW, !!sp.twinSpokes), 28));
  return m;
}

/** A dark arch liner over a wheel (inside the shell). */
function liner(x: number, R: number, y0: number, y1: number): Mesh {
  const rows: V3[][] = [];
  const r = R + 0.07;
  for (let k = 0; k <= 12; k++) {
    const a = (k / 12) * Math.PI;
    rows.push([[x + Math.cos(a) * r, y0, R + Math.sin(a) * r], [x + Math.cos(a) * r, y1, R + Math.sin(a) * r]]);
  }
  return grid(rows, mat('plastic', '#121315', { twoSided: true }), { inside: () => [x, (y0 + y1) / 2, R] });
}

/** Black plate, white characters (Malaysian style). (a, b) run 0..1 across and up the plate. */
export function plate(a: number, b: number, s: Surf) {
  s.kind = 'plastic';
  s.color = [0.06, 0.06, 0.07];
  if (a < 0.04 || a > 0.96 || b < 0.1 || b > 0.9) {
    s.color = [0.75, 0.76, 0.78];
    return;
  }
  // "WKD 2026" as blocky glyphs.
  const cells = 8;
  const c = Math.floor(a * cells);
  const fx = a * cells - c;
  if (c === 3) return;
  const fy = (b - 0.24) / 0.52;
  if (fx < 0.18 || fx > 0.82 || fy < 0 || fy > 1) return;
  const bits = [0b101111101, 0b111101111, 0b110111011, 0, 0b111011110, 0b111101111, 0b111011110, 0b110111111][c];
  const gx = Math.min(2, Math.floor(((fx - 0.18) / 0.64) * 3)), gy = Math.min(2, Math.floor(fy * 3));
  if ((bits >> (gy * 3 + gx)) & 1) s.color = [0.92, 0.93, 0.95];
}

/** Size, seats and rear wheels from the spec alone (instant: no mesh). */
export function carMeta(id: string): ModelMeta {
  const sp = SPECS[id] ?? SPECS.car_sega;
  const off = sp.rr + sp.wb / 2;
  const wy = sp.hw - 0.035 - sp.tyreW / 2;
  const sb = sp.sB;
  const rb = sp.hatch ? sp.rearGlass[1] + 0.3 : sp.rearGlass[1] + 0.12;
  const top = Math.max(...sp.top.map((k) => k[1]));
  return {
    // Exhaust tips poke out at the back, mirrors at the sides, a fin / spoiler on top.
    box: { x0: -off - 0.08, x1: sp.L - off + 0.03, hw: sp.hw + 0.17, h: top + 0.1 },
    seats: [
      [sb + 0.25 - off, -0.36, 0.95],
      [sb + 0.25 - off, 0.36, 0.95],
      [rb + 0.25 - off, 0.36, 0.95],
      [rb + 0.25 - off, -0.36, 0.95],
    ],
    wheels: [[sp.rr - off, wy, 0], [sp.rr - off, -wy, 0]],
  };
}

export function buildCar(id: string, look: CarLook): Model {
  const sp = SPECS[id] ?? SPECS.car_sega;
  const T = tables(sp);
  const paint = hex(look.paint);
  const off = sp.rr + sp.wb / 2; // model x = s − off
  const R = sp.wheelD / 2;
  const axR = sp.rr, axF = sp.rr + sp.wb;
  const rh = Array.from({ length: Math.ceil(sp.L / 0.01) + 1 }, (_, i) => section(sp, T, i * 0.01)[8][0]);
  const roofHalf = (s: number) => rh[Math.max(0, Math.min(rh.length - 1, Math.round(s / 0.01)))];

  // ---------------------------------------------------------------- windows
  /** 0 paint, 1 glass, 2 black trim. */
  const windowAt = (s: number, ay: number, z: number, v: number): number => {
    const t = T.top(s), b = T.belt(s);
    if (t - b < 0.04 || z < b - 0.005) return 0;
    if (v < 7.9) {
      // Side windows: under the roof, behind the windscreen pillar, in front of the rear pillar.
      const lim = Math.min(T.top(s + 0.11), T.top(s - 0.14), t) - 0.055;
      const low = b + 0.035;
      const m = Math.min(z - low, lim - z, Math.abs(s - sp.sB) - 0.05, s - sp.rearGlass[0] - 0.12);
      if (m > 0.022) return 1;
      if (m > -0.004 || sp.blackPillars) return 2;
      return 0;
    }
    const [w0, w1] = sp.windscreen, [r0, r1] = sp.rearGlass;
    const half = roofHalf(s);
    for (const [a, c] of [[w0, w1], [r0, r1]]) {
      const m = Math.min(s - a - 0.03, c - s - 0.02, half - ay - 0.05);
      if (m > 0.03) return 1;
      if (m > 0) return 2;
    }
    return 0;
  };

  // ---------------------------------------------------------------- body details
  const sDF = axF - R - 0.12, sDR = axR + R + 0.1;
  const body = (f: Frag, s: Surf): boolean | void => {
    const S = f.p[0] + off, ay = Math.abs(f.p[1]), z = f.p[2];
    // Wheel arches: holes in the sides over the wheels.
    for (const ax of [axR, axF]) {
      const d = Math.hypot(S - ax, z - R);
      if (d < R + 0.065 && ay > planHalf(sp, S) - 0.2 && z < R * 2.2) return false;
      if (d < R + 0.085 && ay > planHalf(sp, S) - 0.2 && !f.back) s.color = scalec(paint, 0.55);
    }
    if (f.back) return;
    const w = windowAt(S, ay, z, f.v);
    if (w === 1) return false; // the glass shell draws this bit
    if (w === 2) {
      s.kind = 'plastic';
      s.color = [0.05, 0.055, 0.06];
      return;
    }
    const t = T.top(S), zb = T.bot(S), b = T.belt(S);
    const hwS = planHalf(sp, S);
    const dF = sp.L - S, dR = S;
    // ---- front
    if (dF < 0.5) {
      const h = sp.head;
      const k = (ay - h.inner) / (sp.hw - h.inner);
      const ztop = t - 0.012, zlow = t - h.h - k * 0.03;
      if (k > 0 && z < ztop && z > zlow && dF < 0.03 + h.wrap * k) {
        s.kind = 'lamp';
        const lz = (z - zlow) / (ztop - zlow);
        if (h.slim) s.color = lz > 0.55 ? [1, 1, 1] : [0.72, 0.8, 0.88];
        else {
          const cx = h.inner + (sp.hw - h.inner) * 0.35;
          const bulb = Math.hypot((ay - cx) / 0.06, (lz - 0.5) / 0.5) < 1;
          s.color = bulb ? [1, 0.98, 0.9] : [0.78, 0.82, 0.86];
          if (lz > 0.82) s.color = [0.1, 0.1, 0.12];
        }
        s.glow = 0.12;
        return;
      }
      const g = sp.grille;
      if (dF < 0.07 && ay < g.w && z > g.z0 && z < g.z1) {
        s.kind = 'plastic';
        if (g.chromeBar && z > g.z1 - 0.035) {
          s.kind = 'chrome';
          s.color = [0.95, 0.95, 0.95];
          return;
        }
        const cell = g.big ? 0.045 : 0.03;
        const gy = ((z - g.z0) / cell) % 1, gx = ((ay + (Math.floor((z - g.z0) / cell) % 2) * cell * 0.5) / cell) % 1;
        s.color = gy < 0.22 || gx < 0.22 ? [0.2, 0.21, 0.23] : [0.04, 0.04, 0.05];
        if (g.big && ay > g.w - 0.02) s.color = [0.6, 0.62, 0.65];
        return;
      }
      if (dF < 0.06 && ay < 0.25 && z > sp.plateF && z < sp.plateF + 0.1) {
        plate((f.p[1] + 0.25) / 0.5, (z - sp.plateF) / 0.1, s);
        return;
      }
      if (dF < 0.08 && ay < hwS * 0.62 && z > zb + 0.03 && z < zb + 0.12) {
        s.kind = 'plastic';
        s.color = [0.05, 0.05, 0.06];
        return;
      }
    }
    // ---- rear
    if (dR < 0.45) {
      const tl = sp.tail;
      const k = (ay - tl.inner) / (sp.hw - tl.inner);
      let lamp = false;
      if (tl.z0 !== undefined && tl.z1 !== undefined) lamp = k > 0 && dR < 0.04 + tl.wrap * k && z > tl.z0 && z < tl.z1;
      else lamp = k > 0 && z < t - 0.012 && z > t - tl.h && dR < 0.03 + tl.wrap * k;
      if (tl.bar && dR < 0.07 && z < t - 0.02 && z > t - 0.055) lamp = true;
      if (lamp) {
        s.kind = 'lamp';
        const inner = (z - (t - tl.h)) / tl.h;
        s.color = inner > 0.35 && inner < 0.65 && k > 0.2 && k < 0.75 ? [1, 0.55, 0.5] : [0.85, 0.08, 0.1];
        s.glow = 0.1;
        return;
      }
      if (dR < 0.06 && ay < 0.25 && z > sp.plateR && z < sp.plateR + 0.1) {
        plate((0.25 - f.p[1]) / 0.5, (z - sp.plateR) / 0.1, s);
        return;
      }
      if (dR < 0.08 && z < zb + 0.09) {
        s.kind = 'plastic';
        s.color = [0.07, 0.07, 0.08];
        return;
      }
    }
    // ---- sides (below the belt)
    if (f.v > 1.5 && f.v < 6.1 && Math.abs(f.nm[1]) > 0.35) {
      if (z < zb + 0.075) {
        s.kind = 'plastic';
        s.color = scalec(paint, 0.35);
        return;
      }
      for (const seam of sp.hatch ? [sDF, sp.sB - 0.03, sDR] : [sDF, sp.sB - 0.03, sDR]) {
        if (Math.abs(S - seam) < 0.007 && z < b + 0.005) {
          s.color = scalec(paint, 0.4);
          return;
        }
      }
      for (const hx of [sp.sB + 0.22, sDR + 0.14]) {
        if (Math.abs(S - hx) < 0.065 && Math.abs(z - (b - 0.1)) < 0.017) {
          s.kind = 'chrome';
          s.color = mixc(paint, [1, 1, 1], 0.6);
          return;
        }
      }
      // A character line catching the light.
      const cl = b - 0.17 + 0.03 * (S / sp.L);
      if (Math.abs(z - cl) < 0.008) s.color = mixc(paint, [1, 1, 1], 0.22);
      else if (z < cl && z > cl - 0.03) s.color = scalec(paint, 0.9);
    }
  };
  const bodyMat = mat('paint', paint, { twoSided: true, inner: [0.16, 0.17, 0.19], pattern: body });
  const glassMat: Material = {
    ...M.glass,
    pattern: (f: Frag) => {
      const S = f.p[0] + off;
      return windowAt(S, Math.abs(f.p[1]), f.p[2], f.v) === 1;
    },
  };

  // ---------------------------------------------------------------- shell
  const stations: Array<{ x: number; ring: Array<[number, number]> }> = [];
  const glassStations: typeof stations = [];
  const N = Math.round(sp.L / 0.04);
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * sp.L;
    const half = section(sp, T, s);
    // Full ring: left half bottom → top, then the right half top → bottom (no repeats).
    const ring: Array<[number, number]> = [...half.map(([y, z]) => [y, z] as [number, number])];
    for (let j = half.length - 2; j >= 1; j--) ring.push([-half[j][0], half[j][1]]);
    stations.push({ x: s - off, ring });
    if (s > sp.rearGlass[0] - 0.1 && s < sp.windscreen[1] + 0.1) glassStations.push({ x: s - off, ring: ring.map(([y, z]) => [y * 0.997, z - 0.002]) });
  }
  const vOf = (j: number) => (j <= 10 ? j : 20 - j);
  const mesh = new Mesh();
  mesh.add(loft(stations, bodyMat, { v: vOf }));
  mesh.add(loft(glassStations, glassMat, { v: vOf, caps: false }));

  // ---------------------------------------------------------------- wheels & arches
  const rim = hex(look.wheel);
  const wy = sp.hw - 0.035 - sp.tyreW / 2;
  for (const ax of [axR, axF]) {
    const left = new Mesh().add(wheel(ax - off, wy, R, sp.tyreW, rim, sp), liner(ax - off, R, sp.hw - 0.32, sp.hw - 0.02));
    mesh.add(left, left.mirrored());
  }

  // ---------------------------------------------------------------- mirrors, cabin, extras
  const cowl = sp.windscreen[1];
  const bC = T.belt(cowl - 0.15);
  // Door mirrors: a body-coloured shell on a short black arm, the glass facing back.
  const mx = cowl - 0.2 - off, my = sp.hw + 0.05, mz = bC + 0.1;
  const mir = new Mesh().add(
    blob([mx, my, mz], [0.06, 0.1, 0.06], mat('paint', paint), 12),
    box([mx - 0.055, my, mz], [0.006, 0.085, 0.045], mat('chrome', '#9fb3c4')),
    tube([[mx + 0.03, sp.hw - 0.1, bC + 0.03], [mx + 0.01, my - 0.06, mz - 0.02]], 0.018, M.black, 6),
  );
  mesh.add(mir, mir.mirrored());
  const seat = mat('cloth', '#3b3d42');
  const sb = sp.sB;
  const fSeat = new Mesh().add(
    box([sb + 0.32 - off, 0.36, 0.52], [0.24, 0.22, 0.06], seat),
    box([sb + 0.06 - off, 0.36, 0.86], [0.06, 0.22, 0.3], seat, -0.2),
    box([sb - 0.01 - off, 0.36, 1.22], [0.05, 0.13, 0.08], seat),
  );
  mesh.add(fSeat, fSeat.mirrored());
  const rb = sp.hatch ? sp.rearGlass[1] + 0.3 : sp.rearGlass[1] + 0.12;
  mesh.add(box([rb + 0.3 - off, 0, 0.5], [0.22, sp.hw - 0.16, 0.06], seat), box([rb + 0.04 - off, 0, 0.82], [0.06, sp.hw - 0.16, 0.28], seat, -0.25));
  mesh.add(box([cowl - 0.42 - off, 0, bC - 0.1], [0.2, sp.hw - 0.1, 0.12], mat('plastic', '#24262a')));
  // Steering wheel on the right (Malaysia drives on the left).
  const sw: V3[] = [];
  for (let k = 0; k <= 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    sw.push([cowl - 0.62 - off + Math.sin(a) * 0.05, -0.37 + Math.cos(a) * 0.17, bC + 0.02 + Math.sin(a) * 0.15]);
  }
  mesh.add(tube(sw, 0.018, M.black, 6, false));
  if (sp.fin) mesh.add(blob([sp.rearGlass[1] + 0.05 - off, 0, T.top(sp.rearGlass[1] + 0.05) + 0.03], [0.09, 0.025, 0.04], mat('paint', paint)));
  if (sp.spoiler) {
    const sz = T.top(0.3);
    mesh.add(box([0.27 - off, 0, sz + 0.015], [0.08, sp.hw * 0.8, 0.018], mat('paint', paint), 0.18));
  }

  // ---------------------------------------------------------------- exhaust
  const tipMat = look.tip === 'straight' ? mat('metal', '#a5794a') : look.tip === 'racing' ? mat('metal', '#2b2d31') : look.tip === 'sport' ? M.chrome : M.steel;
  const tipR = look.tip === 'stock' ? 0.025 : look.tip === 'sport' ? 0.04 : look.tip === 'racing' ? 0.055 : 0.032;
  const tipZ = T.bot(0.05) - 0.02;
  const pipe = (y: number) => {
    const m = new Mesh().add(tube([[0.25 - off, y, tipZ + 0.02], [-0.04 - off, y, tipZ]], tipR, tipMat, 12));
    m.add(disc([-0.041 - off, y, tipZ], [-1, 0, 0], tipR * 0.75, mat('matte', '#0b0b0c'), 12));
    return m;
  };
  mesh.add(pipe(sp.hw * 0.55));
  if (look.tip === 'sport' || look.tip === 'racing') mesh.add(pipe(-sp.hw * 0.55));

  // ---------------------------------------------------------------- shadow & seats
  const hl = sp.L / 2, hwid = sp.hw;
  const shadow = (x: number, y: number) => {
    const dx = Math.max(0, Math.abs(x) - (hl - 0.25)), dy = Math.max(0, Math.abs(y) - (hwid - 0.2));
    const d = Math.hypot(dx, dy);
    let a = 0.42 * (1 - smooth(0.05, 0.42, d));
    for (const ax of [axR - off, axF - off]) {
      for (const yy of [wy, -wy]) {
        const c = Math.hypot((x - ax) / 0.3, (y - yy) / 0.12);
        if (c < 1) a = Math.max(a, 0.62 * (1 - c * c));
      }
    }
    return a;
  };
  return { mesh, shadow, ...carMeta(id) };
}
