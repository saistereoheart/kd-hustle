// 🚗 Motor Kota vehicles, drawn in code: four cars and four big bikes, each with its own shape
// (a three-box sedan, a short sedan, a tall hatchback, a fastback; three sportbikes and a chrome
// cruiser). Paint, wheel colour and the exhaust tip come from the VehicleLook. Side views face
// LEFT (the sprite is flipped to face right), like the other vehicles.
//
// Cars: 96×56 logical px, ground at y = 52. Bikes: 64×44, ground at y = 40.
import type Phaser from 'phaser';
import type { GarageConfig, VehicleLook } from '@kh/shared';

type Ctx = CanvasRenderingContext2D;
export type View = 'side' | 'front' | 'back';
export interface Look {
  paint: string; // colour
  wheel: string; // colour
  tip: 'stock' | 'sport' | 'racing' | 'straight';
}

export const CAR_SIZE = { w: 96, h: 56, ground: 52 };
export const BIKE_SIZE = { w: 64, h: 44, ground: 40 };

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
/** Lighter (k > 0) or darker (k < 0). */
export function shade(hex: string, k: number): string {
  const c = rgb(hex).map((v) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k)));
  return `rgb(${c.join(',')})`;
}
function path(ctx: Ctx, pts: number[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}
function fillPath(ctx: Ctx, pts: number[], fill: string | CanvasGradient) {
  path(ctx, pts);
  ctx.fillStyle = fill;
  ctx.fill();
}
function line(ctx: Ctx, pts: number[], color: string, w: number) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}
function ell(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}
function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}
/** A body-panel gradient: light on top, darker towards the sills. */
function paintGrad(ctx: Ctx, col: string, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, shade(col, 0.35));
  g.addColorStop(0.45, col);
  g.addColorStop(1, shade(col, -0.35));
  return g;
}
function glassGrad(ctx: Ctx, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#9fc5e8');
  g.addColorStop(0.5, '#3d5a73');
  g.addColorStop(1, '#1d2b38');
  return g;
}

/** A wheel seen from the side: tyre, coloured rim, spokes, hub. */
function sideWheel(ctx: Ctx, x: number, y: number, r: number, rim: string, spokes = 5) {
  ell(ctx, x, y, r, r, '#1b1d21');
  ell(ctx, x, y, r * 0.86, r * 0.86, '#2b2e33');
  const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, 0.5, x, y, r * 0.65);
  g.addColorStop(0, shade(rim, 0.4));
  g.addColorStop(1, shade(rim, -0.2));
  ell(ctx, x, y, r * 0.62, r * 0.62, g);
  ctx.strokeStyle = shade(rim, -0.45);
  ctx.lineWidth = r * 0.12;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.18, y + Math.sin(a) * r * 0.18);
    ctx.lineTo(x + Math.cos(a) * r * 0.58, y + Math.sin(a) * r * 0.58);
    ctx.stroke();
  }
  ell(ctx, x, y, r * 0.18, r * 0.18, shade(rim, -0.5));
}
function shadow(ctx: Ctx, cx: number, y: number, rx: number) {
  ell(ctx, cx, y, rx, 3.2, 'rgba(0,0,0,0.28)');
}

