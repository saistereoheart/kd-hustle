// A building's interior, Pokémon style: runs ON TOP of the town scene, which keeps running
// (other players, the network) but is blurred and darkened behind a small room. You walk
// around the room; the shops/machines inside are used here. Your town position stays at the
// door, which is what the server checks when you use something inside.
// The room is the building's footprint as it sits on the map, and its doorway is on the same
// side as the door you came in by (come in from the north, you appear at the top). The counters
// and machines stand in the middle of the room on a glowing spot.
import Phaser from 'phaser';
import { doorSide, formatMoney, randomAppearance, roomSize, type BuiltBuilding, type BuiltMap, type Furniture, type RoomStyle } from '@kh/shared';
import type { App } from '../app';
import { toast } from '../ui/dom';
import { loadPrefs } from '../ui/settings';
import { AVATAR_DEPTH, Avatar } from './avatar';
import { DOOR_HALF, drawFurniture, drawHighlight, drawRoom, drawStation, FURNITURE_SIZE, stationSize, T, type RoomDoor } from './interiorArt';
import { ensureGlowTexture, GLOW_TEXTURE } from './lightLayer';

type Interactable = BuiltMap['interactables'][number];
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Station {
  it: Interactable;
  x: number;
  y: number;
  /** Its footprint (you can use it from any side). */
  rect: Rect;
}

/** Small deterministic PRNG so a building's shopkeeper looks the same every visit. */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const ICON: Record<string, string> = { jobs: '📋', pawn: '🏪', crate: '🎰', carwash: '🚿', market: '🛒' };

export class InteriorScene extends Phaser.Scene {
  private app!: App;
  building!: BuiltBuilding;
  private style!: RoomStyle;
  private me!: Avatar;
  private pos = { x: 0, y: 0 };
  private dir: 'up' | 'down' | 'left' | 'right' = 'up';
  private blockers: Rect[] = [];
  private stations: Station[] = [];
  /** undefined = not checked yet (forces the first prompt update). */
  private near: Station | null | undefined = undefined;
  private keeper: Avatar | null = null;
  private others = new Map<number, Avatar>();
  private othersAcc = 0;
  private leaving = false;
  private door: RoomDoor = { side: 'bottom', pos: 0 };
  /** Kept clear of furniture: the counters and the walk from the door to them. */
  private keepClear: Rect | null = null;

  constructor() {
    super('interior');
  }

  init(data: { app: App; building: BuiltBuilding; style: RoomStyle; door?: BuiltBuilding['doors'][number] | null }) {
    this.app = data.app;
    this.building = data.building;
    // The room follows the building's footprint (a long shoplot is a long room, a mall is huge).
    const size = roomSize(data.app.cfg.interiors, data.style, data.building, data.app.map.metersPerTile);
    this.style = { ...data.style, ...size };
    // The doorway is on the side of the door we used, about where it is on that wall.
    const d = data.door ?? data.building.door;
    const ds = d ? doorSide(data.building, d) : { side: 'bottom' as const, at: 0.5 };
    const along = ds.side === 'top' || ds.side === 'bottom' ? size.w * T : size.h * T;
    const lo = ds.side === 'left' || ds.side === 'right' ? 3.4 * T : 1.8 * T; // side doors below the back wall
    this.door = { side: ds.side, pos: Math.max(lo, Math.min(along - 1.8 * T, ds.at * along)) };
    this.blockers = [];
    this.stations = [];
    this.near = undefined;
    this.keeper = null;
    this.keepClear = null;
    this.others = new Map();
    this.leaving = false;
  }

