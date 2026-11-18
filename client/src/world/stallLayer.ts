// Food stalls in the world (Phase 4): the pasar malam stalls, food trucks and kopitiam signs on
// their plots, NPC customers queueing with order bubbles and patience bars, warm lights at
// night, and the day/night tint over the whole town.
import Phaser from 'phaser';
import { darkness, formatMoneyExact, gameTime, randomAppearance, stockCount, type BuiltMap, type StallCustomer, type StallPublic } from '@kh/shared';
import type { App } from '../app';
import { AVATAR_DEPTH, Avatar } from './avatar';
import { ensureGlowTexture, GLOW_TEXTURE, LightLayer } from './lightLayer';

type Plot = BuiltMap['stallPlots'][number];
const TOP_DEPTH = 1_000_001; // canopies draw above characters (walk "under" them)
const NIGHT_DEPTH = 1_500_000;
const LIGHT_DEPTH = 1_600_000;

interface Customer {
  c: StallCustomer;
  avatar: Avatar;
  bubble: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Graphics;
  tx: number;
  ty: number;
  leaving: boolean;
}

interface PlotView {
  key: string;
  objs: Phaser.GameObjects.GameObject[];
  /** Night lights: the warm pool on the ground and the bulbs (alpha follows the darkness). */
  lights: Array<{ img: Phaser.GameObjects.Image; k: number; phase: number }>;
}

/** Small deterministic PRNG so every screen draws the same customer. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hashColor = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Phaser.Display.Color.HSVToRGB((h % 360) / 360, 0.55, 0.9).color;
};

/** Where the cooks stand at each kind of stall (px from the plot centre): beside the table,
 *  beside the truck, around the kopitiam's tables. */
const STAFF_SPOTS: Record<number, Array<[number, number]>> = {
  1: [[68, -2], [-68, -2]],
  2: [[78, 8], [-82, 8]],
  3: [[-62, 8], [62, 8], [-22, 52], [22, 52]],
};

interface StaffView {
  avatar: Avatar;
  icon: Phaser.GameObjects.Text;
  busy: boolean;
}

export class StallLayer {
  private views = new Map<string, PlotView>();
  /** The cooks you've hired, standing at the stall (everyone sees them). */
  private staff = new Map<string, StaffView[]>();
  /** "📦 23 · 🍗 4" over your own stall. */
  private stockSign: Phaser.GameObjects.Text | null = null;
  private customers = new Map<number, Customer>();
  private night: Phaser.GameObjects.Rectangle;
  private T: number;
  private lamps: LightLayer;

  constructor(private scene: Phaser.Scene, private app: App) {
    this.T = app.map.tileSize;
    ensureGlowTexture(scene);
    this.lamps = new LightLayer(scene, app);
    this.night = scene.add.rectangle(0, 0, 10, 10, 0xffffff, 1).setOrigin(0, 0).setDepth(NIGHT_DEPTH).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.sync();
  }

  get plots(): Plot[] {
    return this.app.map.stallPlots;
  }

  /** Rebuild what changed (call when the store's stalls change). */
  sync() {
    for (const plot of this.plots) {
      const s = this.app.store.stalls.get(plot.id);
      const key = s ? `${s.owner}|${s.tier}|${s.open}|${s.ownerName}` : 'free';
      const v = this.views.get(plot.id);
      if (v?.key === key) continue;
      if (v) for (const o of v.objs) o.destroy();
      this.views.set(plot.id, this.drawPlot(plot, s, key));
    }
    this.syncStaff();
    this.syncStockSign();
    // Customers: add new ones, move the queue up, send leavers away.
    const seen = new Set<number>();
    for (const s of this.app.store.stalls.values()) {
      const plot = this.plots.find((p) => p.id === s.plot);
      if (!plot) continue;
      s.queue.forEach((c, k) => {
        seen.add(c.id);
        const tx = (plot.x + plot.queueFrom[0] + plot.queueStep[0] * k) * this.T;
        const ty = (plot.y + plot.queueFrom[1] + plot.queueStep[1] * k) * this.T;
        let cu = this.customers.get(c.id);
        if (!cu) cu = this.spawn(c, plot, tx, ty);
        cu.c = c;
        cu.tx = tx;
        cu.ty = ty;
      });
    }
    for (const [id, cu] of this.customers) {
      if (seen.has(id) || cu.leaving) continue;
      cu.leaving = true;
      cu.bubble.setVisible(false);
      cu.bar.setVisible(false);
      cu.tx += this.T * 4;
      cu.ty += this.T * 3;
    }
  }

