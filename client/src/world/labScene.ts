// 🗝️ Labirin Purba: the room you're in (docs/LABYRINTH.md). One room at a time: its walls, its
// doors (walk into one to go through, and you come out of the opposite door next door), pillars,
// and what's in it (a loot box, a key, the campfire, stairs). Others in the same room walk about too.
// The server checks everything; this draws and sends intents.
import Phaser from 'phaser';
import {
  DIRECTIONS, labFloor, roomLayout,
  type Direction, type LabDir, type LabFloor, type LabOther, type LabRoom, type LabRoomView, type LabUse, type RoomLayout,
} from '@kh/shared';
import type { App } from '../app';
import { SnapClock } from '../net/snapClock';
import { labSay, setLabSpeaker } from '../ui/dom';
import { loadPrefs } from '../ui/settings';
import { sfx } from '../ui/sound';
import { AVATAR_DEPTH, Avatar } from './avatar';
import { LabNpc, MERCHANT_LOOK, NPC_LOOKS } from './labNpc';
import { buildRoomArt, KEEPER_DY, LABEL_DEPTH, type RoomArt } from './labRoomArt';
import { addLabFrames, LAB_SHEET, LAB_SHEET_URL } from './labSheet';
import { memoryBudget } from '../perf/memory';
import { openLabBag } from '../ui/lab/labBag';
import { openLabTavern } from '../ui/lab/labTavern';
import { startWarp } from '../ui/lab/warp';
import { showLabLoot } from '../ui/lab/lootPop';

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
  /** A server action, 'shop' (the merchant's wares), 'tavern' (drinks), or 'read' (a sign, a
   *  skeleton, an old campfire: its `text` shows). */
  use: LabUse | 'shop' | 'tavern' | 'read';
  label: string;
  text?: string;
  /** Tile it stands on. */
  at: [number, number];
}