/** Exhaust tip, side view, at the rear bottom (x, y). */
function sideTip(ctx: Ctx, x: number, y: number, tip: Look['tip'], big = false) {
  const s = big ? 1.3 : 1;
  if (tip === 'stock') return rrect(ctx, x, y - 1.2 * s, 3 * s, 2.4 * s, 1, '#6c737a');
  if (tip === 'sport') {
    rrect(ctx, x - 1, y - 1.8 * s, 5 * s, 3.6 * s, 1.6, '#dee2e6');
    return ell(ctx, x + 4 * s, y, 1 * s, 1.6 * s, '#212529');
  }
  if (tip === 'racing') {
    rrect(ctx, x - 6 * s, y - 2.6 * s, 10 * s, 5.2 * s, 2.4, '#2b2d31');
    line(ctx, [x - 4 * s, y - 2.6 * s, x - 4 * s, y + 2.6 * s], '#868e96', 0.6);
    return ell(ctx, x + 4 * s, y, 1.4 * s, 2.2 * s, '#495057');
  }
  line(ctx, [x - 4, y, x + 4 * s, y - 0.5], '#a5794a', 2.4 * s); // straight pipe: bare, heat-blued
  ell(ctx, x + 4.5 * s, y - 0.5, 0.9 * s, 1.3 * s, '#1b1b1b');
}
/** Exhaust tip(s), back view, at (x, y). */
function backTip(ctx: Ctx, x: number, y: number, tip: Look['tip']) {
  const r = tip === 'stock' ? 1.3 : tip === 'sport' ? 2 : tip === 'racing' ? 2.6 : 1.8;
  ell(ctx, x, y, r + 0.7, r + 0.4, tip === 'racing' ? '#2b2d31' : tip === 'straight' ? '#a5794a' : '#ced4da');
  ell(ctx, x, y, r * 0.65, r * 0.55, '#111');
}

// ------------------------------------------------------------------ cars
interface CarShape {
  /** Side outline (facing left), roof line, the glass. */
  body: number[];
  glass: number[];
  /** Pillar between the side windows (x). */
  bPillar: number;
  wheels: [number, number];
  hood: number;
  /** Tall (hatch / sedan) for the front and back views. */
  roofY: number;
  hatch?: boolean;
  sleek?: boolean;
}
const CARS: Record<string, CarShape> = {
  // A three-box sedan: hood, cabin, a proper boot.
  car_sega: {
    body: [5, 41, 6, 35, 9, 31, 28, 29, 40, 18, 62, 17.5, 73, 27, 88, 28.5, 90, 32, 91, 41, 89, 45, 7, 45],
    glass: [30, 29, 41, 19.5, 61, 19, 70, 28],
    bPillar: 51, wheels: [21, 74], hood: 29, roofY: 12,
  },
  // A shorter sedan with a tall cabin and a stubby boot.
  car_bezzo: {
    body: [6, 41, 7, 35, 10, 31, 27, 29.5, 38, 16.5, 61, 16, 72, 27, 86, 28.5, 88, 32, 89, 41, 87, 45, 8, 45],
    glass: [29, 29.5, 39, 18, 60, 17.5, 69.5, 28],
    bPillar: 50, wheels: [22, 72], hood: 29.5, roofY: 10,
  },
  // A tall hatchback: short nose, long roof, upright tailgate.
  car_mivy: {
    body: [7, 41, 8, 35, 11, 31, 24, 29, 37, 15, 74, 14.5, 80, 18, 84, 30, 86, 41, 84, 45, 9, 45],
    glass: [26, 29, 38, 16.5, 73, 16, 78, 27, 26, 29],
    bPillar: 52, wheels: [22, 72], hood: 29, roofY: 8, hatch: true,
  },
  // A low fastback: long sloping windscreen and roof, sharp tail.
  car_s7o: {
    body: [4, 40, 5, 35, 8, 32, 27, 30, 43, 18.5, 60, 18, 79, 27, 90, 29, 92, 33, 92, 41, 90, 45, 6, 45],
    glass: [30, 30, 44, 20, 59, 19.5, 75, 28],
    bPillar: 52, wheels: [21, 75], hood: 30, roofY: 13, sleek: true,
  },
};

