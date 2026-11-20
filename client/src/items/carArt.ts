// 🚗 Motor Kota vehicles: four cars and four big bikes, each a real 3D model built from the real
// vehicle's dimensions (see vehicle3d/), rendered in code the way the town camera sees things.
// One model gives every direction: side (facing LEFT; the sprite is flipped to face right),
// front, back and the two 45° views. Paint, wheel colour and the exhaust tip come from the look.
import type Phaser from 'phaser';
import type { GarageConfig, VehicleLook } from '@kh/shared';
import { bikeMeta, buildBike } from './vehicle3d/bikes';
import { buildCar, carMeta } from './vehicle3d/cars';
import { project, renderModel, type Model, type ModelMeta, type RenderOpts } from './vehicle3d/render';
import type { VehicleDone, VehicleJob } from './vehicle3d/vehicleWorker';

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
/** Layout pixels per metre (town = layout × townScale): cars ~25.6 px a metre in town, a bit bigger
 *  than the map's real scale (16) so they read next to the chibi characters; bikes 32. */
export const pxPerMetre = (id: string) => (isCarId(id) ? 51.2 : 64);
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
const metas = new Map<string, ModelMeta>();
/** Size, seats and wheels from the spec (instant: no 3D model is built on the main thread). */
function metaOf(id: string): ModelMeta {
  let m = metas.get(id);
  if (!m) {
    m = isCarId(id) ? carMeta(id) : bikeMeta(id);
    metas.set(id, m);
  }
  return m;
}
export function viewSize(id: string, _view?: View): Layout {
  let l = layouts.get(id);
  if (l) return l;
  const { box } = metaOf(id);
  const s = pxPerMetre(id);
  // Every view must fit: the box's corners turned each way (plus room for the soft shadow).
  const pts: Array<[number, number, number]> = [];
  for (const x of [box.x0 - 0.25, box.x1 + 0.25]) for (const y of [-box.hw - 0.25, box.hw + 0.25]) pts.push([x, y, 0]);
  for (const x of [box.x0, box.x1]) for (const y of [-box.hw, box.hw]) pts.push([x, y, box.h]);
  let maxX = 0, minY = 0, maxY = 0;
  for (const yaw of Object.values(VIEW_YAW)) {
    for (const p of pts) {
      const [x, y] = project(p, yaw, s);
      maxX = Math.max(maxX, Math.abs(x));
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const top = Math.ceil(-minY + 2), bottom = Math.ceil(maxY + 2);
  l = { w: Math.ceil(maxX + 2) * 2, h: top + bottom, ground: top, center: top };
  layouts.set(id, l);
  return l;
}

/** Where a seat is in a view, in texture pixels from the anchor (x right, y down). Seat 0 is the
 *  rider's / driver's, 1 the pillion / front passenger, and so on. */
export function seatPoint(id: string, view: View, seat = 0): { x: number; y: number } {
  const m = metaOf(id);
  const p = m.seats[Math.min(seat, m.seats.length - 1)];
  const [x, y] = project(p, VIEW_YAW[view], pxPerMetre(id));
  return { x, y };
}
/** Where the rear tyres touch the road in a view, in world px from the sprite's anchor (x right, y down). */
export function rearWheels(id: string, view: View): Array<{ x: number; y: number }> {
  const m = metaOf(id);
  const k = townScale(id);
  return m.wheels.map((p) => {
    const [x, y] = project(p, VIEW_YAW[view], pxPerMetre(id));
    return { x: x * k, y: y * k };
  });
}
export function seatCount(id: string): number {
  return metaOf(id).seats.length;
}

/** How a view is rendered at `k` device pixels per layout pixel. */
function renderOpts(id: string, view: View, k: number): RenderOpts {
  const size = viewSize(id, view);
  const W = Math.max(1, Math.round(size.w * k)), H = Math.max(1, Math.round(size.h * k));
  // Supersample small pictures more (they need the smoothing); big ones are fine as they are.
  const ss = W * H > 300_000 ? 1 : 2;
  return { w: W, h: H, ox: W / 2, oy: size.center * (H / size.h), scale: pxPerMetre(id) * (W / size.w), ss };
}

/** Draws a showroom vehicle into a canvas laid out as viewSize(id). The context's current scale
 *  sets the detail (it's rendered at the real pixel size, then drawn in). */
export function drawShowroomVehicle(ctx: Ctx, id: string, look: Look, view: View) {
  const size = viewSize(id, view);
  const t = ctx.getTransform();
  const o = renderOpts(id, view, Math.max(0.25, Math.hypot(t.a, t.b)));
  const W = o.w, H = o.h;
  const px = renderModel(modelFor(id, look), VIEW_YAW[view], o);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.getContext('2d')!.putImageData(new ImageData(px, W, H), 0, 0);
  ctx.drawImage(c, 0, 0, size.w, size.h);
}

// ------------------------------------------------------------------ icons
const icons = new Map<string, string>();
/** A cartoon icon of the vehicle (its 3D model seen from the front-left, cel-shaded), as a
 *  data URL `px` pixels square. Cached per look. */
export function vehicleIconUrl(id: string, look: Look, px: number): string {
  const key = `${id}|${look.paint}|${look.wheel}|${look.tip}|${px}`;
  const hit = icons.get(key);
  if (hit) return hit;
  const m = modelFor(id, look);
  const yaw = VIEW_YAW.dfront;
  // Fit the turned model in the square (no shadow, a small margin for the outline).
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const t of m.mesh.tris) {
    for (const v of [t.a, t.b, t.c]) {
      const [x, y] = project(v.p, yaw, 1);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  const pad = Math.max(2, px * 0.06);
  const scale = Math.min((px - pad * 2) / (x1 - x0), (px - pad * 2) / (y1 - y0));
  const ox = px / 2 - ((x0 + x1) / 2) * scale, oy = px / 2 - ((y0 + y1) / 2) * scale;
  const pixels = renderModel({ ...m, shadow: () => 0 }, yaw, { w: px, h: px, ox, oy, scale, ss: 2, toon: true });
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  c.getContext('2d')!.putImageData(new ImageData(pixels, px, px), 0, 0);
  const url = c.toDataURL('image/png');
  icons.set(key, url);
  return url;
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
/** Texture pixels per layout pixel: sprites are scaled by townScale / TEX_RES. */
export const TEX_RES = RES;

/** Views waiting to be drawn on the main thread (no worker): one per frame. */
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
function queueHere(job: () => void) {
  queue.push(job);
  if (!pumping) {
    pumping = true;
    requestAnimationFrame(pump);
  }
}

// The 3D work happens in a worker when the browser has one: building a model and rendering its
// five views is about half a second of work (seconds on a slow phone), and would freeze the game
// each time a new car or paint job comes into view.
let worker: Worker | null = null;
let workerBroken = false;
const waiting = new Map<number, (r: VehicleDone) => void>();
let nextJob = 1;
function vehicleWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./vehicle3d/vehicleWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<VehicleDone>) => {
      const cb = waiting.get(e.data.jid);
      waiting.delete(e.data.jid);
      cb?.(e.data);
    };
    worker.onerror = () => {
      workerBroken = true;
      for (const cb of waiting.values()) cb({ jid: -1, w: 0, h: 0, pixels: null });
      waiting.clear();
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

/** Makes <key>_side / _front / _back / _dfront / _dback for this vehicle and look (once) and returns
 *  the key. The textures exist at once (blank) and fill in as the views are rendered: in a worker,
 *  or one per frame here when there's no worker. */
export function ensureShowroomTextures(scene: Phaser.Scene, id: string, look: VehicleLook | null | undefined): string {
  const key = `sr_${id}_${look?.paint ?? '-'}_${look?.wheel ?? '-'}_${look?.exhaust ?? '-'}`;
  if (scene.textures.exists(`${key}_side`)) return key;
  const colours = resolveLook(id, look);
  const order: View[] = ['side', 'dfront', 'front', 'back', 'dback'];
  const w = vehicleWorker();
  for (const view of order) {
    const o = renderOpts(id, view, RES);
    const tex = scene.textures.createCanvas(`${key}_${view}`, o.w, o.h);
    if (!tex) continue;
    const alive = () => scene.textures.exists(`${key}_${view}`);
    const fill = (pixels: Uint8ClampedArray<ArrayBuffer>) => {
      if (!alive()) return;
      tex.getContext().putImageData(new ImageData(pixels, o.w, o.h), 0, 0);
      tex.refresh();
    };
    const here = () => {
      if (alive()) fill(renderModel(modelFor(id, colours), VIEW_YAW[view], o));
    };
    if (w) {
      const jid = nextJob++;
      waiting.set(jid, (r) => (r.pixels ? fill(r.pixels) : queueHere(here)));
      const job: VehicleJob = { jid, id, look: colours, yaw: VIEW_YAW[view], opts: o };
      w.postMessage(job);
    } else queueHere(here);
  }
  return key;
}
