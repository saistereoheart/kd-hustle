// Map view: chunked vector renderer + labels for named landmarks.
import Phaser from 'phaser';
import type { BuiltMap } from '@kh/shared';
import { ChunkRenderer } from './chunkRenderer';

export { roofColorOf } from './chunkRenderer';

export class MapView {
  private chunks: ChunkRenderer;
  private labels: Phaser.GameObjects.Text[] = [];

  constructor(scene: Phaser.Scene, map: BuiltMap, resolution: number) {
    this.chunks = new ChunkRenderer(scene, map, resolution);
    const T = map.tileSize;
    for (const b of map.buildings) {
      if (!b.name) continue;
      const w = (b.bbox.x1 - b.bbox.x0) * T;
      const t = scene.add
        .text(((b.bbox.x0 + b.bbox.x1) / 2) * T, ((b.bbox.y0 + b.bbox.y1) / 2) * T, b.name, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: `${Math.max(16, Math.min(30, w / 9))}px`,
          fontStyle: 'bold',
          color: '#ffffff',
          stroke: '#1d2133',
          strokeThickness: 5,
          align: 'center',
          wordWrap: { width: Math.max(140, w - 16) },
          resolution: 2,
        })
        .setOrigin(0.5)
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

  get chunkCount() {
    return this.chunks.chunkCount;
  }

  destroy() {
    this.chunks.destroy();
  }
}
