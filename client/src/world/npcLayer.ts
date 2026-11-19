// Draws the wandering townsfolk. Their positions come from the shared route maths and the
// server clock, so everyone sees them in the same place (and the server agrees).
import Phaser from 'phaser';
import { buildNpcRoutes, npcPose, randomAppearance, seededRandom, type NpcRoute } from '@kh/shared';
import type { App } from '../app';
import { Avatar } from './avatar';

interface Npc {
  route: NpcRoute;
  avatar: Avatar;
  tag: Phaser.GameObjects.Text;
  /** On-screen sidestep (px) so townsfolk walk round people instead of through them. */
  ox: number;
  oy: number;
}

/** How close (px) two people can get before an NPC steps aside, and how far it may step. */
const PERSONAL_PX = 22;
const MAX_STEP_PX = 18;

export class NpcLayer {
  private npcs: Npc[] = [];

  constructor(private scene: Phaser.Scene, private app: App) {
    const cfg = app.cfg;
    for (const route of buildNpcRoutes(app.map, cfg.npcs)) {
      const look = randomAppearance(cfg.character, seededRandom(424242 + route.id * 101));
      const avatar = new Avatar(scene, cfg.character, app.items, { name: route.name, level: 1, appearance: look, x: 0, y: 0, isSelf: false, npc: true });
      const tag = scene.add
        .text(0, 0, route.name, { fontFamily: 'system-ui, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#c5f6fa', stroke: '#11131f', strokeThickness: 3, resolution: 2 })
        .setOrigin(0.5, 1);
      this.npcs.push({ route, avatar, tag, ox: 0, oy: 0 });
    }
    this.update(0);
  }

  /** Where an NPC is now (world px), for the guide arrow. */
  posOf(id: number): { x: number; y: number } | null {
    const n = this.npcs.find((x) => x.route.id === id);
    return n ? { x: n.avatar.x, y: n.avatar.y } : null;
  }

  private errandNpc = -1;

  /**
   * `people`: where players are (world px). NPCs keep to their shared routes (everyone agrees
   * where they are, and you talk to them there); on screen they just step round people and each
   * other, then drift back onto the path.
   */
  update(delta: number, people: Array<{ x: number; y: number }> = []) {
    const now = this.app.store.serverNow();
    const T = this.app.map.tileSize;
    const errandNpc = this.app.store.errand?.stage === 'return' ? this.app.store.errand.npc : -1;
    // Restyling a Text re-renders it (font measuring + a texture upload), so only on change.
    const restyle = errandNpc !== this.errandNpc;
    this.errandNpc = errandNpc;
    const view = this.scene.cameras.main.worldView;
    const pad = 200;
    const pnow = performance.now();
    const poses = this.npcs.map((n) => npcPose(n.route, this.app.cfg.npcs, now));
    const ease = Math.min(1, delta / 120);
    for (let k = 0; k < this.npcs.length; k++) {
      const n = this.npcs[k];
      const p = poses[k];
      const bx = p.x * T, by = p.y * T;
      // Push away from anyone too close (players, then the townsfolk before this one).
      let px = 0, py = 0;
      const push = (ox: number, oy: number) => {
        const dx = bx + n.ox - ox, dy = by + n.oy - oy;
        const d = Math.hypot(dx, dy);
        if (d >= PERSONAL_PX) return;
        const f = (PERSONAL_PX - d) / PERSONAL_PX;
        // Straight on top of each other: step to the side of the walking direction.
        const ux = d > 0.5 ? dx / d : p.dir === 'up' || p.dir === 'down' ? 1 : 0;
        const uy = d > 0.5 ? dy / d : p.dir === 'left' || p.dir === 'right' ? 1 : 0;
        px += ux * f * MAX_STEP_PX;
        py += uy * f * MAX_STEP_PX;
      };
      for (const o of people) push(o.x, o.y);
      for (let j = 0; j < k; j++) push(this.npcs[j].avatar.x, this.npcs[j].avatar.y);
      const tx = Math.max(-MAX_STEP_PX, Math.min(MAX_STEP_PX, n.ox + px)), ty = Math.max(-MAX_STEP_PX, Math.min(MAX_STEP_PX, n.oy + py));
      // Ease towards the sidestep (or back to the path when nobody's near).
      n.ox += ((px || py ? tx : 0) - n.ox) * ease;
      n.oy += ((px || py ? ty : 0) - n.oy) * ease;
      const x = bx + n.ox, y = by + n.oy;
      n.avatar.setPosition(x, y);
      if (restyle) {
        n.tag.setText(n.route.id === errandNpc ? `❗ ${n.route.name}` : n.route.name);
        n.tag.setColor(n.route.id === errandNpc ? '#ffe066' : '#c5f6fa');
      }
      // Off-screen townsfolk aren't drawn or animated.
      const vis = x > view.x - pad && x < view.right + pad && y > view.y - pad && y < view.bottom + pad;
      if (n.avatar.container.visible !== vis) {
        n.avatar.container.setVisible(vis);
        n.tag.setVisible(vis);
      }
      if (!vis) continue;
      n.avatar.setState(p.dir, p.moving);
      n.avatar.tick(pnow);
      n.tag.setPosition(x, y - 58).setDepth(n.avatar.container.depth + 1);
    }
  }

  /** The closest NPC within `radius` tiles of a world-px position. */
  nearest(px: number, py: number, radius: number): NpcRoute | null {
    const T = this.app.map.tileSize;
    let best: NpcRoute | null = null;
    let bd = radius;
    for (const n of this.npcs) {
      const d = Math.hypot(n.avatar.x - px, n.avatar.y - py) / T;
      if (d < bd) {
        bd = d;
        best = n.route;
      }
    }
    return best;
  }

  /** How far (tiles) an NPC is from a point. */
  distance(id: number, px: number, py: number): number {
    const n = this.npcs.find((x) => x.route.id === id);
    return n ? Math.hypot(n.avatar.x - px, n.avatar.y - py) / this.app.map.tileSize : Infinity;
  }

  say(id: number, text: string) {
    this.npcs.find((n) => n.route.id === id)?.avatar.say(text, 5000);
  }

  destroy() {
    for (const n of this.npcs) {
      n.avatar.destroy();
      n.tag.destroy();
    }
    this.npcs = [];
  }
}
