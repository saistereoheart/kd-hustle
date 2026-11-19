// Your own home's interior: walk in from the street (the front door opens into the living room),
// and through doorways into the other rooms (bedrooms, kitchen, bathroom). The camera frames the
// room you're in and the others go dark. Decorate mode shows the whole floor plan: a Sims-like
// grid editor (pick furniture you own, place / move / rotate / remove it, drag it, undo / redo,
// keyboard controls), with the star rating and the top suggestions updating live (same maths as
// the server), then Save. From here you can also clean the unit (Airbnb) and fix requests.
import Phaser from 'phaser';
import {
  formatMoney, layoutProblem, planForType, rateUnit, roomIndex, roomKindsFor, roomNames, roomStatus, roomSuits, suggestions, wallBetween,
  type FloorPlan, type Placed, type PropSelf, type RatingCfg, type RoomKind,
} from '@kh/shared';
import type { App } from '../app';
import { drawPlaced, furniturePiece } from '../items/furnitureArt';
import { el, toast, uiRoot } from '../ui/dom';
import { iconUrl } from '../ui/panel';
import { loadPrefs } from '../ui/settings';
import { sfx } from '../ui/sound';
import { AVATAR_DEPTH, Avatar } from './avatar';

const C = 40; // px per cell (1 m)
const WALL = 18; // outer wall thickness (px)
const INNER = 8; // inner wall thickness (px)
const DIM_DEPTH = 900_000;
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

  init(data: { app: App; unit: string }) {
    this.app = data.app;
    this.unitId = data.unit;
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
    return this.app.store.myProps.find((p) => p.unit === this.unitId);
  }

  private ratingCfg(): RatingCfg {
    const tiers = this.app.cfg.rarities.tiers.map((t) => t.id);
    return { furniture: this.app.cfg.furniture, properties: this.app.cfg.properties, rarityIndex: (id) => Math.max(0, tiers.indexOf(this.app.items.get(id)?.rarity ?? 'common')) };
  }

  private unit() {
    return { w: this.W, h: this.H, type: this.self?.type ?? 'studio' };
  }

  create() {
    const s = this.self;
    const typeId = s?.type ?? 'studio';
    const t = this.app.cfg.properties.types[typeId];
    this.W = t.w;
    this.H = t.h;
    this.plan = planForType(t, typeId);
    this.layout = (s?.layout ?? []).map((p) => ({ ...p }));
    const W = this.W * C, H = this.H * C;
    this.add.rectangle(W / 2, H / 2, 40000, 40000, 0x05060c, 0.75).setDepth(-10);
    this.drawStructure();
    // grid lines (only shown while decorating)
    this.gridG = this.add.graphics().setDepth(-3).setVisible(false);
    this.gridG.lineStyle(1, 0xffffff, 0.22);
    for (let x = 0; x <= this.W; x++) this.gridG.lineBetween(x * C, 0, x * C, H);
    for (let y = 0; y <= this.H; y++) this.gridG.lineBetween(0, y * C, W, y * C);

    this.furnTex = this.textures.createCanvas(`home_${Date.now()}`, W, H);
    this.add.image(0, 0, this.furnTex!.key).setOrigin(0).setDepth(AVATAR_DEPTH - 1);
    this.ghostTex = this.textures.createCanvas(`ghost_${Date.now()}`, W, H);
    this.add.image(0, 0, this.ghostTex!.key).setOrigin(0).setDepth(DIM_DEPTH + 10);
    this.ghostText = this.add.text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#fff', backgroundColor: 'rgba(17,19,31,0.85)', padding: { x: 6, y: 3 }, resolution: 3 }).setOrigin(0.5, 1).setDepth(DIM_DEPTH + 20).setVisible(false);
    this.dim = this.add.graphics().setDepth(DIM_DEPTH);
    this.redraw();

    const you = this.app.lastInit!.you;
    const fx = ((this.plan.front[0] + this.plan.front[1] + 1) / 2) * C;
    this.pos = { x: fx, y: H - C * 0.6 };
    this.me = new Avatar(this, this.app.cfg.character, this.app.items, {
      name: you.name, level: this.app.store.progress.level, appearance: you.appearance, x: this.pos.x, y: this.pos.y, isSelf: true,
      cosmetics: this.app.town?.selfCosmetics ?? you.cosmetics, particles: loadPrefs().particles,
    });
    this.me.setState('up', false);
    this.add
      .text(W / 2, -WALL - 6, `${t.icon} ${t.name}`, { fontFamily: 'system-ui, sans-serif', fontSize: '18px', fontStyle: 'bold', color: '#ffffff', stroke: '#11131f', strokeThickness: 5, resolution: 3 })
      .setOrigin(0.5, 1)
      .setDepth(999_000);
    this.banner = this.add.text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '20px', fontStyle: '900', color: '#ffffff', stroke: '#11131f', strokeThickness: 5, resolution: 3 }).setOrigin(0.5).setDepth(999_100).setAlpha(0);
    this.enterRoom(true);
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
      if (this.furnTex) this.textures.remove(this.furnTex.key);
      if (this.ghostTex) this.textures.remove(this.ghostTex.key);
    });
  }
  private gridG!: Phaser.GameObjects.Graphics;

  // ---------------------------------------------------------------- the rooms
  /** Floors (a different one per room), inner walls with doorways, outer walls, the front door. */
  private drawStructure() {
    const W = this.W * C, H = this.H * C;
    const g = this.add.graphics().setDepth(-5);
    g.fillStyle(0x000000, 0.45).fillRoundedRect(-WALL - 12, -WALL - 6, W + WALL * 2 + 24, H + WALL * 2 + 22, 16);
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
    // Outer walls and the front door (bottom of the living room).
    g.fillStyle(0xf1e3d3, 1).fillRect(-WALL, -WALL, W + WALL * 2, WALL).fillRect(-WALL, 0, WALL, H).fillRect(W, 0, WALL, H);
    g.fillStyle(0xd9c7b2, 1).fillRect(-WALL, -6, W + WALL * 2, 6).fillRect(-6, 0, 6, H).fillRect(W, 0, 6, H);
    const d0 = this.plan.front[0] * C, d1 = (this.plan.front[1] + 1) * C;
    g.fillStyle(0xf1e3d3, 1).fillRect(-WALL, H, d0 + WALL, WALL).fillRect(d1, H, W - d1 + WALL, WALL);
    g.fillStyle(0x8c5a3c, 1).fillRect(d0 + 6, H - 10, d1 - d0 - 12, 10);
    g.fillStyle(0x6d4c41, 1).fillRect(d0 + 4, H, d1 - d0 - 8, 8); // doormat
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

  /** Darken every room but yours (none while decorating). */
  private paintDim() {
    const g = this.dim!;
    g.clear();
    if (this.decorating) return;
    for (let k = 0; k < this.plan.rooms.length; k++) {
      if (k === this.room) continue;
      const r = this.plan.rooms[k];
      g.fillStyle(0x05060c, 0.78).fillRect(r.x * C - INNER / 2, r.y * C - INNER / 2, r.w * C + INNER, r.h * C + INNER);
    }
  }

  /** Frame the room you're in (or the whole home while decorating). */
  fit(smooth = false) {
    const cam = this.cameras?.main;
    if (!cam) return; // the scene has shut down (left it, or not built yet)
    cam.setSize(this.scale.width, this.scale.height);
    const r = this.decorating || this.room < 0 ? { x: 0, y: 0, w: this.W, h: this.H } : this.plan.rooms[this.room];
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
    ctx.clearRect(0, 0, tex.width, tex.height);
    // floor pieces (rugs) first, then the rest, wall items last
    const order = (p: Placed) => (furniturePiece(p.item)?.floor ? 0 : furniturePiece(p.item)?.wall ? 2 : 1);
    for (const p of [...this.layout].sort((a, b) => order(a) - order(b))) drawPlaced(ctx, p.item, p.x, p.y, p.rot, C);
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
    if (c1[1] >= this.H) return true; // out the front door (checked separately)
    if (Math.abs(c0[0] - c1[0]) + Math.abs(c0[1] - c1[1]) !== 1) return false;
    return !wallBetween(this.plan, c0[0], c0[1], c1[0], c1[1]);
  }

  override update(_t: number, delta: number) {
    if (this.leaving) return;
    const dt = Math.min(delta, 100) / 1000;
    let { x: vx, y: vy } = this.decorating ? { x: 0, y: 0 } : this.app.inputVector();
    const len = Math.hypot(vx, vy);
    if (len > 1) {
      vx /= len;
      vy /= len;
    }
    const moving = len > 0.01;
    const W = this.W * C, H = this.H * C;
    if (moving) {
      this.dir = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : vy > 0 ? 'down' : 'up';
      const sp = this.app.cfg.movement.walkSpeed * 0.8;
      const nx = Math.max(10, Math.min(W - 10, this.pos.x + vx * sp * dt));
      const inDoor = this.pos.x > this.plan.front[0] * C + 8 && this.pos.x < (this.plan.front[1] + 1) * C - 8;
      const ny = Math.max(12, Math.min(inDoor ? H + 20 : H - 4, this.pos.y + vy * sp * dt));
      if (!this.solidAt(nx, this.pos.y - 4) && this.canStep(this.pos.x, this.pos.y - 4, nx, this.pos.y - 4)) this.pos.x = nx;
      if (!this.solidAt(this.pos.x, ny - 4) && this.canStep(this.pos.x, this.pos.y - 4, this.pos.x, ny - 4)) this.pos.y = ny;
      this.me.setPosition(this.pos.x, this.pos.y);
      if (this.pos.y > H + 12) return this.leave();
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
    ctx.clearRect(0, 0, tex.width, tex.height);
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

  private setDecorating(on: boolean) {
    this.decorating = on;
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

  private save() {
    this.app.socket?.timeout(6000).emit('prop:layout', { unit: this.unitId, layout: this.layout }, (err, res) => {
      if (err || !res.ok) {
        sfx.error();
        return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      }
      this.dirty = false;
      sfx.chime();
      toast(`💾 Saved! ${res.stars.toFixed(1)}★`, 'good');
      this.refreshUi();
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

  private refreshUi() {
    const s = this.self;
    if (!this.ui || !s) return;
    const btn = (label: string, fn: () => void, cls = 'btn', attrs: Record<string, string> = {}) => {
      const b = el('button', { class: cls, type: 'button', ...attrs }, label);
      b.addEventListener('click', fn);
      return b;
    };
    const work = s.work ? Math.max(0, (s.work.at + (s.work.kind === 'clean' ? this.app.cfg.properties.airbnb.cleanMs : this.app.cfg.properties.rent.diyMs) - this.app.store.serverNow()) / 1000) : 0;
    const tools: HTMLElement[] = [
      btn(this.decorating ? '✅ Done' : '🛠️ Decorate', () => this.setDecorating(!this.decorating), this.decorating ? 'btn primary' : 'btn', { 'data-action': 'decorate' }),
    ];
    if (s.mode === 'airbnb' && s.cleanliness < 100) tools.push(btn(`🧽 Clean (${Math.round(s.cleanliness)}%)`, () => this.work('clean'), 'btn', { 'data-action': 'clean' }));
    for (const r of s.requests) tools.push(btn(`🔧 Fix: ${r.text}`, () => this.work('diy', r.id), 'btn'));
    if (work > 0) tools.push(el('span', { class: 'muted' }, `⏳ ${work.toFixed(0)} s…`));
    tools.push(btn('🚪 Leave', () => this.leave(), 'btn', { 'data-testid': 'home-exit' }));
    this.ui.replaceChildren(...tools);
    if (!this.decorating || !this.side) return;

    const cfg = this.ratingCfg();
    const t = this.app.cfg.properties.types[s.type];
    const r = rateUnit(cfg, { w: t.w, h: t.h, type: s.type }, this.layout, s.cleanliness);
    const free = this.freeFurniture();
    const sugg = suggestions(cfg, { w: t.w, h: t.h, type: s.type, loc: s.loc }, this.layout, s.cleanliness, free.map((i) => i.itemId));
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
    if (this.dirty && !confirm('Leave without saving your decorating?')) return;
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
