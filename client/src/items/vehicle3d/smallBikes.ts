// The everyday rides as 3D models, like the showroom bikes: the starter basikal (a city bike with a
// front basket) and the kapcai (a 110 cc underbone moped: step-through frame, leg shield, rear
// rack), which the green Ronda ride-hailing bikes use too (with a top box). Parody, no badges.
import { M, hex, mat, scalec, type Frag, type RGB, type Surf } from './shading';
import { Mesh, blob, box, disc, lathe, smooth, tube, type V3 } from './mesh';
import { body, can, fender, rad, tipMat } from './bikeParts';
import { plate, type CarLook } from './cars';
import type { Model, ModelMeta } from './render';

export const SMALL_IDS = ['bicycle', 'motorbike', 'ronda'] as const;
export const isSmallBike = (id: string) => (SMALL_IDS as readonly string[]).includes(id);

/** Their factory colours (they're not in the showroom, so the garage has no look for them). */
export const SMALL_LOOKS: Record<string, CarLook> = {
  bicycle: { paint: '#0ca678', wheel: '#ced4da', tip: 'stock' },
  motorbike: { paint: '#e03131', wheel: '#adb5bd', tip: 'stock' },
  ronda: { paint: '#2f9e44', wheel: '#adb5bd', tip: 'stock' },
};

/** A thin-tyred spoked wheel you can see through (bicycle). */
function wireWheel(x: number, R: number, tw: number, rim: RGB, spokes: number): Mesh {
  const m = new Mesh();
  const rimR = R - tw * 0.9;
  const prof: Array<[number, number]> = [[rimR, -tw / 2 + 0.006]];
  for (let k = 0; k <= 8; k++) {
    const a = -Math.PI / 2 + (k / 8) * Math.PI;
    prof.push([R - tw * 0.5 + Math.cos(a) * tw * 0.5, Math.sin(a) * tw * 0.5]);
  }
  prof.push([rimR, tw / 2 - 0.006]);
  m.add(lathe([x, 0, R], [0, 1, 0], prof, M.tyre, 28, { core: (rimR + R) / 2 }));
  const spokeMat = mat('metal', rim, {
    twoSided: true,
    pattern: (f: Frag, s: Surf) => {
      const dx = f.p[0] - x, dz = f.p[2] - R;
      const r = Math.hypot(dx, dz) / rimR;
      if (r > 0.9) {
        s.color = scalec(rim, 0.95); // the rim
        return;
      }
      if (r < 0.1) {
        s.color = scalec(rim, 0.7); // the hub
        return;
      }
      const a = Math.atan2(dz, dx);
      let ph = ((a / (Math.PI * 2)) * spokes) % 1;
      if (ph < 0) ph += 1;
      if (Math.abs(ph - 0.5) < 0.09 * (1.1 - r * 0.5)) return;
      return false; // between the spokes: see-through
    },
  });
  m.add(disc([x, 0, R], [0, 1, 0], rimR + 0.002, spokeMat, 28));
  return m;
}