  /** Hired cooks stand at their stall while it's open; busy ones cook (🍳 and steam). */
  private syncStaff() {
    const T = this.T;
    for (const plot of this.plots) {
      const s = this.app.store.stalls.get(plot.id);
      const want = s?.open ? Math.min(s.staff, (STAFF_SPOTS[plot.tier] ?? STAFF_SPOTS[1]).length) : 0;
      const list = this.staff.get(plot.id) ?? [];
      while (list.length > want) {
        const v = list.pop()!;
        v.avatar.destroy();
        v.icon.destroy();
      }
      while (list.length < want) {
        const [dx, dy] = (STAFF_SPOTS[plot.tier] ?? STAFF_SPOTS[1])[list.length];
        const seed = (s!.owner * 7919 + list.length * 104729) >>> 0;
        const avatar = new Avatar(this.scene, this.app.cfg.character, this.app.items, {
          name: 'Cook', level: 1, appearance: randomAppearance(this.app.cfg.character, seeded(seed)), x: plot.x * T + dx, y: plot.y * T + dy, isSelf: false, npc: true, particles: false,
        });
        avatar.setState('down', false);
        const icon = this.scene.add
          .text(plot.x * T + dx, plot.y * T + dy - 64, '🍳', { fontSize: '16px', backgroundColor: '#ffffffdd', padding: { x: 3, y: 1 }, resolution: 2 })
          .setOrigin(0.5, 1)
          .setDepth(999_000)
          .setVisible(false);
        list.push({ avatar, icon, busy: false });
      }
      // The first N cooks are busy, N = orders a cook is on.
      const busy = s ? s.queue.filter((c) => c.serving === 'staff').length : 0;
      list.forEach((v, i) => {
        v.busy = i < busy;
        v.icon.setVisible(v.busy);
        if (!v.busy) v.avatar.setState('down', false);
      });
      if (list.length) this.staff.set(plot.id, list);
      else this.staff.delete(plot.id);
    }
  }

  /** Your own stall shows its stock, so you can see when to restock from across the car park. */
  private syncStockSign() {
    const me = this.app.store.stall;
    const plot = me ? this.plots.find((p) => p.id === me.plot) : undefined;
    const r = this.app.cfg.recipes.recipes;
    if (!me || !plot) {
      this.stockSign?.destroy();
      this.stockSign = null;
      return;
    }
    const parts: string[] = [];
    let low = false;
    for (const rec of r) {
      if (!(rec.id in me.stock) && !rec.addons.some((a) => a.id in me.stock)) continue;
      const n = stockCount(me, rec.id);
      if (n <= 5) low = true;
      parts.push(`${rec.icon} ${n}`);
      for (const a of rec.addons) if (a.id in me.stock || stockCount(me, a.id)) parts.push(`${a.icon}${stockCount(me, a.id)}`);
    }
    const text = `📦 ${parts.join('  ') || 'no stock!'}`;
    const T = this.T;
    const y = plot.y * T + (plot.tier === 1 ? -100 : plot.tier === 2 ? -62 : -70);
    if (!this.stockSign) {
      this.stockSign = this.scene.add
        .text(plot.x * T, y, text, { fontFamily: 'system-ui, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#ffffff', backgroundColor: 'rgba(17,19,31,0.78)', padding: { x: 6, y: 3 }, resolution: 3 })
        .setOrigin(0.5, 1)
        .setDepth(999_001);
    }
    this.stockSign.setText(text).setPosition(plot.x * T, y).setBackgroundColor(low || !parts.length ? 'rgba(201,42,42,0.88)' : 'rgba(17,19,31,0.78)');
  }

