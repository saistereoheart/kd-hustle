// The four big bikes as 3D models, from their real dimensions (wheelbase, wheel sizes, rake, seat
// height): three fully-faired sportbikes and a chrome touring cruiser. Parody makes, no badges.
// The exhaust sits on the LEFT (the side the side view shows), so its tip is always visible.
import { M, hex, mat, mixc, scalec, type Frag, type Material, type RGB, type Surf } from './shading';
import { Mesh, blob, box, disc, grid, lathe, loft, smooth, superRing, tube, type Station, type V3 } from './mesh';
import { plate, rimMat, type CarLook } from './cars';
import type { Model } from './render';

const rad = (d: number) => (d * Math.PI) / 180;

/** Stations (x, bottom z, top z, half width) → a rounded solid. */
function body(st: Array<[number, number, number, number]>, m: Material, e = 2.6, n = 18): Mesh {
  const stations: Station[] = st.map(([x, zb, zt, hw]) => ({ x, ring: superRing(n, 0, (zb + zt) / 2, Math.max(0.004, hw), Math.max(0.004, (zt - zb) / 2), e) }));
  return loft(stations, m);
}

/** A bike wheel at (x, 0, R): tyre, rim faces both sides, optional brake discs. */
function wheel(x: number, R: number, tw: number, rim: RGB, spokes: number, sw: number, discs: 0 | 1 | 2, rimR = R * 0.72): Mesh {
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
function fender(x: number, R: number, half: number, a0: number, a1: number, m: Material, drop = 0.04): Mesh {
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

type Tip = CarLook['tip'];
function tipMat(tip: Tip): Material {
  return tip === 'straight' ? mat('metal', '#a5794a') : tip === 'racing' ? mat('plastic', '#25272b') : tip === 'sport' ? M.chrome : mat('metal', '#5c636a');
}
/** An exhaust can along the path's last segment, with a dark mouth. */
function can(a: V3, b: V3, r: number, m: Material): Mesh {
  const out = new Mesh().add(tube([a, b], [r * 0.85, r], m, 14));
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as V3;
  const l = Math.hypot(...d);
  out.add(disc([b[0] + (d[0] / l) * 0.002, b[1] + (d[1] / l) * 0.002, b[2] + (d[2] / l) * 0.002], d, r * 0.6, mat('matte', '#0b0b0c'), 14));
  return out;
}

// ------------------------------------------------------------------ sportbikes
interface Sport {
  wb: number;
  rf: number;
  rr: number;
  twF: number;
  twR: number;
  rake: number;
  headZ: number;
  seatZ: number;
  spokes: number;
  spokeW: number;
  single?: boolean;
  fork: string;
  livery: (f: Frag, s: Surf, paint: RGB) => void;
  tailUp: number; // how high the tail kicks up
}
const SPORT: Record<string, Sport> = {
  // Kawasaki ZX-25R-ish: wheelbase 1380, 110/70-17 + 150/60-17, seat 785, rake 24.3°.
  bike_zx25: {
    wb: 1.38, rf: 0.293, rr: 0.306, twF: 0.11, twR: 0.15, rake: 24.3, headZ: 0.86, seatZ: 0.785, spokes: 5, spokeW: 0.16, fork: '#c9cdd2', tailUp: 0,
    livery: (f, s) => {
      const [x, y, z] = f.p;
      if (Math.abs(y) < 0.08 && f.nm[2] > 0.5) return;
      if (z < 0.47 - 0.25 * (x - 0.3)) s.color = [0.08, 0.08, 0.09];
      const l1 = 0.6 + 0.28 * (x - 0.3);
      if (z > l1 && z < l1 + 0.045 && x > -0.05 && x < 0.8 && Math.abs(f.nm[1]) > 0.4) s.color = [0.08, 0.08, 0.09];
      if (z > l1 + 0.06 && z < l1 + 0.075 && x > 0.1 && x < 0.7 && Math.abs(f.nm[1]) > 0.4) s.color = [0.95, 0.95, 0.95];
    },
  },
  // A 500 cc inline-four middleweight: wheelbase 1400, 120/70-17 + 160/60-17, seat 795.
  bike_500rr: {
    wb: 1.4, rf: 0.3, rr: 0.31, twF: 0.12, twR: 0.16, rake: 24.5, headZ: 0.88, seatZ: 0.795, spokes: 6, spokeW: 0.14, fork: '#d9a520', tailUp: 0.02,
    livery: (f, s) => {
      const [x, , z] = f.p;
      const side = Math.abs(f.nm[1]) > 0.35;
      const blue: RGB = [0.1, 0.36, 0.78];
      if (z < 0.42 - 0.2 * (x - 0.3)) s.color = blue;
      const l1 = 0.62 + 0.32 * (x - 0.3);
      if (side && z > l1 && z < l1 + 0.06 && x > -0.2 && x < 0.85) s.color = blue;
      if (side && z > l1 - 0.03 && z < l1 - 0.012 && x > 0 && x < 0.7) s.color = [0.86, 0.12, 0.14];
    },
  },
  // Ducati Panigale V2-ish: wheelbase 1436, 120/70-17 + 180/60-17, seat 840, single-sided swingarm.
  bike_dukati: {
    wb: 1.436, rf: 0.3, rr: 0.324, twF: 0.12, twR: 0.18, rake: 24, headZ: 0.9, seatZ: 0.84, spokes: 3, spokeW: 0.2, single: true, fork: '#d9a520', tailUp: 0.05,
    livery: (f, s) => {
      const [x, , z] = f.p;
      if (z < 0.36 - 0.15 * (x - 0.3)) s.color = [0.17, 0.17, 0.19];
      const l1 = 0.66 + 0.2 * (x - 0.3);
      if (Math.abs(f.nm[1]) > 0.4 && z > l1 && z < l1 + 0.016 && x > -0.3 && x < 0.8) s.color = [0.97, 0.97, 0.97];
    },
  },
};

function sportbike(id: string, look: CarLook): Model {
  const b = SPORT[id] ?? SPORT.bike_zx25;
  const paint = hex(look.paint);
  const rim = hex(look.wheel);
  const xf = b.wb / 2, xr = -b.wb / 2;
  const rk = rad(b.rake);
  const fl = (b.headZ - b.rf) / Math.cos(rk);
  const topX = xf - fl * Math.sin(rk);
  const mesh = new Mesh();
  const S = b.seatZ, U = b.tailUp;

  // Wheels, forks, swingarm
  mesh.add(wheel(xf, b.rf, b.twF, rim, b.spokes, b.spokeW, 2));
  mesh.add(wheel(xr, b.rr, b.twR, rim, b.spokes, b.spokeW, 0));
  const forkM = mat('metal', b.fork);
  for (const y of [0.1, -0.1]) {
    const lowTop: V3 = [xf - 0.3 * Math.sin(rk), y, b.rf + 0.3 * Math.cos(rk)];
    mesh.add(tube([[xf + 0.01, y, b.rf - 0.04], lowTop], 0.03, mat('metal', '#2d3034'), 10));
    mesh.add(tube([lowTop, [topX, y, b.headZ + 0.02]], 0.023, forkM, 10));
  }
  mesh.add(fender(xf, b.rf, 0.07, 40, 140, mat('paint', paint), 0.02));
  const pivot: V3 = [-0.1, 0, 0.42];
  if (b.single) {
    // One arm, on the left, so the whole rear wheel shows on the right.
    const arm = body([[pivot[0], pivot[2] - 0.05, pivot[2] + 0.05, 0.035], [xr + 0.06, b.rr - 0.04, b.rr + 0.05, 0.03]], mat('metal', '#3a3d42'), 3);
    const moved = new Set<object>();
    for (const t of arm.tris) {
      for (const v of [t.a, t.b, t.c]) {
        if (moved.has(v)) continue; // corners are shared between triangles
        moved.add(v);
        v.p = [v.p[0], v.p[1] + 0.13, v.p[2]];
      }
    }
    mesh.add(arm);
  } else {
    for (const y of [0.11, -0.11]) mesh.add(tube([[pivot[0], y, pivot[2]], [xr, y, b.rr]], 0.028, mat('metal', '#8a9097'), 8));
  }
  // Engine and frame
  mesh.add(body([[0.34, 0.2, 0.55, 0.12], [0.2, 0.16, 0.62, 0.17], [0.0, 0.18, 0.6, 0.17], [-0.13, 0.25, 0.55, 0.14]], mat('metal', '#33373c'), 4));
  for (const y of [0.13, -0.13]) mesh.add(tube([[topX, y * 0.7, b.headZ], [0.15, y, 0.72], [-0.12, y, 0.5]], 0.025, mat('metal', id === 'bike_dukati' ? '#b52a20' : '#3a3d42'), 8));

  // Fairing: clear of the front wheel.
  const wheelTop = (x: number) => (Math.abs(x - xf) < b.rf + 0.04 ? b.rf + Math.sqrt(Math.max(0, (b.rf + 0.04) ** 2 - (x - xf) ** 2)) + 0.03 : 0);
  const fx = (k: number) => topX + k;
  const fair: Array<[number, number, number, number]> = [
    [fx(0.5), 0.8, 0.84, 0.03],
    [fx(0.44), 0.74, 0.9, 0.085],
    [fx(0.36), 0.68, 0.94, 0.135],
    [fx(0.25), 0.62, 0.96, 0.175],
    [fx(0.12), 0.52, 0.95, 0.2],
    [fx(0.0), 0.4, 0.92, 0.205],
    [fx(-0.14), 0.28, 0.86, 0.2],
    [fx(-0.28), 0.25, 0.77, 0.19],
    [fx(-0.42), 0.28, 0.67, 0.16],
    [fx(-0.5), 0.34, 0.58, 0.1],
  ].map(([x, zb, zt, hw]) => [x, Math.max(zb, wheelTop(x)), zt + (b.headZ - 0.86), hw] as [number, number, number, number]);
  const lamp = (f: Frag, s: Surf) => {
    const [x, y, z] = f.p;
    if (x > fx(0.33) && f.nm[0] > 0.25) {
      const ay = Math.abs(y);
      const zc = 0.8 + (b.headZ - 0.86) - (ay - 0.05) * 0.4;
      if (ay > 0.035 && ay < 0.15 && Math.abs(z - zc) < 0.028) {
        s.kind = 'lamp';
        s.color = [0.96, 0.98, 1];
        s.glow = 0.15;
        return true;
      }
      if (ay < 0.035 && z < 0.78) {
        s.kind = 'plastic';
        s.color = [0.05, 0.05, 0.06]; // ram-air intake
        return true;
      }
    }
    return false;
  };
  const fairMat = mat('paint', paint, {
    pattern: (f, s) => {
      if (lamp(f, s)) return;
      b.livery(f, s, paint);
    },
  });
  mesh.add(body(fair, fairMat, 2.15, 20));
  // Windscreen (smoked).
  const ws: V3[][] = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    const x = fx(0.36) - t * 0.24, zb = 0.95 + (b.headZ - 0.86) + t * 0.05, top = zb + 0.02 + t * 0.12;
    const row: V3[] = [];
    for (let c = -4; c <= 4; c++) {
      const yy = (c / 4) * (0.06 + t * 0.07);
      row.push([x - 0.02 * (c / 4) ** 2, yy, top - 0.04 * (c / 4) ** 2]);
    }
    ws.push(row);
  }
  mesh.add(grid(ws, mat('glass', [0.15, 0.17, 0.2], { alpha: 0.55, twoSided: true }), { inside: () => [0, 0, 0] }));
  // Tank, seat, tail
  const tankM = mat('paint', paint, { pattern: (f, s) => (f.p[0] > fx(-0.3) ? b.livery(f, s, paint) : undefined) });
  mesh.add(body([[fx(0.0), S - 0.01, S + 0.15, 0.13], [fx(-0.1), S - 0.03, S + 0.22, 0.18], [fx(-0.24), S - 0.03, S + 0.23, 0.19], [fx(-0.38), S - 0.03, S + 0.18, 0.17], [fx(-0.5), S - 0.03, S + 0.09, 0.14]], tankM, 2.4));
  const sx = fx(-0.5);
  mesh.add(body([[sx + 0.02, S - 0.04, S + 0.035, 0.13], [sx - 0.12, S - 0.04, S + 0.02, 0.145], [sx - 0.28, S - 0.03, S + 0.03, 0.12], [sx - 0.34, S - 0.02, S + 0.06, 0.1]], mat('cloth', '#1e1f22'), 3));
  const tailX = xr - 0.12 - (id === 'bike_dukati' ? 0.02 : 0);
  const tailM = mat('paint', paint, {
    pattern: (f, s) => {
      const [x, , z] = f.p;
      if (x < tailX + 0.06 && f.nm[0] < -0.2) {
        s.kind = 'lamp';
        s.color = [0.9, 0.08, 0.1];
        s.glow = 0.12;
        return;
      }
      // The pillion pad on top of the tail.
      if (f.nm[2] > 0.55 && x > sx - 0.62 && x < sx - 0.36 && z > S + 0.05) {
        s.kind = 'cloth';
        s.color = [0.12, 0.12, 0.13];
        return;
      }
      if (f.nm[2] < -0.3) s.color = [0.08, 0.08, 0.09]; // undertray
    },
  });
  mesh.add(body([[sx - 0.2, S - 0.06, S + 0.07, 0.13], [sx - 0.36, S - 0.03 + U * 0.3, S + 0.12 + U * 0.5, 0.12], [sx - 0.52, S + 0.01 + U * 0.6, S + 0.15 + U, 0.095], [tailX + 0.12, S + 0.05 + U, S + 0.16 + U, 0.06], [tailX, S + 0.08 + U, S + 0.15 + U, 0.025]], tailM, 2.4));
  // Plate hanger + black plate, under the tail.
  mesh.add(tube([[tailX + 0.2, 0, S - 0.02], [tailX - 0.05, 0, S - 0.16]], 0.012, M.black, 6));
  const pm = mat('plastic', '#111', { pattern: (f, s) => plate((0.09 - f.p[1]) / 0.18, (f.p[2] - (S - 0.24)) / 0.11, s) });
  mesh.add(box([tailX - 0.07, 0, S - 0.185], [0.006, 0.09, 0.055], pm));
  // Clip-ons, mirrors, pegs
  for (const sgn of [1, -1]) {
    const c0: V3 = [topX + 0.02, sgn * 0.1, b.headZ + 0.02];
    const c1: V3 = [topX - 0.06, sgn * 0.26, b.headZ - 0.01];
    mesh.add(tube([c0, c1], 0.013, M.black, 6));
    mesh.add(tube([c1, [topX - 0.1, sgn * 0.34, b.headZ - 0.02]], 0.019, M.tyre, 8));
    const hz = b.headZ - 0.86;
    mesh.add(tube([[fx(0.2), sgn * 0.15, 0.92 + hz], [fx(0.15), sgn * 0.27, 0.95 + hz]], 0.008, M.black, 5));
    mesh.add(blob([fx(0.14), sgn * 0.29, 0.955 + hz], [0.03, 0.055, 0.03], mat('paint', paint), 10));
    mesh.add(tube([[-0.18, sgn * 0.12, 0.36], [-0.2, sgn * 0.22, 0.36]], 0.012, M.steel, 6));
  }
  // Exhaust (left side)
  const tm = tipMat(look.tip);
  const header: V3[] = [[0.3, 0.06, 0.22], [0.2, 0.12, 0.14], [0.0, 0.15, 0.15]];
  if (look.tip === 'racing' || look.tip === 'straight') {
    const p: V3[] = [...header, [-0.2, 0.17, 0.22], [xr + 0.35, 0.17, 0.45]];
    if (look.tip === 'straight') mesh.add(tube([...p, [xr + 0.05, 0.17, 0.58]], 0.022, tm, 8));
    else {
      mesh.add(tube(p, 0.022, mat('metal', '#8a9097'), 8));
      mesh.add(can([xr + 0.38, 0.17, 0.44], [xr + 0.03, 0.18, 0.6], 0.055, tm));
    }
  } else {
    mesh.add(tube(header, 0.022, mat('metal', '#8a9097'), 8));
    if (id === 'bike_dukati') mesh.add(can([0.02, 0.0, 0.16], [-0.24, 0.0, 0.18], look.tip === 'sport' ? 0.075 : 0.065, tm));
    else mesh.add(can([0.0, 0.15, 0.15], [-0.36, 0.17, 0.3], look.tip === 'sport' ? 0.06 : 0.052, tm));
  }

  const L = b.wb + b.rf + b.rr + 0.2;
  const shadow = (x: number, y: number) => {
    const e = Math.hypot(x / (L / 2), y / 0.26);
    let a = 0.4 * (1 - smooth(0.6, 1.05, e));
    for (const [ax, R] of [[xf, b.rf], [xr, b.rr]]) {
      const c = Math.hypot((x - ax) / (R * 0.8), y / 0.08);
      if (c < 1) a = Math.max(a, 0.6 * (1 - c * c));
    }
    return a;
  };
  return { mesh, shadow, seats: [[sx - 0.12, 0, S + 0.03], [sx - 0.48, 0, S + 0.16 + U * 0.7]] };
}

// ------------------------------------------------------------------ the cruiser
/** Harley-Davidson Road King-ish: wheelbase 1625, 130/80B17 + 180/65B16, seat 680, rake 26°. */
function cruiser(look: CarLook): Model {
  const paint = hex(look.paint);
  const rim = hex(look.wheel);
  const R = 0.32;
  const xf = 0.8125, xr = -0.8125;
  const rk = rad(26);
  const headZ = 1.0;
  const topX = xf - ((headZ - R) / Math.cos(rk)) * Math.sin(rk);
  const mesh = new Mesh();
  const P = mat('paint', paint);
  mesh.add(wheel(xf, R, 0.13, rim, 12, 0.07, 2, R * 0.68));
  mesh.add(wheel(xr, R, 0.18, rim, 12, 0.07, 1, R * 0.64));
  // Forks with chrome covers, the headlamp nacelle and passing lamps.
  for (const y of [0.12, -0.12]) {
    const mid: V3 = [xf - 0.33 * Math.sin(rk), y, R + 0.33 * Math.cos(rk)];
    mesh.add(tube([[xf + 0.01, y, R - 0.03], mid], 0.032, M.chrome, 10));
    mesh.add(tube([mid, [topX, y, headZ]], 0.04, M.chrome, 10));
  }
  mesh.add(fender(xf, R, 0.1, 15, 165, P, 0.05));
  mesh.add(lathe([0.6, 0, 0.93], [1, 0, 0], [[0.05, -0.14], [0.1, -0.08], [0.125, -0.01], [0.13, 0.03]], M.chrome, 24));
  const lens = mat('lamp', '#fff6d6', {
    pattern: (f, s) => {
      const r = Math.hypot(f.p[1], f.p[2] - 0.93) / 0.12;
      s.color = r < 0.25 ? [1, 1, 0.95] : r > 0.85 ? [0.85, 0.87, 0.9] : [0.95, 0.93, 0.85];
      s.glow = 0.15;
    },
  });
  mesh.add(disc([0.632, 0, 0.93], [1, 0, 0], 0.12, lens, 24));
  mesh.add(tube([[0.56, -0.22, 0.79], [0.6, 0, 0.82], [0.56, 0.22, 0.79]], 0.012, M.chrome, 6));
  for (const sgn of [1, -1]) {
    mesh.add(lathe([0.58, sgn * 0.22, 0.79], [1, 0, 0], [[0.03, -0.06], [0.055, -0.02], [0.058, 0.02]], M.chrome, 16));
    mesh.add(disc([0.6, sgn * 0.22, 0.79], [1, 0, 0], 0.05, lens, 16));
    mesh.add(blob([0.56, sgn * 0.3, 0.9], [0.03, 0.025, 0.025], M.amber, 8));
  }
  // Windshield
  const ws: V3[][] = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    const z = 0.98 + t * 0.46;
    const row: V3[] = [];
    for (let c = -6; c <= 6; c++) {
      const u = c / 6;
      const half = 0.3 - 0.06 * t * t;
      row.push([0.58 - 0.12 * t - 0.09 * u * u, u * half, z - 0.03 * u * u * (1 - t)]);
    }
    ws.push(row);
  }
  mesh.add(grid(ws, M.clearGlass, { inside: () => [0, 0, 0] }));
  mesh.add(tube(ws[0], 0.01, M.chrome, 6, false));
  // Wide pulled-back bars
  mesh.add(tube([[0.38, -0.4, 1.12], [0.46, -0.27, 1.08], [0.49, 0, 1.06], [0.46, 0.27, 1.08], [0.38, 0.4, 1.12]], 0.014, M.chrome, 8));
  for (const sgn of [1, -1]) mesh.add(tube([[0.4, sgn * 0.38, 1.115], [0.35, sgn * 0.47, 1.13]], 0.02, M.tyre, 8));
  // Tank with the chrome console
  const tankM = mat('paint', paint, {
    pattern: (f, s) => {
      if (Math.abs(f.p[1]) < 0.035 && f.nm[2] > 0.75) {
        s.kind = 'chrome';
        s.color = [0.95, 0.95, 0.95];
      }
    },
  });
  mesh.add(body([[0.5, 0.86, 0.94, 0.08], [0.42, 0.8, 1.03, 0.16], [0.26, 0.77, 1.07, 0.2], [0.08, 0.77, 1.04, 0.19], [-0.06, 0.8, 0.95, 0.13]], tankM, 2.3));
  // Two-up seat
  mesh.add(body([[-0.02, 0.62, 0.74, 0.16], [-0.16, 0.6, 0.71, 0.2], [-0.3, 0.62, 0.72, 0.19], [-0.4, 0.68, 0.81, 0.16], [-0.55, 0.7, 0.81, 0.15], [-0.7, 0.72, 0.8, 0.11]], M.leather, 3));
  // Rear fender, saddlebags, tail lamp
  mesh.add(fender(xr, R, 0.14, 25, 178, P, 0.05));
  const bagM = mat('paint', paint, {
    pattern: (f, s) => {
      const z = f.p[2];
      if (Math.abs(z - 0.67) < 0.006) s.color = scalec(paint, 0.35);
      if (Math.abs(z - 0.64) < 0.02 && Math.abs(f.p[0] + 0.78) < 0.03 && Math.abs(f.nm[1]) > 0.5) {
        s.kind = 'chrome';
        s.color = [0.95, 0.95, 0.95];
      }
    },
  });
  for (const sgn of [1, -1]) {
    const bag = loft(
      [
        [-0.48, 0.05],
        [-0.52, 0.09],
        [-0.62, 0.1],
        [-0.95, 0.1],
        [-1.05, 0.08],
        [-1.09, 0.04],
      ].map(([x, hw]) => ({ x, ring: superRing(16, sgn * 0.33, 0.56, hw, 0.17 * (hw / 0.1) ** 0.3, 3.6) })),
      bagM,
    );
    mesh.add(bag);
  }
  mesh.add(blob([-1.12, 0, 0.66], [0.02, 0.06, 0.03], M.red, 10));
  for (const sgn of [1, -1]) mesh.add(blob([-1.1, sgn * 0.18, 0.62], [0.03, 0.022, 0.022], M.amber, 8));
  // The 45° V-twin: finned cylinders on a big crankcase, chrome primary cover on the left.
  mesh.add(blob([0.0, 0, 0.36], [0.22, 0.13, 0.15], mat('metal', '#a9b0b7'), 16));
  const fins: Array<[number, number]> = [];
  for (let k = 0; k <= 12; k++) fins.push([k % 2 ? 0.075 : 0.098, k * 0.024]);
  for (const sgn of [1, -1]) {
    const a = rad(22.5) * sgn;
    const base: V3 = [0.06 * sgn, 0, 0.44];
    const dir: V3 = [Math.sin(a), 0, Math.cos(a)];
    mesh.add(lathe(base, dir, fins, mat('metal', '#3b3f45'), 16, { flat: true }));
    const top: V3 = [base[0] + dir[0] * 0.3, 0, base[2] + dir[2] * 0.3];
    mesh.add(blob([top[0], 0, top[2] + 0.02], [0.08, 0.1, 0.045], M.chrome, 12));
  }
  mesh.add(blob([-0.22, 0.15, 0.33], [0.2, 0.045, 0.11], M.chrome, 16));
  mesh.add(disc([0.02, -0.17, 0.62], [0, -1, 0], 0.1, M.chrome, 20));
  // Frame, swingarm, footboards, crash bars
  const frame = mat('metal', '#1d1f22');
  for (const y of [0.07, -0.07]) mesh.add(tube([[topX, y * 0.5, headZ], [0.36, y, 0.72], [0.3, y, 0.2], [-0.32, y, 0.2], [-0.42, y, 0.46], [-0.85, y * 1.4, 0.58]], 0.02, frame, 8));
  for (const y of [0.13, -0.13]) mesh.add(tube([[-0.32, y, 0.34], [xr, y, R]], 0.026, frame, 8));
  for (const sgn of [1, -1]) {
    mesh.add(box([0.36, sgn * 0.31, 0.3], [0.14, 0.07, 0.012], M.tyre));
    mesh.add(tube([[0.36, sgn * 0.08, 0.62], [0.44, sgn * 0.3, 0.5], [0.4, sgn * 0.34, 0.3], [0.26, sgn * 0.12, 0.2]], 0.017, M.chrome, 8));
  }
  // Exhaust: chrome headers to a muffler under each saddlebag (the left one carries the tip).
  const tm = tipMat(look.tip);
  for (const sgn of [1, -1]) {
    const hdr: V3[] = [[0.18, sgn * 0.06, 0.56], [0.26, sgn * 0.16, 0.36], [0.12, sgn * 0.22, 0.2], [-0.4, sgn * 0.24, 0.22], [-0.5, sgn * 0.25, 0.27]];
    if (look.tip === 'straight') mesh.add(tube([...hdr, [-1.05, sgn * 0.26, 0.33]], 0.026, tm, 10));
    else {
      mesh.add(tube(hdr, 0.025, M.chrome, 10));
      mesh.add(can([-0.48, sgn * 0.25, 0.27], [-1.08, sgn * 0.26, 0.33], look.tip === 'racing' ? 0.07 : look.tip === 'sport' ? 0.062 : 0.055, look.tip === 'stock' ? M.chrome : tm));
    }
  }
  const shadow = (x: number, y: number) => {
    const e = Math.hypot(x / 1.3, y / 0.45);
    let a = 0.42 * (1 - smooth(0.6, 1.05, e));
    for (const ax of [xf, xr]) {
      const c = Math.hypot((x - ax) / 0.25, y / 0.1);
      if (c < 1) a = Math.max(a, 0.6 * (1 - c * c));
    }
    return a;
  };
  return { mesh, shadow, seats: [[-0.16, 0, 0.71], [-0.55, 0, 0.81]] };
}

export const BIKE_IDS = [...Object.keys(SPORT), 'bike_harlee'];
export function buildBike(id: string, look: CarLook): Model {
  return id === 'bike_harlee' ? cruiser(look) : sportbike(id, look);
}
export const bikeLength = (id: string) => (id === 'bike_harlee' ? 2.43 : (SPORT[id]?.wb ?? 1.4) + 0.62);
export { mixc };