// ------------------------------------------------------------------ basikal
/** A 26" city bike: wheelbase 1.05 m, saddle ~0.92 m, upright bars, a front basket. */
function bicycle(look: CarLook): Model {
  const paint = hex(look.paint);
  const rim = hex(look.wheel);
  const R = 0.33, xf = 0.53, xr = -0.52;
  const mesh = new Mesh();
  mesh.add(wireWheel(xf, R, 0.045, rim, 14));
  mesh.add(wireWheel(xr, R, 0.045, rim, 14));
  const F = mat('paint', paint);
  const bb: V3 = [0.02, 0, 0.3]; // bottom bracket
  const seatTop: V3 = [-0.18, 0, 0.82];
  const head: V3 = [0.42, 0, 0.84];
  const headLow: V3 = [0.45, 0, 0.66];
  // Frame: a step-through (the down tube sweeps low), seat tube, stays.
  mesh.add(tube([head, headLow], 0.024, F, 10));
  mesh.add(tube([headLow, [0.3, 0, 0.5], [0.12, 0, 0.36], bb], 0.022, F, 10));
  mesh.add(tube([bb, seatTop], 0.02, F, 10));
  for (const y of [0.04, -0.04]) {
    mesh.add(tube([bb, [xr, y, R]], 0.012, F, 6));
    mesh.add(tube([[seatTop[0] + 0.02, y * 0.5, seatTop[2] - 0.06], [xr, y, R]], 0.011, F, 6));
  }
  // Fork, stem, swept-back bars with grips.
  for (const y of [0.035, -0.035]) mesh.add(tube([[headLow[0], y, headLow[2]], [xf, y, R]], 0.012, M.steel, 6));
  mesh.add(tube([head, [head[0] - 0.02, 0, 1.0]], 0.014, M.steel, 6));
  for (const sgn of [1, -1]) {
    mesh.add(tube([[head[0] - 0.02, 0, 1.0], [head[0] - 0.02, sgn * 0.16, 1.02], [head[0] - 0.14, sgn * 0.27, 1.02]], 0.011, M.steel, 6));
    mesh.add(tube([[head[0] - 0.14, sgn * 0.27, 1.02], [head[0] - 0.22, sgn * 0.29, 1.02]], 0.017, M.tyre, 6));
  }
  // Saddle on its post.
  mesh.add(tube([seatTop, [-0.2, 0, 0.92]], 0.011, M.steel, 6));
  mesh.add(body([[-0.08, 0.9, 0.95, 0.03], [-0.16, 0.89, 0.96, 0.06], [-0.27, 0.9, 0.97, 0.1], [-0.32, 0.91, 0.96, 0.09]], mat('cloth', '#3d2b1f'), 3, 12));
  // Mudguards, chain guard, pedals.
  mesh.add(fender(xf, R, 0.035, 20, 150, F, 0.01));
  mesh.add(fender(xr, R, 0.035, 30, 170, F, 0.01));
  mesh.add(body([[0.08, 0.27, 0.36, 0.008], [-0.2, 0.28, 0.35, 0.008], [-0.45, 0.3, 0.36, 0.008]], M.black, 3, 8));
  for (const sgn of [1, -1]) {
    const pa: V3 = [bb[0] + sgn * 0.12, sgn * 0.08, bb[2] - sgn * 0.08];
    mesh.add(tube([[bb[0], sgn * 0.05, bb[2]], pa], 0.01, M.steel, 5));
    mesh.add(box([pa[0], sgn * 0.11, pa[2]], [0.04, 0.035, 0.008], M.black));
  }
  // The front basket (wicker) on the bars, and a bell.
  const wicker = mat('cloth', '#b5835a', {
    pattern: (f, s) => {
      const k = Math.sin(f.p[0] * 160) * Math.sin(f.p[2] * 160 + f.p[1] * 160);
      if (k > 0.3) s.color = [0.55, 0.38, 0.24];
    },
  });
  mesh.add(box([0.58, 0, 0.9], [0.13, 0.17, 0.1], wicker));
  mesh.add(box([0.58, 0, 0.995], [0.115, 0.155, 0.006], mat('cloth', '#5c3d24')));
  mesh.add(blob([head[0] - 0.1, 0.14, 1.04], [0.018, 0.018, 0.014], M.chrome, 8));
  // A little red reflector at the back.
  mesh.add(box([xr - 0.12, 0, 0.6], [0.01, 0.03, 0.015], M.red));
  const shadow = (x: number, y: number) => {
    const e = Math.hypot(x / 0.95, y / 0.2);
    let a = 0.32 * (1 - smooth(0.6, 1.05, e));
    for (const ax of [xf, xr]) {
      const c = Math.hypot((x - ax) / 0.2, y / 0.05);
      if (c < 1) a = Math.max(a, 0.5 * (1 - c * c));
    }
    return a;
  };
  return { mesh, shadow, ...smallMeta('bicycle') };
}

