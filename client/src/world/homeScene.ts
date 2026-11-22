// Your own home's interior: walk in from the street (the front door opens into the living room),
// and through doorways into the other rooms (bedrooms, kitchen, bathroom). The camera frames the
// room you're in and the others go dark. Decorate mode shows the whole floor plan: a Sims-like
// grid editor (pick furniture you own, place / move / rotate / remove it, drag it, undo / redo,
// keyboard controls), with the star rating and the top suggestions updating live (same maths as
// the server), then Save. From here you can also clean the unit (Airbnb) and fix requests.
import Phaser from 'phaser';
import {
  formatMoney, layoutProblem, planForType, rateUnit, roomIndex, roomKindsFor, roomNames, roomStatus, roomSuits, suggestions, wallBetween,
  type FloorPlan, type Placed, type PropSelf, type ShopView, type RatingCfg, type RoomKind,
  shopFrontTop,
} from '@kh/shared';
import type { App } from '../app';
import { drawPlaced, furniturePiece } from '../items/furnitureArt';
import { el, toast, uiRoot } from '../ui/dom';
import { iconUrl } from '../ui/panel';
import { loadPrefs } from '../ui/settings';
import { sfx } from '../ui/sound';
import { AVATAR_DEPTH, Avatar } from './avatar';
import { CHAIR_FACE, SERVICE_ROWS, ShopFloor, type ShopCtx, type ShopFixture } from './shopFloor';
import { COUNTER_LINES, Walkers } from './walkers';

const C = 40; // px per cell (1 m)
const WALL = 18; // outer wall thickness (px)
const INNER = 8; // inner wall thickness (px)
const DIM_DEPTH = 900_000;
/** Space above the floor in the furniture layers (tall pieces at the back wall rise into it). */
const HEADROOM = 40;
/** What goes in each kind of room (shown under the room's name while decorating). */
const BELONGS: Record<RoomKind, string> = {
  living: 'sofas · TV · tables',
  bedroom: 'beds · wardrobes · desks',
  kitchen: 'cooking · fridge · dining',
  bath: 'toilet · shower · bathtub',
  office: 'desks · shelves',
};

type Hand = { iid: number; item: string; rot: number; manual: boolean };

export class HomeScene extends Phaser.Scene {
  private app!: App;
  unitId = '';
  private me!: Avatar;
  private pos = { x: 0, y: 0 };
  private dir: 'up' | 'down' | 'left' | 'right' = 'up';
  private W = 7;
  private H = 6;
  private plan!: FloorPlan;
  private layout: Placed[] = [];
  private furnTex: Phaser.Textures.CanvasTexture | null = null;
  private ghostTex: Phaser.Textures.CanvasTexture | null = null;
  private ghostText: Phaser.GameObjects.Text | null = null;
  private dim: Phaser.GameObjects.Graphics | null = null;
  private roomLabels: Phaser.GameObjects.Text[] = [];
  /** Per room: what belongs there and how complete it is (while decorating). */
  private roomSubs: Phaser.GameObjects.Text[] = [];
  private banner: Phaser.GameObjects.Text | null = null;
  private ui: HTMLElement | null = null;
  private side: HTMLElement | null = null;
  private decorating = false;
  private hand: Hand | null = null;
  private hover: { x: number; y: number } | null = null;
  /** Where the piece in hand was picked up from (a release elsewhere = a drag). */
  private dragFrom: { x: number; y: number } | null = null;
  private undo: Placed[][] = [];
  private redo: Placed[][] = [];
  private dirty = false;
  private leaving = false;
  private room = -1;
  private off: (() => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    super('home');
  }

  /** 🏪 A shop: its counter, staff and customers (and, visiting someone else's, what they've built). */
  private shopCtx: ShopCtx | null = null;
  private visit: ShopView | null = null;
  private shop: ShopFloor | null = null;
  /** Rows of service area above the floor (a shop's counter side)... */
  private top = 0;
  /** ...or below it, for a shop whose door is in the top wall (its building's door faces up). */
  private bottom = 0;
  private frontTop = false;
  private nearFix: ShopFixture | null = null;
  /** 🪑 A chair within reach (E: sit on it, facing its way), and where you stood before sitting. */
  private nearChair: { x: number; y: number; face: (typeof CHAIR_FACE)[number] } | null = null;
  private sitFrom: { x: number; y: number } | null = null;

  init(data: { app: App; unit: string; shop?: ShopCtx; visit?: ShopView }) {
    this.app = data.app;
    this.unitId = data.unit;
    this.shopCtx = data.shop ?? null;
    this.visit = data.visit ?? null;
    this.shop = null;
    this.nearFix = null;
    const bld = this.shopCtx ? this.app.map.buildings.find((b) => b.id === this.shopCtx!.building) : undefined;
    this.frontTop = !!bld && shopFrontTop(bld);
    this.top = this.shopCtx && !this.frontTop ? SERVICE_ROWS : 0;
    this.bottom = this.shopCtx && this.frontTop ? SERVICE_ROWS : 0;
    this.decorating = false;
    this.hand = null;
    this.undo = [];
    this.redo = [];
    this.dirty = false;
    this.leaving = false;
    this.room = -1;
    this.roomLabels = [];
    this.roomSubs = [];
  }

  private get self(): PropSelf | undefined {
    if (this.visit) return undefined; // someone else's shop
    return this.app.store.myProps.find((p) => p.unit === this.unitId) ?? this.app.store.myShops.find((p) => p.unit === this.unitId);
  }

  private ratingCfg(): RatingCfg {
    const tiers = this.app.cfg.rarities.tiers.map((t) => t.id);
    return { furniture: this.app.cfg.furniture, properties: this.app.cfg.properties, rarityIndex: (id) => Math.max(0, tiers.indexOf(this.app.items.get(id)?.rarity ?? 'common')) };
  }

  private unit() {
    return { w: this.W, h: this.H, type: this.visit?.type ?? this.self?.type ?? 'studio', frontTop: this.frontTop };
  }

