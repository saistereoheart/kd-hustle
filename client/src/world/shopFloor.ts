// 🏪 A shop floor's working side, for the furnished room (HomeScene) when it's a shop: a service
// area behind a counter along the back (stoves or shelves), the cashier sitting at the register,
// cook(s) at the stoves, starter tables until the owner puts their own in, and customers who come
// in, order at the counter, sit down to eat / drink, and leave. All for show: the money is the
// server's (kopitiam orders, Venture income). Everyone walking in sees this, the owner too.
import Phaser from 'phaser';
import { randomAppearance, type Placed } from '@kh/shared';
import type { App } from '../app';
import { furniturePiece } from '../items/furnitureArt';
import { loadPrefs } from '../ui/settings';
import { AVATAR_DEPTH, Avatar } from './avatar';
import { bake } from './bake';
import { COUNTER_LINES, Walkers } from './walkers';

/** Metres of service area behind the counter (above the furnishable floor). */
export const SERVICE_ROWS = 3;

export interface ShopFixture {
  label: string;
  use: () => void;
}
/** What the app knows about the shop you're walking into. */
export interface ShopCtx {
  building: string;
  kind: 'kopitiam' | 'shop';
  icon: string;
  /** The cashier's name; null = nobody at the till. */
  cashier: string | null;
  greeting: string;
  /** The counter (cook / order / run the business). Without it, the cashier just says hello. */
  counter?: ShopFixture;
  /** The till (the owner's books). */
  till?: ShopFixture;
  /** Stairs up to lofts above. */
  stairs?: ShopFixture;
}

type Dir = 'up' | 'down' | 'left' | 'right';
interface Seat {
  key: string;
  x: number;
  y: number;
  face: Dir;
  table: [number, number];
}
interface Cook {
  av: Avatar;
  stoves: number[];
  target: number;
  until: number;
}

const STAFF_NAMES = ['Kak Mah', 'Dik Aina', 'Uncle Lim', 'Aunty Devi', 'Abang Zul', 'Kak Ros', 'Adik Faiz', 'Cik Mei'];
const FOOD = {
  kopitiam: ['🍜', '🍛', '☕', '🥤', '🍳', '🍞', '🧋', '🍲'],
  shop: ['☕', '🥤', '🧋', '🍩', '📱', '🥪'],
};
const COOKING = ['🍳', '🔥', '🥢', '🧂', '🍜'];