  /** "+RM 21.60 🧑‍🍳" rising over your stall when a cook sells something. */
  popIncome(sen: number) {
    const me = this.app.store.stall;
    const plot = me ? this.plots.find((p) => p.id === me.plot) : undefined;
    if (!plot) return;
    const T = this.T;
    const x = plot.x * T + (Math.random() - 0.5) * 30, y = plot.y * T - 70;
    const t = this.scene.add
      .text(x, y, `+${formatMoneyExact(sen)} 🧑‍🍳`, { fontFamily: 'system-ui, sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#8ce99a', stroke: '#11131f', strokeThickness: 4, resolution: 3 })
      .setOrigin(0.5, 1)
      .setDepth(999_100);
    this.scene.tweens.add({ targets: t, y: y - 46, alpha: { from: 1, to: 0 }, duration: 1800, ease: 'Sine.easeOut', onComplete: () => t.destroy() });
  }

  private spawn(c: StallCustomer, plot: Plot, tx: number, ty: number): Customer {
    const a = randomAppearance(this.app.cfg.character, seeded(c.seed));
    const sx = tx + plot.queueStep[0] * this.T * 6 + this.T * 2;
    const sy = ty + plot.queueStep[1] * this.T * 6 + this.T * 2;
    const avatar = new Avatar(this.scene, this.app.cfg.character, this.app.items, { name: '', level: 1, appearance: a, x: sx, y: sy, isSelf: false, npc: true, particles: false });
    const recipe = this.app.cfg.recipes.recipes.find((r) => r.id === c.recipe);
    const extras = (c.addons ?? []).map((id) => recipe?.addons.find((a) => a.id === id)?.icon ?? '').join('');
    const bubble = this.scene.add
      .text(sx, sy - 60, `${c.blogger ? '📸' : ''}${recipe?.icon ?? '🍽️'}${extras ? `+${extras}` : ''}`, { fontSize: '16px', backgroundColor: '#ffffffee', color: '#000', padding: { x: 4, y: 2 }, resolution: 2 })
      .setOrigin(0.5, 1)
      .setDepth(999_000);
    const bar = this.scene.add.graphics().setDepth(999_000);
    const cu: Customer = { c, avatar, bubble, bar, tx, ty, leaving: false };
    this.customers.set(c.id, cu);
    return cu;
  }

