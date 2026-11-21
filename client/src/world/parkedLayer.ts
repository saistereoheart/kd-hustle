// 🅿️ Vehicles put down around town: drawn where they stand (facing the way they were left), and
// tappable to get in. A vehicle someone is driving is drawn with its driver instead.
import type Phaser from 'phaser';
import type { Direction, ParkedPublic } from '@kh/shared';
import { vehicleFit, vehicleOriginY, vehicleTexturePrefix } from '../items/vehicleArt';
import { AVATAR_DEPTH } from './avatar';
import { holdTexture } from '../perf/memory';

const VIEW: Record<Direction, 'side' | 'front' | 'back'> = { left: 'side', right: 'side', up: 'back', down: 'front' };

export class ParkedLayer {
  private sprites = new Map<string, Phaser.GameObjects.Image>();
  private list = new Map<string, ParkedPublic>();

  constructor(
    private scene: Phaser.Scene,
    private onTap: (vid: string) => void,
  ) {}

  setAll(list: ParkedPublic[]) {
    for (const vid of [...this.list.keys()]) if (!list.some((v) => v.vid === vid)) this.remove(vid);
    for (const v of list) this.upsert(v);
  }

  upsert(v: ParkedPublic) {
    this.list.set(v.vid, v);
    const driven = v.seats[0] !== null;
    let img = this.sprites.get(v.vid);
    if (driven) {
      img?.setVisible(false);
      return;
    }
    const view = VIEW[v.dir];
    const key = `${vehicleTexturePrefix(this.scene, v.vehicle, v.look)}_${view}`;
    if (!img) {
      img = this.scene.add.image(v.x, v.y + 2, key);
      img.setInteractive({ useHandCursor: true });
      img.on('pointerup', () => this.onTap(v.vid));
      this.sprites.set(v.vid, img);
    } else img.setTexture(key);
    holdTexture(img);
    img.setVisible(true);
    img.setScale(vehicleFit(v.vehicle).scale);
    img.setOrigin(0.5, vehicleOriginY(v.vehicle, view));
    img.setFlipX(v.dir === 'right');
    img.setPosition(v.x, v.y + 2);
    // Slightly behind someone standing on the same line, so people step in front of it.
    img.setDepth(AVATAR_DEPTH + v.y - 0.5);
  }

  remove(vid: string) {
    this.sprites.get(vid)?.destroy();
    this.sprites.delete(vid);
    this.list.delete(vid);
  }

  get(vid: string) {
    return this.list.get(vid);
  }

  /** The closest parked (not driven) vehicle within `range` px. */
  nearest(x: number, y: number, range: number): ParkedPublic | null {
    let best: ParkedPublic | null = null;
    let bd = range;
    for (const v of this.list.values()) {
      if (v.seats[0] !== null && v.seats.every((s) => s !== null)) continue;
      const d = Math.hypot(v.x - x, v.y - y);
      if (d <= bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  destroy() {
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    this.list.clear();
  }
}