function seeded(str: string) {
  let a = 0;
  for (let i = 0; i < str.length; i++) a = (Math.imul(a, 31) + str.charCodeAt(i)) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A friendly staff name for a shop (the same one every visit). */
export function staffName(seed: string): string {
  return STAFF_NAMES[Math.floor(seeded(seed)() * STAFF_NAMES.length)];
}

export class ShopFloor {
  private objs: Phaser.GameObjects.GameObject[] = [];
  private cashierAv: Avatar | null = null;
  private cooks: Cook[] = [];
  private walkers: Walkers;
  private busy = new Set<string>();
  private paused = false;
  private nextVisit = 0;
  private steam = 0;
  private others = new Map<number, Avatar>();
  private othersAt = 0;
  /** The register's x (px) and the counter's left end. */
  readonly regX: number;
  private readonly c0: number;
  /** The door is in the top wall: everything is mirrored top-to-bottom (the counter along the
   *  bottom, the stoves against the bottom wall). Furniture keeps its own cells. */
  private readonly flip: boolean;
  /** The floor's height (px). */
  private readonly HP: number;
  /** A y (px) as laid out for a bottom door, mirrored for a top door. */
  private my(y: number) {
    return this.flip ? this.HP - y : y;
  }
  /** Facing towards the back (the stoves / the counter). */
  private get back(): Dir {
    return this.flip ? 'down' : 'up';
  }

  constructor(
    private scene: Phaser.Scene,
    private app: App,
    readonly ctx: ShopCtx,
    private g: { C: number; W: number; H: number; front: [number, number]; frontTop?: boolean },
    private layout: () => Placed[],
    private stars: () => number,
  ) {
    const { C, W } = g;
    this.flip = !!g.frontTop;
    this.HP = g.H * C;
    this.c0 = 2 * C;
    this.regX = (W - 1.6) * C;
    this.walkers = new Walkers(scene, app.cfg.character, app.items, 8, 62);
    this.drawService();
    this.addStaff();
    this.nextVisit = performance.now() + 1200;
  }

  // ---------------------------------------------------------------- drawing (baked once)
  private drawService() {
    const { C, W } = this.g;
    const S = SERVICE_ROWS * C, w = W * C;
    const kopi = this.ctx.kind === 'kopitiam';
    // The service floor and what's along the back wall.
    const backKey = bake(this.scene, `shopback_${this.ctx.kind}_${W}`, w, S, (g) => {
      for (let y = 0; y < S; y += C / 2) for (let x = 0; x < w; x += C / 2) g.fillStyle(((x + y) / (C / 2)) % 2 ? 0x868e96 : 0xced4da, 1).fillRect(x, y, C / 2, C / 2);
      g.fillStyle(0x000000, 0.12).fillRect(0, 0, w, 6);
      // the staff doorway / stairs gap on the left
      g.fillStyle(0x6d4c41, 1).fillRect(C * 0.3, 0, C * 1.3, C * 0.25);
      for (let i = 0; i < 4; i++) g.fillStyle(i % 2 ? 0x8d6e63 : 0xa1887f, 1).fillRect(C * 0.3, C * 0.25 + i * C * 0.32, C * 1.3, C * 0.3);
      if (kopi) {
        // a row of stoves (with woks) and a fridge
        for (let x = this.c0; x < this.regX - C * 1.6; x += C * 1.4) {
          g.fillStyle(0x495057, 1).fillRoundedRect(x, 4, C * 1.3, C * 0.85, 4);
          g.fillStyle(0x343a40, 1).fillRect(x + 3, 6, C * 1.3 - 6, C * 0.2);
          g.fillStyle(0x212529, 1).fillCircle(x + C * 0.4, C * 0.55, C * 0.2).fillCircle(x + C * 0.92, C * 0.55, C * 0.2);
          g.lineStyle(2, 0xff922b, 0.9).strokeCircle(x + C * 0.4, C * 0.55, C * 0.12).strokeCircle(x + C * 0.92, C * 0.55, C * 0.12);
          g.fillStyle(0x6c757d, 1).fillEllipse(x + C * 0.4, C * 0.5, C * 0.42, C * 0.24);
        }
        g.fillStyle(0xe9ecef, 1).fillRoundedRect(w - C * 1.2, 4, C * 0.95, C * 1.2, 4);
        g.lineStyle(2, 0xadb5bd, 1).strokeRoundedRect(w - C * 1.2, 4, C * 0.95, C * 1.2, 4);
        g.fillStyle(0xadb5bd, 1).fillRect(w - C * 0.4, C * 0.3, 3, C * 0.4);
      } else {
        // shelves of stock
        const cols = [0xff6b6b, 0x4dabf7, 0xffd43b, 0x69db7c, 0xda77f2, 0xff922b];
        for (let x = this.c0; x < w - C * 0.2; x += C * 1.5) {
          g.fillStyle(0x8d6e63, 1).fillRect(x, 4, C * 1.4, C * 0.95);
          for (let r = 0; r < 3; r++) {
            g.fillStyle(0x5d4037, 1).fillRect(x, 4 + r * C * 0.31 + C * 0.27, C * 1.4, 3);
            for (let k = 0; k < 5; k++) g.fillStyle(cols[(k + r + Math.floor(x / C)) % cols.length], 1).fillRect(x + 3 + k * C * 0.27, 6 + r * C * 0.31, C * 0.22, C * 0.24);
          }
        }
      }
    });
    this.objs.push(this.scene.add.image(0, this.flip ? this.HP : -S, backKey).setOrigin(0).setFlipY(this.flip).setDepth(-4));
    // The counter: drawn over the staff (they stand behind it), under customers in front of it.
    const cw = w - this.c0, ch = C * 1.05;
    const counterKey = bake(this.scene, `shopcounter_${this.ctx.kind}_${W}`, cw, ch + 8, (g) => {
      g.fillStyle(0x000000, 0.18).fillRect(2, ch - 2, cw - 2, 8);
      const top = kopi ? 0xdee2e6 : 0xd7b48a, face = kopi ? 0x2b8a3e : 0x8c5a3c;
      g.fillStyle(top, 1).fillRect(0, 0, cw, ch * 0.5);
      g.fillStyle(0xffffff, 0.35).fillRect(0, 0, cw, 3);
      g.fillStyle(face, 1).fillRect(0, ch * 0.5, cw, ch * 0.5);
      for (let x = 6; x < cw - 6; x += C) g.fillStyle(0x000000, 0.12).fillRect(x, ch * 0.58, C - 10, ch * 0.34);
      if (kopi) {
        // a glass display of kuih and lauk at the kitchen end
        const dx = 6, dw = Math.min(cw * 0.45, C * 3.2);
        g.fillStyle(0xa5d8ff, 0.55).fillRoundedRect(dx, 2, dw, ch * 0.42, 4);
        const food = [0xf08c00, 0xe8590c, 0x82c91e, 0xfab005, 0xc92a2a];
        for (let i = 0; i < 6; i++) g.fillStyle(food[i % food.length], 1).fillEllipse(dx + 10 + i * (dw - 20) / 5, ch * 0.24, C * 0.32, C * 0.18);
        g.lineStyle(2, 0xffffff, 0.8).strokeRoundedRect(dx, 2, dw, ch * 0.42, 4);
      }
    });
    // (Mirrored: below the floor's edge, under the staff standing in front of it.)
    this.objs.push(this.scene.add.image(this.c0, this.flip ? this.HP : -ch, counterKey).setOrigin(0).setDepth(AVATAR_DEPTH + (this.flip ? this.HP : 0) + 2));
    // The register on the counter (in front of the cashier).
    const regKey = bake(this.scene, 'shop_register', C, C * 0.7, (g) => {
      g.fillStyle(0x343a40, 1).fillRoundedRect(C * 0.12, C * 0.25, C * 0.76, C * 0.4, 4);
      g.fillStyle(0x212529, 1).fillRoundedRect(C * 0.3, 0, C * 0.5, C * 0.3, 3);
      g.fillStyle(0x69db7c, 1).fillRect(C * 0.36, C * 0.05, C * 0.38, C * 0.16);
      for (let i = 0; i < 3; i++) g.fillStyle(0xadb5bd, 1).fillRect(C * 0.2 + i * C * 0.2, C * 0.36, C * 0.14, C * 0.08);
    });
    this.objs.push(this.scene.add.image(this.regX, this.flip ? this.HP + C * 0.3 : -ch + C * 0.32, regKey).setOrigin(0.5, 0.5).setDepth(AVATAR_DEPTH + (this.flip ? this.HP : 0) + 3));
    // The shop's sign over the counter.
    const sign = this.scene.add
      .text(w / 2, this.my(-S + C * 1.25), this.ctx.icon, { fontFamily: 'system-ui, sans-serif', fontSize: '22px', resolution: 3 })
      .setOrigin(0.5)
      .setAlpha(0.9)
      .setDepth(-3);
    this.objs.push(sign);
  }

  private addStaff() {
    const { C } = this.g;
    const particles = loadPrefs().particles;
    const r = seeded(this.ctx.building);
    if (this.ctx.cashier) {
      const av = new Avatar(this.scene, this.app.cfg.character, this.app.items, {
        // Behind the counter (mirrored: in front of it, on the staff side, facing the floor).
        name: this.ctx.cashier, level: 1, appearance: randomAppearance(this.app.cfg.character, r), x: this.regX + C * 0.05, y: this.flip ? this.HP + C * 1.85 : -C * 0.62, isSelf: false, npc: true, particles,
      });
      av.setState(this.flip ? 'up' : 'down', false);
      av.playEmote('sit', { emoji: '🧾', loop: true, durationMs: 0 }, false);
      this.cashierAv = av;
      this.scene.time.delayedCall(450, () => this.cashierAv?.say(this.ctx.greeting, 4200));
    }
    // Cooks (a kopitiam) or a shop hand, at the back.
    const kopi = this.ctx.kind === 'kopitiam';
    const stoves: number[] = [];
    if (kopi) for (let x = this.c0; x < this.regX - C * 1.6; x += C * 1.4) stoves.push(x + C * 0.66);
    else for (let x = this.c0; x < this.regX - C * 0.8; x += C * 1.5) stoves.push(x + C * 0.7);
    if (!stoves.length) stoves.push(this.c0 + C);
    const n = kopi ? Math.min(2, stoves.length) : 1;
    for (let i = 0; i < n; i++) {
      const x = stoves[Math.floor((i + 0.5) * (stoves.length / n))] ?? stoves[0];
      const av = new Avatar(this.scene, this.app.cfg.character, this.app.items, {
        name: '', level: 1, appearance: randomAppearance(this.app.cfg.character, r), x, y: this.my(-SERVICE_ROWS * C + C * 1.55), isSelf: false, npc: true, particles,
      });
      av.setState(this.back, false);
      this.cooks.push({ av, stoves, target: x, until: performance.now() + 2000 + i * 1500 });
    }
  }

  // ---------------------------------------------------------------- furniture: starter tables, seats, paths
  /** Starter tables (a table with a chair each side), shown until the owner puts in tables of their own. */
  houseSets(layout: Placed[]): Placed[] {
    const { W, H, front } = this.g;
    if (layout.some((p) => furniturePiece(p.item)?.category === 'tables')) return [];
    const used = new Set<string>();
    for (const p of layout) {
      const f = furniturePiece(p.item);
      if (!f || f.wall) continue;
      const [w, h] = p.rot % 2 ? [f.h, f.w] : [f.w, f.h];
      for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) used.add(`${x},${y}`);
    }
    const out: Placed[] = [];
    const max = this.ctx.kind === 'kopitiam' ? 6 : 4;
    let id = -1;
    for (let y = 2; y <= H - 4 && out.length / 3 < max; y += 3) {
      for (const x0 of [1, W - 4]) {
        if (out.length / 3 >= max) break;
        const cells = [x0, x0 + 1, x0 + 2];
        if (cells.some((x) => used.has(`${x},${y}`) || (x >= front[0] && x <= front[1]))) continue;
        out.push({ iid: id--, item: 'plastic_chair', x: x0, y, rot: 3 });
        out.push({ iid: id--, item: 'kopitiam_table', x: x0 + 1, y, rot: 0 });
        out.push({ iid: id--, item: 'plastic_chair', x: x0 + 2, y, rot: 1 });
      }
    }
    return out;
  }

  private pieces(): Placed[] {
    const l = this.layout();
    return [...l, ...this.houseSets(l)];
  }

  /** Chairs next to a table. */
  private seats(): Seat[] {
    const all = this.pieces();
    const tables = new Set<string>();
    for (const p of all) {
      const f = furniturePiece(p.item);
      if (f?.category !== 'tables') continue;
      const [w, h] = p.rot % 2 ? [f.h, f.w] : [f.w, f.h];
      for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) tables.add(`${x},${y}`);
    }
    const out: Seat[] = [];
    for (const p of all) {
      if (furniturePiece(p.item)?.category !== 'chairs') continue;
      const around: Array<[number, number, Dir]> = [[1, 0, 'right'], [-1, 0, 'left'], [0, -1, 'up'], [0, 1, 'down']];
      const t = around.find(([dx, dy]) => tables.has(`${p.x + dx},${p.y + dy}`));
      if (t) out.push({ key: `${p.x},${p.y}`, x: p.x, y: p.y, face: t[2], table: [p.x + t[0], p.y + t[1]] });
    }
    return out;
  }

  private solidCells(): Set<string> {
    const out = new Set<string>();
    for (const p of this.pieces()) {
      const f = furniturePiece(p.item);
      if (!f || f.floor || f.wall) continue;
      const [w, h] = p.rot % 2 ? [f.h, f.w] : [f.w, f.h];
      for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) out.add(`${x},${y}`);
    }
    return out;
  }

  /** Is this point (px) on a starter table / chair? (The room's own furniture is checked by the room.) */
  houseSolid(px: number, py: number): boolean {
    const { C } = this.g;
    const cx = Math.floor(px / C), cy = Math.floor(py / C);
    return this.houseSets(this.layout()).some((p) => p.x === cx && p.y === cy);
  }

  /** A walking route between two cells around the furniture (the ends may be furniture: a chair). */
  private route(from: [number, number], to: [number, number], solid: Set<string>): Array<[number, number]> | null {
    const { W, H } = this.g;
    const key = (x: number, y: number) => y * W + x;
    const prev = new Map<number, number>();
    const start = key(from[0], from[1]), goal = key(to[0], to[1]);
    const q = [start];
    prev.set(start, -1);
    while (q.length) {
      const k = q.shift()!;
      if (k === goal) break;
      const x = k % W, y = Math.floor(k / W);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nk = key(nx, ny);
        if (prev.has(nk) || (nk !== goal && solid.has(`${nx},${ny}`))) continue;
        prev.set(nk, k);
        q.push(nk);
      }
    }
    if (!prev.has(goal)) return null;
    const out: Array<[number, number]> = [];
    for (let k = goal; k !== -1; k = prev.get(k)!) out.unshift([k % W, Math.floor(k / W)]);
    return out;
  }

  // ---------------------------------------------------------------- customers
  private visit() {
    const { C, H, front } = this.g;
    const kopi = this.ctx.kind === 'kopitiam';
    const fx = ((front[0] + front[1] + 1) / 2) * C;
    const door: [number, number] = [Math.floor(fx / C), this.flip ? 0 : H - 1];
    const counter: [number, number] = [Math.max(0, Math.min(this.g.W - 1, Math.floor(this.regX / C))), this.flip ? H - 1 : 0];
    const solid = this.solidCells();
    const pt = (c: [number, number]) => ({ x: (c[0] + 0.5) * C, y: (c[1] + 0.75) * C });
    const toCounter = this.route(door, counter, solid);
    if (!toCounter) return;
    const lines = kopi ? COUNTER_LINES.kopitiam : COUNTER_LINES.shop;
    const steps: Parameters<Walkers['walk']>[1] = toCounter.map(pt);
    steps.push({ x: this.regX, y: this.flip ? this.HP - C * 0.2 : C * 0.55, face: this.back, say: lines[Math.floor(Math.random() * lines.length)], waitMs: 1700 });
    // A free seat (and a route there and back), or it's a takeaway.
    const free = this.seats().filter((s) => !this.busy.has(s.key));
    const seat = free.length && Math.random() < 0.8 ? free[Math.floor(Math.random() * free.length)] : null;
    const there = seat ? this.route(counter, [seat.x, seat.y], solid) : null;
    const back = seat ? this.route([seat.x, seat.y], door, solid) : this.route(counter, door, solid);
    if (seat && there && back) {
      this.busy.add(seat.key);
      steps.push(...there.slice(1, -1).map(pt));
      let food: Phaser.GameObjects.Text | null = null;
      let nom: Phaser.Time.TimerEvent | null = null;
      const menu = kopi ? FOOD.kopitiam : FOOD.shop;
      const dish = menu[Math.floor(Math.random() * menu.length)];
      steps.push({
        ...pt([seat.x, seat.y]),
        face: seat.face,
        arrive: (av) => {
          av.playEmote('sit', { emoji: dish, loop: true, durationMs: 0 }, false);
          const tx = (seat.table[0] + 0.5) * C, ty = (seat.table[1] + 0.45) * C;
          food = this.scene.add.text(tx, ty, dish, { fontFamily: 'system-ui, sans-serif', fontSize: '16px', resolution: 3 }).setOrigin(0.5).setDepth(AVATAR_DEPTH + ty - 2);
          // A bite now and then (the dish bobs, a happy face pops up).
          nom = this.scene.time.addEvent({
            delay: 1700 + Math.random() * 900,
            loop: true,
            callback: () => {
              if (food) this.scene.tweens.add({ targets: food, scale: { from: 1.25, to: 1 }, duration: 260 });
              av.playEmote('sit', { emoji: Math.random() < 0.5 ? '😋' : dish, loop: true, durationMs: 0 }, false);
            },
          });
          return 8000 + Math.random() * 7000;
        },
        leave: (av) => {
          av.stopEmote();
          nom?.remove();
          food?.destroy();
          this.busy.delete(seat.key);
        },
      });
      steps.push(...back.slice(1).map(pt));
    } else if (back) steps.push(...back.slice(1).map(pt));
    const outside = this.flip ? -C * 0.8 : H * C + C * 0.8;
    steps.push({ x: fx, y: outside });
    const ok = this.walkers.walk({ x: fx, y: outside }, steps, undefined, () => seat && this.busy.delete(seat.key));
    if (!ok && seat) this.busy.delete(seat.key);
  }

  // ---------------------------------------------------------------- every frame
  update(now: number) {
    this.walkers.update(now);
    this.cashierAv?.tick(now);
    const { C } = this.g;
    // Customers: more often the more stars the place has.
    if (!this.paused && now > this.nextVisit) {
      this.visit();
      this.nextVisit = now + Math.max(2200, 7000 - this.stars() * 900) * (0.7 + Math.random() * 0.6);
    }
    // Cooks: work a stove a while, then move to another.
    for (const c of this.cooks) {
      c.av.tick(now);
      const dx = c.target - c.av.x;
      if (Math.abs(dx) > 2) {
        c.av.setPosition(c.av.x + Math.sign(dx) * Math.min(Math.abs(dx), 1.1), c.av.y);
        c.av.setState(dx > 0 ? 'right' : 'left', true);
      } else {
        c.av.setState(this.back, false);
        if (now > c.until) {
          c.target = c.stoves[Math.floor(Math.random() * c.stoves.length)];
          c.until = now + 3500 + Math.random() * 4000;
          if (Math.random() < 0.3) c.av.say(this.ctx.kind === 'kopitiam' ? 'Order siap! 🔔' : 'Stok dah susun ✅', 1500);
        }
      }
    }
    // Steam and a sizzle over the busy stoves (a kopitiam).
    if (this.ctx.kind === 'kopitiam' && now > this.steam) {
      this.steam = now + 700;
      for (const c of this.cooks) {
        if (Math.abs(c.target - c.av.x) > 2) continue;
        const y0 = this.my(-SERVICE_ROWS * C + C * 0.45);
        const puff = this.scene.add.circle(c.av.x + (Math.random() - 0.5) * C * 0.6, y0, 4 + Math.random() * 4, 0xffffff, 0.55).setDepth(this.flip ? AVATAR_DEPTH + y0 + 40 : AVATAR_DEPTH - SERVICE_ROWS * C + 20);
        this.scene.tweens.add({ targets: puff, y: y0 - C * 0.9, alpha: 0, scale: 2.2, duration: 1300, onComplete: () => puff.destroy() });
        if (Math.random() < 0.15) {
          const e = this.scene.add.text(c.av.x, y0 - 6, COOKING[Math.floor(Math.random() * COOKING.length)], { fontSize: '14px', resolution: 3 }).setOrigin(0.5).setDepth(AVATAR_DEPTH + 10);
          this.scene.tweens.add({ targets: e, y: y0 - C, alpha: 0, duration: 1100, onComplete: () => e.destroy() });
        }
      }
    }
    if (now > this.othersAt) {
      this.othersAt = now + 800;
      this.syncOthers();
    }
    for (const a of this.others.values()) a.tick(now);
  }

  /** Other players in here too, standing about on the floor. */
  private syncOthers() {
    const { C, W, H } = this.g;
    const selfId = this.app.lastInit?.you.id;
    const inside = (this.app.town?.playersInside(this.ctx.building) ?? []).filter((p) => p.id !== selfId);
    const ids = new Set(inside.map((p) => p.id));
    for (const [id, a] of this.others) if (!ids.has(id)) (a.destroy(), this.others.delete(id));
    if (!inside.length) return;
    const solid = this.solidCells();
    for (const p of inside) {
      if (this.others.has(p.id)) continue;
      const r = seeded(`${p.id}`);
      let cx = 1, cy = 1;
      for (let k = 0; k < 20; k++) {
        cx = Math.floor(r() * W);
        cy = 1 + Math.floor(r() * (H - 2));
        if (!solid.has(`${cx},${cy}`)) break;
      }
      const a = new Avatar(this.scene, this.app.cfg.character, this.app.items, {
        name: p.name, level: p.level, appearance: p.appearance, x: (cx + 0.5) * C, y: (cy + 0.75) * C, isSelf: false, cosmetics: p.cosmetics, particles: loadPrefs().particles,
      });
      a.setState(r() < 0.5 ? 'left' : 'right', false);
      this.others.set(p.id, a);
    }
  }

  /** While the owner is decorating: no new customers (and the ones about leave). */
  setPaused(on: boolean) {
    this.paused = on;
    if (on) {
      this.walkers.destroy();
      this.busy.clear();
    }
  }

  // ---------------------------------------------------------------- the counter, the till, the stairs
  /** What's within reach at this spot (px), if anything. */
  near(x: number, y: number): ShopFixture | null {
    const { C } = this.g;
    if (this.flip ? y < this.HP - C * 1.15 : y > C * 1.15) return null;
    if (x < this.c0) return this.ctx.stairs ?? null;
    if (this.ctx.till && Math.abs(x - this.regX) < C * 1.1) return this.ctx.till;
    if (this.ctx.counter) return this.ctx.counter;
    if (this.cashierAv) return { label: `💬 ${this.ctx.cashier}`, use: () => this.cashierAv?.say(this.ctx.greeting, 3500) };
    return null;
  }

  destroy() {
    this.walkers.destroy();
    this.cashierAv?.destroy();
    for (const c of this.cooks) c.av.destroy();
    for (const a of this.others.values()) a.destroy();
    this.others.clear();
    for (const o of this.objs) o.destroy();
    this.objs = [];
  }
}
