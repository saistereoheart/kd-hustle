// Map view: chunked vector renderer + labels for named landmarks.
import Phaser from 'phaser';
import type { BuiltMap } from '@kh/shared';
import { ChunkRenderer } from './chunkRenderer';

export { roofColorOf } from './chunkPainter';

export class MapView {
  private chunks: ChunkRenderer;
  private labels: Phaser.GameObjects.Text[] = [];
  /** 1 where something elevated (road deck, MRT viaduct) passes overhead. */
  readonly overhead: Uint8Array;
  private deckAlpha = 1;

  constructor(scene: Phaser.Scene, private map: BuiltMap, resolution: number) {
    this.chunks = new ChunkRenderer(scene, map, resolution);
    this.overhead = map.deck.slice();
    for (const r of map.rails) {
      if (!r.elevated) continue;
      for (let s = 0; s + 3 < r.pts.length; s += 2) {
        const ax = r.pts[s], ay = r.pts[s + 1], bx = r.pts[s + 2], by = r.pts[s + 3];
        const len = Math.hypot(bx - ax, by - ay);
        for (let t = 0; t <= len; t += 0.5) {
          const px = ax + ((bx - ax) * t) / (len || 1), py = ay + ((by - ay) * t) / (len || 1);
          for (let oy = -2; oy <= 2; oy++)
            for (let ox = -2; ox <= 2; ox++) {
              const gx = Math.floor(px + ox) - map.originTx, gy = Math.floor(py + oy) - map.originTy;
              if (gx >= 0 && gy >= 0 && gx < map.width && gy < map.height && Math.hypot(ox, oy) <= 1.7) this.overhead[gy * map.width + gx] = 1;
            }
        }
      }
    }
    const T = map.tileSize;
    // Two kinds of building names: places you can USE (something inside: gold, heavy, with a
    // door icon) and plain landmarks (white, lighter, smaller). Area names are drawn italic in
    // the map chunks, street names along their roads.
    const useful = new Set(map.interactables.map((i) => i.building).filter(Boolean));
    for (const b of map.buildings) {
      if (!b.name) continue;
      const w = (b.bbox.x1 - b.bbox.x0) * T;
      const isUseful = useful.has(b.id);
      const t = scene.add
        .text(((b.bbox.x0 + b.bbox.x1) / 2) * T, ((b.bbox.y0 + b.bbox.y1) / 2) * T, isUseful ? `🚪 ${b.name}` : b.name, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: `${isUseful ? Math.max(17, Math.min(30, w / 8)) : Math.max(14, Math.min(24, w / 10))}px`,
          fontStyle: isUseful ? '900' : '600',
          color: isUseful ? '#ffe066' : '#f1f3f5',
          stroke: '#1d2133',
          strokeThickness: isUseful ? 6 : 4,
          align: 'center',
          wordWrap: { width: Math.max(140, w - 16) },
          resolution: 2,
        })
        .setOrigin(0.5)
        .setAlpha(isUseful ? 1 : 0.9)
        .setDepth(-900);
      this.labels.push(t);
    }
  }

  /** Call every frame with the camera's world view. */
  update(view: Phaser.Geom.Rectangle, force = false) {
    this.chunks.update(view, force ? 1e9 : 8, force);
    const pad = 600;
    for (const t of this.labels) {
      t.setVisible(t.x > view.x - pad && t.x < view.right + pad && t.y > view.y - pad && t.y < view.bottom + pad);
    }
  }

  /** Is there a deck/viaduct over this world-pixel position? */
  overheadAt(wx: number, wy: number): boolean {
    const m = this.map;
    const gx = Math.floor(wx / m.tileSize) - m.originTx, gy = Math.floor(wy / m.tileSize) - m.originTy;
    return gx >= 0 && gy >= 0 && gx < m.width && gy < m.height && this.overhead[gy * m.width + gx] === 1;
  }

  /** Eases the elevated layer towards see-through (walking under it) or solid. */
  fadeDecks(under: boolean, dtMs: number) {
    const target = under ? 0.35 : 1;
    const k = Math.min(1, dtMs / 180);
    const a = Math.abs(target - this.deckAlpha) < 0.02 ? target : this.deckAlpha + (target - this.deckAlpha) * k;
    this.deckAlpha = a;
    this.chunks.setDeckAlpha(Math.round(a * 50) / 50);
  }

  get chunkCount() {
    return this.chunks.chunkCount;
  }

  destroy() {
    this.chunks.destroy();
    for (const t of this.labels) t.destroy();
    this.labels = [];
  }
}