function carSide(ctx: Ctx, id: string, look: Look) {
  const c = CARS[id] ?? CARS.car_sega;
  const [fw, rw] = c.wheels;
  shadow(ctx, 48, 51, 44);
  // Wheel wells (dark) behind the body.
  ell(ctx, fw, 44, 10, 10, '#16181b');
  ell(ctx, rw, 44, 10, 10, '#16181b');
  // Body
  fillPath(ctx, c.body, paintGrad(ctx, look.paint, 16, 46));
  ctx.save();
  path(ctx, c.body);
  ctx.clip();
  // Lower sill and a shoulder line catching the light.
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 40, 96, 6);
  line(ctx, [8, 33, 90, 32], 'rgba(255,255,255,0.35)', 0.8);
  ctx.restore();
  // Wheel arches cut out
  for (const x of [fw, rw]) {
    ctx.beginPath();
    ctx.arc(x, 45, 9.6, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = '#16181b';
    ctx.fill();
  }
  // Glass (one shape), split by the pillars, a driver's head behind the front glass.
  fillPath(ctx, c.glass, glassGrad(ctx, 17, 30));
  ctx.save();
  path(ctx, c.glass);
  ctx.clip();
  ell(ctx, c.bPillar - 8, 25, 3.6, 4, 'rgba(15,20,28,0.85)'); // driver
  ell(ctx, c.bPillar - 8, 30, 5.5, 3, 'rgba(15,20,28,0.85)');
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.moveTo(c.glass[0] + 6, c.glass[1]);
  ctx.lineTo(c.glass[2] + 6, c.glass[3]);
  ctx.lineTo(c.glass[2] + 10, c.glass[3]);
  ctx.lineTo(c.glass[0] + 10, c.glass[1]);
  ctx.fill();
  ctx.restore();
  line(ctx, [c.bPillar, 18, c.bPillar, 30], shade(look.paint, -0.3), 2.2);
  if (c.hatch) line(ctx, [72, 16, 77, 28], shade(look.paint, -0.3), 1.8);
  // Doors, handles, mirror
  line(ctx, [c.bPillar - 18, 30, c.bPillar - 19, 43], 'rgba(0,0,0,0.3)', 0.7);
  line(ctx, [c.bPillar + 1, 30, c.bPillar + 1, 43], 'rgba(0,0,0,0.3)', 0.7);
  if (!c.hatch) line(ctx, [c.bPillar + 19, 30, c.bPillar + 18, 41], 'rgba(0,0,0,0.3)', 0.7);
  rrect(ctx, c.bPillar - 8, 32.5, 4, 1.2, 0.6, shade(look.paint, -0.45));
  rrect(ctx, c.bPillar + 6, 32.5, 4, 1.2, 0.6, shade(look.paint, -0.45));
  fillPath(ctx, [c.glass[0] - 1, c.glass[1] - 1, c.glass[0] - 4, c.glass[1] - 3, c.glass[0] - 1, c.glass[1] - 4], shade(look.paint, -0.25));
  // Lights: headlamp (front, left) and tail lamp (back, right)
  if (c.sleek) {
    fillPath(ctx, [5, 33, 14, 31.5, 13, 33.5, 6, 35], '#e7f5ff');
    line(ctx, [84, 29.5, 92, 30.5], '#e03131', 1.8);
  } else {
    fillPath(ctx, [6, 33, 13, 31.5, 13, 35, 7, 36], '#fff3bf');
    rrect(ctx, c.hatch ? 82.5 : 87, c.hatch ? 22 : 30.5, 3, c.hatch ? 7 : 4, 1, '#e03131');
  }
  // Bumpers / grille hint
  rrect(ctx, 4, 38, 6, 3, 1, 'rgba(0,0,0,0.35)');
  rrect(ctx, 86, 39, 6, 3, 1, 'rgba(0,0,0,0.35)');
  sideTip(ctx, 87, 45, look.tip);
  // Wheels
  sideWheel(ctx, fw, 44, 8, look.wheel);
  sideWheel(ctx, rw, 44, 8, look.wheel);
}