  private drawPlot(plot: Plot, s: StallPublic | undefined, key: string): PlotView {
    const sc = this.scene;
    const T = this.T;
    const x = plot.x * T, y = plot.y * T;
    const objs: Phaser.GameObjects.GameObject[] = [];
    const label = (text: string, dy: number, color = '#ffe066') => {
      const t = sc.add.text(x, y + dy, text, { fontFamily: 'system-ui, sans-serif', fontSize: '12px', fontStyle: 'bold', color, stroke: '#11131f', strokeThickness: 4, align: 'center', resolution: 2 }).setOrigin(0.5, 1).setDepth(999_000);
      objs.push(t);
    };
    const lights: PlotView['lights'] = [];
    const L = this.app.cfg.time.lighting;
    const warm = parseInt((L?.stallColor ?? '#ffb45c').slice(1), 16);
    /** A glow sprite: (x, y) centre, w × h, strength k. */
    const glow = (gx: number, gy: number, w: number, h: number, k: number, tint = warm, depth = LIGHT_DEPTH) => {
      const img = sc.add.image(gx, gy, GLOW_TEXTURE).setDisplaySize(w, h).setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth).setAlpha(0);
      objs.push(img);
      lights.push({ img, k, phase: lights.length * 1.3 });
    };
    if (plot.tier === 1) {
      const g = sc.add.graphics().setDepth(AVATAR_DEPTH + y - 40);
      objs.push(g);
      if (!s) {
        g.lineStyle(2, 0xffffff, 0.35).strokeRect(x - 52, y - 30, 104, 56);
        label('Pasar malam spot', -2, '#dee2e6');
      } else {
        const col = hashColor(s.ownerName);
        // The canopy's shadow on the ground (sun from the top left, like the buildings'), then
        // the table with pots and the striped canopy (rolled up when closed).
        if (s.open) {
          g.fillStyle(0x000000, 0.14).fillPoints([{ x: x - 44, y: y - 30 }, { x: x + 74, y: y - 30 }, { x: x + 84, y: y + 2 }, { x: x - 34, y: y + 2 }], true);
          g.fillStyle(0x000000, 0.16).fillRect(x - 40, y - 20, 4, 30).fillRect(x + 64, y - 20, 4, 30);
        }
        g.fillStyle(0x000000, 0.2).fillRoundedRect(x - 50, y - 14, 104, 30, 6);
        g.fillStyle(0x8d5a33, 1).fillRoundedRect(x - 52, y - 20, 104, 28, 6);
        g.fillStyle(0xf8f9fa, 1).fillRect(x - 50, y - 18, 100, 6);
        if (s.open) {
          g.fillStyle(0xc0c0c0, 1).fillCircle(x - 28, y - 8, 9).fillCircle(x, y - 8, 9).fillCircle(x + 28, y - 8, 9);
          g.fillStyle(0xffffff, 0.9).fillCircle(x - 28, y - 9, 6);
          g.fillStyle(0xc92a2a, 0.9).fillCircle(x, y - 9, 6);
          g.fillStyle(0xd9a066, 0.9).fillCircle(x + 28, y - 9, 6);
        }
        const top = sc.add.graphics().setDepth(TOP_DEPTH);
        objs.push(top);
        top.fillStyle(0x495057, 1).fillRect(x - 54, y - 70, 4, 56).fillRect(x + 50, y - 70, 4, 56);
        const h = s.open ? 26 : 10;
        for (let i = 0; i < 8; i++) top.fillStyle(i % 2 ? 0xffffff : col, 0.95).fillRect(x - 58 + i * 14.5, y - 78, 14.5, h);
        if (s.open) {
          for (let i = 0; i < 8; i++) top.fillStyle(i % 2 ? 0xffffff : col, 0.95).fillTriangle(x - 58 + i * 14.5, y - 52, x - 43.5 + i * 14.5, y - 52, x - 50.75 + i * 14.5, y - 44);
          // Canopy shading (lighter top band, darker underside) and a string of bulbs.
          top.fillStyle(0xffffff, 0.18).fillRect(x - 58, y - 78, 116, 6);
          top.fillStyle(0x000000, 0.16).fillRect(x - 58, y - 56, 116, 4);
          top.lineStyle(1, 0x343a40, 0.8).lineBetween(x - 56, y - 50, x + 56, y - 50);
          for (let i = 0; i < 8; i++) {
            const bx = x - 52 + i * 15, by = y - 48 + (i % 2) * 2;
            top.fillStyle(0xfff3bf, 1).fillCircle(bx, by, 2.2);
            glow(bx, by, 22, 22, 0.9, 0xfff0c2, LIGHT_DEPTH + 1);
          }
          // A hanging lamp over the pots, lighting the table and the queue.
          top.fillStyle(0x343a40, 1).fillRect(x - 1, y - 52, 2, 10);
          top.fillStyle(0xffe066, 1).fillCircle(x, y - 40, 4);
          glow(x, y - 40, 40, 40, 1, 0xfff4d6, LIGHT_DEPTH + 1);
          glow(x + 4, y + 2, 230, 130, 1);
        }
        label(`⛺ ${s.ownerName}'s stall${s.open ? '' : ' · tutup'}`, -82);
      }
    } else if (plot.tier === 2) {
      const g = sc.add.graphics().setDepth(AVATAR_DEPTH + y - 40);
      objs.push(g);
      if (!s) {
        g.lineStyle(2, 0xffffff, 0.35).strokeRect(x - 60, y - 36, 120, 64);
        label('Food truck spot', -2, '#dee2e6');
      } else {
        const col = hashColor(s.ownerName);
        g.fillStyle(0x000000, 0.22).fillRoundedRect(x - 56, y - 26, 120, 60, 10);
        g.fillStyle(col, 1).fillRoundedRect(x - 62, y - 36, 120, 60, 10);
        g.fillStyle(0x212529, 1).fillCircle(x - 38, y + 24, 9).fillCircle(x + 34, y + 24, 9);
        g.fillStyle(0xa5d8ff, 1).fillRoundedRect(x + 30, y - 30, 22, 26, 4);
        g.fillStyle(s.open ? 0xfff3bf : 0x495057, 1).fillRoundedRect(x - 50, y - 20, 70, 26, 4);
        // Body shading: a lighter roof edge, a darker lower skirt.
        g.fillStyle(0xffffff, 0.2).fillRoundedRect(x - 62, y - 36, 120, 8, { tl: 10, tr: 10, bl: 0, br: 0 });
        g.fillStyle(0x000000, 0.18).fillRect(x - 62, y + 12, 120, 12);
        if (s.open) {
          const top = sc.add.graphics().setDepth(TOP_DEPTH);
          objs.push(top);
          for (let i = 0; i < 6; i++) top.fillStyle(i % 2 ? 0xffffff : 0xe03131, 0.95).fillRect(x - 56 + i * 13, y - 34, 13, 10);
          // The serving hatch glows; a warm spill on the ground in front of it.
          glow(x - 15, y - 7, 90, 44, 0.8, 0xfff3bf, LIGHT_DEPTH + 1);
          glow(x - 10, y + 44, 220, 110, 1);
        }
        label(`🚚 ${s.ownerName}'s food truck${s.open ? '' : ' · closed'}`, -42);
      }
    } else if (s) {
      // Kopitiam: a signboard above the shop door and a few plastic tables outside.
      const g = sc.add.graphics().setDepth(AVATAR_DEPTH + y - 40);
      objs.push(g);
      for (const [dx, dy] of [[-40, 30], [40, 30]]) {
        g.fillStyle(0xe03131, 1).fillCircle(x + dx, y + dy, 11);
        g.fillStyle(0xffc9c9, 1).fillCircle(x + dx - 14, y + dy, 5).fillCircle(x + dx + 14, y + dy, 5);
      }
      const top = sc.add.graphics().setDepth(TOP_DEPTH);
      objs.push(top);
      top.fillStyle(0x2b8a3e, 1).fillRoundedRect(x - 70, y - 64, 140, 24, 5);
      top.fillStyle(0xffffff, 0.2).fillRoundedRect(x - 70, y - 64, 140, 6, { tl: 5, tr: 5, bl: 0, br: 0 });
      label(`🏪 Kopitiam ${s.ownerName}${s.open ? '' : ' · tutup'}`, -42, '#ffffff');
      if (s.open) {
        glow(x, y - 52, 170, 50, 0.7, 0xd3f9d8, LIGHT_DEPTH + 1); // the lit signboard
        glow(x, y + 30, 260, 120, 1);
      }
    }
    return { key, objs, lights };
  }

  /** Per frame: walk customers to their spots, patience bars, the night tint and lights. */
  update(dtMs: number) {
    const now = this.app.store.serverNow();
    const speed = 150 * (dtMs / 1000);
    for (const [id, cu] of this.customers) {
      const ax = cu.avatar.x, ay = cu.avatar.y;
      const dx = cu.tx - ax, dy = cu.ty - ay;
      const d = Math.hypot(dx, dy);
      if (d > 1.5) {
        const k = Math.min(1, speed / d);
        cu.avatar.setPosition(ax + dx * k, ay + dy * k);
        cu.avatar.setState(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up', true);
      } else {
        cu.avatar.setPosition(cu.tx, cu.ty);
        cu.avatar.setState('up', false);
        if (cu.leaving) {
          cu.avatar.destroy();
          cu.bubble.destroy();
          cu.bar.destroy();
          this.customers.delete(id);
          continue;
        }
      }
      cu.avatar.tick(performance.now());
      cu.bubble.setPosition(cu.avatar.x, cu.avatar.y - 56);
      if (!cu.leaving) {
        const left = cu.c.serving ? 1 : Math.max(0, 1 - (now - cu.c.arrivedAt) / cu.c.patienceMs);
        cu.bar.clear();
        cu.bar.fillStyle(0x000000, 0.5).fillRect(cu.avatar.x - 13, cu.avatar.y - 54, 26, 5);
        cu.bar.fillStyle(cu.c.serving ? 0x74c0fc : left > 0.5 ? 0x40c057 : left > 0.25 ? 0xfab005 : 0xfa5252, 1).fillRect(cu.avatar.x - 12, cu.avatar.y - 53, 24 * left, 3);
      }
    }

    // Cooks: busy ones work the pan (animated, facing the queue, a bobbing 🍳 and steam).
    const pnow = performance.now();
    for (const list of this.staff.values())
      for (const v of list) {
        if (v.busy) {
          v.avatar.setState(Math.sin(pnow / 600) > 0 ? 'left' : 'down', true);
          v.icon.setY(v.avatar.y - 64 + Math.sin(pnow / 180) * 3);
          if (Math.random() < dtMs / 400) v.avatar.floatText('♨', '#f1f3f5');
        }
        v.avatar.tick(pnow);
      }

    // Day / night: tint the whole view (multiply), warmer at dusk and dawn.
    const cam = this.scene.cameras.main;
    const view = cam.worldView;
    this.night.setPosition(view.x - 4, view.y - 4).setSize(view.width + 8, view.height + 8);
    const t = gameTime(this.app.cfg.time, now);
    const dk = darkness(this.app.cfg.time, t.hourF);
    // Full night multiplies the town by time.json → lighting.nightTint (lighter = brighter nights).
    const warm = Math.max(0, 1 - Math.abs(dk - 0.5) * 2);
    const nt = parseInt((this.app.cfg.time.lighting?.nightTint ?? '#505c96').slice(1), 16);
    const r = Math.round(255 - (255 - ((nt >> 16) & 255)) * dk + warm * 20);
    const g = Math.round(255 - (255 - ((nt >> 8) & 255)) * dk - warm * 15);
    const b = Math.round(255 - (255 - (nt & 255)) * dk - warm * 50);
    this.night.setFillStyle(Phaser.Display.Color.GetColor(Math.min(255, r), Math.max(0, g), Math.max(0, b)), 1);
    this.night.setVisible(dk > 0.01);
    // Stall lights come on from dusk; the bulbs twinkle a little.
    const k = dk * (this.app.cfg.time.lighting?.stallStrength ?? 0.9);
    const tt = performance.now() / 1000;
    for (const v of this.views.values()) for (const l of v.lights) l.img.setAlpha(Math.min(1, k * l.k * (0.92 + 0.08 * Math.sin(tt * 3 + l.phase))));
    this.lamps.update(dtMs, dk);
  }

  /** The plot nearest to (px, py) within `radius` tiles. */
  nearest(px: number, py: number, radius: number): Plot | null {
    let best: Plot | null = null;
    let bd = radius;
    for (const p of this.plots) {
      const d = Math.hypot(px / this.T - p.x, py / this.T - p.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  destroy() {
    for (const v of this.views.values()) for (const o of v.objs) o.destroy();
    for (const cu of this.customers.values()) {
      cu.avatar.destroy();
      cu.bubble.destroy();
      cu.bar.destroy();
    }
    this.night.destroy();
    this.lamps.destroy();
    for (const list of this.staff.values()) for (const v of list) (v.avatar.destroy(), v.icon.destroy());
    this.staff.clear();
    this.stockSign?.destroy();
  }
}