  create() {
    const s = this.style;
    const W = s.w * T, H = s.h * T;
    const accent = parseInt(s.trim.slice(1), 16);
    // Darken everything behind the room (the town keeps rendering underneath, blurred).
    this.add.rectangle(W / 2, H / 2, 40000, 40000, 0x05060c, 0.72).setDepth(-10);
    drawRoom(this.add.graphics().setDepth(-5), s, this.door);
    // The back wall (top 2 rows) blocks, except the passage through it for a door in the top wall.
    const dr = this.door;
    if (dr.side === 'top') {
      this.blockers.push({ x0: -100, y0: -100, x1: dr.pos - DOOR_HALF, y1: 2 * T + 4 }, { x0: dr.pos + DOOR_HALF, y0: -100, x1: W + 100, y1: 2 * T + 4 });
    } else this.blockers.push({ x0: -100, y0: -100, x1: W + 100, y1: 2 * T + 4 });

    // Counters and machines (what this building is FOR) stand in the middle of the room, each on
    // a glowing, pulsing spot with a bouncing arrow and a big label.
    ensureGlowTexture(this);
    const its = this.app.map.interactables.filter((i) => i.building === this.building.id);
    const sizes = its.map((it) => stationSize(it.type));
    const widest = Math.max(0, ...sizes.map(([w]) => w));
    const gap = Math.max((widest + 2.2) * T, Math.min(W / (its.length + 1), 6.5 * T));
    const sx0 = W / 2 - (gap * (its.length - 1)) / 2;
    const cyMid = 2 * T + (H - 2 * T) / 2;
    const glowCol = 0xffd43b;
    its.forEach((it, i) => {
      const cx = sx0 + i * gap;
      const [sw, sh] = sizes[i];
      const cy = cyMid;
      const w = sw * T, h = sh * T;
      // the highlight on the floor, a pulsing ring and a soft glow
      drawHighlight(this.add.graphics().setDepth(-4), cx, cy, w, h, glowCol);
      const ring = this.add.ellipse(cx, cy + h * 0.15, w + 1.8 * T, h + 1.3 * T).setStrokeStyle(4, 0xfff3bf, 0.9).setDepth(-3);
      this.tweens.add({ targets: ring, scaleX: 1.12, scaleY: 1.12, alpha: 0.25, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const glow = this.add.image(cx, cy, GLOW_TEXTURE).setDisplaySize(w + 4 * T, h + 3.2 * T).setTint(glowCol).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD).setDepth(-3);
      this.tweens.add({ targets: glow, alpha: 0.15, duration: 1100, yoyo: true, repeat: -1 });
      const g = this.add.graphics().setDepth(AVATAR_DEPTH + cy + h / 2);
      drawStation(g, it.type, it.crate, cx, cy, it.type === 'carwash' ? 0x1971c2 : accent);
      this.blockers.push({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 });
      const crate = it.crate ? this.app.crates.get(it.crate) : undefined;
      const label = this.add
        .text(cx, cy - h / 2 - 22, `${it.crate === 'luckybag' ? '🧧' : it.crate === 'mallbox' ? '🎁' : ICON[it.type] ?? '⭐'} ${it.name}${crate ? ` · ${formatMoney(crate.priceSen)}` : ''}`, {
          fontFamily: 'system-ui, sans-serif', fontSize: '14px', fontStyle: 'bold', color: '#11131f', backgroundColor: '#ffd43b', padding: { x: 8, y: 4 }, align: 'center', resolution: 3,
        })
        .setOrigin(0.5, 1)
        .setDepth(999_000);
      const arrow = this.add.text(cx, label.y - label.height - 2, '▼', { fontSize: '20px', color: '#ffd43b', stroke: '#11131f', strokeThickness: 4, resolution: 3 }).setOrigin(0.5, 1).setDepth(999_000);
      this.tweens.add({ targets: arrow, y: arrow.y - 7, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.stations.push({ it, x: cx, y: cy + h / 2 + T * 0.6, rect: { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 } });
    });
    if (this.stations.length) {
      const r0 = this.stations[0].rect, r1 = this.stations[this.stations.length - 1].rect;
      this.keepClear = { x0: r0.x0 - 2.2 * T, y0: r0.y0 - 2.6 * T, x1: r1.x1 + 2.2 * T, y1: r0.y1 + 2.2 * T };
    }
    this.layoutFurniture();
    // Name sign over the back wall.
    this.add
      .text(W / 2, -16, this.building.name ?? s.label, { fontFamily: 'system-ui, sans-serif', fontSize: '18px', fontStyle: 'bold', color: '#ffffff', stroke: '#11131f', strokeThickness: 5, resolution: 3 })
      .setOrigin(0.5, 1)
      .setDepth(999_000);

    // The shopkeeper, by the right-hand end of the back wall.
    const cfg = this.app.cfg;
    if (s.keeper) {
      // Behind (north of) the middle counter, or in the middle of an empty room.
      const mid = this.stations[Math.floor((this.stations.length - 1) / 2)];
      const kx = mid ? mid.x : W / 2, ky = mid ? mid.rect.y0 - 6 : cyMid;
      this.keeper = new Avatar(this, cfg.character, this.app.items, {
        name: s.keeper, level: 1, appearance: randomAppearance(cfg.character, seeded(this.building.id)), x: kx, y: ky, isSelf: false, npc: true,
      });
      this.keeper.setState('down', false);
      this.blockers.push({ x0: kx - 12, y0: ky - 10, x1: kx + 12, y1: ky + 4 });
      this.time.delayedCall(350, () => this.keeper?.say(s.greeting, 4500));
    } else if (!its.length) {
      this.time.delayedCall(300, () => toast(s.greeting));
    }

    // Us, just inside the door.
    const you = this.app.lastInit!.you;
    const start = { bottom: [dr.pos, H - T * 0.9], top: [dr.pos, 2 * T + T * 0.9], left: [T * 0.9, dr.pos], right: [W - T * 0.9, dr.pos] }[dr.side];
    this.pos = { x: start[0], y: start[1] };
    this.dir = ({ bottom: 'up', top: 'down', left: 'right', right: 'left' } as const)[dr.side];
    this.me = new Avatar(this, cfg.character, this.app.items, {
      name: you.name, level: this.app.store.progress.level, appearance: you.appearance, x: this.pos.x, y: this.pos.y, isSelf: true,
      cosmetics: this.app.town?.selfCosmetics ?? you.cosmetics, particles: loadPrefs().particles,
    });
    this.me.setState(this.dir, false);

    const cam = this.cameras.main;
    cam.setBackgroundColor('rgba(0,0,0,0)');
    this.fit();
    this.syncOthers();

    // You leave by walking out through the doorway (Esc works too). A small sign shows the way.
    const exitAt = { bottom: [dr.pos, H + 14, '▼ EXIT ▼', 0.5, 0], top: [dr.pos, T, '▲ EXIT ▲', 0.5, 0.5], left: [-14, dr.pos, '◀ EXIT', 1, 0.5], right: [W + 14, dr.pos, 'EXIT ▶', 0, 0.5] }[dr.side] as [number, number, string, number, number];
    this.add
      .text(exitAt[0], exitAt[1], exitAt[2], { fontFamily: 'system-ui, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#c3fae8', stroke: '#11131f', strokeThickness: 4, resolution: 3 })
      .setOrigin(exitAt[3], exitAt[4])
      .setDepth(999_000);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.me?.destroy();
      this.keeper?.destroy();
      for (const a of this.others.values()) a.destroy();
      this.others.clear();
    });
  }

  /**
   * Furniture: big pieces in a grid of aisles over the floor, kept clear of the counters in the
   * middle and of the walk from the door to them; small pieces along the side walls. A big room
   * repeats the style's `fill` pieces so a hypermarket has rows of shelves and a mall has kiosks
   * and benches all the way along.
   */
  private layoutFurniture() {
    const s = this.style;
    const W = s.w * T, H = s.h * T;
    const accent = parseInt(s.trim.slice(1), 16);
    const big: ReadonlySet<Furniture> = new Set(['shelf', 'fountain', 'table', 'slot', 'gate', 'kiosk', 'trolleys', 'bed', 'sofa', 'glasscase', 'desk', 'bench']);
    const bigList = s.furniture.filter((f) => big.has(f));
    const smallList = s.furniture.filter((f) => !big.has(f));
    const fill = s.fill?.length ? s.fill : bigList;
    const dr = this.door;
    const doorPt = { bottom: [dr.pos, H], top: [dr.pos, 2 * T], left: [0, dr.pos], right: [W, dr.pos] }[dr.side];
    const centre = [W / 2, 2 * T + (H - 2 * T) / 2];
    const nearWalk = (x: number, y: number, r: number) => {
      const [ax, ay] = doorPt, dx = centre[0] - ax, dy = centre[1] - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(ax + dx * t - x, ay + dy * t - y) < r;
    };
    const cellW = 4.4 * T, cellH = 3 * T;
    const cells: Array<[number, number]> = [];
    for (let y = 2.4 * T + cellH / 2; y + cellH / 2 <= H - 1.4 * T + 0.01; y += cellH) {
      for (let x = 1.9 * T + cellW / 2; x + cellW / 2 <= W - 1.9 * T + 0.01; x += cellW) {
        const k = this.keepClear;
        if (k && x + cellW / 2 > k.x0 && x - cellW / 2 < k.x1 && y + cellH / 2 > k.y0 && y - cellH / 2 < k.y1) continue;
        if (nearWalk(x, y, 2.4 * T)) continue;
        cells.push([x, y]);
      }
    }
    // Cells nearest the middle first, so a small room gets the style's own pieces there.
    cells.sort((a, b) => Math.hypot(a[0] - centre[0], a[1] - centre[1]) - Math.hypot(b[0] - centre[0], b[1] - centre[1]));
    const place = (f: Furniture, cx: number, cy: number) => {
      const [fw, fh] = FURNITURE_SIZE[f];
      const g = this.add.graphics().setDepth(AVATAR_DEPTH + cy + (fh * T) / 2);
      drawFurniture(g, f, cx, cy, accent);
      this.blockers.push({ x0: cx - (fw * T) / 2, y0: cy - (fh * T) / 2, x1: cx + (fw * T) / 2, y1: cy + (fh * T) / 2 });
    };
    const pieces = bigList.length || fill.length ? cells.map((_, i) => (i < bigList.length ? bigList[i] : fill[(i - bigList.length) % fill.length])) : [];
    const cap = Math.min(cells.length, 90);
    for (let i = 0; i < cap && pieces[i]; i++) {
      // Fountains only in big open rooms, one per ~400 tiles.
      if (pieces[i] === 'fountain' && i >= bigList.length && i % 7 !== 0) continue;
      place(pieces[i], cells[i][0], cells[i][1]);
    }
    // Small pieces along both side walls, every ~3 tiles (not in a doorway or the walk in).
    if (smallList.length) {
      let k = 0;
      for (let y = 4.4 * T; y < H - 1.4 * T; y += 3 * T)
        for (const [x, side] of [[T * 1.1, 'left'], [W - T * 1.1, 'right']] as const) {
          if (dr.side === side && Math.abs(y - dr.pos) < 2.4 * T) continue;
          if (nearWalk(x, y, 1.6 * T)) continue;
          place(smallList[k++ % smallList.length], x, y);
        }
    }
  }

  /**
   * Zoom so the room fills most of the screen; a room too big for that (malls, hypermarkets)
   * keeps a comfortable zoom and the camera follows you around it. Called on resize too.
   */
  fit() {
    const s = this.style;
    const W = s.w * T, H = s.h * T;
    const cam = this.cameras.main;
    cam.setSize(this.scale.width, this.scale.height);
    const fitZoom = Math.min((this.scale.width * 0.92) / (W + 60), (this.scale.height * 0.74) / (H + 120));
    const minZoom = 0.85 * this.app.dpr;
    const zoom = Math.min(Math.max(fitZoom, minZoom), 3 * this.app.dpr);
    cam.setZoom(zoom);
    if (zoom > fitZoom + 1e-6) {
      // Bigger than the screen: follow the player. On an axis where the room does fit, the
      // bounds are the view's size centred on the room (Phaser left-aligns smaller bounds).
      const viewW = cam.width / zoom, viewH = cam.height / zoom;
      const x0 = -60, x1 = W + 60;
      const y0 = -80, y1 = H + 60 + (140 * this.app.dpr) / zoom; // room under the doorway for the hotbar
      const bx = x1 - x0 <= viewW ? W / 2 - viewW / 2 : x0, bw = x1 - x0 <= viewW ? viewW : x1 - x0;
      const by = y1 - y0 <= viewH ? H / 2 - viewH / 2 : y0, bh = y1 - y0 <= viewH ? viewH : y1 - y0;
      cam.setBounds(bx, by, bw, bh);
      cam.startFollow(this.me.container, true, 0.2, 0.2);
    } else {
      cam.stopFollow();
      cam.removeBounds();
      cam.centerOn(W / 2, H / 2);
    }
  }

  private blocked(x: number, y: number) {
    const hw = 9, hh = 5;
    const s = this.style;
    const W = s.w * T, H = s.h * T;
    const { side, pos } = this.door;
    // The doorway lets you step out through its wall.
    const gapX = Math.abs(x - pos) < DOOR_HALF - hw, gapY = Math.abs(y - pos) < DOOR_HALF - hh;
    if (x - hw < 4 && !(side === 'left' && gapY)) return true;
    if (x + hw > W - 4 && !(side === 'right' && gapY)) return true;
    if (y + hh > H - 2 && !(side === 'bottom' && gapX)) return true;
    for (const r of this.blockers) if (x + hw > r.x0 && x - hw < r.x1 && y + hh > r.y0 && y - hh < r.y1) return true;
    return false;
  }

  /** Out through the doorway? */
  private outside(): boolean {
    const W = this.style.w * T, H = this.style.h * T;
    const { x, y } = this.pos;
    return { bottom: y > H + 6, top: y < -6, left: x < -6, right: x > W + 6 }[this.door.side];
  }

  override update(_t: number, delta: number) {
    if (this.leaving) return;
    const dt = Math.min(delta, 100) / 1000;
    let { x: vx, y: vy } = this.app.inputVector();
    const len = Math.hypot(vx, vy);
    if (len > 1) {
      vx /= len;
      vy /= len;
    }
    const moving = len > 0.01;
    if (moving) {
      this.dir = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : vy > 0 ? 'down' : 'up';
      const sp = this.app.cfg.movement.walkSpeed * this.app.mods().walk * 0.8;
      const nx = this.pos.x + vx * sp * dt, ny = this.pos.y + vy * sp * dt;
      if (!this.blocked(nx, this.pos.y)) this.pos.x = nx;
      if (!this.blocked(this.pos.x, ny)) this.pos.y = ny;
      this.me.setPosition(this.pos.x, this.pos.y);
      // Out through the door.
      if (this.outside()) return this.leave();
    }
    this.me.setState(this.dir, moving);
    const now = performance.now();
    this.me.tick(now);
    this.keeper?.tick(now);
    for (const a of this.others.values()) a.tick(now);

    // Nearest station within reach.
    // Usable from any side: distance from our feet to the counter's footprint.
    let best: Station | null = null;
    let bd = T * 1.2;
    for (const st of this.stations) {
      const r = st.rect;
      const d = Math.hypot(Math.max(r.x0 - this.pos.x, 0, this.pos.x - r.x1), Math.max(r.y0 - this.pos.y, 0, this.pos.y - r.y1));
      if (d < bd) {
        bd = d;
        best = st;
      }
    }
    if (best !== this.near) {
      this.near = best;
      const crate = best?.it.crate ? this.app.crates.get(best.it.crate) : undefined;
      if (best) this.app.hud?.setPrompt(crate ? `${best.it.name} (${formatMoney(crate.priceSen)})` : best.it.name, this.app.touch);
      else this.app.hud?.setPrompt('🚪 Walk out through the doorway to leave', this.app.touch, { walk: true });
    }
    this.othersAcc += delta;
    if (this.othersAcc > 800) {
      this.othersAcc = 0;
      this.syncOthers();
    }
  }

  /** E / the interact button: use the station we're at. (You leave by walking out.) */
  interact() {
    if (this.near) this.app.openInteractable(this.near.it);
  }

  /** Other players in this same building, standing around the room. */
  private syncOthers() {
    const inside = this.app.town?.playersInside(this.building.id) ?? [];
    const ids = new Set(inside.map((p) => p.id));
    for (const [id, a] of this.others) if (!ids.has(id)) (a.destroy(), this.others.delete(id));
    const s = this.style;
    for (const p of inside) {
      if (this.others.has(p.id)) continue;
      const r = seeded(`${p.id}`);
      let x = 0, y = 0;
      for (let k = 0; k < 20; k++) {
        x = T * (1.5 + r() * (s.w - 3));
        y = T * (3.5 + r() * (s.h - 5));
        if (!this.blocked(x, y)) break;
      }
      const a = new Avatar(this, this.app.cfg.character, this.app.items, {
        name: p.name, level: p.level, appearance: p.appearance, x, y, isSelf: false, cosmetics: p.cosmetics, particles: loadPrefs().particles,
      });
      a.setState(r() < 0.5 ? 'left' : 'right', false);
      this.others.set(p.id, a);
    }
  }

  leave() {
    if (this.leaving) return;
    this.leaving = true;
    this.app.exitBuilding();
  }

  debugInfo() {
    return { building: this.building.id, x: this.pos.x / T, y: this.pos.y / T, stations: this.stations.map((s) => ({ id: s.it.id, x: s.x / T, y: s.y / T })), near: this.near?.it.id ?? null };
  }
}