function carFront(ctx: Ctx, id: string, look: Look, back: boolean) {
  const c = CARS[id] ?? CARS.car_sega;
  const top = c.roofY + 4;
  shadow(ctx, 48, 51, 30);
  // Tyres peeking out under the body
  rrect(ctx, 22, 40, 8, 11, 2.5, '#1b1d21');
  rrect(ctx, 66, 40, 8, 11, 2.5, '#1b1d21');
  // Lower body
  rrect(ctx, 19, 27, 58, 19, 6, paintGrad(ctx, look.paint, 26, 46));
  // Cabin: roof + glass (trapezoid)
  const cw = c.sleek ? 18 : c.hatch ? 21 : 20; // half width at the roof
  fillPath(ctx, [48 - cw, top, 48 + cw, top, 48 + 27, 28, 48 - 27, 28], paintGrad(ctx, look.paint, top, 28));
  fillPath(ctx, [48 - cw + 2.5, top + 2.5, 48 + cw - 2.5, top + 2.5, 48 + 24.5, 27, 48 - 24.5, 27], glassGrad(ctx, top, 28));
  if (!back) {
    ell(ctx, 40, 21, 3.4, 3.8, 'rgba(15,20,28,0.85)'); // driver (right-hand drive)
    ell(ctx, 40, 26, 5.4, 2.8, 'rgba(15,20,28,0.85)');
  }
  fillPath(ctx, [48 - cw + 5, top + 3, 48 - cw + 9, top + 3, 48 - 18, 26.5, 48 - 22, 26.5], 'rgba(255,255,255,0.2)');
  // Mirrors
  rrect(ctx, 15, 25, 6, 3.6, 1.4, shade(look.paint, -0.2));
  rrect(ctx, 75, 25, 6, 3.6, 1.4, shade(look.paint, -0.2));
  if (!back) {
    // Grille, headlamps, number plate
    rrect(ctx, 36, 34, 24, 6, 2, '#2b2d31');
    for (let x = 38; x < 59; x += 3) line(ctx, [x, 35, x, 39], '#495057', 0.6);
    const lamp = c.sleek ? '#e7f5ff' : '#fff3bf';
    if (c.sleek) {
      fillPath(ctx, [21, 31, 34, 33, 34, 35, 22, 34], lamp);
      fillPath(ctx, [75, 31, 62, 33, 62, 35, 74, 34], lamp);
    } else {
      rrect(ctx, 22, 30.5, 11, 5, 2, lamp);
      rrect(ctx, 63, 30.5, 11, 5, 2, lamp);
    }
    rrect(ctx, 41, 41.5, 14, 3.4, 0.6, '#f8f9fa');
    rrect(ctx, 19, 43, 58, 3, 1.5, 'rgba(0,0,0,0.35)');
  } else {
    // Boot / tailgate, tail lamps, plate, exhaust
    if (c.hatch) line(ctx, [24, 29, 72, 29], shade(look.paint, -0.35), 0.8);
    rrect(ctx, 21, 30, 12, 5, 2, '#e03131');
    rrect(ctx, 63, 30, 12, 5, 2, '#e03131');
    if (c.sleek) line(ctx, [33, 32.5, 63, 32.5], '#c92a2a', 1.2);
    rrect(ctx, 40, 36, 16, 4, 0.6, '#f8f9fa');
    ctx.fillStyle = '#212529';
    ctx.font = 'bold 3.2px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('WKD 2026', 48, 39.2);
    rrect(ctx, 19, 42, 58, 4, 1.5, 'rgba(0,0,0,0.35)');
    backTip(ctx, 68, 45.5, look.tip);
    if (look.tip === 'racing' || look.tip === 'sport') backTip(ctx, 28, 45.5, look.tip);
  }
}

