// 🗝️ Labirin Purba: the room you're in (docs/LABYRINTH.md). One room at a time: its walls, its
// doors (walk into one to go through, and you come out of the opposite door next door), pillars,
// and what's in it (a loot box, a key, the campfire, stairs). Others in the same room walk about too.
// The server checks everything; this draws and sends intents.
import Phaser from 'phaser';
import {
  DIRECTIONS, labFloor, randomAppearance, roomLayout,
  type Direction, type LabDir, type LabFloor, type LabOther, type LabRoom, type LabRoomView, type LabUse, type RoomLayout,
} from '@kh/shared';
import type { App } from '../app';
import { SnapClock } from '../net/snapClock';
import { toast } from '../ui/dom';
import { loadPrefs } from '../ui/settings';
import { sfx } from '../ui/sound';
import { Avatar } from './avatar';
import { openLabBag } from '../ui/lab/labBag';

interface Sample {
  t: number;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
}

interface Remote {
  av: Avatar;
  samples: Sample[];
}

interface Feature {
  /** A server action, or 'shop': the merchant's wares (a panel). */
  use: LabUse | 'shop';
  label: string;
  /** Tile it stands on. */
  at: [number, number];
}

const col = (hex: string) => parseInt(hex.slice(1), 16);
const shade = (c: number, k: number) => {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * k)));
  return (r << 16) | (g << 8) | b;
};

/** Position at time t from timed samples (holds the last one if t is past it). */
function interpolate(s: Sample[], t: number): Sample | null {
  while (s.length >= 2 && s[1].t <= t) s.shift();
  if (!s.length) return null;
  if (s.length < 2 || s[0].t > t) return s[0];
  const k = (t - s[0].t) / Math.max(1, s[1].t - s[0].t);
  return { t, x: s[0].x + (s[1].x - s[0].x) * k, y: s[0].y + (s[1].y - s[0].y) * k, dir: s[1].dir, moving: s[1].moving || s[0].moving };
}

export class LabScene extends Phaser.Scene {
  private app!: App;
  view!: LabRoomView;
  private floor!: LabFloor;
  private room!: LabRoom;
  private L!: RoomLayout;
  private T = 48;
  private me!: Avatar;
  private pos = { x: 0, y: 0 };
  private dir: Direction = 'up';
  private moving = false;
  private roomObjs: Phaser.GameObjects.GameObject[] = [];
  private remotes = new Map<number, Remote>();
  private clock!: SnapClock;
  private features: Feature[] = [];
  private near: Feature | null = null;
  /** Waiting for the server (going through a door, using something). */
  private busy = false;
  /** In a fight (the battle screen is up): no walking. */
  private fighting = false;

  setFighting(on: boolean) {
    this.fighting = on;
    if (on) {
      this.moving = false;
      this.me?.setState(this.dir, false);
      this.app.hud?.setPrompt(null, this.app.touch);
      this.near = null;
    }
  }
  private sendAcc = 0;
  private lastSent = '';
  private bound: Array<() => void> = [];

  constructor() {
    super('lab');
  }

  init(data: { app: App; view: LabRoomView }) {
    this.app = data.app;
    this.view = data.view;
    this.T = this.app.cfg.lab.tile;
    this.busy = false;
    this.near = null;
    this.remotes = new Map();
    this.roomObjs = [];
  }