// ------------------------------------------------------------------ kapcai
/** A 110 cc underbone (the classic kapcai): wheelbase 1.23 m, 70/90-17 + 80/90-17, seat 0.76 m. */
function kapcai(look: CarLook, ronda: boolean): Model {
  const paint = hex(look.paint);
  const rim = hex(look.wheel);
  const R = 0.29, xf = 0.615, xr = -0.615;
  const rk = rad(26.5);
  const headZ = 0.92;
  const topX = xf - ((headZ - R) / Math.cos(rk)) * Math.sin(rk);
  const mesh = new Mesh();
  const P = mat('paint', paint);
  const dark = mat('plastic', '#25272b');
  // Wheels: alloy rims with a drum at the back, a small disc at the front.
  mesh.add(wheelSmall(xf, R, 0.075, rim, true));
  mesh.add(wheelSmall(xr, R, 0.085, rim, false));
  // Front fork and fender.
  for (const y of [0.075, -0.075]) {
    const mid: V3 = [xf - 0.28 * Math.sin(rk), y, R + 0.28 * Math.cos(rk)];
    mesh.add(tube([[xf + 0.01, y, R - 0.03], mid], 0.024, M.steel, 8));
    mesh.add(tube([mid, [topX, y, headZ - 0.06]], 0.02, M.chrome, 8));
  }
  mesh.add(fender(xf, R, 0.06, 35, 150, P, 0.015));
  // The handlebar cowl with its headlamp, and the bars.
  const cowl = mat('paint', paint, {
    pattern: (f, s) => {
      const [x, y, z] = f.p;
      if (x > topX + 0.08 && f.nm[0] > 0.3 && Math.abs(y) < 0.1 && Math.abs(z - (headZ + 0.02)) < 0.045) {
        s.kind = 'lamp';
        s.color = [1, 0.98, 0.9];
        s.glow = 0.15;
      } else if (z < headZ - 0.03) s.color = [0.14, 0.14, 0.15];
    },
  });
  mesh.add(body([[topX + 0.16, headZ - 0.05, headZ + 0.05, 0.05], [topX + 0.1, headZ - 0.08, headZ + 0.09, 0.11], [topX - 0.02, headZ - 0.08, headZ + 0.1, 0.13], [topX - 0.12, headZ - 0.04, headZ + 0.08, 0.1]], cowl, 2.3, 16));
  for (const sgn of [1, -1]) {
    mesh.add(tube([[topX - 0.06, sgn * 0.12, headZ + 0.05], [topX - 0.12, sgn * 0.33, headZ + 0.07]], 0.016, M.tyre, 6));
    mesh.add(tube([[topX - 0.04, sgn * 0.15, headZ + 0.09], [topX - 0.05, sgn * 0.2, headZ + 0.23]], 0.006, M.black, 4));
    mesh.add(blob([topX - 0.05, sgn * 0.21, headZ + 0.24], [0.02, 0.04, 0.025], M.black, 8));
    // Indicators on the cowl.
    mesh.add(blob([topX + 0.06, sgn * 0.12, headZ - 0.01], [0.025, 0.02, 0.016], M.amber, 8));
  }
  // The leg shield (the kapcai's big front panel) and the step-through backbone.
  const shield = mat('paint', paint, { pattern: (f, s) => (f.nm[0] < -0.3 ? void (s.color = [0.13, 0.13, 0.14]) : undefined) });
  mesh.add(body([[topX + 0.02, 0.3, headZ - 0.06, 0.07], [topX - 0.06, 0.24, headZ - 0.1, 0.17], [topX - 0.14, 0.22, headZ - 0.18, 0.19], [topX - 0.2, 0.24, 0.6, 0.15]], shield, 2.6, 18));
  mesh.add(body([[topX - 0.18, 0.24, 0.42, 0.08], [0.05, 0.26, 0.4, 0.09], [-0.12, 0.28, 0.48, 0.1]], dark, 2.6, 14)); // the floor/backbone cover
  // Engine (a horizontal single under the floor) and the kick lever.
  mesh.add(body([[0.18, 0.12, 0.3, 0.08], [0.02, 0.1, 0.34, 0.12], [-0.16, 0.14, 0.38, 0.12]], mat('metal', '#5a5f66'), 3, 14));
  mesh.add(disc([0.02, 0.125, 0.22], [0, 1, 0], 0.08, mat('metal', '#7a8088'), 18));
  // The body under the seat (side covers), the seat, the tail with its lamp.
  const S = 0.76;
  const side = mat('paint', paint, {
    pattern: (f, s) => {
      const [x, , z] = f.p;
      // A white pinstripe along the side covers (the classic kapcai look).
      if (Math.abs(f.nm[1]) > 0.4 && Math.abs(z - (0.56 + (x + 0.2) * 0.25)) < 0.012) s.color = [0.95, 0.95, 0.95];
      if (x < xr - 0.08 && f.nm[0] < -0.2 && z > S - 0.12) {
        s.kind = 'lamp';
        s.color = [0.9, 0.08, 0.1];
        s.glow = 0.12;
      }
    },
  });
  mesh.add(body([[-0.08, 0.42, S - 0.04, 0.1], [-0.3, 0.44, S - 0.03, 0.13], [-0.55, 0.5, S - 0.02, 0.12], [xr - 0.02, 0.56, S - 0.03, 0.09], [xr - 0.12, 0.6, S - 0.05, 0.06]], side, 2.4, 16));
  mesh.add(body([[-0.02, S - 0.04, S + 0.04, 0.1], [-0.16, S - 0.04, S + 0.07, 0.13], [-0.42, S - 0.04, S + 0.07, 0.13], [-0.66, S - 0.05, S + 0.05, 0.1]], mat('cloth', '#1f2023'), 3, 14));
  // Rear fender + plate, swingarm, shocks, rack / grab rail.
  mesh.add(fender(xr, R, 0.06, 95, 175, dark, 0.015));
  const pm = mat('plastic', '#111', { pattern: (f, s) => plate((0.08 - f.p[1]) / 0.16, (f.p[2] - 0.44) / 0.1, s) });
  mesh.add(box([xr - 0.2, 0, 0.49], [0.006, 0.08, 0.05], pm));
  for (const y of [0.09, -0.09]) {
    mesh.add(tube([[-0.06, y, 0.3], [xr, y, R]], 0.022, M.darkMetal, 8));
    mesh.add(tube([[xr + 0.06, y, R + 0.02], [xr + 0.14, y * 1.15, S - 0.06]], 0.02, mat('metal', '#c92a2a'), 8));
  }
  mesh.add(tube([[-0.5, 0.13, S + 0.02], [xr - 0.08, 0.12, S + 0.03], [xr - 0.08, -0.12, S + 0.03], [-0.5, -0.13, S + 0.02]], 0.013, M.black, 6));
  // Pegs.
  for (const sgn of [1, -1]) mesh.add(tube([[-0.28, sgn * 0.1, 0.3], [-0.3, sgn * 0.2, 0.3]], 0.012, M.steel, 5));
  // The exhaust along the visible side (left), with a heat shield.
  const tm = tipMat(look.tip);
  mesh.add(tube([[0.2, 0.06, 0.16], [0.08, 0.14, 0.12], [-0.12, 0.15, 0.17]], 0.018, mat('metal', '#8a9097'), 8));
  mesh.add(can([-0.1, 0.15, 0.17], [-0.5, 0.17, 0.27], look.tip === 'sport' || look.tip === 'racing' ? 0.05 : 0.042, look.tip === 'stock' ? M.chrome : tm));
  if (ronda) {
    // Ronda: a top box on the rack, in the company green with a white stripe.
    const boxM = mat('paint', '#2b8a3e', { pattern: (f, s) => (Math.abs(f.p[2] - 1.0) < 0.022 ? void (s.color = [0.97, 0.97, 0.97]) : undefined) });
    mesh.add(body([[xr + 0.06, S + 0.04, S + 0.36, 0.17], [xr - 0.06, S + 0.04, S + 0.38, 0.19], [xr - 0.2, S + 0.04, S + 0.35, 0.17]], boxM, 3.5, 16));
  }
  const shadow = (x: number, y: number) => {
    const e = Math.hypot(x / 1.0, y / 0.24);
    let a = 0.38 * (1 - smooth(0.6, 1.05, e));
    for (const ax of [xf, xr]) {
      const c = Math.hypot((x - ax) / 0.22, y / 0.07);
      if (c < 1) a = Math.max(a, 0.6 * (1 - c * c));
    }
    return a;
  };
  return { mesh, shadow, ...smallMeta(ronda ? 'ronda' : 'motorbike') };
}