// ------------------------------------------------------------------ bikes
function bikeSide(ctx: Ctx, id: string, look: Look) {
  const p = look.paint;
  shadow(ctx, 32, 39.5, 27);
  if (id === 'bike_harlee') {
    // A long, low cruiser: big wheels, chrome V-twin, teardrop tank, saddlebag, pull-back bars.
    sideWheel(ctx, 53, 31.5, 8.5, look.wheel, 9);
    line(ctx, [40, 29, 53, 31.5], '#adb5bd', 2); // swingarm
    line(ctx, [17, 11, 30, 15, 46, 19, 53, 22], '#212529', 1.8); // frame backbone
    line(ctx, [24, 32, 40, 32, 46, 22], '#212529', 1.6); // lower frame
    // Rear fender (over the wheel) and the saddlebag on it.
    ctx.beginPath();
    ctx.arc(53, 31.5, 10.5, Math.PI * 1.05, Math.PI * 1.95);
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = shade(p, -0.1);
    ctx.stroke();
    rrect(ctx, 45, 17.5, 13, 9, 3, paintGrad(ctx, p, 17, 27));
    rrect(ctx, 46, 19, 11, 1.2, 0.6, 'rgba(255,255,255,0.25)');
    // The V-twin: two finned chrome cylinders on a round crankcase.
    const cyl = (x0: number, y0: number, x1: number, y1: number) => {
      line(ctx, [x0, y0, x1, y1], '#ced4da', 5.4);
      const n = 5;
      for (let i = 1; i <= n; i++) {
        const k = i / (n + 1);
        const x = x0 + (x1 - x0) * k, y = y0 + (y1 - y0) * k;
        line(ctx, [x - 3, y + (x1 - x0) * 0.08, x + 3, y - (x1 - x0) * 0.08], '#868e96', 0.6);
      }
      ell(ctx, x1, y1, 3.2, 1.8, '#e9ecef'); // rocker cover
    };
    cyl(30, 26, 25, 18);
    cyl(34, 26, 39, 18);
    ell(ctx, 32, 28.5, 5.5, 4.2, '#adb5bd'); // crankcase
    ell(ctx, 31, 27.5, 2.2, 1.8, '#e9ecef');
    // Teardrop tank and the low scooped seat
    fillPath(ctx, [19, 14, 23, 9.5, 33, 9, 37, 12.5, 34, 15.5, 21, 16], paintGrad(ctx, p, 9, 16));
    line(ctx, [23, 11.2, 32, 10.6], 'rgba(255,255,255,0.5)', 0.8);
    fillPath(ctx, [36, 14.5, 40, 12.6, 46, 13.6, 49, 16.4, 38, 17.2], '#3b2a20');
    // Pipes: long chrome duals sweeping back along the bottom.
    line(ctx, [25, 21, 23, 29, 29, 34.5, 52, 35], '#e9ecef', 2.2);
    line(ctx, [39, 21, 41, 30, 52, 33], '#dee2e6', 2);
    sideTip(ctx, 52, 34.5, look.tip, true);
    rrect(ctx, 19, 32.5, 7, 1.6, 0.8, '#495057'); // footboard
    // Front end: raked chrome forks, fender, big round headlamp, pull-back bars
    line(ctx, [10, 31.5, 17, 9], '#dee2e6', 2);
    sideWheel(ctx, 10, 31.5, 8.5, look.wheel, 9);
    ctx.beginPath();
    ctx.arc(10, 31.5, 10.2, Math.PI * 1.08, Math.PI * 1.75);
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = shade(p, -0.1);
    ctx.stroke();
    ell(ctx, 14.5, 11, 3.4, 3.4, '#e9ecef');
    ell(ctx, 13.8, 11, 2.4, 2.6, '#fff3bf');
    line(ctx, [17, 8, 18.5, 4, 24, 4.5], '#adb5bd', 1.4);
    return;
  }
  // Sportbikes: a sharp nose, fairing, tall tail and clip-ons. The Dukati has a single-sided
  // swingarm (and gold forks); the racing can / straight pipe sits up by the tail.
  const duk = id === 'bike_dukati';
  const zx = id === 'bike_zx25';
  sideWheel(ctx, 50, 32, 7.5, look.wheel, duk ? 3 : 5);
  if (duk) fillPath(ctx, [35, 26.5, 50, 30.5, 50, 33.5, 35, 30], shade(p, -0.45));
  else line(ctx, [36, 28, 50, 32], '#495057', 2.4);
  // Engine block + frame
  rrect(ctx, 23, 16, 15, 13, 2.5, '#343a40');
  for (let x = 25; x < 37; x += 2.4) line(ctx, [x, 18, x, 22], '#495057', 0.5);
  line(ctx, [19, 12, 30, 14.5, 41, 13], duk ? '#c92a2a' : '#495057', 1.6);
  // Exhaust
  if (look.tip === 'racing' || look.tip === 'straight') {
    line(ctx, [27, 29, 40, 30, 50, 21], '#868e96', 1.6);
    sideTip(ctx, 51, 20.5, look.tip, look.tip === 'racing');
  } else {
    rrect(ctx, 30, 28, 12, 4.6, 2, '#2b2d31');
    sideTip(ctx, 41, 30.4, look.tip);
  }
  const fair = paintGrad(ctx, p, 8, 32);
  // Tail + seat (behind the rider), then the tank, then the fairing over the engine.
  fillPath(ctx, [42, 14.5, 56, 8, 58.5, 9, 53, 15.5, 44, 17], fair);
  rrect(ctx, 56.5, 8.2, 2.6, 1.4, 0.6, '#ff6b6b');
  fillPath(ctx, [38, 12.6, 46, 12.4, 46.5, 14.6, 39, 15], '#212529');
  fillPath(ctx, [24, 13, 29, 9.3, 37, 9.3, 40.5, 12.5, 38, 15.5, 26, 16], shade(p, 0.08));
  line(ctx, [29, 10.6, 36, 10.6], 'rgba(255,255,255,0.45)', 0.7);
  fillPath(ctx, [7, 20.5, 10, 15.5, 17, 11.5, 24, 13, 27, 19.5, 33, 26.5, 30.5, 31, 19, 31, 15, 26], fair);
  // Livery, vents, screen, headlamp, mirror
  if (zx) {
    line(ctx, [13, 24, 23, 18, 30, 27], '#212529', 1.3);
    line(ctx, [21, 25, 28, 25], '#212529', 0.8);
  } else if (duk) {
    line(ctx, [11, 22, 27, 21], '#f8f9fa', 0.9);
    ell(ctx, 22, 24, 2.2, 1.6, 'rgba(0,0,0,0.35)');
  } else {
    line(ctx, [12, 24, 28, 19], '#1971c2', 1.4);
    line(ctx, [17, 27, 31, 28], '#1971c2', 0.8);
  }
  fillPath(ctx, [15.5, 12, 19.5, 7, 24, 8, 22, 12.6], 'rgba(160,200,230,0.8)');
  fillPath(ctx, [7.6, 19.6, 10.4, 16.4, 13.2, 17.4, 9.4, 20.6], '#e7f5ff');
  line(ctx, [17.5, 12, 15.5, 9.5, 13.5, 9.6], '#212529', 1);
  // Forks + front wheel + fender
  line(ctx, [11.5, 32, 18.5, 13], duk ? '#e0a800' : '#ced4da', 1.8);
  sideWheel(ctx, 11.5, 32, 7.5, look.wheel, duk ? 3 : 5);
  fillPath(ctx, [5.5, 25.6, 9, 23.8, 15.5, 24.6, 15, 26.2], shade(p, -0.1));
}

