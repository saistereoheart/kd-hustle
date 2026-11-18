// Hides static world objects that are far off-screen. Phaser draws everything in the scene every
// frame, visible or not, and Graphics are re-tessellated each time, so a map full of stalls,
// signposts and "FOR SALE" signs costs a lot even when you can see only a few of them.
import type Phaser from 'phaser';

interface Cullable {
  visible: boolean;
  scene?: Phaser.Scene | null;
  setVisible(v: boolean): unknown;
}

interface Item {
  obj: Cullable;
  x: number;
  y: number;
  /** Half-size of the object around (x, y), in world px. */
  r: number;
}

export class Culler {
  private items: Item[] = [];
  private lastKey = '';
  private acc = 0;

  /** Pad (world px) around the view, so things appear before they scroll in. */
  constructor(private pad = 320) {}

  add(obj: Cullable, x: number, y: number, r = 160) {
    this.items.push({ obj, x, y, r });
    this.lastKey = ''; // re-check on the next update
  }

  /** Re-checks when the view has moved a little (or every half second); call every frame. */
  update(view: Phaser.Geom.Rectangle, dtMs: number) {
    this.acc += dtMs;
    const key = `${Math.floor(view.x / 96)}|${Math.floor(view.y / 96)}|${Math.round(view.width / 96)}|${Math.round(view.height / 96)}`;
    if (key === this.lastKey && this.acc < 500) return;
    this.lastKey = key;
    this.acc = 0;
    const x0 = view.x - this.pad, x1 = view.right + this.pad, y0 = view.y - this.pad, y1 = view.bottom + this.pad;
    let dead = 0;
    for (const it of this.items) {
      if (!it.obj.scene) {
        dead++; // destroyed
        continue;
      }
      const vis = it.x + it.r > x0 && it.x - it.r < x1 && it.y + it.r > y0 && it.y - it.r < y1;
      if (it.obj.visible !== vis) it.obj.setVisible(vis);
    }
    if (dead > 32) this.items = this.items.filter((it) => it.obj.scene);
  }
}
