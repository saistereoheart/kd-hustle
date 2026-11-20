// A Web Worker that builds the 3D vehicle models and renders their views (render.ts is plain
// JavaScript, no DOM), so a new car coming into view never freezes the game on a slow device.
// It answers with the raw RGBA pixels (transferred, not copied).
import { buildBike } from './bikes';
import { buildCar, type CarLook } from './cars';
import { renderModel, type Model, type RenderOpts } from './render';

export interface VehicleJob {
  jid: number;
  id: string;
  look: CarLook;
  yaw: number;
  opts: RenderOpts;
}
export interface VehicleDone {
  jid: number;
  w: number;
  h: number;
  pixels: Uint8ClampedArray<ArrayBuffer> | null;
}

const models = new Map<string, Model>();
self.onmessage = (e: MessageEvent<VehicleJob>) => {
  const j = e.data;
  const post = (r: VehicleDone, t: Transferable[] = []) => (self as unknown as Worker).postMessage(r, t);
  try {
    const key = `${j.id}|${j.look.paint}|${j.look.wheel}|${j.look.tip}`;
    let m = models.get(key);
    if (!m) {
      m = j.id.startsWith('car_') ? buildCar(j.id, j.look) : buildBike(j.id, j.look);
      if (models.size > 24) models.delete(models.keys().next().value as string);
      models.set(key, m);
    }
    const pixels = renderModel(m, j.yaw, j.opts);
    post({ jid: j.jid, w: j.opts.w, h: j.opts.h, pixels }, [pixels.buffer]);
  } catch {
    post({ jid: j.jid, w: 0, h: 0, pixels: null });
  }
};