  create() {
    const n = this.app.cfg.net;
    this.clock = new SnapClock({ periodMs: 1000 / n.snapshotRateHz, startMs: n.interpolationDelayMs, minMs: n.interpolationMinMs, maxMs: n.interpolationMaxMs, marginMs: n.interpolationMarginMs });
    this.cameras.main.setBackgroundColor('#0b0d14');
    const you = this.app.lastInit!.you;
    this.me = new Avatar(this, this.app.cfg.character, this.app.items, {
      name: you.name, level: this.app.store.progress.level, appearance: you.appearance, x: 0, y: 0, isSelf: true,
      cosmetics: this.app.town?.selfCosmetics ?? you.cosmetics, particles: loadPrefs().particles,
    });
    this.showRoom(this.view);
    this.scale.on('resize', this.fit, this);
    const s = this.app.socket;
    if (s) {
      const onOthers = (p: { room: string; others: LabOther[] }) => {
        if (p.room === `lab:${this.view.floor}:${this.view.room}`) this.setOthers(p.others);
      };
      const onSnap = (p: { t: number; p: Array<[number, number, number, number, number]> }) => this.onSnap(p);
      const onCorrect = (p: { x: number; y: number }) => {
        this.pos = { x: p.x, y: p.y };
        this.me.setPosition(p.x, p.y);
      };
      s.on('lab:others', onOthers);
      s.on('lab:snap', onSnap);
      s.on('lab:correct', onCorrect);
      this.bound.push(() => (s.off('lab:others', onOthers), s.off('lab:snap', onSnap), s.off('lab:correct', onCorrect)));
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const off of this.bound) off();
      this.bound = [];
      this.scale.off('resize', this.fit, this);
      this.clearRoom();
      for (const r of this.remotes.values()) r.av.destroy();
      this.remotes.clear();
      this.me?.destroy();
      this.app.hud?.setPrompt(null, this.app.touch);
    });
  }

  // ---------------------------------------------------------------- the room
  /** Show a room (on entering, or after a door / the stairs). */
  showRoom(view: LabRoomView) {
    this.view = view;
    this.floor = labFloor(this.app.cfg.lab, view.floor);
    this.room = this.floor.rooms[view.room];
    this.L = roomLayout(this.app.cfg.lab, this.floor, this.room);
    this.clearRoom();
    this.drawRoom();
    this.pos = { x: view.x, y: view.y };
    this.dir = view.dir;
    this.me.setPosition(this.pos.x, this.pos.y);
    this.me.setState(this.dir, false);
    this.lastSent = '';
    this.setOthers(view.others);
    this.near = null;
    this.fit();
    this.app.labHud?.update(view);
  }

  private clearRoom() {
    for (const o of this.roomObjs) o.destroy();
    this.roomObjs = [];
    this.features = [];
    this.merchant?.destroy();
    this.merchant = null;
  }

  /** 🛒 Tok Peraih, in the entrance hall and every rest chamber. */
  private merchant: Avatar | null = null;

  private drawRoom() {
    const { T, L, room } = this;
    const fc = this.app.cfg.lab.floors[this.view.floor];
    const W = L.w * T, H = L.h * T;
    const floorC = col(fc.floor), wallC = col(fc.wall);
    const g = this.add.graphics().setDepth(-10);
    this.roomObjs.push(g);
    // Floor: big flagstones, a little uneven.
    g.fillStyle(shade(floorC, 0.55), 1).fillRect(-T, -T, W + 2 * T, H + 2 * T);
    for (let y = 1; y < L.h - 1; y++)
      for (let x = 1; x < L.w - 1; x++) {
        const k = 0.9 + (((x * 73 + y * 151 + room.id * 31) % 17) / 17) * 0.16;
        g.fillStyle(shade(floorC, k), 1).fillRect(x * T + 1, y * T + 1, T - 2, T - 2);
      }
    // Walls: a tall back wall (you see its face), thinner sides and front.
    const face = shade(wallC, 0.85), top = shade(wallC, 1.25);
    g.fillStyle(top, 1).fillRect(0, 0, W, T * 0.35);
    g.fillStyle(face, 1).fillRect(0, T * 0.35, W, T * 0.65);
    for (let x = 0; x < W; x += T / 2) g.fillStyle(shade(face, 0.9), 1).fillRect(x, T * 0.62, T / 2 - 2, 2);
    g.fillStyle(top, 1).fillRect(0, 0, T, H).fillRect(W - T, 0, T, H).fillRect(0, H - T * 0.6, W, T * 0.6);
    g.fillStyle(shade(wallC, 0.6), 1).fillRect(T - 4, T, 4, H - T * 1.6).fillRect(W - T, T, 4, H - T * 1.6);
    // Doors: gaps in the wall, a dark way through, and a sign of where they lead.
    const doorLabel: Record<LabDir, string> = { n: '▲', s: '▼', w: '◀', e: '▶' };
    for (const [d, at] of Object.entries(L.doorAt) as Array<[LabDir, [number, number]]>) {
      const door = room.doors[d]!;
      const locked = door.lock !== undefined && !this.view.self.unlocked.includes(`${this.view.floor}:${door.lock}`);
      const [tx, ty] = at;
      const horiz = d === 'n' || d === 's';
      const x0 = horiz ? (tx - 0.5) * T : d === 'w' ? 0 : W - T;
      const y0 = horiz ? (d === 'n' ? 0 : H - T * 0.6) : (ty - 0.5) * T;
      const w = horiz ? T * 2 : T, h = horiz ? (d === 'n' ? T : T * 0.6) : T * 2;
      g.fillStyle(0x07080c, 1).fillRect(x0, y0, w, h);
      if (locked) {
        // A barred gate.
        g.fillStyle(0x8d6e3f, 1);
        for (let i = 0; i < 5; i++) {
          if (horiz) g.fillRect(x0 + 4 + (i * (w - 8)) / 4 - 2, y0, 4, h);
          else g.fillRect(x0, y0 + 4 + (i * (h - 8)) / 4 - 2, w, 4);
        }
      }
      const lx = horiz ? tx * T + T / 2 : d === 'w' ? T * 0.5 : W - T * 0.5;
      const ly = horiz ? (d === 'n' ? T * 0.5 : H - T * 0.3) : ty * T + T / 2;
      const nextRoom = this.floor.rooms[door.to];
      const seen = this.app.labHud?.hasSeen(this.view.floor, door.to, this.view.seen) ?? false;
      const sign = locked ? '🔒' : nextRoom.kind === 'rest' && seen ? '🔥' : doorLabel[d];
      this.roomObjs.push(
        this.add.text(lx, ly, sign, { fontFamily: 'system-ui, sans-serif', fontSize: locked ? '18px' : '16px', fontStyle: 'bold', color: seen ? '#c3fae8' : '#ffffff', stroke: '#000000', strokeThickness: 4, resolution: 3 }).setOrigin(0.5).setDepth(5),
      );
    }
    // Pillars / rubble.
    for (const i of L.solid) {
      const x = (i % L.w) * T, y = Math.floor(i / L.w) * T;
      g.fillStyle(0x000000, 0.25).fillEllipse(x + T / 2, y + T * 0.95, T * 0.9, T * 0.3);
      g.fillStyle(shade(wallC, 1.05), 1).fillRoundedRect(x + 5, y - T * 0.35, T - 10, T * 1.2, 6);
      g.fillStyle(shade(wallC, 1.35), 1).fillRoundedRect(x + 5, y - T * 0.35, T - 10, T * 0.3, 6);
    }
    this.drawFeatures();
  }

  /** What's in the room: the town gate / campfire / stairs / key, the loot box, the treasure. */
  private drawFeatures() {
    const { T, L, room, view } = this;
    const at = (t: [number, number]) => ({ x: (t[0] + 0.5) * T, y: (t[1] + 0.5) * T });
    const emoji = (t: [number, number], e: string, size = 34, dy = 0) => {
      const p = at(t);
      const o = this.add.text(p.x, p.y + dy, e, { fontSize: `${size}px`, resolution: 3 }).setOrigin(0.5, 0.7).setDepth(1000 + p.y);
      this.roomObjs.push(o);
      return o;
    };
    const label = (t: [number, number], s: string) => {
      const p = at(t);
      this.roomObjs.push(this.add.text(p.x, p.y - T * 0.95, s, { fontFamily: 'system-ui, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#ffe8a3', stroke: '#000000', strokeThickness: 4, resolution: 3 }).setOrigin(0.5, 1).setDepth(5000));
    };
    const f = L.spot.feature;
    const floorName = this.app.cfg.lab.floors[view.floor].name;
    if (view.floor === 0 && room.kind === 'start') {
      emoji(f, '🏙️', 40);
      label(f, 'Back to town');
      this.features.push({ use: 'exit', label: '🚪 Back to town (your Syiling are banked)', at: f });
    } else if (room.kind === 'start') {
      emoji(f, '🪜', 38);
      label(f, `Up to ${this.app.cfg.lab.floors[view.floor - 1].name}`);
      this.features.push({ use: 'up', label: '⬆️ Stairs up', at: f });
    } else if (room.kind === 'rest') {
      const fire = emoji(f, '🔥', 40);
      this.tweens.add({ targets: fire, scale: { from: 0.94, to: 1.08 }, duration: 520, yoyo: true, repeat: -1 });
      label(f, 'Rest chamber');
      this.features.push({ use: 'rest', label: '🔥 Rest here (save point · banks your Syiling)', at: f });
      this.features.push({ use: 'exit', label: '🚪 Leave the labyrinth', at: [f[0] + 3, f[1]] });
      emoji([f[0] + 3, f[1]], '🌀', 34);
    } else if (room.kind === 'boss') {
      emoji(f, '🕳️', 40);
      const last = view.floor + 1 >= this.app.cfg.lab.floors.length;
      const boss = this.app.cfg.lab.bosses[view.floor];
      const beaten = view.self.bosses.includes(view.floor);
      if (!beaten && boss) {
        // 👹 The floor's boss stands in front of the stairs.
        const b = emoji([f[0], f[1] + 2], boss.icon, 64);
        this.tweens.add({ targets: b, scale: { from: 0.96, to: 1.06 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        label([f[0], f[1] + 1.4], `👹 ${boss.name}`);
      }
      label(f, last ? (beaten ? 'The bottom · you made it!' : 'The bottom') : beaten ? 'Stairs down' : 'Stairs down (beat the boss)');
      if (!last) this.features.push({ use: 'down', label: beaten ? `⬇️ Down to ${this.app.cfg.lab.floors[view.floor + 1].name}` : `👹 ${boss?.name ?? 'The boss'} guards the stairs`, at: f });
    } else if (room.kind === 'treasure') {
      emoji(L.spot.centre, view.chestDone ? '🗃️' : '💰', 44);
      if (!view.chestDone) this.features.push({ use: 'chest', label: '💰 Open the treasure', at: L.spot.centre });
    }
    // 🛒 The merchant: the entrance hall and every rest chamber.
    if ((view.floor === 0 && room.kind === 'start') || room.kind === 'rest') {
      const m = L.spot.merchant;
      const lc = this.app.cfg.lab;
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      this.merchant = new Avatar(this, this.app.cfg.character, this.app.items, {
        name: lc.merchant.name, level: 1, appearance: randomAppearance(this.app.cfg.character, rnd), x: (m[0] + 0.5) * T, y: (m[1] + 0.7) * T, isSelf: false, npc: true, particles: false,
      });
      this.merchant.setState('down', false);
      emoji([m[0] + 1, m[1]], '🎒', 26, 6);
      label([m[0], m[1] - 0.25], '🛒 Gear & potions');
      this.features.push({ use: 'shop', label: `🛒 ${lc.merchant.name}: gear and potions`, at: m });
    }
    if (room.key !== undefined) {
      const k = `${view.floor}:${room.key}`;
      const have = view.self.keys.includes(k) || view.self.unlocked.includes(k);
      if (!have) {
        const key = emoji(f, '🗝️', 32);
        this.tweens.add({ targets: key, y: key.y - 6, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.features.push({ use: 'key', label: '🗝️ Take the key', at: f });
      }
    }
    if (room.chest && room.kind === 'chamber') {
      emoji(L.spot.chest, view.chestDone ? '📭' : '📦', 32);
      if (!view.chestDone) this.features.push({ use: 'chest', label: '📦 Open the loot box', at: L.spot.chest });
    }
    // The floor's name, faint, on the back wall.
    this.roomObjs.push(
      this.add.text((L.w * T) / 2, T * 0.32, `${floorName} · B${view.floor + 1}`, { fontFamily: 'Georgia, serif', fontSize: '13px', color: 'rgba(255,255,255,0.45)', resolution: 3 }).setOrigin(0.5, 0.5).setDepth(4),
    );
  }

  /** Frame the whole room. */
  private fit() {
    const cam = this.cameras.main;
    if (!cam || !this.L) return;
    const W = this.L.w * this.T, H = this.L.h * this.T;
    const zoom = Math.min((this.scale.width * 0.96) / (W + this.T), (this.scale.height * 0.78) / (H + this.T * 1.5), 2.4 * this.app.dpr);
    cam.setZoom(zoom);
    cam.centerOn(W / 2, H / 2 + this.T * 0.2);
  }

  // ---------------------------------------------------------------- others in the room
  private setOthers(list: LabOther[]) {
    const ids = new Set(list.map((o) => o.id));
    for (const [id, r] of this.remotes) if (!ids.has(id)) (r.av.destroy(), this.remotes.delete(id));
    for (const o of list) {
      if (this.remotes.has(o.id)) continue;
      const av = new Avatar(this, this.app.cfg.character, this.app.items, { name: o.name, level: o.level, appearance: o.appearance, x: o.x, y: o.y, isSelf: false, cosmetics: o.cosmetics, particles: loadPrefs().particles });
      av.setState(o.dir, false);
      this.remotes.set(o.id, { av, samples: [{ t: performance.now(), x: o.x, y: o.y, dir: o.dir, moving: false }] });
    }
  }

  private onSnap(p: { t: number; p: Array<[number, number, number, number, number]> }) {
    const now = performance.now();
    const at = this.clock.map(p.t, now);
    for (const [id, x, y, d, moving] of p.p) {
      const r = this.remotes.get(id);
      if (!r) continue;
      r.samples.push({ t: at, x, y, dir: DIRECTIONS[d] ?? 'down', moving: moving === 1 });
      if (r.samples.length > 30) r.samples.splice(0, r.samples.length - 30);
    }
  }

  // ---------------------------------------------------------------- walking
  private blocked(x: number, y: number): boolean {
    const { T, L } = this;
    const W = L.w * T, H = L.h * T;
    const hw = 10;
    // Inside the walls, except in a doorway (you walk out through it).
    const inDoor = (d: LabDir) => {
      const at = L.doorAt[d];
      if (!at) return false;
      return d === 'n' || d === 's' ? Math.abs(x - (at[0] + 0.5) * T) < T - hw : Math.abs(y - (at[1] + 0.5) * T) < T - 6;
    };
    if (y < T * 0.95 && !inDoor('n')) return true;
    if (y > H - T * 0.45 && !inDoor('s')) return true;
    if (x < T + hw && !inDoor('w')) return true;
    if (x > W - T - hw && !inDoor('e')) return true;
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    return L.solid.has(ty * L.w + tx) || L.solid.has(ty * L.w + Math.floor((x - hw) / T)) || L.solid.has(ty * L.w + Math.floor((x + hw) / T));
  }

  /** Walked out through a doorway? */
  private outThrough(): LabDir | null {
    const { T, L } = this;
    const W = L.w * T, H = L.h * T, { x, y } = this.pos;
    if (y < T * 0.35 && L.doorAt.n) return 'n';
    if (y > H - T * 0.1 && L.doorAt.s) return 's';
    if (x < T * 0.4 && L.doorAt.w) return 'w';
    if (x > W - T * 0.4 && L.doorAt.e) return 'e';
    return null;
  }

  override update(_t: number, delta: number) {
    const now = performance.now();
    const dt = Math.min(delta, 100) / 1000;
    if (!this.busy && !this.fighting) {
      let { x: vx, y: vy } = this.app.inputVector();
      const len = Math.hypot(vx, vy);
      if (len > 1) {
        vx /= len;
        vy /= len;
      }
      this.moving = len > 0.01;
      if (this.moving) {
        this.dir = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : vy > 0 ? 'down' : 'up';
        const sp = this.app.cfg.lab.walkSpeed;
        const nx = this.pos.x + vx * sp * dt, ny = this.pos.y + vy * sp * dt;
        if (!this.blocked(nx, this.pos.y)) this.pos.x = nx;
        if (!this.blocked(this.pos.x, ny)) this.pos.y = ny;
        this.me.setPosition(this.pos.x, this.pos.y);
        const out = this.outThrough();
        if (out) this.goThrough(out);
      }
      this.me.setState(this.dir, this.moving);
      this.sendMove(delta);
      this.checkNear();
    }
    this.me.tick(now);
    this.merchant?.tick(now);
    const renderT = now - this.clock.delay;
    for (const r of this.remotes.values()) {
      const p = interpolate(r.samples, renderT);
      if (p) {
        r.av.setPosition(p.x, p.y);
        r.av.setState(p.dir, p.moving);
      }
      r.av.tick(now);
    }
  }

  private sendMove(delta: number) {
    this.sendAcc += delta;
    if (this.sendAcc < 1000 / this.app.cfg.movement.sendRateHz) return;
    this.sendAcc = 0;
    // Inside the room only (the doorway itself is handled by lab:door).
    const { T, L } = this;
    const x = Math.max(T * 0.6, Math.min((L.w - 0.6) * T, this.pos.x));
    const y = Math.max(T * 0.9, Math.min((L.h - 0.4) * T, this.pos.y));
    const key = `${Math.round(x)},${Math.round(y)},${this.dir},${this.moving}`;
    if (key === this.lastSent) return;
    this.lastSent = key;
    this.app.socket?.emit('lab:move', { x, y, dir: this.dir, moving: this.moving });
  }

  private goThrough(dir: LabDir) {
    this.busy = true;
    // Tell the server where we are first (at the door), then go through.
    const { T, L } = this;
    const at = L.doorAt[dir]!;
    const inside: Record<LabDir, [number, number]> = { n: [at[0], 1], s: [at[0], L.h - 2], w: [1, at[1]], e: [L.w - 2, at[1]] };
    const ix = (inside[dir][0] + 0.5) * T, iy = (inside[dir][1] + 0.5) * T;
    this.app.socket?.emit('lab:move', { x: ix, y: iy, dir: this.dir, moving: true });
    this.cameras.main.fadeOut(110, 0, 0, 0);
    this.app.socket?.timeout(5000).emit('lab:door', { dir }, (err, res) => {
      this.cameras.main.fadeIn(140, 0, 0, 0);
      this.busy = false;
      if (err || !res.ok) {
        sfx.locked();
        toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
        // Step back into the room.
        this.pos = { x: ix, y: iy };
        this.me.setPosition(ix, iy);
        return;
      }
      sfx.door();
      this.showRoom(res.view);
    });
  }

  private checkNear() {
    const reach = this.T * 1.55;
    let best: Feature | null = null;
    let bd = reach;
    for (const f of this.features) {
      const d = Math.hypot(this.pos.x - (f.at[0] + 0.5) * this.T, this.pos.y - (f.at[1] + 0.5) * this.T);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    if (best !== this.near) {
      this.near = best;
      this.app.hud?.setPrompt(best?.label ?? null, this.app.touch);
    }
  }

  /** E / the interact button. */
  interact() {
    const f = this.near;
    if (!f || this.busy || this.fighting) return;
    if (f.use === 'shop') {
      this.merchant?.say(this.app.cfg.lab.merchant.line || 'Selamat datang!', 2600);
      return void openLabBag(this.app, 'shop');
    }
    this.busy = true;
    this.app.socket?.timeout(5000).emit('lab:use', { what: f.use }, (err, res) => {
      this.busy = false;
      if (err || !res.ok) return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      sfx.coin();
      toast(res.text, 'good', 3200);
      if (res.left) return void this.app.exitLab(res.self);
      if (res.view) {
        const moved = res.view.floor !== this.view.floor || res.view.room !== this.view.room;
        if (moved) this.cameras.main.fadeIn(260, 0, 0, 0);
        this.showRoom(res.view);
      }
    });
  }
}
