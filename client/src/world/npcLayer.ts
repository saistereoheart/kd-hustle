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
}

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
      this.npcs.push({ route, avatar, tag });
    }
    this.update(0);
  }

  /** Where an NPC is now (world px), for the guide arrow. */
  posOf(id: number): { x: number; y: number } | null {
    const n = this.npcs.find((x) => x.route.id === id);
    return n ? { x: n.avatar.x, y: n.avatar.y } : null;
  }

  update(_delta: number) {
    const now = this.app.store.serverNow();
    const T = this.app.map.tileSize;
    const errandNpc = this.app.store.errand?.stage === 'return' ? this.app.store.errand.npc : -1;
    for (const n of this.npcs) {
      const p = npcPose(n.route, this.app.cfg.npcs, now);
      const x = p.x * T, y = p.y * T;
      n.avatar.setPosition(x, y);
      n.avatar.setState(p.dir, p.moving);
      n.avatar.tick(performance.now());
      n.tag.setPosition(x, y - 58).setDepth(n.avatar.container.depth + 1);
      n.tag.setText(n.route.id === errandNpc ? `❗ ${n.route.name}` : n.route.name);
      n.tag.setColor(n.route.id === errandNpc ? '#ffe066' : '#c5f6fa');
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