/** A kapcai wheel: a narrow tyre, 5-spoke alloy rim (and a little disc up front). */
function wheelSmall(x: number, R: number, tw: number, rim: RGB, front: boolean): Mesh {
  const m = new Mesh();
  const rimR = R * 0.7;
  const prof: Array<[number, number]> = [[rimR, -tw / 2 + 0.008]];
  for (let k = 0; k <= 8; k++) {
    const a = -Math.PI / 2 + (k / 8) * Math.PI;
    prof.push([R - tw * 0.5 + Math.cos(a) * tw * 0.5, Math.sin(a) * tw * 0.5]);
  }
  prof.push([rimR, tw / 2 - 0.008]);
  m.add(lathe([x, 0, R], [0, 1, 0], prof, M.tyre, 26, { core: (rimR + R) / 2 }));
  const rm = mat('metal', rim, {
    pattern: (f: Frag, s: Surf) => {
      const dx = f.p[0] - x, dz = f.p[2] - R;
      const r = Math.hypot(dx, dz) / rimR;
      if (r > 0.88 || r < 0.22) return;
      let ph = ((Math.atan2(dz, dx) / (Math.PI * 2)) * 5) % 1;
      if (ph < 0) ph += 1;
      if (Math.abs(ph - 0.5) < 0.1) return;
      s.color = front && r < 0.62 ? [0.6, 0.62, 0.64] : [0.12, 0.12, 0.13];
    },
  });
  for (const sgn of [1, -1]) m.add(disc([x, sgn * (tw / 2 - 0.006), R], [0, sgn, 0], rimR + 0.002, rm, 24));
  return m;
}

// ------------------------------------------------------------------ meta
/** Size, seats and the rear wheel (no mesh). Seat 0 rides / drives, seat 1 is the pillion. */
export function smallMeta(id: string): ModelMeta {
  if (id === 'bicycle') return { box: { x0: -0.9, x1: 0.92, hw: 0.32, h: 1.1 }, seats: [[-0.2, 0, 0.9]], wheels: [[-0.52, 0, 0]] };
  return { box: { x0: -0.98, x1: 0.95, hw: 0.36, h: 1.25 }, seats: [[-0.14, 0, 0.8], [-0.46, 0, 0.84]], wheels: [[-0.615, 0, 0]] };
}

export function buildSmall(id: string, look: CarLook): Model {
  return id === 'bicycle' ? bicycle(look) : kapcai(look, id === 'ronda');
}
