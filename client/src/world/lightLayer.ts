// Night lighting for the town (client only, cheap): street lamps glow, with a soft warm pool on
// the ground under each one. Lamps come from the map's decor grid; only those in view get a
// light (a small pool of reused sprites, additive blend over the night tint).
import Phaser from 'phaser';
import { Decor } from '@kh/shared';
import type { App } from '../app';

export const GLOW_TEXTURE = 'kh-glow';
const LIGHT_DEPTH = 1_600_000;

/** A soft round glow (white centre fading to nothing), shared by every light. */
export function ensureGlowTexture(scene: Phaser.Scene) {
  if (scene.textures.exists(GLOW_TEXTURE)) return;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  scene.textures.addCanvas(GLOW_TEXTURE, c);
}

const hex = (c: string) => parseInt(c.slice(1), 16);

export class LightLayer {
  private pools: Phaser.GameObjects.Image[] = [];
  private heads: Phaser.GameObjects.Image[] = [];
  private used = 0;
  private scanAcc = 1000;
  private lastView = '';
  private strength = 0;

  constructor(private scene: Phaser.Scene, private app: App) {
    ensureGlowTexture(scene);
  }

  private light() {
    return this.app.cfg.time.lighting ?? { nightTint: '#949ed2', lampColor: '#ffd58a', stallColor: '#ffb45c', lampPoolTiles: 3.4, lampStrength: 0.75, stallStrength: 0.9, maxLamps: 110 };
  }

  /** `dark`: 0 (day) .. 1 (night). */
  update(dtMs: number, dark: number) {
    const L = this.light();
    this.strength = dark * L.lampStrength;
    if (dark < 0.05) {
      if (this.used) this.hideFrom(0);
      return;
    }
    const view = this.scene.cameras.main.worldView;
    const key = `${Math.floor(view.x / 64)}|${Math.floor(view.y / 64)}|${Math.round(view.width / 64)}`;
    this.scanAcc += dtMs;
    if (key !== this.lastView || this.scanAcc > 2000 || !this.used) {
      this.scanAcc = 0;
      this.lastView = key;
      this.scan(view, L);
    }
    // Lamps flicker on at dusk and breathe very slightly.
    const t = performance.now() / 1000;
    for (let i = 0; i < this.used; i++) {
      const w = 0.94 + 0.06 * Math.sin(t * 2.1 + i * 1.7);
      this.pools[i].setAlpha(this.strength * 0.55 * w);
      this.heads[i].setAlpha(Math.min(1, this.strength * 1.1) * w);
    }
  }

  private scan(view: Phaser.Geom.Rectangle, L: NonNullable<App['cfg']['time']['lighting']>) {
    const m = this.app.map;
    const T = m.tileSize;
    const pad = 3;
    const tx0 = Math.floor(view.x / T) - pad, ty0 = Math.floor(view.y / T) - pad;
    const tx1 = Math.ceil((view.x + view.width) / T) + pad, ty1 = Math.ceil((view.y + view.height) / T) + pad;
    const col = hex(L.lampColor);
    let n = 0;
    for (let ty = ty0; ty <= ty1 && n < L.maxLamps; ty++) {
      const gy = ty - m.originTy;
      if (gy < 0 || gy >= m.height) continue;
      for (let tx = tx0; tx <= tx1 && n < L.maxLamps; tx++) {
        const gx = tx - m.originTx;
        if (gx < 0 || gx >= m.width || m.decor[gy * m.width + gx] !== Decor.Lamp) continue;
        // The lamp head sits at the top right of its tile sprite; the pool lands just below it.
        const hx = (tx + 0.72) * T, hy = (ty + 0.28) * T;
        this.place(n++, hx, hy, (tx + 0.62) * T, (ty + 1.1) * T, L.lampPoolTiles * T, col);
      }
    }
    this.hideFrom(n);
  }

  private place(i: number, hx: number, hy: number, px: number, py: number, d: number, col: number) {
    if (!this.pools[i]) {
      this.pools[i] = this.scene.add.image(0, 0, GLOW_TEXTURE).setBlendMode(Phaser.BlendModes.ADD).setDepth(LIGHT_DEPTH);
      this.heads[i] = this.scene.add.image(0, 0, GLOW_TEXTURE).setBlendMode(Phaser.BlendModes.ADD).setDepth(LIGHT_DEPTH + 1);
    }
    this.pools[i].setPosition(px, py).setDisplaySize(d, d * 0.62).setTint(col).setVisible(true);
    this.heads[i].setPosition(hx, hy).setDisplaySize(d * 0.32, d * 0.32).setTint(0xfff4d6).setVisible(true);
    this.used = Math.max(this.used, i + 1);
  }

  private hideFrom(n: number) {
    for (let i = n; i < this.used; i++) {
      this.pools[i].setVisible(false);
      this.heads[i].setVisible(false);
    }
    this.used = n;
  }

  destroy() {
    for (const o of [...this.pools, ...this.heads]) o.destroy();
    this.pools = [];
    this.heads = [];
  }
}