const col = (hex: string) => parseInt(hex.slice(1), 16);
/** The pixel font joins "fi" / "fl" into one odd glyph on canvas: keep them apart. */
export const noLig = (s: string) => s.replace(/f(?=[ilf])/g, 'f‌');
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
  /** The room's pictures (floor, rock, torches, roofs). */
  private art: RoomArt | null = null;
  /** The room you came from (its door says "back"). */
  private prevRoom = -1;
  /** People sitting about (the entrance hall, rest chambers) and the tavern keeper. */
  private npcs: LabNpc[] = [];
  private chatter = 0;
  /** The bush / cobweb tile you're in (to rustle once on stepping in). */
  private brushTile = -1;
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

  /** 🧱 The tileset (once per game; if it fails to load, rooms are drawn in code instead). */
  preload() {
    if (!this.textures.exists(LAB_SHEET)) this.load.image(LAB_SHEET, LAB_SHEET_URL);
  }

  create() {
    addLabFrames(this);
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
    // 🗝️ What happens down here, you say to yourself (a bubble over your head).
    setLabSpeaker((text, ms) => this.me.say(noLig(text), ms, true));
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
      setLabSpeaker(null);
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
    if (this.view && this.room && (view.floor !== this.view.floor || view.room !== this.view.room)) this.prevRoom = view.floor === this.view.floor ? this.view.room : -1;
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
    this.art?.destroy();
    this.art = null;
    for (const o of this.roomObjs) o.destroy();
    this.roomObjs = [];
    this.features = [];
    this.merchant?.destroy();
    this.merchant = null;
    for (const n of this.npcs) n.destroy();
    this.npcs = [];
    this.brushTile = -1;
  }

  /** Someone about the place, in the dungeon's pixel-art style: standing (the keeper), sitting facing
   *  you (benches), side-on on a log (round a fire; `flip` faces left) or from behind (at the counter). */
  private npc(t: [number, number], look: number, pose: 'stand' | 'sit' | 'side' | 'back', dx = 0, dy = 0, flip = false) {
    const i = look % NPC_LOOKS.length;
    const a = new LabNpc(this, `l${i}`, NPC_LOOKS[i], pose, (t[0] + 0.5) * this.T + dx, (t[1] + 0.85) * this.T + dy, this.T / 24, flip);
    this.npcs.push(a);
    return a;
  }

  /** 🛒 Tok Peraih, in the entrance hall and every rest chamber. */
  private merchant: LabNpc | null = null;

  /**
   * 🪧 What a sign says: real help for this floor (always the same for the same sign). The way to the
   * rest chamber, to the stairs down, to the key, what's behind each door here, or what lives on this
   * floor, plus an old adventurer's line.
   */
  private signText(at: [number, number], tip: number): string {
    const lc = this.app.cfg.lab;
    const f = this.floor, here = this.room;
    const DIR: Record<LabDir, string> = { n: 'north', e: 'east', s: 'south', w: 'west' };
    /** Rooms away, and the first door to take (a plain walk through the doors). */
    const way = (to: number): { k: number; dir: LabDir } | null => {
      if (to === here.id) return null;
      const prev = new Map<number, { from: number; dir: LabDir }>();
      const q = [here.id];
      prev.set(here.id, { from: -1, dir: 'n' });
      while (q.length) {
        const r = q.shift()!;
        if (r === to) break;
        for (const [d, door] of Object.entries(f.rooms[r].doors) as Array<[LabDir, { to: number }]>)
          if (!prev.has(door.to)) prev.set(door.to, { from: r, dir: d }), q.push(door.to);
      }
      if (!prev.has(to)) return null;
      let k = 0, r = to, dir: LabDir = 'n';
      while (r !== here.id) {
        const p = prev.get(r)!;
        dir = p.dir;
        r = p.from;
        k++;
      }
      return { k, dir };
    };
    const lines: string[] = [];
    const kinds = ['rest', 'boss', 'doors', 'monsters', 'key'] as const;
    const pick = kinds[(at[0] * 7 + at[1] * 13 + here.id) % kinds.length];
    const boss = lc.bosses[Math.min(f.n, lc.bosses.length - 1)];
    const restWay = way(f.rest), bossWay = way(f.boss);
    const keyRoom = f.rooms.find((r) => r.key !== undefined && !this.view.self.keys.includes(`${f.n}:${r.key}`) && !this.view.self.used.includes(`${f.n}:${r.key}`));
    const keyWay = keyRoom ? way(keyRoom.id) : null;
    if ((pick === 'rest' || pick === 'key') && restWay && !(pick === 'key' && keyWay)) lines.push(`🔥 The rest chamber is ${restWay.k} room${restWay.k === 1 ? '' : 's'} away: take the ${DIR[restWay.dir]} door first.`);
    else if (pick === 'key' && keyWay) lines.push(`🗝️ The key to this floor's locked treasure is ${keyWay.k} room${keyWay.k === 1 ? '' : 's'} away: ${DIR[keyWay.dir]} door first.`);
    else if (pick === 'boss' && bossWay) lines.push(`👹 ${boss.name} guards the stairs down, ${bossWay.k} room${bossWay.k === 1 ? '' : 's'} from here (${DIR[bossWay.dir]} door first). Its move: ${boss.move}.`);
    else if (pick === 'monsters') {
      const names = lc.monsters.filter((m) => f.n >= m.floors[0] && f.n <= m.floors[1]).map((m) => `${m.icon} ${m.name}`);
      lines.push(`${lc.floors[f.n].name} (B${f.n + 1}): ${names.join(', ')} live here.${f.n >= lc.boss.minionsFrom ? ' The boss brings friends this deep.' : ''}`);
    }
    // What's behind each door of this room.
    const beyond = (Object.entries(here.doors) as Array<[LabDir, { to: number; lock?: number }]>).map(([d, door]) => {
      const r = f.rooms[door.to];
      const what = door.lock !== undefined ? '🔒 locked treasure' : r.kind === 'rest' ? '🔥 a campfire' : r.kind === 'boss' ? '👹 the boss' : r.kind === 'start' ? (f.n === 0 ? 'the entrance hall' : 'the stairs up') : r.monsters ? '⚔️ monsters' : r.chest ? '📦 a loot box' : 'quiet';
      return `${DIR[d][0].toUpperCase()}${DIR[d].slice(1)}: ${what}`;
    });
    if (!lines.length || pick === 'doors') lines.push(`Beyond these doors: ${beyond.join(' · ')}.`);
    const flavour = tip >= 0 ? lc.signs[tip] : lc.signs[(at[0] + at[1] * 3 + here.id) % Math.max(1, lc.signs.length)];
    const main = `📜 ${lines.join(' ')}`;
    // (A speech bubble holds about 200 letters: the old line only if it fits.)
    return flavour && main.length + flavour.length < 175 ? `${main} (Below: "${flavour}")` : main;
  }

  /** How far the camera zooms in to frame the room. */
  private zoomFor() {
    const W = this.L.w * this.T, H = this.L.h * this.T;
    return Math.min((this.scale.width * 0.96) / (W + this.T), (this.scale.height * 0.78) / (H + this.T * 1.5), 2.4 * this.app.dpr);
  }

  private drawRoom() {
    const { T, L, room } = this;
    const fc = this.app.cfg.lab.floors[this.view.floor];
    const budget = memoryBudget();
    const locked: Partial<Record<LabDir, boolean>> = {};
    for (const d of Object.keys(L.doorAt) as LabDir[]) {
      const door = room.doors[d]!;
      locked[d] = door.lock !== undefined && !this.view.self.unlocked.includes(`${this.view.floor}:${door.lock}`);
    }
    this.art = buildRoomArt(this, L, {
      T, seed: fc.seed * 31 + room.id * 977 + 13, wall: fc.wall, floor: fc.floor, locked,
      res: Math.min(budget.maxChunkRes + 0.25, Math.max(1, this.zoomFor())),
      torches: loadPrefs().memory === 'normal' ? 4 : 3,
      fire: room.kind === 'rest' ? L.spot.feature : undefined,
      merchant: (this.view.floor === 0 && room.kind === 'start') || room.kind === 'rest' ? L.spot.merchant : undefined,
    });
    // Doors: a sign of where each one leads.
    const arrow: Record<LabDir, string> = { n: '▲', s: '▼', w: '◀', e: '▶' };
    for (const [d, at] of Object.entries(L.doorAt) as Array<[LabDir, [number, number]]>) {
      const door = room.doors[d]!;
      const next = this.floor.rooms[door.to];
      const seen = this.app.labHud?.hasSeen(this.view.floor, door.to, this.view.seen) ?? false;
      const sign =
        locked[d] ? ['🔒 Locked door', "needs this floor's 🗝️ key"]
        : door.to === this.prevRoom ? ['↩ Back', 'the way you came']
        : seen && next.kind === 'rest' ? ['🔥 Rest chamber', 'save · heal · shop']
        : seen && next.kind === 'boss' ? ['👹 Boss room', 'the stairs down']
        : seen && next.kind === 'treasure' ? ['💰 Treasure room', '']
        : seen && next.kind === 'start' ? (this.view.floor === 0 ? ['🏙️ Entrance hall', 'exit to town'] : ['⬆️ Stairs up', ''])
        : seen ? ['Explored', ''] : ['❔ Unexplored', ''];
      const [tx, ty] = at;
      const p: [number, number] = d === 'n' ? [tx, 0.2] : d === 's' ? [tx, L.h - 1.05] : d === 'w' ? [1.25, ty - 0.55] : [L.w - 2.25, ty - 0.55];
      this.sign(p, `${arrow[d]} ${sign[0]}`, sign[1], locked[d] ? '#ffa8a8' : seen ? '#c3fae8' : '#ffffff', 11);
    }
    this.drawFeatures();
  }

  /** A two-line sign: what it is, and what it does (always on top). */
  private sign(t: [number, number], title: string, sub = '', color = '#ffe8a3', size0 = 13) {
    const { T } = this;
    // Bigger in the world when the room is shown small (a phone), so it stays readable.
    const size = Math.round(size0 * Math.min(1.8, Math.max(1, 0.8 / this.zoomFor())));
    const x = (t[0] + 0.5) * T, y = (t[1] + 0.5) * T;
    // Like the reference: a pixel font, the name in warm gold, what it does in white underneath.
    const style = { fontFamily: '"Pixelify Sans", system-ui, sans-serif', fontStyle: 'bold', stroke: '#1a0f08', strokeThickness: 4, resolution: 3 };
    const gold = color === '#ffe8a3' ? '#ffb533' : color;
    title = noLig(title);
    sub = noLig(sub);
    const a = this.add.text(x, y - (sub ? size * 0.55 : 0), title, { ...style, fontSize: `${size + 1}px`, color: gold }).setOrigin(0.5, 0.5).setDepth(LABEL_DEPTH);
    this.roomObjs.push(a);
    if (sub) this.roomObjs.push(this.add.text(x, y + size * 0.62, sub, { ...style, fontStyle: '500', fontSize: `${size - 1}px`, color: '#f8f1e7', strokeThickness: 3 }).setOrigin(0.5, 0.5).setDepth(LABEL_DEPTH));
  }

  /** What's in the room: the town gate / campfire / stairs / key, the loot box, the treasure. */
  private drawFeatures() {
    const { T, L, room, view } = this;
    const at = (t: [number, number]) => ({ x: (t[0] + 0.5) * T, y: (t[1] + 0.5) * T });
    const emoji = (t: [number, number], e: string, size = 34, dy = 0) => {
      const p = at(t);
      const o = this.add.text(p.x, p.y + dy, e, { fontSize: `${size}px`, resolution: 3 }).setOrigin(0.5, 0.7).setDepth(AVATAR_DEPTH + p.y - 1);
      this.roomObjs.push(o);
      return o;
    };
    /** A sign over a thing: what it is, and (smaller) what it does. */
    const label = (t: [number, number], title: string, sub = '') => this.sign([t[0], t[1] - 1.05], title, sub);
    const f = L.spot.feature;
    const lc = this.app.cfg.lab;
    const floorName = lc.floors[view.floor].name;
    const glowAt = (t: [number, number], tint: number) => {
      const p = at(t);
      const g = this.add.image(p.x, p.y, 'lab_glow').setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.45).setScale((T * 2.6) / 128).setDepth(-4);
      this.roomObjs.push(g);
      this.tweens.add({ targets: g, alpha: { from: 0.32, to: 0.55 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    };
    if (view.floor === 0 && room.kind === 'start') {
      // 🌀 The way in and out: the purple portal (top left). Walk up to it and press E.
      const pt = L.spot.portal;
      this.sign([pt[0] + 0.1, pt[1] - 2.25], '🌀 PORTAL: back to town', 'banks your carried Syiling', '#e5b8ff');
      this.features.push({ use: 'exit', label: '🌀 Step into the portal: back to town (banks your carried Syiling)', at: pt });
    } else if (room.kind === 'start') {
      glowAt(f, 0xa5d8ff);
      emoji(f, '🪜', 40);
      label(f, '⬆️ Stairs up', `to ${lc.floors[view.floor - 1].name} (B${view.floor})`);
      this.features.push({ use: 'up', label: `⬆️ Stairs up to ${lc.floors[view.floor - 1].name} (B${view.floor})`, at: f });
    } else if (room.kind === 'rest') {
      glowAt(f, 0xff922b);
      const fire = emoji(f, '🔥', 42);
      this.tweens.add({ targets: fire, scale: { from: 0.94, to: 1.08 }, duration: 520, yoyo: true, repeat: -1 });
      label(f, '🔥 Campfire: rest & save', 'heals you · banks Syiling · you come back here');
      this.features.push({ use: 'rest', label: '🔥 Rest at the campfire: heals you, banks your Syiling, and you come back here if you fall', at: f });
      const portal = L.spot.portal;
      glowAt(portal, 0x9775fa);
      const pe = emoji(portal, '🌀', 36);
      this.tweens.add({ targets: pe, angle: 360, duration: 4000, repeat: -1 });
      this.sign([portal[0] + 0.4, portal[1] + 0.95], '🌀 Exit portal', 'back to town');
      this.features.push({ use: 'exit', label: '🌀 Exit portal: leave the labyrinth, back to town (banks your Syiling)', at: portal });
    } else if (room.kind === 'boss') {
      emoji(f, '🕳️', 42);
      const last = view.floor + 1 >= lc.floors.length;
      const boss = lc.bosses[view.floor];
      const beaten = view.self.bosses.includes(view.floor);
      if (!beaten && boss) {
        // 👹 The floor's boss stands in front of the stairs.
        glowAt([f[0], f[1] + 2], 0xe03131);
        const b = emoji([f[0], f[1] + 2], boss.icon, 64);
        this.tweens.add({ targets: b, scale: { from: 0.96, to: 1.06 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.sign([f[0], f[1] + 3.2], `👹 BOSS: ${boss.name}`, 'beat it to open the stairs down', '#ffa8a8');
      }
      if (last) label(f, '🏁 The bottom', beaten ? 'you made it!' : 'the deepest floor');
      else label(f, '⬇️ Stairs down', beaten ? `to ${lc.floors[view.floor + 1].name} (B${view.floor + 2})` : 'locked until the boss falls');
      if (!last) this.features.push({ use: 'down', label: beaten ? `⬇️ Stairs down to ${lc.floors[view.floor + 1].name} (B${view.floor + 2})` : `👹 ${boss?.name ?? 'The boss'} guards the stairs: beat it first`, at: f });
    } else if (room.kind === 'treasure') {
      if (!view.chestDone) glowAt(L.spot.centre, 0xfcc419);
      emoji(L.spot.centre, view.chestDone ? '🗃️' : '💰', 44);
      label(L.spot.centre, view.chestDone ? '🗃️ Emptied' : '💰 Treasure', view.chestDone ? 'you took it all' : 'a big pile of Syiling');
      if (!view.chestDone) this.features.push({ use: 'chest', label: '💰 Open the treasure: a big pile of Syiling', at: L.spot.centre });
    }
    // 🛒 The merchant: the entrance hall and every rest chamber.
    if ((view.floor === 0 && room.kind === 'start') || room.kind === 'rest') {
      const m = L.spot.merchant;
      // An old sage in pixel art: a long white beard and hair, a deep purple robe, his hand on the staff.
      this.merchant = new LabNpc(this, 'merchant', MERCHANT_LOOK, 'stand', (m[0] + 0.5) * T, (m[1] + 0.7) * T, T / 24, true); // (flipped: the staff on the open side, away from his stall)
      emoji([m[0] + 1, m[1]], '🎒', 26, 6);
      label([m[0], m[1] - 0.25], '🛒 SHOP', 'gear & potions (Syiling)');
      this.features.push({ use: 'shop', label: `🛒 ${lc.merchant.name}'s shop: buy gear and potions with Syiling`, at: m });
    }
    if (room.key !== undefined) {
      const k = `${view.floor}:${room.key}`;
      const have = view.self.keys.includes(k) || view.self.used.includes(k);
      if (!have) {
        glowAt(f, 0xffd43b);
        const key = emoji(f, '🗝️', 32);
        this.tweens.add({ targets: key, y: key.y - 6, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        label(f, '🗝️ Key', "opens this floor's 🔒 treasure door");
        this.features.push({ use: 'key', label: "🗝️ Take the key: it opens this floor's locked 🔒 treasure door", at: f });
      }
    }
    if (room.chest && room.kind === 'chamber') {
      emoji(L.spot.chest, view.chestDone ? '📭' : '📦', 32);
      label(L.spot.chest, view.chestDone ? '📭 Opened' : '📦 Loot box', view.chestDone ? 'refills tomorrow' : 'Syiling · refills daily');
      if (!view.chestDone) this.features.push({ use: 'chest', label: '📦 Open the loot box: Syiling (it refills every day)', at: L.spot.chest });
    }
    // 🍵 The tavern, people round the campfire and on the benches (the entrance hall).
    if (L.hall) {
      const h = L.hall;
      const tv = lc.tavern;
      const sheet = this.textures.exists(LAB_SHEET);
      this.npc(h.keeper, 0, 'stand', 0, (sheet ? T * KEEPER_DY : 0) - T * 0.25).say(tv.line, 4000);
      this.sign([(h.tavern[0] + h.tavern[2]) / 2, h.tavern[1] - 1.5], `🍵 TAVERN: ${tv.name}`, 'drinks = buffs for your next fights', '#ffd8a8');
      this.features.push({ use: 'tavern', label: `🍵 ${tv.name}: drinks that buff your next fights`, at: L.spot.tavern });
      h.sitters.forEach((s, i) => this.npc(s, 1 + i, 'side', 0, 0, s[0] > h.fire[0]));
      h.benchSitters.forEach((s, i) => this.npc(s, 4 + i, 'sit', 0, -T * 0.1));
      this.npc(h.stools[1], 3, 'back', 0, -T * 0.15); // someone having a drink at the counter
      this.features.push({ use: 'read', label: '🔥 Campfire: adventurers swap stories here', text: '🔥 The fire crackles. "Rest at the campfires deeper down: they save your progress."', at: h.fire });
    }
    // 🔥 A rest chamber: one or two adventurers resting by the fire.
    if (room.kind === 'rest') {
      this.npc([f[0] - 1, f[1]], 6 + view.floor, 'side', -T * 0.1, T * 0.1);
      if (room.id % 2) this.npc([f[0] + 1, f[1]], 7 + view.floor, 'side', T * 0.1, T * 0.1, true);
    }
    // Things lying about: signs to read, bones, cold campfires.
    const BONES = ['💀 An adventurer who never made it out. Their bag is long empty.', '💀 Old bones, picked clean. Something lives down here.', "💀 A skeleton still clutching a broken keris. Don't end up like this."];
    for (const pr of L.props) {
      if (pr.kind === 'sign' && pr.text !== undefined) {
        this.sign([pr.at[0], pr.at[1] - 1.1], '📜 Sign', 'read it', '#e9ecef', 11);
        this.features.push({ use: 'read', label: '📜 Read the sign (left by an adventurer)', text: this.signText(pr.at, pr.text), at: pr.at });
      } else if (pr.kind === 'skeleton') this.features.push({ use: 'read', label: '💀 Look at the bones', text: BONES[(pr.at[0] + pr.at[1]) % BONES.length], at: pr.at });
      else if (pr.kind === 'oldfire') this.features.push({ use: 'read', label: '🔥 A cold campfire', text: '🔥 Cold ashes, a few embers. Someone camped here not long ago… and left in a hurry.', at: pr.at });
    }
    // 📦 Crates: smash them (they come back later). 🪨 This floor's cracked rock hides a stash.
    const sheetOk = this.textures.exists(LAB_SHEET);
    L.props.filter((x) => x.kind === 'crate').forEach((c, i) => {
      const x = (c.at[0] + 0.5) * T, by = (c.at[1] + 0.9) * T;
      if (view.broken?.includes(i)) {
        if (sheetOk) this.roomObjs.push(this.add.image(x, by, LAB_SHEET, 'rubble_b').setOrigin(0.5, 1).setDisplaySize(T * 0.7, T * 0.35).setTint(0x8a6a50).setDepth(-3));
        return;
      }
      const img = sheetOk
        ? this.add.image(x, by, LAB_SHEET, i % 2 ? 'crate_small_b' : 'crate_small_a').setOrigin(0.5, 1)
        : this.add.text(x, by, '📦', { fontSize: '30px', resolution: 3 }).setOrigin(0.5, 1);
      if (img instanceof Phaser.GameObjects.Image) img.setScale((T * 0.78) / img.width);
      img.setDepth(AVATAR_DEPTH + by);
      this.roomObjs.push(img);
      this.features.push({ use: 'crate', label: '📦 Smash the crate: maybe something inside (it comes back later)', at: c.at });
    });
    const sec = L.props.find((x) => x.kind === 'secret');
    if (sec) {
      const x = (sec.at[0] + 0.5) * T, y = (sec.at[1] + 0.75) * T;
      const g = this.add.graphics().setDepth(AVATAR_DEPTH + (sec.at[1] + 1) * T + 2);
      if (!view.secretFound) {
        // Cracks across the rock face, and now and then a glint.
        g.lineStyle(2, 0x0d0712, 0.9);
        g.beginPath().moveTo(x - T * 0.25, y - T * 0.35).lineTo(x - T * 0.05, y - T * 0.1).lineTo(x - T * 0.15, y + T * 0.05).lineTo(x + T * 0.05, y + T * 0.2).strokePath();
        g.beginPath().moveTo(x - T * 0.05, y - T * 0.1).lineTo(x + T * 0.2, y - T * 0.2).lineTo(x + T * 0.28, y - T * 0.05).strokePath();
        g.lineStyle(1, 0xb197fc, 0.35).beginPath().moveTo(x - T * 0.23, y - T * 0.36).lineTo(x - T * 0.03, y - T * 0.11).strokePath();
        const glint = this.add.text(x + T * 0.12, y - T * 0.25, '✦', { fontSize: '12px', color: '#e5dbff', resolution: 3 }).setOrigin(0.5).setDepth(g.depth + 1).setAlpha(0);
        this.tweens.add({ targets: glint, alpha: { from: 0, to: 0.9 }, duration: 600, yoyo: true, repeat: -1, repeatDelay: 2600 });
        this.roomObjs.push(glint);
        this.features.push({ use: 'secret', label: '🪨 A cracked rock… something glints behind it. Give it a shove?', at: [sec.at[0], sec.at[1] + 1] });
      } else {
        // Broken open: a dark hollow.
        g.fillStyle(0x07040a, 0.9).fillEllipse(x, y - T * 0.05, T * 0.55, T * 0.45);
        g.fillStyle(0x3b2a4a, 1).fillRect(x - T * 0.3, y + T * 0.15, T * 0.15, T * 0.08).fillRect(x + T * 0.12, y + T * 0.18, T * 0.12, T * 0.07);
      }
      this.roomObjs.push(g);
    }
    // The floor's name, carved faint into the back wall.
    this.roomObjs.push(
      this.add.text((L.w * T) / 2 + T * 2.6, T * 0.1, `${floorName} · B${view.floor + 1}`, { fontFamily: 'Georgia, serif', fontSize: '13px', color: 'rgba(220,230,255,0.55)', stroke: '#000000', strokeThickness: 3, resolution: 3 }).setOrigin(0, 0.5).setDepth(AVATAR_DEPTH + T + 1),
    );
  }

  /** Frame the whole room. */
  private fit() {
    const cam = this.cameras.main;
    if (!cam || !this.L) return;
    const W = this.L.w * this.T, H = this.L.h * this.T;
    cam.setZoom(this.zoomFor());
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

  /** 🔥 By the hall's campfire (the server heals you there): say so once, and keep the HP shown fresh. */
  private warmAt = 0;
  private warm = false;
  private warmUp(now: number) {
    const h = this.L?.hall;
    const fire = this.app.cfg.lab.player.campfire;
    const T = this.app.cfg.lab.tile;
    const near = !!h && this.view.floor === 0 && Math.hypot(this.pos.x - (h.fire[0] + 0.5) * T, this.pos.y - (h.fire[1] + 0.5) * T) <= (fire.reach - 0.15) * T;
    const self = this.app.labHud?.self;
    const hurt = !!self && self.hp < self.maxHp;
    if (near && !this.warm && hurt) labSay(`🔥 Ahh, warm… (+${fire.hp} HP every ${fire.everySec}s by the fire)`);
    this.warm = near;
    if (!near || !hurt || now < this.warmAt) return;
    this.warmAt = now + fire.everySec * 1000;
    this.app.socket?.timeout(5000).emit('lab:self', (err, res) => {
      if (!err && res.ok && this.app.lab === this) this.app.labHud?.updateSelf(res.self);
    });
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
      this.warmUp(now);
    }
    this.me.tick(now);
    this.art?.update(this.pos.x, this.pos.y, delta);
    this.merchant?.tick(now);
    for (const n of this.npcs) n.tick(now);
    this.rustle();
    // Now and then someone by the fire says something.
    if (this.npcs.length > 1 && now > this.chatter) {
      this.chatter = now + 7000 + Math.random() * 6000;
      const lines = ['Hati-hati kat bawah tu…', 'I heard the bushes bite.', 'Bang, ada Jamu lebih?', 'Floor 3 nearly got me.', 'Teh tarik Mak Jah best!', 'Jangan lupa rest kat campfire.', 'Something rustled. Just the wind… right?'];
      const who = this.npcs[1 + Math.floor(Math.random() * (this.npcs.length - 1))];
      who.say(lines[Math.floor(Math.random() * lines.length)], 3200);
    }
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

  /** Walking into a bush or a cobweb: leaves (or threads) fly and it shakes (the server decides if
   *  something was hiding in it). */
  private rustle() {
    const { T, L } = this;
    const i = Math.floor(this.pos.y / T) * L.w + Math.floor(this.pos.x / T);
    const kind = L.brush.get(i);
    if (!kind) return void (this.brushTile = -1);
    if (i === this.brushTile) return;
    this.brushTile = i;
    const color = kind === 'bush' ? 0x51cf66 : 0xe9ecef;
    for (let k = 0; k < 6; k++) {
      const bit = this.add.rectangle(this.pos.x + (Math.random() - 0.5) * T * 0.6, this.pos.y - T * 0.3, kind === 'bush' ? 5 : 2, kind === 'bush' ? 3 : 6, color).setDepth(LABEL_DEPTH - 1);
      this.tweens.add({ targets: bit, x: bit.x + (Math.random() - 0.5) * T, y: bit.y - T * (0.4 + Math.random() * 0.5), angle: Math.random() * 360, alpha: 0, duration: 500 + Math.random() * 300, onComplete: () => bit.destroy() });
    }
    sfx.tick();
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
        labSay(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
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
    if (f.use === 'tavern') {
      this.npcs[0]?.say(this.app.cfg.lab.tavern.line, 2600);
      return void openLabTavern(this.app);
    }
    if (f.use === 'read') {
      sfx.click();
      return void labSay(f.text ?? '', 'info', 6500);
    }
    this.busy = true;
    // 🌀 Stepping into the portal: the warp covers the way back to town.
    const warp = f.use === 'exit' ? startWarp() : null;
    this.app.socket?.timeout(5000).emit('lab:use', { what: f.use }, (err, res) => {
      this.busy = false;
      if (err || !res.ok) {
        warp?.cancel();
        return void labSay(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      }
      // 💰 Something found: show it big (coins counting up, the thing in its colour).
      const titles: Partial<Record<string, string>> = { chest: '📦 Found!', crate: '📦 Smash!', secret: '🪨 A hidden stash!', key: '🗝️ A key!' };
      if (res.loot) showLabLoot(res.loot, res.text.startsWith('💰') ? '💰 Treasure!' : (titles[f.use] ?? ''));
      else sfx.coin();
      labSay(res.text, 'good', 3200);
      if (res.left) {
        if (warp) return void warp.done(() => this.app.exitLab(res.self));
        return void this.app.exitLab(res.self);
      }
      warp?.cancel();
      if (res.view) {
        const moved = res.view.floor !== this.view.floor || res.view.room !== this.view.room;
        if (moved) this.cameras.main.fadeIn(260, 0, 0, 0);
        this.showRoom(res.view);
      }
    });
  }
}
