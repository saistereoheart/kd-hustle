// Shows the map as chunk textures around the camera (see chunkPainter.ts for the drawing). Chunks
// are painted in a Web Worker when the browser can (chunkWorker.ts), so driving into new parts of
// town doesn't stall the game; otherwise (and for the first screenful) on the main thread. Far
// chunks are evicted, so memory stays bounded on phones even though the whole map is huge.
import Phaser from 'phaser';
import type { BuiltMap } from '@kh/shared';
import { buildDecorSprites } from './tileset';
import { addCanvasTexture } from './canvasTexture';
import { BLEED, CHUNK, ChunkPainter, occupancy, type Ctx } from './chunkPainter';
import type { ChunkReply } from './chunkWorker';

/** Elevated roads draw above characters (≈ 500,000 + y) but below labels and tree canopies. */
export const DECK_DEPTH = 900_000;
const CANOPY_DEPTH = 1_000_000;
const GRID = 8;

interface LiveChunk {
  ground: Phaser.GameObjects.Image;
  canopy: Phaser.GameObjects.Image[];
  /** Elevated roads and the MRT viaduct: drawn above characters so you walk UNDER them. */
  deck: Phaser.GameObjects.Image[];
  keys: string[];
  bitmaps: ImageBitmap[];
  lastUsed: number;
}

