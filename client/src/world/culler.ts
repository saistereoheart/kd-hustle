// Hides static world objects that are far off-screen. Phaser draws everything in the scene every
// frame, visible or not, and Graphics are re-tessellated each time, so a map full of stalls,
// signposts and "FOR SALE" signs costs a lot even when you can see only a few of them.
//
// Hidden objects still cost memory, though: a Text is its own canvas plus a picture on the
// graphics card. So the many signs (one per home building: 500+) are "lazy": made when they come
// near the screen and destroyed when they're far away again (see addLazy).
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

/** An object made only while it's near the screen. */
export interface LazyItem<T extends Cullable & { destroy(): void }> {
  /** The object, or null while it's far away (or disabled). */
  obj: T | null;
  /** False: not made at all (destroyed if it was). Call Culler.recheck() after changing it. */
  enabled: boolean;
}

interface Lazy {
  item: LazyItem<Cullable & { destroy(): void }>;
  make: () => Cullable & { destroy(): void };
  x: number;
  y: number;
  r: number;
  dead: boolean;
}

/** Lazy objects this far past the pad (in pads) stay hidden rather than destroyed: walking back
 *  and forth along a street doesn't remake them every time. */
const KEEP = 2;

export class Culler {
  private items: Item[] = [];
  private lazies: Lazy[] = [];
  private lastKey = '';
  private acc = 0;

  /** Pad (world px) around the view, so things appear before they scroll in. */
  constructor(private pad = 320) {}

  add(obj: Cullable, x: number, y: number, r = 160) {
    this.items.push({ obj, x, y, r });
    this.lastKey = ''; // re-check on the next update
  }

  /** `make` builds the object when it first comes near the screen (again after it went far away). */
  addLazy<T extends Cullable & { destroy(): void }>(make: () => T, x: number, y: number, r = 160): LazyItem<T> {
    const item: LazyItem<T> = { obj: null, enabled: true };
    this.lazies.push({ item: item as unknown as Lazy['item'], make, x, y, r, dead: false });
    this.lastKey = '';
    return item;
  }

  /** Destroys a lazy object and forgets it. */
  removeLazy(item: LazyItem<Cullable & { destroy(): void }>) {
    const l = this.lazies.find((z) => z.item === item);
    if (!l) return;
    l.dead = true;
    item.obj?.destroy();
    item.obj = null;
    this.lazies = this.lazies.filter((z) => !z.dead);
  }

  /** Something changed (an item enabled or disabled): look again on the next update. */
  recheck() {
    this.lastKey = '';
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
    const k = this.pad * KEEP;
    for (const l of this.lazies) {
      const { item } = l;
      if (item.obj && !item.obj.scene) item.obj = null; // the scene destroyed it
      const near = item.enabled && l.x + l.r > x0 && l.x - l.r < x1 && l.y + l.r > y0 && l.y - l.r < y1;
      if (near) {
        if (!item.obj) item.obj = l.make();
        if (!item.obj.visible) item.obj.setVisible(true);
        continue;
      }
      if (!item.obj) continue;
      const kept = item.enabled && l.x + l.r > x0 - k && l.x - l.r < x1 + k && l.y + l.r > y0 - k && l.y - l.r < y1 + k;
      if (kept) {
        if (item.obj.visible) item.obj.setVisible(false);
      } else {
        item.obj.destroy();
        item.obj = null;
      }
    }
  }
}