function bikeFront(ctx: Ctx, id: string, look: Look, back: boolean) {
  const p = look.paint;
  shadow(ctx, 32, 39.5, 10);
  rrect(ctx, 29.5, 26, 5, 14, 2.4, '#1b1d21'); // tyre
  if (id === 'bike_harlee') {
    if (!back) {
      line(ctx, [16, 14, 24, 17, 40, 17, 48, 14], '#adb5bd', 1.6); // wide bars
      rrect(ctx, 26, 20, 12, 7, 3, paintGrad(ctx, p, 20, 27));
      ell(ctx, 32, 17.5, 5, 5, '#e9ecef');
      ell(ctx, 32, 17.5, 3.8, 3.8, '#fff3bf');
      line(ctx, [27, 22, 28, 34], '#ced4da', 1.4);
      line(ctx, [37, 22, 36, 34], '#ced4da', 1.4);
      rrect(ctx, 22, 31, 4, 4, 1.5, '#dee2e6'); // cylinder heads stick out
      rrect(ctx, 38, 31, 4, 4, 1.5, '#dee2e6');
    } else {
      rrect(ctx, 17, 15, 9, 12, 3, paintGrad(ctx, p, 15, 27)); // saddlebags
      rrect(ctx, 38, 15, 9, 12, 3, paintGrad(ctx, p, 15, 27));
      rrect(ctx, 25, 13, 14, 14, 4, paintGrad(ctx, p, 13, 27)); // fender
      rrect(ctx, 29, 20, 6, 2.4, 1, '#e03131');
      rrect(ctx, 28, 23.5, 8, 4, 0.5, '#f8f9fa');
      backTip(ctx, 21, 34, look.tip);
      backTip(ctx, 43, 34, look.tip);
    }
    return;
  }
  // Sportbike: narrow fairing, twin headlights (front) or the slim tail (back).
  const fair = paintGrad(ctx, p, 12, 30);
  if (!back) {
    fillPath(ctx, [22, 28, 21, 18, 26, 11, 38, 11, 43, 18, 42, 28, 36, 31, 28, 31], fair);
    fillPath(ctx, [27, 12, 37, 12, 35, 6, 29, 6], 'rgba(160,200,230,0.75)');
    fillPath(ctx, [24, 18, 30, 19.5, 29, 22, 24, 21], '#e7f5ff');
    fillPath(ctx, [40, 18, 34, 19.5, 35, 22, 40, 21], '#e7f5ff');
    line(ctx, [20, 14, 17, 12], '#212529', 1.2);
    line(ctx, [44, 14, 47, 12], '#212529', 1.2);
    rrect(ctx, 30, 29, 4, 3, 1, shade(p, -0.2)); // fender
  } else {
    fillPath(ctx, [25, 22, 27, 12, 37, 12, 39, 22, 35, 27, 29, 27], fair);
    rrect(ctx, 28.5, 12, 7, 2.4, 1, '#e03131');
    rrect(ctx, 28, 22, 8, 4, 0.5, '#f8f9fa');
    if (look.tip === 'racing' || look.tip === 'straight') backTip(ctx, 39, 24, look.tip);
    else backTip(ctx, 36, 34, look.tip);
  }
}