// ------------------------------------------------------------------ the shared painters
/** One painter for main-thread drawing (built on first use), one worker per map. */
let mainPainter: { map: BuiltMap; painter: ChunkPainter } | null = null;
function painterFor(map: BuiltMap): ChunkPainter {
  if (mainPainter?.map !== map) mainPainter = { map, painter: new ChunkPainter(map, buildDecorSprites()) };
  return mainPainter.painter;
}
let worker: { map: BuiltMap; w: Worker } | null = null;
let workerBroken = false;
const waiting = new Map<number, (r: ChunkReply) => void>();
let nextId = 1;
function workerFor(map: BuiltMap): Worker | null {
  if (workerBroken || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  if (worker?.map === map) return worker.w;
  try {
    worker?.w.terminate();
    const w = new Worker(new URL('./chunkWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<ChunkReply>) => {
      const cb = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      cb?.(e.data);
    };
    w.onerror = () => {
      // No worker after all (old browser, blocked): paint on the main thread from now on.
      workerBroken = true;
      for (const cb of waiting.values()) cb({ id: -1, failed: true } as ChunkReply);
      waiting.clear();
    };
    w.postMessage({ type: 'init', map });
    worker = { map, w };
    return w;
  } catch {
    workerBroken = true;
    return null;
  }
}

export class ChunkRenderer {
  private live = new Map<string, LiveChunk>();
  /** Chunks a worker is painting right now. */
  private pending = new Set<string>();
  private res: number;
  private maxChunks: number;
  private counter = 0;
  private deckAlpha = 1;
  private dead = false;

  constructor(private scene: Phaser.Scene, private map: BuiltMap, resolution: number) {
    this.res = resolution;
    const bytesPerChunk = (CHUNK * map.tileSize * resolution) ** 2 * 4 * 1.5; // + canopy layers
    // Enough to keep the chunks around you (and the prefetch ring) without redrawing them when
    // you walk back and forth.
    this.maxChunks = Math.max(24, Math.floor((112 * 1024 * 1024) / bytesPerChunk));
    workerFor(map); // start it early: it has to receive the map before it can paint
  }

  /** Ensure chunks around the camera exist; evict far ones. Call every frame. With `force`
   *  everything on screen is painted right now (the first frame, after a resize). */
  update(view: Phaser.Geom.Rectangle, budgetMs = 8, force = false) {
    const T = this.map.tileSize;
    const S = CHUNK * T;
    const pad = S * 1.1; // paint chunks well before they scroll into view
    const cx0 = Math.floor((view.x - pad) / S), cx1 = Math.floor((view.right + pad) / S);
    const cy0 = Math.floor((view.y - pad) / S), cy1 = Math.floor((view.bottom + pad) / S);
    const minCx = Math.floor(this.map.originTx / CHUNK), maxCx = Math.floor((this.map.originTx + this.map.width - 1) / CHUNK);
    const minCy = Math.floor(this.map.originTy / CHUNK), maxCy = Math.floor((this.map.originTy + this.map.height - 1) / CHUNK);
    const midX = (view.x + view.right) / 2, midY = (view.y + view.bottom) / 2;
    const need: Array<[number, number, number, boolean]> = [];
    const now = ++this.counter;
    for (let cy = Math.max(cy0, minCy); cy <= Math.min(cy1, maxCy); cy++)
      for (let cx = Math.max(cx0, minCx); cx <= Math.min(cx1, maxCx); cx++) {
        const key = `${cx},${cy}`;
        const live = this.live.get(key);
        if (live) live.lastUsed = now;
        else if (!this.pending.has(key)) {
          const onScreen = (cx + 1) * S > view.x && cx * S < view.right && (cy + 1) * S > view.y && cy * S < view.bottom;
          need.push([cx, cy, Math.hypot((cx + 0.5) * S - midX, (cy + 0.5) * S - midY), onScreen]);
        }
      }
    need.sort((a, b) => a[2] - b[2]);
    const w = force ? null : workerFor(this.map);
    const start = performance.now();
    for (const [cx, cy, , onScreen] of need) {
      if (w) {
        // In the background, a few at a time (nearest first)...
        if (this.pending.size < 3) {
          this.request(w, cx, cy);
          continue;
        }
        // ...unless it's on screen already and the worker is busy: paint that one here.
        if (!onScreen) break;
      }
      this.paintHere(cx, cy, now);
      if (!force && performance.now() - start > budgetMs) break;
    }
    if (this.live.size > this.maxChunks) {
      const old = [...this.live.entries()].filter(([, c]) => c.lastUsed !== now).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (const [k, c] of old.slice(0, this.live.size - this.maxChunks)) this.destroyChunk(k, c);
    }
  }

  get chunkCount() {
    return this.live.size;
  }

  /** Fade the elevated layer (while the player walks underneath it). */
  setDeckAlpha(a: number) {
    if (a === this.deckAlpha) return;
    this.deckAlpha = a;
    for (const c of this.live.values()) for (const d of c.deck) d.setAlpha(a);
  }

  private destroyChunk(key: string, c: LiveChunk) {
    c.ground.destroy();
    for (const o of c.canopy) o.destroy();
    for (const o of c.deck) o.destroy();
    for (const k of c.keys) this.scene.textures.remove(k);
    for (const b of c.bitmaps) b.close();
    this.live.delete(key);
  }

  destroy() {
    this.dead = true;
    for (const [k, c] of this.live) this.destroyChunk(k, c);
  }

  /** Ask the worker to paint a chunk; it's added when the pictures come back. */
  private request(w: Worker, cx: number, cy: number) {
    const key = `${cx},${cy}`;
    const id = nextId++;
    this.pending.add(key);
    waiting.set(id, (r) => {
      this.pending.delete(key);
      if (this.dead || this.live.has(key)) {
        for (const b of [r.ground, r.canopy, r.deck]) b?.close();
        return;
      }
      if (r.failed || !r.ground) return; // painted on the main thread next frame instead
      const bitmaps = [r.ground, r.canopy, r.deck].filter((b): b is ImageBitmap => !!b);
      this.addChunk(cx, cy, this.counter, r.px, { ground: r.ground, canopy: r.canopy ?? null, deck: r.deck ?? null }, r.canopyOcc ?? null, r.deckOcc ?? null, bitmaps);
    });
    w.postMessage({ type: 'paint', id, cx, cy, res: this.res });
  }

  /** Paint a chunk on the main thread (no worker, or it's needed this very frame). */
  private paintHere(cx: number, cy: number, now: number) {
    const p = painterFor(this.map).paint(cx, cy, this.res, (px) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = px;
      // The overlay layers are read back once (to skip their empty parts): keep them on the CPU.
      return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true })! };
    });
    this.addChunk(
      cx, cy, now, p.px,
      { ground: p.ground.canvas, canopy: p.canopy?.canvas ?? null, deck: p.deck?.canvas ?? null },
      p.canopy ? occupancy(p.canopy.ctx, p.px, GRID) : null,
      p.deck ? occupancy(p.deck.ctx as Ctx, p.px, GRID) : null,
      [],
    );
  }

  private addChunk(
    cx: number, cy: number, now: number, px: number,
    src: { ground: CanvasImageSource; canopy: CanvasImageSource | null; deck: CanvasImageSource | null },
    canopyOcc: Uint8Array | null, deckOcc: Uint8Array | null, bitmaps: ImageBitmap[],
  ) {
    const T = this.map.tileSize;
    const keyBase = `chunk_${cx}_${cy}_${Math.random().toString(36).slice(2, 7)}`;
    const ox = (cx * CHUNK - BLEED) * T, oy = (cy * CHUNK - BLEED) * T;
    const keys = [`${keyBase}_g`];
    addCanvasTexture(this.scene, keys[0], src.ground as HTMLCanvasElement);
    const img = this.scene.add.image(ox, oy, keys[0]).setOrigin(0).setScale(1 / this.res).setDepth(-1000);
    let canopy: Phaser.GameObjects.Image[] = [];
    if (src.canopy && canopyOcc) {
      keys.push(`${keyBase}_c`);
      addCanvasTexture(this.scene, `${keyBase}_c`, src.canopy as HTMLCanvasElement);
      canopy = this.pieces(`${keyBase}_c`, px, canopyOcc, ox, oy, CANOPY_DEPTH, 0.72);
    }
    let deck: Phaser.GameObjects.Image[] = [];
    if (src.deck && deckOcc) {
      keys.push(`${keyBase}_d`);
      addCanvasTexture(this.scene, `${keyBase}_d`, src.deck as HTMLCanvasElement);
      deck = this.pieces(`${keyBase}_d`, px, deckOcc, ox, oy, DECK_DEPTH, this.deckAlpha);
    }
    this.live.set(`${cx},${cy}`, { ground: img, canopy, deck, keys, bitmaps, lastUsed: now });
  }

  /**
   * An overlay layer (tree canopies, elevated roads) is mostly see-through. Drawing the whole chunk
   * would blend a full screen of empty pixels every frame, which weak GPUs feel. So it's cut into
   * a grid and only the cells with something in them are drawn (runs of cells along a row become
   * one image; all of them share the one texture).
   */
  private pieces(key: string, px: number, occ: Uint8Array, ox: number, oy: number, depth: number, alpha: number): Phaser.GameObjects.Image[] {
    const cell = Math.ceil(px / GRID);
    const tex = this.scene.textures.get(key);
    const out: Phaser.GameObjects.Image[] = [];
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        if (!occ[r * GRID + c]) continue;
        let c1 = c;
        while (c1 + 1 < GRID && occ[r * GRID + c1 + 1]) c1++;
        const x = c * cell, y = r * cell;
        const w = Math.min(px, (c1 + 1) * cell) - x, h = Math.min(px, (r + 1) * cell) - y;
        const name = `${r}_${c}`;
        tex.add(name, 0, x, y, w, h);
        out.push(this.scene.add.image(ox + x / this.res, oy + y / this.res, key, name).setOrigin(0).setScale(1 / this.res).setDepth(depth).setAlpha(alpha));
        c = c1;
      }
    }
    return out;
  }
}