  create() {
    const s = this.self;
    const typeId = this.visit?.type ?? s?.type ?? 'studio';
    const t = this.app.cfg.properties.types[typeId];
    this.W = t.w;
    this.H = t.h;
    this.plan = planForType(t, typeId);
    if (this.frontTop) this.plan.frontTop = true;
    this.layout = (this.visit?.layout ?? s?.layout ?? []).map((p) => ({ ...p }));
    const W = this.W * C, H = this.H * C;
    // Bright surroundings: a pale tiled corridor outside the home's walls.
    this.add.rectangle(W / 2, H / 2, 40000, 40000, 0xdfe3e8, 1).setDepth(-10);
    this.drawStructure();
    if (this.shopCtx) {
      this.shop = new ShopFloor(this, this.app, this.shopCtx, { C, W: this.W, H: this.H, front: this.plan.front, frontTop: this.frontTop }, () => this.layout, () => this.visit?.stars ?? this.self?.rating.stars ?? 3);
    }
    // grid lines (only shown while decorating)
    this.gridG = this.add.graphics().setDepth(-3).setVisible(false);
    this.gridG.lineStyle(1, 0xffffff, 0.22);
    for (let x = 0; x <= this.W; x++) this.gridG.lineBetween(x * C, 0, x * C, H);
    for (let y = 0; y <= this.H; y++) this.gridG.lineBetween(0, y * C, W, y * C);

    // Headroom above the floor: furniture stands up, so its top can rise above the back wall's line.
    this.furnTex = this.textures.createCanvas(`home_${Date.now()}`, W, H + HEADROOM);
    this.add.image(0, -HEADROOM, this.furnTex!.key).setOrigin(0).setDepth(AVATAR_DEPTH - 1);
    this.ghostTex = this.textures.createCanvas(`ghost_${Date.now()}`, W, H + HEADROOM);
    this.add.image(0, -HEADROOM, this.ghostTex!.key).setOrigin(0).setDepth(DIM_DEPTH + 10);
    this.ghostText = this.add.text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#fff', backgroundColor: 'rgba(17,19,31,0.85)', padding: { x: 6, y: 3 }, resolution: 3 }).setOrigin(0.5, 1).setDepth(DIM_DEPTH + 20).setVisible(false);
    this.dim = this.add.graphics().setDepth(DIM_DEPTH);
    this.redraw();

    const you = this.app.lastInit!.you;
    const fx = ((this.plan.front[0] + this.plan.front[1] + 1) / 2) * C;
    // Just inside the front door (the bottom wall, or the top one), facing in.
    this.pos = { x: fx, y: this.frontTop ? C * 0.75 : H - C * 0.6 };
    this.me = new Avatar(this, this.app.cfg.character, this.app.items, {
      name: you.name, level: this.app.store.progress.level, appearance: you.appearance, x: this.pos.x, y: this.pos.y, isSelf: true,
      cosmetics: this.app.town?.selfCosmetics ?? you.cosmetics, particles: loadPrefs().particles,
    });
    this.dir = this.frontTop ? 'down' : 'up';
    this.me.setState(this.dir, false);
    this.add
      .text(W / 2, -this.top * C - WALL - 6, this.visit ? `${t.icon} ${this.visit.ownerName}'s ${t.name.toLowerCase()} · ★ ${this.visit.stars.toFixed(1)}` : `${t.icon} ${t.name}`, { fontFamily: 'system-ui, sans-serif', fontSize: '18px', fontStyle: 'bold', color: '#ffffff', stroke: '#11131f', strokeThickness: 5, resolution: 3 })
      .setOrigin(0.5, 1)
      .setDepth(999_000);
    this.banner = this.add.text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '20px', fontStyle: '900', color: '#ffffff', stroke: '#11131f', strokeThickness: 5, resolution: 3 }).setOrigin(0.5).setDepth(999_100).setAlpha(0);
    this.enterRoom(true);
    // 🚶 A shop: customers come in, look around (at a free spot on the floor), say something, leave.
    if (s?.mode === 'shop' && !this.shop) {
      this.walkers = new Walkers(this, this.app.cfg.character, this.app.items, 3, 60);
      const lines = s.type === 'kopitiam_floor' ? COUNTER_LINES.kopitiam : COUNTER_LINES.shop;
      const outside = { x: fx, y: H + C * 0.8 }, inside = { x: fx, y: H - C * 1.2 };
      const visit = () => {
        if (this.decorating) return; // not while you're moving furniture around
        const tx = (1 + Math.random() * (this.W - 2)) * C, ty = (1 + Math.random() * (this.H - 3)) * C;
        this.walkers?.walk(outside, [inside, { x: tx, y: ty, say: lines[Math.floor(Math.random() * lines.length)], waitMs: 2000 }, inside, outside]);
      };
      this.time.addEvent({ delay: 5000, loop: true, callback: visit, startAt: 3000 });
    }
    this.buildUi();
    this.off = this.app.store.on(() => this.refreshUi());

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointer(p, 'move'));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointer(p, 'down'));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onPointer(p, 'up'));
    this.keyHandler = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener('keydown', this.keyHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.off?.();
      if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
      this.ui?.remove();
      this.side?.remove();
      this.me?.destroy();
      this.walkers?.destroy();
      this.walkers = null;
      this.shop?.destroy();
      this.shop = null;
      this.app.hud?.setPrompt(null, this.app.touch);
      if (this.furnTex) this.textures.remove(this.furnTex.key);
      if (this.ghostTex) this.textures.remove(this.ghostTex.key);
    });
  }
  private gridG!: Phaser.GameObjects.Graphics;

  // ---------------------------------------------------------------- the rooms
  /** Floors (a different one per room), inner walls with doorways, outer walls, the front door. */
  private drawStructure() {
    const W = this.W * C, H = this.H * C;
    const T = this.top * C; // a shop's service area, above the floor
    const B = this.bottom * C; // ...or below it
    const g = this.add.graphics().setDepth(-5);
    g.fillStyle(0x000000, 0.12).fillRoundedRect(-WALL - 8, -T - WALL - 2, W + WALL * 2 + 16, H + T + B + WALL * 2 + 14, 12);
    for (const r of this.plan.rooms) this.drawFloor(g, r.kind, r.x * C, r.y * C, r.w * C, r.h * C);
    // Skirting shadow inside every room.
    for (const r of this.plan.rooms) {
      g.lineStyle(4, 0x000000, 0.12).strokeRect(r.x * C + 2, r.y * C + 2, r.w * C - 4, r.h * C - 4);
    }
    // Inner walls: every boundary between two rooms, except the doorways.
    const wallCol = 0xe9dccb, wallTop = 0xfaf3ea;
    const seg = (x0: number, y0: number, x1: number, y1: number) => {
      g.fillStyle(0x000000, 0.18).fillRect(Math.min(x0, x1) - INNER / 2 + 2, Math.min(y0, y1) - INNER / 2 + 3, Math.abs(x1 - x0) + INNER, Math.abs(y1 - y0) + INNER);
      g.fillStyle(wallCol, 1).fillRect(Math.min(x0, x1) - INNER / 2, Math.min(y0, y1) - INNER / 2, Math.abs(x1 - x0) + INNER, Math.abs(y1 - y0) + INNER);
      g.fillStyle(wallTop, 1).fillRect(Math.min(x0, x1) - INNER / 2 + 1, Math.min(y0, y1) - INNER / 2 + 1, Math.abs(x1 - x0) + INNER - 2, Math.max(2, (Math.abs(y1 - y0) ? INNER : INNER) / 2 - 1));
    };
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        if (x + 1 < this.W && wallBetween(this.plan, x, y, x + 1, y) && roomIndex(this.plan, x, y) !== roomIndex(this.plan, x + 1, y)) seg((x + 1) * C, y * C, (x + 1) * C, (y + 1) * C);
        if (y + 1 < this.H && wallBetween(this.plan, x, y, x, y + 1) && roomIndex(this.plan, x, y) !== roomIndex(this.plan, x, y + 1)) seg(x * C, (y + 1) * C, (x + 1) * C, (y + 1) * C);
      }
    // Doorways: a threshold strip and an open door leaf with its swing.
    for (const d of this.plan.doors) {
      g.fillStyle(0x9c6b43, 1);
      if (d.side === 'v') {
        g.fillRect(d.x * C - INNER / 2, d.y * C + 2, INNER, C - 4);
        g.lineStyle(3, 0x7a4e2d, 1).lineBetween(d.x * C, d.y * C + 2, d.x * C + C * 0.8, d.y * C + 2);
        g.lineStyle(1, 0x7a4e2d, 0.45).beginPath().arc(d.x * C, d.y * C + 2, C * 0.8, 0, Math.PI / 2).strokePath();
      } else {
        g.fillRect(d.x * C + 2, d.y * C - INNER / 2, C - 4, INNER);
        g.lineStyle(3, 0x7a4e2d, 1).lineBetween(d.x * C + 2, d.y * C, d.x * C + 2, d.y * C - C * 0.8);
        g.lineStyle(1, 0x7a4e2d, 0.45).beginPath().arc(d.x * C + 2, d.y * C, C * 0.8, -Math.PI / 2, 0).strokePath();
      }
    }
    // Outer walls and the front door (bottom of the living room; a top-door shop's top wall).
    const d0 = this.plan.front[0] * C, d1 = (this.plan.front[1] + 1) * C;
    const yb = H + B; // the bottom wall
    g.fillStyle(0xf1e3d3, 1).fillRect(-WALL, -T, WALL, H + T + B).fillRect(W, -T, WALL, H + T + B);
    g.fillStyle(0xd9c7b2, 1).fillRect(-6, -T, 6, H + T + B).fillRect(W, -T, 6, H + T + B);
    if (this.frontTop) {
      // The back wall has the door in it; the bottom wall is whole.
      g.fillStyle(0xf1e3d3, 1).fillRect(-WALL, -WALL, d0 + WALL, WALL).fillRect(d1, -WALL, W - d1 + WALL, WALL).fillRect(-WALL, yb, W + WALL * 2, WALL);
      g.fillStyle(0xd9c7b2, 1).fillRect(-WALL, -6, d0 + WALL, 6).fillRect(d1, -6, W - d1 + WALL, 6);
      g.fillStyle(0x8c5a3c, 1).fillRect(d0 + 6, 0, d1 - d0 - 12, 10);
      g.fillStyle(0x6d4c41, 1).fillRect(d0 + 4, -8, d1 - d0 - 8, 8); // doormat
    } else {
      g.fillStyle(0xf1e3d3, 1).fillRect(-WALL, -T - WALL, W + WALL * 2, WALL);
      g.fillStyle(0xd9c7b2, 1).fillRect(-WALL, -T - 6, W + WALL * 2, 6);
      g.fillStyle(0xf1e3d3, 1).fillRect(-WALL, H, d0 + WALL, WALL).fillRect(d1, H, W - d1 + WALL, WALL);
      g.fillStyle(0x8c5a3c, 1).fillRect(d0 + 6, H - 10, d1 - d0 - 12, 10);
      g.fillStyle(0x6d4c41, 1).fillRect(d0 + 4, H, d1 - d0 - 8, 8); // doormat
    }
    // Room names (shown while decorating).
    for (const r of this.plan.rooms) {
      const cx = (r.x + r.w / 2) * C, cy = (r.y + r.h / 2) * C;
      const t = this.add.text(cx, cy, `${r.icon} ${r.name}`, { fontFamily: 'system-ui, sans-serif', fontSize: '14px', fontStyle: '900', color: 'rgba(255,255,255,0.9)', stroke: '#11131f', strokeThickness: 4, align: 'center', resolution: 3, wordWrap: { width: r.w * C - 6 } })
        .setOrigin(0.5, 1).setDepth(DIM_DEPTH + 5).setVisible(false);
      const sub = this.add.text(cx, cy + 2, BELONGS[r.kind], { fontFamily: 'system-ui, sans-serif', fontSize: '10px', fontStyle: 'bold', color: 'rgba(255,255,255,0.8)', stroke: '#11131f', strokeThickness: 3, align: 'center', resolution: 3, wordWrap: { width: r.w * C - 8 } })
        .setOrigin(0.5, 0).setDepth(DIM_DEPTH + 5).setVisible(false);
      this.roomLabels.push(t, sub);
      this.roomSubs.push(sub);
    }
  }

  private drawFloor(g: Phaser.GameObjects.Graphics, kind: RoomKind, x0: number, y0: number, w: number, h: number) {
    if (kind === 'bath') {
      // small white tiles with blue grout
      g.fillStyle(0xdde9f2, 1).fillRect(x0, y0, w, h);
      for (let y = 0; y < h; y += C / 4) for (let x = 0; x < w; x += C / 4) g.fillStyle(((x + y) / (C / 4)) % 2 ? 0xeef4f9 : 0xe4eef6, 1).fillRect(x0 + x + 1, y0 + y + 1, C / 4 - 2, C / 4 - 2);
    } else if (kind === 'kitchen') {
      // checkerboard tiles
      for (let y = 0; y < h; y += C / 2) for (let x = 0; x < w; x += C / 2) g.fillStyle(((x + y) / (C / 2)) % 2 ? 0x495057 : 0xe9ecef, 1).fillRect(x0 + x, y0 + y, C / 2, C / 2);
    } else if (kind === 'bedroom' || kind === 'office') {
      // soft carpet with a subtle weave
      const base = kind === 'bedroom' ? 0xc9b8a6 : 0x8d99ae;
      g.fillStyle(base, 1).fillRect(x0, y0, w, h);
      for (let y = 0; y < h; y += 6) g.fillStyle(0xffffff, 0.04).fillRect(x0, y0 + y, w, 2);
      for (let x = 0; x < w; x += 7) g.fillStyle(0x000000, 0.03).fillRect(x0 + x, y0, 2, h);
    } else {
      // warm wooden planks
      g.fillStyle(0xd8b384, 1).fillRect(x0, y0, w, h);
      for (let y = 0; y < h; y += C / 2) {
        g.fillStyle((y / (C / 2)) % 2 ? 0xcfa874 : 0xd8b384, 1).fillRect(x0, y0 + y, w, C / 2);
        for (let x = ((y / (C / 2)) % 2) * C; x < w; x += C * 2) g.fillStyle(0xb98f5e, 1).fillRect(x0 + x, y0 + y, 1, C / 2);
        g.fillStyle(0x000000, 0.06).fillRect(x0, y0 + y, w, 1);
      }
    }
  }

  /** The room you're standing in changed (or you just arrived): frame it, dim the rest. */
  private enterRoom(first = false) {
    const cx = Math.floor(this.pos.x / C), cy = Math.min(this.H - 1, Math.floor((this.pos.y - 4) / C));
    const i = roomIndex(this.plan, cx, cy);
    if (i < 0 || (i === this.room && !first)) return;
    this.room = i;
    this.paintDim();
    this.fit(!first);
    const r = this.plan.rooms[i];
    if (!first || this.plan.rooms.length > 1) {
      this.banner!.setText(`${r.icon} ${r.name}`).setPosition((r.x + r.w / 2) * C, r.y * C + 26).setAlpha(1);
      this.tweens.killTweensOf(this.banner!);
      this.tweens.add({ targets: this.banner, alpha: 0, delay: 1100, duration: 600 });
    }
  }

  /** (Rooms used to be darkened when you weren't in them; everything stays bright now.) */
  private paintDim() {
    this.dim?.clear();
  }

  /** Frame the room you're in (or the whole home while decorating). */
  fit(smooth = false) {
    const cam = this.cameras?.main;
    if (!cam) return; // the scene has shut down (left it, or not built yet)
    cam.setSize(this.scale.width, this.scale.height);
    const r0 = this.decorating || this.room < 0 ? { x: 0, y: 0, w: this.W, h: this.H } : this.plan.rooms[this.room];
    const r = { x: r0.x, y: r0.y - this.top, w: r0.w, h: r0.h + this.top + this.bottom };
    const pad = this.decorating ? 1.2 : 2.6;
    const W = (r.w + pad) * C + WALL * 2, H = (r.h + pad) * C + WALL * 2 + 50;
    // Leave room for the side panel while decorating on wide screens.
    const avail = this.decorating && innerWidth > innerHeight ? 0.58 : 0.92;
    const zoom = Math.min(Math.min((this.scale.width * avail) / W, (this.scale.height * 0.74) / H), 3 * this.app.dpr);
    const shift = this.decorating && innerWidth > innerHeight ? (this.scale.width * 0.2) / zoom : 0;
    const tx = (r.x + r.w / 2) * C + shift, ty = (r.y + r.h / 2) * C - 10;
    this.tweens.killTweensOf(this.camGo);
    if (smooth) {
      // Zoom and pan together (Phaser's own pan aims at where the centre is at the OLD zoom).
      const from = { z: cam.zoom, x: cam.midPoint.x, y: cam.midPoint.y };
      this.camGo.k = 0;
      this.tweens.add({
        targets: this.camGo, k: 1, duration: 450, ease: 'Sine.easeInOut',
        onUpdate: () => {
          const k = this.camGo.k;
          cam.setZoom(from.z + (zoom - from.z) * k);
          cam.centerOn(from.x + (tx - from.x) * k, from.y + (ty - from.y) * k);
        },
      });
    } else {
      cam.setZoom(zoom);
      cam.centerOn(tx, ty);
    }
  }

  private camGo = { k: 0 };

  private redraw() {
    const tex = this.furnTex!;
    const ctx = tex.getContext();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, tex.width, tex.height);
    ctx.translate(0, HEADROOM);
    // floor pieces (rugs) first, then the rest, wall items last
    // Rugs first; then back to front (things nearer the bottom of the screen overlap those behind).
    const bottom = (p: Placed) => p.y + this.footprint(p.item, p.rot)[1];
    const flat = (p: Placed) => (furniturePiece(p.item)?.floor ? 0 : 1);
    const house = this.shop && !this.decorating ? this.shop.houseSets(this.layout) : [];
    for (const p of [...this.layout, ...house].sort((a, b) => flat(a) - flat(b) || bottom(a) - bottom(b) || a.x - b.x)) drawPlaced(ctx, p.item, p.x, p.y, p.rot, C);
    // Each room's label: what it still needs, or ✓ complete.
    if (this.decorating) {
      const st = roomStatus(this.ratingCfg(), this.plan, this.layout);
      this.plan.rooms.forEach((r, i) => {
        const s = st.find((x) => x.room === i);
        const sub = this.roomSubs[i];
        if (!sub) return;
        if (!s || this.plan.rooms.length < 2) return void sub.setText(BELONGS[r.kind]).setColor('rgba(255,255,255,0.8)');
        if (!s.missing.length) sub.setText('✓ complete').setColor('#8ce99a');
        else sub.setText(`needs: ${s.missing.map((m) => m.name).join(' · ')}`).setColor('#ffe066');
      });
    }
    // While decorating: pieces in the wrong room get a yellow outline, ones that break a rule
    // (e.g. now across a wall) a red one.
    if (this.decorating) {
      for (const p of this.misplaced()) {
        const [w, h] = this.footprint(p.item, p.rot);
        ctx.strokeStyle = '#ffd43b';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(p.x * C + 3, p.y * C + 3, w * C - 6, h * C - 6);
        ctx.setLineDash([]);
      }
      for (const p of this.badPieces()) {
        const [w, h] = this.footprint(p.item, p.rot);
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(p.x * C + 2, p.y * C + 2, w * C - 4, h * C - 4);
        ctx.setLineDash([]);
      }
    }
    tex.refresh();
  }

  /** Placed pieces in a room they don't belong in (they still count, just less). */
  private misplaced(): Placed[] {
    return this.layout.filter((p) => {
      const want = roomKindsFor(this.ratingCfg(), p.item);
      const i = roomIndex(this.plan, p.x, p.y);
      return want && i >= 0 && !roomSuits(this.plan, this.plan.rooms[i].kind, want);
    });
  }

  /** Pieces that break a rule on their own (out of bounds, across a wall, in a doorway). */
  private badPieces(): Placed[] {
    const cfg = this.ratingCfg();
    return this.layout.filter((p) => layoutProblem(cfg, this.unit(), [p]) !== null);
  }

  // ---------------------------------------------------------------- walking
  private solidAt(px: number, py: number) {
    if (this.shop && !this.decorating && this.shop.houseSolid(px, py)) return true;
    const cx = Math.floor(px / C), cy = Math.floor(py / C);
    for (const p of this.layout) {
      const f = furniturePiece(p.item);
      if (!f || f.floor || f.wall) continue;
      const [w, h] = p.rot % 2 ? [f.h, f.w] : [f.w, f.h];
      if (cx >= p.x && cx < p.x + w && cy >= p.y && cy < p.y + h) return true;
    }
    return false;
  }

  /** Can you step from (ax, ay) to (bx, by) (px)? Not through an inner wall (doorways are fine). */
  private canStep(ax: number, ay: number, bx: number, by: number) {
    const c0 = [Math.floor(ax / C), Math.floor(ay / C)], c1 = [Math.floor(bx / C), Math.floor(by / C)];
    if (c0[0] === c1[0] && c0[1] === c1[1]) return true;
    if (this.frontTop ? c1[1] < 0 : c1[1] >= this.H) return true; // out the front door (checked separately)
    if (Math.abs(c0[0] - c1[0]) + Math.abs(c0[1] - c1[1]) !== 1) return false;
    return !wallBetween(this.plan, c0[0], c0[1], c1[0], c1[1]);
  }

  private walkers: Walkers | null = null;
  override update(_t: number, delta: number) {
    this.walkers?.update(performance.now());
    this.shop?.update(performance.now());
    if (this.leaving) return;
    // 🏪 The counter / till / stairs within reach.
    if (this.shop) {
      const fix = this.decorating ? null : this.shop.near(this.pos.x, this.pos.y);
      if (fix !== this.nearFix) {
        this.nearFix = fix;
        this.app.hud?.setPrompt(fix?.label ?? null, this.app.touch);
      }
    }
    // 🪑 A chair next to you (not while decorating, sitting, or at the counter).
    if (!this.nearFix) {
      const ch = this.decorating || this.sitFrom ? null : this.chairNear();
      if ((ch?.x ?? -1) !== (this.nearChair?.x ?? -1) || (ch?.y ?? -1) !== (this.nearChair?.y ?? -1)) {
        this.nearChair = ch;
        this.app.hud?.setPrompt(ch ? '🪑 Sit down' : null, this.app.touch);
      }
    }
    const dt = Math.min(delta, 100) / 1000;
    let { x: vx, y: vy } = this.decorating ? { x: 0, y: 0 } : this.app.inputVector();
    const len = Math.hypot(vx, vy);
    if (len > 1) {
      vx /= len;
      vy /= len;
    }
    const moving = len > 0.01;
    const W = this.W * C, H = this.H * C;
    // Getting up from a chair: back where you stood.
    if (moving && this.sitFrom) {
      this.pos = { ...this.sitFrom };
      this.sitFrom = null;
      this.me.setPosition(this.pos.x, this.pos.y);
    }
    if (moving) {
      this.dir = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : vy > 0 ? 'down' : 'up';
      const sp = this.app.cfg.movement.walkSpeed * 0.8;
      const nx = Math.max(10, Math.min(W - 10, this.pos.x + vx * sp * dt));
      const inDoor = this.pos.x > this.plan.front[0] * C + 8 && this.pos.x < (this.plan.front[1] + 1) * C - 8;
      const ny = this.frontTop
        ? Math.max(inDoor ? -24 : 12, Math.min(H - 4, this.pos.y + vy * sp * dt))
        : Math.max(12, Math.min(inDoor ? H + 20 : H - 4, this.pos.y + vy * sp * dt));
      if (!this.solidAt(nx, this.pos.y - 4) && this.canStep(this.pos.x, this.pos.y - 4, nx, this.pos.y - 4)) this.pos.x = nx;
      if (!this.solidAt(this.pos.x, ny - 4) && this.canStep(this.pos.x, this.pos.y - 4, this.pos.x, ny - 4)) this.pos.y = ny;
      this.me.setPosition(this.pos.x, this.pos.y);
      if (this.frontTop ? this.pos.y < -2 : this.pos.y > H + 12) return this.leave();
      this.enterRoom();
    }
    this.me.setState(this.dir, moving);
    this.me.tick(performance.now());
  }

  // ---------------------------------------------------------------- decorating
  private onKey(e: KeyboardEvent) {
    if (!this.decorating) return;
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    const move = (dx: number, dy: number) => {
      e.preventDefault();
      const h = this.hover ?? { x: Math.floor(this.W / 2), y: Math.floor(this.H / 2) };
      this.hover = { x: Math.max(0, Math.min(this.W - 1, h.x + dx)), y: Math.max(0, Math.min(this.H - 1, h.y + dy)) };
      this.drawGhost();
    };
    if ((k === 'z' || k === 'Z') && ctrl) return this.doUndo();
    if ((k === 'y' || k === 'Y') && ctrl) return this.doRedo();
    if (ctrl) return;
    if (k === 'r' || k === 'R' || k === 'e' || k === 'E') return this.rotate(1);
    if (k === 'q' || k === 'Q') return this.rotate(-1);
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') return move(-1, 0);
    if (k === 'ArrowRight' || k === 'd' || k === 'D') return move(1, 0);
    if (k === 'ArrowUp' || k === 'w' || k === 'W') return move(0, -1);
    if (k === 'ArrowDown' || k === 's' || k === 'S') return move(0, 1);
    if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      if (this.hand && this.hover) this.place(this.hover.x, this.hover.y);
      else if (this.hover) this.pickUp(this.hover.x, this.hover.y);
      return;
    }
    if (k === 'x' || k === 'X') return void (this.hover && !this.hand && this.pickUp(this.hover.x, this.hover.y));
    if (k === 'Delete' || k === 'Backspace') return this.dropHand();
    if (k === 'Escape') {
      if (this.hand) {
        e.stopPropagation();
        this.dropHand();
      }
    }
  }

  private onPointer(p: Phaser.Input.Pointer, kind: 'move' | 'down' | 'up') {
    if (!this.decorating) return;
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    const cx = Math.floor(wp.x / C), cy = Math.floor(wp.y / C);
    const inside = cx >= 0 && cy >= 0 && cx < this.W && cy < this.H;
    if (inside) this.hover = { x: cx, y: cy };
    if (kind === 'move') return this.drawGhost();
    if (!inside) return;
    if (kind === 'down') {
      if (this.hand) this.place(cx, cy);
      else if (this.pickUp(cx, cy)) this.dragFrom = { x: cx, y: cy };
    } else if (this.hand && this.dragFrom && (this.dragFrom.x !== cx || this.dragFrom.y !== cy)) {
      // Dragged it somewhere: drop it there (if it fits; else keep holding it).
      this.place(cx, cy, true);
      this.dragFrom = null;
    } else this.dragFrom = null;
  }

  /** Pick up the piece at a cell (wall items, then furniture, then rugs). True if it did. */
  private pickUp(cx: number, cy: number): boolean {
    const layer = (pl: Placed) => (furniturePiece(pl.item)?.wall ? 0 : furniturePiece(pl.item)?.floor ? 2 : 1);
    const hit = [...this.layout].sort((a, b) => layer(a) - layer(b)).find((pl) => {
      if (!furniturePiece(pl.item)) return false;
      const [w, h] = this.footprint(pl.item, pl.rot);
      return cx >= pl.x && cx < pl.x + w && cy >= pl.y && cy < pl.y + h;
    });
    if (!hit) return false;
    this.snapshot();
    this.layout = this.layout.filter((x) => x.iid !== hit.iid);
    this.hand = { iid: hit.iid, item: hit.item, rot: hit.rot, manual: true };
    sfx.click();
    this.changed();
    return true;
  }

  private footprint(item: string, rot: number): [number, number] {
    const f = furniturePiece(item)!;
    return rot % 2 ? [f.h, f.w] : [f.w, f.h];
  }

  /** Wall pieces turn to face out from the wall you point at (until you rotate by hand). */
  private autoRotate() {
    const h = this.hand;
    if (!h || h.manual || !this.hover || !furniturePiece(h.item)?.wall) return;
    const { x, y } = this.hover;
    const p = this.plan;
    if (wallBetween(p, x, y, x, y - 1)) h.rot = 0;
    else if (wallBetween(p, x, y, x - 1, y)) h.rot = 3;
    else if (wallBetween(p, x, y, x + 1, y)) h.rot = 1;
    else if (y < this.H - 1 && wallBetween(p, x, y, x, y + 1)) h.rot = 2;
  }

  /** Where the piece in hand would go if you tapped the hovered cell (kept inside the home). */
  private target(): { x: number; y: number; w: number; h: number } | null {
    if (!this.hand || !this.hover) return null;
    const [w, h] = this.footprint(this.hand.item, this.hand.rot);
    return { x: Math.max(0, Math.min(this.W - w, this.hover.x)), y: Math.max(0, Math.min(this.H - h, this.hover.y)), w, h };
  }

  /** The see-through preview of the piece in hand, outlined green (fits) or red (with why). */
  private drawGhost() {
    const tex = this.ghostTex!;
    const ctx = tex.getContext();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, tex.width, tex.height);
    ctx.translate(0, HEADROOM);
    this.ghostText?.setVisible(false);
    if (this.decorating) {
      this.autoRotate();
      const t = this.target();
      if (this.hand && t) {
        const problem = layoutProblem(this.ratingCfg(), this.unit(), [...this.layout, { ...this.hand, x: t.x, y: t.y }]);
        ctx.globalAlpha = 0.65;
        drawPlaced(ctx, this.hand.item, t.x, t.y, this.hand.rot, C);
        ctx.globalAlpha = 1;
        ctx.fillStyle = problem ? 'rgba(255,107,107,0.25)' : 'rgba(81,207,102,0.18)';
        ctx.fillRect(t.x * C, t.y * C, t.w * C, t.h * C);
        ctx.strokeStyle = problem ? '#ff6b6b' : '#51cf66';
        ctx.lineWidth = 3;
        ctx.strokeRect(t.x * C + 1.5, t.y * C + 1.5, t.w * C - 3, t.h * C - 3);
        const name = this.app.items.get(this.hand.item)?.name ?? this.hand.item;
        const want = roomKindsFor(this.ratingCfg(), this.hand.item);
        const ri = roomIndex(this.plan, t.x, t.y);
        const wrongRoom = !problem && want && ri >= 0 && !roomSuits(this.plan, this.plan.rooms[ri].kind, want);
        this.ghostText
          ?.setText(problem ? `✋ ${problem}` : wrongRoom ? `${name} · fits better in ${roomNames(want!)}` : `${name} · tap to place · R rotate`)
          .setColor(problem ? '#ffc9c9' : wrongRoom ? '#ffe066' : '#d3f9d8')
          .setPosition((t.x + t.w / 2) * C, t.y * C - 4)
          .setVisible(true);
      } else if (this.hover) {
        // Nothing in hand: show what's under the cursor.
        const c = this.hover;
        const under = this.layout.find((pl) => {
          const [w, h] = this.footprint(pl.item, pl.rot);
          return c.x >= pl.x && c.x < pl.x + w && c.y >= pl.y && c.y < pl.y + h;
        });
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 2;
        if (under) {
          const [w, h] = this.footprint(under.item, under.rot);
          ctx.strokeRect(under.x * C + 1, under.y * C + 1, w * C - 2, h * C - 2);
          this.ghostText?.setText(`${this.app.items.get(under.item)?.name ?? under.item} · tap or drag to move`).setColor('#fff').setPosition((under.x + w / 2) * C, under.y * C - 4).setVisible(true);
        } else ctx.strokeRect(c.x * C + 1, c.y * C + 1, C - 2, C - 2);
      }
    }
    tex.refresh();
  }

  private place(cx: number, cy: number, quiet = false) {
    const hand = this.hand!;
    this.hover = { x: cx, y: cy };
    this.autoRotate();
    const [w, h] = this.footprint(hand.item, hand.rot);
    const x = Math.max(0, Math.min(this.W - w, cx)), y = Math.max(0, Math.min(this.H - h, cy));
    const next = [...this.layout, { iid: hand.iid, item: hand.item, x, y, rot: hand.rot }];
    const problem = layoutProblem(this.ratingCfg(), this.unit(), next);
    if (problem) {
      sfx.error();
      if (!quiet) toast(problem, 'bad');
      this.drawGhost();
      return;
    }
    this.snapshot();
    this.layout = next;
    this.hand = null;
    sfx.click();
    this.changed();
  }

  private rotate(dir: 1 | -1 = 1) {
    if (!this.hand) return;
    this.hand.rot = (this.hand.rot + (dir > 0 ? 1 : 3)) % 4;
    this.hand.manual = true;
    this.drawGhost();
  }

  /** Put what's in your hand back in the box (it stays in your inventory). */
  private dropHand() {
    if (!this.hand) return;
    this.hand = null;
    this.changed();
  }

  private snapshot() {
    this.undo.push(this.layout.map((p) => ({ ...p })));
    if (this.undo.length > 50) this.undo.shift();
    this.redo = [];
  }

  private doUndo() {
    const prev = this.undo.pop();
    if (!prev) return;
    this.redo.push(this.layout);
    this.layout = prev;
    this.hand = null;
    this.changed();
  }

  private doRedo() {
    const next = this.redo.pop();
    if (!next) return;
    this.undo.push(this.layout);
    this.layout = next;
    this.hand = null;
    this.changed();
  }

  private changed() {
    this.dirty = true;
    this.redraw();
    this.drawGhost();
    this.refreshUi();
  }

  /** E / the interact button: use the counter / till / stairs you're at. */
  interact() {
    if (this.decorating || this.leaving) return;
    if (this.nearFix) return this.nearFix.use();
    const ch = this.nearChair;
    if (!ch || this.sitFrom) return;
    // Sit on it, facing the chair's way (side-on to the left or right).
    this.sitFrom = { ...this.pos };
    this.pos = { x: (ch.x + 0.5) * C, y: (ch.y + 0.75) * C };
    this.me.setPosition(this.pos.x, this.pos.y);
    this.dir = ch.face;
    this.me.setState(ch.face, false);
    this.me.playEmote(ch.face === 'left' || ch.face === 'right' ? 'sitside' : 'sit', { emoji: '', loop: true, durationMs: 0 }, false);
    this.nearChair = null;
    this.app.hud?.setPrompt(null, this.app.touch);
  }

  /** The chair (yours, or the shop's starter ones) closest to you, within reach. */
  private chairNear(): { x: number; y: number; face: (typeof CHAIR_FACE)[number] } | null {
    const all = this.shop ? [...this.layout, ...this.shop.houseSets(this.layout)] : this.layout;
    let best: { x: number; y: number; face: (typeof CHAIR_FACE)[number] } | null = null;
    let bd = C * 1.05;
    for (const p of all) {
      if (furniturePiece(p.item)?.category !== 'chairs') continue;
      const d = Math.hypot(this.pos.x - (p.x + 0.5) * C, this.pos.y - 4 - (p.y + 0.5) * C);
      if (d < bd) (bd = d), (best = { x: p.x, y: p.y, face: CHAIR_FACE[((p.rot % 4) + 4) % 4] });
    }
    return best;
  }

  private setDecorating(on: boolean) {
    this.decorating = on;
    this.shop?.setPaused(on);
    this.gridG.setVisible(on);
    for (const t of this.roomLabels) t.setVisible(on);
    this.side?.classList.toggle('hidden', !on);
    this.hand = null;
    this.paintDim();
    this.redraw();
    this.drawGhost();
    this.fit(true);
    this.refreshUi();
  }

  /** Done decorating: unsaved changes are saved first (stays in decorating if that fails). */
  private toggleDecorating() {
    if (!this.decorating) {
      // 🪑 Your shop's starter tables and chairs: make them real furniture first (feedback #17), so you
      // can pick them up, move them, or swap in your own.
      if (this.shop && !this.visit && this.shop.houseSets(this.layout).length) {
        this.app.socket?.timeout(6000).emit('shop:starter', { unit: this.unitId }, (err, res) => {
          if (!err && res.ok) {
            this.layout = res.layout.map((p) => ({ ...p }));
            toast('🪑 The starter tables and chairs are yours now: move them, pick them up (back to your bag) or swap in others.', 'good');
          }
          this.setDecorating(true);
        });
        return;
      }
      return this.setDecorating(true);
    }
    if (!this.dirty) return this.setDecorating(false);
    this.save(() => this.setDecorating(false));
  }

  private save(then?: () => void, failed?: (why: string) => void) {
    this.app.socket?.timeout(6000).emit('prop:layout', { unit: this.unitId, layout: this.layout }, (err, res) => {
      if (err || !res.ok) {
        sfx.error();
        const why = err ? 'No response.' : res.ok ? '' : res.error;
        toast(why, 'bad');
        return void failed?.(why);
      }
      this.dirty = false;
      sfx.chime();
      toast(`💾 Saved! ${res.stars.toFixed(1)}★`, 'good');
      this.refreshUi();
      then?.();
    });
  }

  // ---------------------------------------------------------------- the DOM side
  private buildUi() {
    const bar = el('div', { class: 'home-bar' });
    this.ui = bar;
    this.side = el('div', { class: 'decorate-panel hidden', 'data-testid': 'decorate-panel' });
    uiRoot().append(bar, this.side);
    this.refreshUi();
  }

  /** Free furniture: owned, not placed here (in the editor) or in another home. */
  private freeFurniture() {
    const elsewhere = new Set<number>();
    for (const p of this.app.store.myProps) if (p.unit !== this.unitId) for (const pl of p.layout) elsewhere.add(pl.iid);
    const here = new Set(this.layout.map((p) => p.iid));
    if (this.hand) here.add(this.hand.iid);
    return this.app.store.inventory.filter((i) => furniturePiece(i.itemId) && !elsewhere.has(i.iid) && !here.has(i.iid));
  }

  /** 🏪 A shop's cleaner on / off. */
  private toggleCleaner() {
    const s = this.self;
    if (!s) return;
    this.app.socket?.timeout(5000).emit('prop:staff', { unit: this.unitId, role: 'cleaner', on: !s.cleaner }, (err, res) => {
      if (err || !res.ok) return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
    });
  }

  private refreshUi() {
    const s = this.self;
    if (!this.ui) return;
    const btn = (label: string, fn: () => void, cls = 'btn', attrs: Record<string, string> = {}) => {
      const b = el('button', { class: cls, type: 'button', ...attrs }, label);
      b.addEventListener('click', fn);
      return b;
    };
    if (this.visit) {
      const v = this.visit;
      this.ui.replaceChildren(
        el('span', { class: 'shop-stars' }, `★ ${v.stars.toFixed(1)} · ${v.ownerName}`),
        btn('🚪 Leave', () => this.leave(), 'btn', { 'data-testid': 'home-exit' }),
      );
      return;
    }
    if (!s) return;
    const work = s.work ? Math.max(0, (s.work.at + (s.work.kind === 'clean' ? this.app.cfg.properties.airbnb.cleanMs : this.app.cfg.properties.rent.diyMs) - this.app.store.serverNow()) / 1000) : 0;
    const tools: HTMLElement[] = [
      btn(this.decorating ? (this.dirty ? '💾 Save & done' : '✅ Done') : '🛠️ Decorate', () => this.toggleDecorating(), this.decorating ? 'btn primary' : 'btn', { 'data-action': 'decorate' }),
    ];
    if ((s.mode === 'airbnb' || s.mode === 'shop') && s.cleanliness < 100) tools.push(btn(`🧽 Clean (${Math.round(s.cleanliness)}%)`, () => this.work('clean'), 'btn', { 'data-action': 'clean' }));
    if (s.mode === 'shop') {
      // 🏪 Its stars bring customers; a cleaner keeps it spotless (daily fee).
      const c = this.app.cfg.properties.shop;
      const mult = c.multBase + c.multPerStar * s.rating.stars;
      const need = s.rating.missing.length ? ` · needs ${s.rating.missing.join(', ')}` : '';
      tools.unshift(el('span', { class: 'shop-stars', title: 'Customers / income ×' }, `★ ${s.rating.stars.toFixed(1)} · ${mult >= 1 ? '+' : '−'}${Math.abs(Math.round((mult - 1) * 100))}% customers${need}`));
      tools.push(btn(s.cleaner ? '🧹 Cleaner: on' : `🧹 Hire a cleaner (${formatMoney(c.cleanerPerDaySen)}/day)`, () => this.toggleCleaner(), s.cleaner ? 'btn primary' : 'btn'));
      if (s.reviews.length) {
        const last = s.reviews[s.reviews.length - 1];
        tools.push(el('span', { class: 'muted small shop-review' }, `${'★'.repeat(last.stars)} "${last.text}"`));
      }
    }
    for (const r of s.requests) tools.push(btn(`🔧 Fix: ${r.text}`, () => this.work('diy', r.id), 'btn'));
    if (work > 0) tools.push(el('span', { class: 'muted' }, `⏳ ${work.toFixed(0)} s…`));
    tools.push(btn('🚪 Leave', () => this.leave(), 'btn', { 'data-testid': 'home-exit' }));
    this.ui.replaceChildren(...tools);
    if (!this.decorating || !this.side) return;

    const cfg = this.ratingCfg();
    const t = this.app.cfg.properties.types[s.type];
    const r = rateUnit(cfg, { w: t.w, h: t.h, type: s.type, frontTop: this.frontTop }, this.layout, s.cleanliness);
    const free = this.freeFurniture();
    const sugg = suggestions(cfg, { w: t.w, h: t.h, type: s.type, loc: s.loc, frontTop: this.frontTop }, this.layout, s.cleanliness, free.map((i) => i.itemId));
    const bad = this.badPieces();
    const bar = (label: string, v: number) => {
      const b = el('div', { class: 'progress' }, el('i', {}));
      (b.firstChild as HTMLElement).style.width = `${Math.round(v * 100)}%`;
      return el('div', { class: 'factor' }, el('span', {}, label), b);
    };
    const counts = new Map<string, { item: string; iids: number[] }>();
    for (const i of free) {
      const c = counts.get(i.itemId) ?? { item: i.itemId, iids: [] };
      c.iids.push(i.iid);
      counts.set(i.itemId, c);
    }
    const pieces = [...counts.values()].map((c) => {
      const def = this.app.items.get(c.item);
      const fp = furniturePiece(c.item);
      const b = el('button', { class: `deco-piece${this.hand?.item === c.item ? ' active' : ''}`, type: 'button', 'data-piece': c.item, title: def?.name ?? c.item }, el('img', { src: def ? iconUrl(def, 'normal', 48) : '', alt: '' }), el('span', {}, `${def?.name ?? c.item}${c.iids.length > 1 ? ` ×${c.iids.length}` : ''}`), el('small', { class: 'muted' }, fp ? `${fp.w}×${fp.h} m${fp.wall ? ' · wall' : fp.floor ? ' · floor' : ''}` : ''));
      b.addEventListener('click', () => {
        this.hand = { iid: c.iids[0], item: c.item, rot: 0, manual: false };
        this.hover ??= { x: Math.floor(this.W / 2), y: Math.floor(this.H / 2) };
        this.drawGhost();
        this.refreshUi();
      });
      return b;
    });
    const keys = this.app.touch
      ? 'Tap a piece, then tap the floor to place it (or drag a placed piece). ⟳ turns it.'
      : 'Click or drag pieces · R / E rotate, Q back · arrows move · Enter place · X pick up · Esc / Del put away · Ctrl+Z undo';
    this.side.replaceChildren(
      el('div', { class: 'deco-stars', 'data-testid': 'deco-stars' }, `${'★'.repeat(Math.floor(r.stars))}${r.stars % 1 >= 0.5 ? '½' : ''} ${r.stars.toFixed(1)}`),
      ...(r.missing.length ? [el('div', { class: 'deco-missing' }, `Missing: ${r.missing.join(', ')} (caps the stars)`)] : []),
      ...(bad.length ? [el('div', { class: 'deco-missing' }, `⚠️ ${bad.length} piece${bad.length > 1 ? 's' : ''} outlined in red: ${bad.length > 1 ? 'they' : 'it'} cross a wall or block a doorway. Pick ${bad.length > 1 ? 'them' : 'it'} up and move ${bad.length > 1 ? 'them' : 'it'} before saving.`)] : []),
      bar('Comfort', r.factors.comfort), bar('Style & theme', r.factors.style), bar('Rarity', r.factors.rarity),
      bar('Amenities', r.factors.amenities), bar('Cleanliness', r.factors.clean), bar(r.blocked ? 'Space (walkway blocked!)' : 'Space', r.factors.space),
      bar(`Rooms (${r.rooms.filter((x) => !x.missing.length).length}/${r.rooms.length} complete${r.misplaced.length ? ` · ${r.misplaced.length} in the wrong room` : ''})`, r.factors.rooms),
      el('h4', {}, '💡 Suggestions'),
      ...(sugg.length ? sugg.map((x) => el('div', { class: 'deco-sugg' }, `${x.text} → ${x.gain > 0 ? `+${x.gain.toFixed(1)}★` : 'a small boost'}${x.nightGainSen > 0 ? `, +${formatMoney(x.nightGainSen)}/night` : ''}`)) : [el('div', { class: 'muted' }, 'Looking good!')]),
      el('h4', {}, `🛋️ Your furniture (${free.length})`),
      el('div', { class: 'deco-pieces' }, ...(pieces.length ? pieces : [el('p', { class: 'muted small' }, `Nothing to place. Buy at ${this.app.cfg.furniture.storeName} or win some from the Mall Mystery Box.`)])),
      el('p', { class: 'muted small deco-keys' }, keys),
      el(
        'div',
        { class: 'actions' },
        btn('↶ Undo', () => this.doUndo(), 'btn small'),
        btn('↷ Redo', () => this.doRedo(), 'btn small'),
        ...(this.hand ? [btn('⟲', () => this.rotate(-1), 'btn small', { title: 'Rotate back (Q)' }), btn('⟳ Rotate', () => this.rotate(1), 'btn small', { title: 'Rotate (R)' }), btn('📦 Put away', () => this.dropHand(), 'btn small')] : []),
        btn(this.dirty ? '💾 Save' : '✓ Saved', () => this.save(), this.dirty ? 'btn primary' : 'btn', { 'data-action': 'save-layout' }),
      ),
    );
  }

  /** Cleaning / a DIY repair: start, wait it out (you're "working"), then finish. */
  private work(kind: 'clean' | 'diy', req?: number) {
    const done = (err: unknown, res: { ok: boolean; error?: string; doneAt?: number }) => {
      if (err || !res.ok) return void toast(err ? 'No response.' : (res.error ?? ''), 'bad');
      const wait = Math.max(0, (res.doneAt ?? 0) - this.app.store.serverNow()) + 400;
      toast(kind === 'clean' ? '🧽 Cleaning…' : '🔧 Fixing…', 'info', wait);
      this.me.playEmote('dance', { emoji: kind === 'clean' ? '🧽' : '🔧', loop: true, durationMs: wait }, loadPrefs().particles);
      this.time.delayedCall(wait, () => {
        const fin = (e2: unknown, r2: { ok: boolean; error?: string }) => {
          this.me.stopEmote();
          if (e2 || !r2.ok) return void toast(e2 ? 'No response.' : (r2.error ?? ''), 'bad');
          sfx.chime();
          toast(kind === 'clean' ? '✨ Sparkling clean!' : '✅ Fixed!', 'good');
        };
        if (kind === 'clean') this.app.socket?.timeout(5000).emit('prop:clean', { unit: this.unitId, phase: 'finish' }, fin as never);
        else this.app.socket?.timeout(5000).emit('prop:fix', { unit: this.unitId, req: req!, how: 'diy-finish' }, fin as never);
      });
    };
    if (kind === 'clean') this.app.socket?.timeout(5000).emit('prop:clean', { unit: this.unitId, phase: 'start' }, done as never);
    else this.app.socket?.timeout(5000).emit('prop:fix', { unit: this.unitId, req: req!, how: 'diy-start' }, done as never);
  }

  leave() {
    if (this.leaving) return;
    // Unsaved decorating is saved on the way out (it used to ask, and "OK" threw it all away).
    if (this.dirty)
      return this.save(
        () => this.leave(),
        (why) => {
          if (!confirm(`Couldn't save your decorating: ${why}

Leave anyway? (The changes are lost.)`)) return;
          this.dirty = false;
          this.leave();
        },
      );
    this.leaving = true;
    this.app.exitBuilding();
  }

  get isDecorating() {
    return this.decorating;
  }

  debugInfo() {
    return { unit: this.unitId, layout: this.layout, decorating: this.decorating, hand: this.hand, dirty: this.dirty, room: this.plan?.rooms[this.room]?.name ?? null, rooms: this.plan?.rooms.map((r) => r.name) ?? [] };
  }
  /** Tests: place a piece by iid at a cell without the pointer. */
  debugPlace(iid: number, item: string, x: number, y: number, rot = 0) {
    this.hand = { iid, item, rot, manual: true };
    this.place(x, y);
  }
  /** Tests: walk to a cell (teleport within the home). */
  debugGoto(x: number, y: number) {
    this.pos = { x: (x + 0.5) * C, y: (y + 0.8) * C };
    this.me.setPosition(this.pos.x, this.pos.y);
    this.enterRoom();
  }
}
