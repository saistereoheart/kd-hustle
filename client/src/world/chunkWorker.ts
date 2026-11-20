// A Web Worker that paints map chunks (chunkPainter.ts) on OffscreenCanvas and sends them back as
// ImageBitmaps (no copying), with which cells of the overlay layers have anything in them. The
// main thread only uploads the pictures, so new parts of town appear without stalling the game.
import type { BuiltMap } from '@kh/shared';
import { ChunkPainter, occupancy, type Ctx } from './chunkPainter';
import { buildDecorSprites } from './tileset';

export type ChunkRequest = { type: 'init'; map: BuiltMap } | { type: 'paint'; id: number; cx: number; cy: number; res: number };
export interface ChunkReply {
  id: number;
  failed?: boolean;
  px: number;
  ground: ImageBitmap | null;
  canopy?: ImageBitmap | null;
  deck?: ImageBitmap | null;
  canopyOcc?: Uint8Array | null;
  deckOcc?: Uint8Array | null;
}

const GRID = 8;
let painter: ChunkPainter | null = null;
const offscreen = (w: number, h: number) => new OffscreenCanvas(w, h) as unknown as HTMLCanvasElement;

const ctxOf = (c: OffscreenCanvas) => c.getContext('2d', { willReadFrequently: true }) as unknown as Ctx;

self.onmessage = (e: MessageEvent<ChunkRequest>) => {
  const m = e.data;
  if (m.type === 'init') {
    painter = new ChunkPainter(m.map, buildDecorSprites(offscreen) as unknown as CanvasImageSource);
    return;
  }
  if (m.type !== 'paint') return;
  const post = (r: ChunkReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(r, transfer);
  if (!painter) return post({ id: m.id, failed: true, px: 0, ground: null });
  try {
    const p = painter.paint(m.cx, m.cy, m.res, (px) => {
      const canvas = new OffscreenCanvas(px, px);
      return { canvas, ctx: ctxOf(canvas) };
    });
    const canopyOcc = p.canopy ? occupancy(p.canopy.ctx, p.px, GRID) : null;
    const deckOcc = p.deck ? occupancy(p.deck.ctx, p.px, GRID) : null;
    const ground = p.ground.canvas.transferToImageBitmap();
    const canopy = p.canopy ? p.canopy.canvas.transferToImageBitmap() : null;
    const deck = p.deck ? p.deck.canvas.transferToImageBitmap() : null;
    const transfer: Transferable[] = [ground, ...(canopy ? [canopy] : []), ...(deck ? [deck] : [])];
    post({ id: m.id, px: p.px, ground, canopy, deck, canopyOcc, deckOcc }, transfer);
  } catch {
    post({ id: m.id, failed: true, px: 0, ground: null });
  }
};
