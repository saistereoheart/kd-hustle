// Ah Long's debt collectors (spec §10.2): two burly NPCs who trail anyone who's late paying the
// Ah Long, everywhere they go (comedic, visible to friends). Purely visual; the server does the
// collecting.
import Phaser from 'phaser';
import { randomAppearance, seededRandom } from '@kh/shared';
import type { App } from '../app';
import { Avatar } from './avatar';

interface Collector {
  av: Avatar;
  tag: Phaser.GameObjects.Text;
  /** Where they stand relative to the debtor (world px), behind and to the side. */
  ox: number;
  oy: number;
}

export class Collectors {
  private following = new Map<number, Collector[]>();

  constructor(private scene: Phaser.Scene, private app: App) {}

  /** Start or stop following player `id` (standing at x, y). */
  set(id: number, on: boolean, x: number, y: number) {
    const cur = this.following.get(id);
    if (!on) {
      for (const c of cur ?? []) (c.av.destroy(), c.tag.destroy());
      this.following.delete(id);
      return;
    }
    if (cur) return;
    const n = Math.max(1, this.app.cfg.loans.ahlong.collectors);
    const list: Collector[] = [];
    for (let i = 0; i < n; i++) {
      const look = randomAppearance(this.app.cfg.character, seededRandom(777 + i * 31));
      const ox = (i % 2 ? 1 : -1) * (26 + 8 * Math.floor(i / 2));
      const oy = 34 + 10 * i;
      const av = new Avatar(this.scene, this.app.cfg.character, this.app.items, { name: '', level: 1, appearance: look, x: x + ox, y: y + oy, isSelf: false, npc: true, particles: false });
      const tag = this.scene.add
        .text(x + ox, y + oy - 58, i === 0 ? '😠 Bayar hutang!' : '🕶️', { fontFamily: 'system-ui, sans-serif', fontSize: '11px', fontStyle: '900', color: '#ffc9c9', stroke: '#11131f', strokeThickness: 3, resolution: 2 })
        .setOrigin(0.5, 1);
      list.push({ av, tag, ox, oy });
    }
    this.following.set(id, list);
  }

  /** Per frame: walk after their debtor (a little behind, so they lag when you run). */
  update(dtMs: number, posOf: (id: number) => { x: number; y: number; visible: boolean } | null) {
    const speed = 210 * (dtMs / 1000);
    for (const [id, list] of this.following) {
      const t = posOf(id);
      if (!t) continue;
      for (const c of list) {
        c.av.container.setVisible(t.visible);
        c.tag.setVisible(t.visible);
        const tx = t.x + c.ox, ty = t.y + c.oy;
        const dx = tx - c.av.x, dy = ty - c.av.y;
        const d = Math.hypot(dx, dy);
        if (d > 600) c.av.setPosition(tx, ty); // teleported / rode away: catch up
        else if (d > 4) {
          const k = Math.min(1, speed / d);
          c.av.setPosition(c.av.x + dx * k, c.av.y + dy * k);
          c.av.setState(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up', true);
        } else c.av.setState('up', false);
        c.av.tick(performance.now());
        c.tag.setPosition(c.av.x, c.av.y - 58).setDepth(c.av.container.depth + 1);
      }
    }
  }

  destroy() {
    for (const id of [...this.following.keys()]) this.set(id, false, 0, 0);
  }
}