/** Draws a showroom vehicle into a canvas laid out as CAR_SIZE / BIKE_SIZE. */
export function drawShowroomVehicle(ctx: Ctx, id: string, look: Look, view: View) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const car = id.startsWith('car_');
  if (view === 'side') (car ? carSide : bikeSide)(ctx, id, look);
  else (car ? carFront : bikeFront)(ctx, id, look, view === 'back');
  ctx.restore();
}

export const isCarId = (id: string) => id.startsWith('car_');

// ------------------------------------------------------------------ game textures
let garageCfg: GarageConfig | null = null;
/** The app hands over the garage config once it's loaded (paint / wheel colours, exhaust tips). */
export function setGarageConfig(cfg: GarageConfig) {
  garageCfg = cfg;
}
export const isShowroomVehicle = (id: string) => !!garageCfg?.models[id];

/** Colours for a look (the model's factory look when there's none). */
export function resolveLook(id: string, look: VehicleLook | null | undefined): Look {
  const g = garageCfg;
  const m = g?.models[id];
  const paint = g?.paints[look?.paint ?? m?.paint ?? '']?.color ?? '#adb5bd';
  const wheel = g?.wheels[look?.wheel ?? m?.wheel ?? '']?.color ?? '#ced4da';
  const tip = g?.exhausts[look?.exhaust ?? 'stock']?.tip ?? 'stock';
  return { paint, wheel, tip };
}

const RES = 2;
/** Makes <key>_side / _front / _back for this vehicle and look (once) and returns the key. */
export function ensureShowroomTextures(scene: Phaser.Scene, id: string, look: VehicleLook | null | undefined): string {
  const key = `sr_${id}_${look?.paint ?? '-'}_${look?.wheel ?? '-'}_${look?.exhaust ?? '-'}`;
  if (scene.textures.exists(`${key}_side`)) return key;
  const size = isCarId(id) ? CAR_SIZE : BIKE_SIZE;
  const colours = resolveLook(id, look);
  for (const view of ['side', 'front', 'back'] as const) {
    const c = document.createElement('canvas');
    c.width = size.w * RES;
    c.height = size.h * RES;
    const ctx = c.getContext('2d')!;
    ctx.scale(RES, RES);
    drawShowroomVehicle(ctx, id, colours, view);
    scene.textures.addCanvas(`${key}_${view}`, c);
  }
  return key;
}

