// 🚗 Motor Kota vehicles: four cars and four big bikes, each a real 3D model built from the real
// vehicle's dimensions (see vehicle3d/), rendered in code the way the town camera sees things.
// One model gives every direction: side (facing LEFT; the sprite is flipped to face right),
// front, back and the two 45° views. Paint, wheel colour and the exhaust tip come from the look.
import type Phaser from 'phaser';
import type { GarageConfig, VehicleLook } from '@kh/shared';
import { buildBike } from './vehicle3d/bikes';
import { buildCar } from './vehicle3d/cars';
import { project, renderModel, type Model } from './vehicle3d/render';

type Ctx = CanvasRenderingContext2D;
/** side / front / back, plus the 45° views (dfront: going down-left, dback: going up-left). */
export type View = 'side' | 'front' | 'back' | 'dfront' | 'dback';
export const VIEWS: readonly View[] = ['side', 'front', 'back', 'dfront', 'dback'];
export interface Look {
  paint: string; // colour
  wheel: string; // colour
  tip: 'stock' | 'sport' | 'racing' | 'straight';
}

/** Which way the vehicle points in each view (radians; 0 = right, π/2 = away from the camera). */
export const VIEW_YAW: Record<View, number> = {
  side: Math.PI,
  front: -Math.PI / 2,
  back: Math.PI / 2,
  dfront: (-3 * Math.PI) / 4,
  dback: (3 * Math.PI) / 4,
};

export const isCarId = (id: string) => id.startsWith('car_');
/** Texture pixels per metre (before the sprite's scale in town). Cars are at the map's real scale
 *  (16 px a metre in town); bikes a little bigger so a chibi rider fits on them. */
export const pxPerMetre = (id: string) => (isCarId(id) ? 32 : 40);
/** The sprite's scale in town. */
export const townScale = (_id: string) => 0.5;

// ------------------------------------------------------------------ models
const models = new Map<string, Model>();
function modelFor(id: string, look: Look): Model {
  const key = `${id}|${look.paint}|${look.wheel}|${look.tip}`;
  let m = models.get(key);
  if (!m) {
    m = isCarId(id) ? buildCar(id, look) : buildBike(id, look);
    if (models.size > 24) models.delete(models.keys().next().value as string);
    models.set(key, m);
  }
  return m;
}

/** Canvas layout for a vehicle (the same for every view): `center` is where the middle of the
 *  vehicle meets the ground, horizontally in the middle. */
export interface Layout {
  w: number;
  h: number;
  ground: number;
  center: number;
}
const layouts = new Map<string, Layout>();
export function viewSize(id: string, _view?: View): Layout {
  let l = layouts.get(id);
  if (l) return l;
  const m = modelFor(id, { paint: '#888888', wheel: '#888888', tip: 'racing' });
  const s = pxPerMetre(id);
  let maxX = 0, minY = 0, maxY = 0;
  for (const yaw of Object.values(VIEW_YAW)) {
    for (const t of m.mesh.tris) {
      for (const v of [t.a, t.b, t.c]) {
        const [x, y] = project(v.p, yaw, s);
        maxX = Math.max(maxX, Math.abs(x));
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const top = Math.ceil(-minY + 3), bottom = Math.ceil(maxY + 4);
  l = { w: Math.ceil(maxX + 4) * 2, h: top + bottom, ground: top, center: top };
  layouts.set(id, l);
  return l;
}

/** Where a seat is in a view, in texture pixels from the anchor (x right, y down). Seat 0 is the
 *  rider's / driver's, 1 the pillion / front passenger, and so on. */
export function seatPoint(id: string, view: View, seat = 0): { x: number; y: number } {
  const m = modelFor(id, { paint: '#888888', wheel: '#888888', tip: 'stock' });
  const p = m.seats[Math.min(seat, m.seats.length - 1)];
  const [x, y] = project(p, VIEW_YAW[view], pxPerMetre(id));
  return { x, y };
}
export function seatCount(id: string): number {
  return modelFor(id, { paint: '#888888', wheel: '#888888', tip: 'stock' }).seats.length;
}

/** Draws a showroom vehicle into a canvas laid out as viewSize(id). The context's current scale
 *  sets the detail (it's rendered at the real pixel size, then drawn in). */
export function drawShowroomVehicle(ctx: Ctx, id: string, look: Look, view: View) {
  const size = viewSize(id, view);
  const t = ctx.getTransform();
  const k = Math.max(0.25, Math.hypot(t.a, t.b));
  const W = Math.max(1, Math.round(size.w * k)), H = Math.max(1, Math.round(size.h * k));
  // Supersample small pictures more (they need the smoothing); big ones are fine as they are.
  const ss = W * H > 300_000 ? 1 : 2;
  const px = renderModel(modelFor(id, look), VIEW_YAW[view], { w: W, h: H, ox: W / 2, oy: size.center * (H / size.h), scale: pxPerMetre(id) * (W / size.w), ss });
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.getContext('2d')!.putImageData(new ImageData(px, W, H), 0, 0);
  ctx.drawImage(c, 0, 0, size.w, size.h);
}

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

const RES = 1.6; // texture pixels per layout pixel (3.2 per world pixel in town)

/** Views waiting to be drawn: one per frame, so a new vehicle never stalls the game. */
const queue: Array<() => void> = [];
let pumping = false;
function pump() {
  const job = queue.shift();
  if (!job) {
    pumping = false;
    return;
  }
  job();
  requestAnimationFrame(pump);
}

/** Makes <key>_side / _front / _back / _dfront / _dback for this vehicle and look (once) and returns
 *  the key. The side view is drawn now; the others follow over the next few frames. */
export function ensureShowroomTextures(scene: Phaser.Scene, id: string, look: VehicleLook | null | undefined): string {
  const key = `sr_${id}_${look?.paint ?? '-'}_${look?.wheel ?? '-'}_${look?.exhaust ?? '-'}`;
  if (scene.textures.exists(`${key}_side`)) return key;
  const colours = resolveLook(id, look);
  const size = viewSize(id);
  const order: View[] = ['side', 'dfront', 'front', 'back', 'dback'];
  for (const view of order) {
    const tex = scene.textures.createCanvas(`${key}_${view}`, Math.round(size.w * RES), Math.round(size.h * RES));
    if (!tex) continue;
    const draw = () => {
      if (!scene.textures.exists(`${key}_${view}`)) return;
      const ctx = tex.getContext();
      ctx.save();
      ctx.scale(RES, RES);
      drawShowroomVehicle(ctx, id, colours, view);
      ctx.restore();
      tex.refresh();
    };
    if (view === 'side') draw();
    else queue.push(draw);
  }
  if (!pumping && queue.length) {
    pumping = true;
    requestAnimationFrame(pump);
  }
  return key;
}
