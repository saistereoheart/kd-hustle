// A building's interior, Pokémon style: runs ON TOP of the town scene, which keeps running
// (other players, the network) but is blurred and darkened behind a small room. You walk
// around the room; the shops/machines inside are used here. Your town position stays at the
// door, which is what the server checks when you use something inside.
// The room is the building's footprint as it sits on the map, and its doorway is on the same
// side as the door you came in by (come in from the north, you appear at the top). The counters
// and machines stand in the middle of the room on a glowing spot.
import Phaser from 'phaser';
import { doorSide, formatMoney, mallLotCount, mallLots, planInterior, randomAppearance, roomSize, type BuiltBuilding, type BuiltMap, type Furniture, type MallLot, type Plan, type PlanAct, type PlanProp, type RoomStyle } from '@kh/shared';
import { crowdLook } from '../character/crowd';
import { openCratePrizes, openDirectory, openFood, openInfo, openPotionShop } from '../ui/interiorPanels';
import { sfx } from '../ui/sound';
import { drawBalloons, drawProp } from './propArt';
import type { App } from '../app';
import { toast } from '../ui/dom';
import { loadPrefs } from '../ui/settings';
import { AVATAR_DEPTH, Avatar } from './avatar';
import { DOOR_HALF, drawFurniture, drawHighlight, drawRoom, drawStation, FURNITURE_SIZE, stationSize, T, type RoomDoor } from './interiorArt';
import { ensureGlowTexture, GLOW_TEXTURE } from './lightLayer';
import { bake, bakedPiece } from './bake';
import { COUNTER_LINES, Walkers } from './walkers';

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
/** 🏬 Something usable in a designed room: a sign, a shop lot, a shelf, a person. */
interface Spot {
  rect: Rect;
  prompt: string;
  act: PlanAct | { kind: 'say'; lines: string[] };
  npc?: Avatar;
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

const ICON: Record<string, string> = { jobs: '📋', pawn: '🏪', crate: '🎰', carwash: '🚿', market: '🛒', casino: '🎲', kitchen: '🍳', cashier: '💵', stairs: '🏠', showroom: '🚗' };

/** Extra stations a room can get from outside the map data (a kopitiam's kitchen and till). */
export interface ExtraStation {
  it: Interactable;
  use: () => void;
}
const GAME_ICON: Record<string, string> = { slots: '🎰', roulette: '🎡', blackjack: '🃏', crash: '📈', wheel: '🎯', highlow: '🔼' };

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
  private walkers: Walkers | null = null;
  private others = new Map<number, Avatar>();
  private othersAcc = 0;
  private leaving = false;
  private door: RoomDoor = { side: 'bottom', pos: 0 };
  /** Kept clear of furniture: the counters and the walk from the door to them. */
  private keepClear: Rect | null = null;
  private extra = new Map<string, () => void>();
  /** 🏬 Designed rooms: usable props and people, the staff, this mall's shop lots, your balloon. */
  private spots: Spot[] = [];
  private nearSpot: Spot | null = null;
  private npcs: Avatar[] = [];
  private lots: MallLot[] = [];
  private balloon = false;
  private extraIts: Interactable[] = [];
  private doorHalf = DOOR_HALF;

  constructor() {
    super('interior');
  }

  init(data: { app: App; building: BuiltBuilding; style: RoomStyle; door?: BuiltBuilding['doors'][number] | null; extra?: ExtraStation[] }) {
    this.app = data.app;
    this.extra = new Map((data.extra ?? []).map((e) => [e.it.id, e.use]));
    this.extraIts = (data.extra ?? []).map((e) => e.it);
    this.doorHalf = data.style.doorTiles ? (data.style.doorTiles * T) / 2 : DOOR_HALF;
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
    this.spots = [];
    this.nearSpot = null;
    this.npcs = [];
    this.lots = [];
    this.balloon = false;
  }

  private roomKey = '';

  create() {
    const s = this.style;
    const W = s.w * T, H = s.h * T;
    const accent = parseInt(s.trim.slice(1), 16);
    // Behind the room (the town isn't drawn while you're inside).
    this.add.rectangle(W / 2, H / 2, 40000, 40000, 0x05060c, 0.72).setDepth(-10);
    // The room is baked into one picture (static vector art is re-drawn every frame otherwise).
    const pad = 3 * T;
    this.roomKey = `room_${this.building.id}_${this.door.side}_${Math.round(this.door.pos)}_${s.w}x${s.h}`;
    bake(this, this.roomKey, W + pad * 2, H + pad * 2, (g) => {
      g.translateCanvas(pad, pad);
      drawRoom(g, s, this.door, this.doorHalf);
    });
    this.add.image(-pad, -pad, this.roomKey).setOrigin(0, 0).setDepth(-5);
    // The back wall (top 2 rows) blocks, except the passage through it for a door in the top wall.
    const dr = this.door;
    if (dr.side === 'top') {
      this.blockers.push({ x0: -100, y0: -100, x1: dr.pos - this.doorHalf, y1: 2 * T + 4 }, { x0: dr.pos + this.doorHalf, y0: -100, x1: W + 100, y1: 2 * T + 4 });
    } else this.blockers.push({ x0: -100, y0: -100, x1: W + 100, y1: 2 * T + 4 });

    // Counters and machines (what this building is FOR) stand in the middle of the room, each on
    // a glowing, pulsing spot with a bouncing arrow and a big label.
    ensureGlowTexture(this);
    const its = [...this.app.map.interactables.filter((i) => i.building === this.building.id), ...this.extraIts];
    const sizes = its.map((it) => stationSize(it.type));
    const widest = Math.max(0, ...sizes.map(([w]) => w));
    const gap = Math.max((widest + 2.2) * T, Math.min(W / (its.length + 1), 6.5 * T));
    const sx0 = W / 2 - (gap * (its.length - 1)) / 2;
    const cyMid = 2 * T + (H - 2 * T) / 2;
    const glowCol = 0xffd43b;
    // A narrow room (a long shoplot) stacks the stations down the middle instead.
    const rowW = sizes.reduce((a, [w]) => a + w, 0) * T + (its.length - 1) * 2.2 * T;
    const vertical = its.length > 1 && rowW > W - T;
    // 🏬 A designed room (pawn shop, capsule shop, mall, supermarket) plans where everything goes.
    const plan = s.plan ? this.makePlan(its, sizes) : null;
    const placeStation = (it: Interactable, cx: number, cy: number, sw: number, sh: number) => {
      const w = sw * T, h = sh * T;
      // the highlight on the floor, a pulsing ring and a soft glow
      bakedPiece(this, `hl_${Math.round(w)}x${Math.round(h)}_${glowCol}`, { w: w + 4 * T, h: h + 4 * T, padL: w / 2 + 2 * T, padT: h / 2 + 2 * T }, cx, cy, (g, x, y) => drawHighlight(g, x, y, w, h, glowCol)).setDepth(-4);
      const ring = this.add.ellipse(cx, cy + h * 0.15, w + 1.8 * T, h + 1.3 * T).setStrokeStyle(4, 0xfff3bf, 0.9).setDepth(-3);
      this.tweens.add({ targets: ring, scaleX: 1.12, scaleY: 1.12, alpha: 0.25, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const glow = this.add.image(cx, cy, GLOW_TEXTURE).setDisplaySize(w + 4 * T, h + 3.2 * T).setTint(glowCol).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD).setDepth(-3);
      this.tweens.add({ targets: glow, alpha: 0.15, duration: 1100, yoyo: true, repeat: -1 });
      const stCol = it.type === 'carwash' ? 0x1971c2 : accent;
      bakedPiece(this, `st_${it.type}_${it.crate ?? it.game ?? ''}_${stCol}`, { w: w + 6 * T, h: h + 8 * T, padL: w / 2 + 3 * T, padT: h / 2 + 5 * T }, cx, cy, (g, x, y) =>
        drawStation(g, it.type, it.crate ?? it.game, x, y, stCol),
      ).setDepth(AVATAR_DEPTH + cy + h / 2);
      this.blockers.push({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 });
      const crate = it.crate ? this.app.crates.get(it.crate) : undefined;
      const label = this.add
        .text(cx, cy - h / 2 - 22, `${it.crate === 'luckybag' ? '🧧' : it.crate === 'mallbox' ? '🎁' : (it.game && GAME_ICON[it.game]) || ICON[it.type] || '⭐'} ${it.name}${crate ? ` · ${formatMoney(crate.priceSen)}` : ''}`, {
          fontFamily: 'system-ui, sans-serif', fontSize: '14px', fontStyle: 'bold', color: '#11131f', backgroundColor: '#ffd43b', padding: { x: 8, y: 4 }, align: 'center', resolution: 3,
        })
        .setOrigin(0.5, 1)
        .setDepth(999_000);
      const arrow = this.add.text(cx, label.y - label.height - 2, '▼', { fontSize: '20px', color: '#ffd43b', stroke: '#11131f', strokeThickness: 4, resolution: 3 }).setOrigin(0.5, 1).setDepth(999_000);
      this.tweens.add({ targets: arrow, y: arrow.y - 7, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.stations.push({ it, x: cx, y: cy + h / 2 + T * 0.6, rect: { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 } });
    };
    if (plan) {
      for (const ps of plan.stations) {
        const i = its.findIndex((x) => x.id === ps.id);
        if (i >= 0) placeStation(its[i], ps.x * T, ps.y * T, sizes[i][0], sizes[i][1]);
      }
    } else
      its.forEach((it, i) => {
        const cx = vertical ? W / 2 : sx0 + i * gap;
        const cy = vertical ? 2 * T + ((H - 2 * T) * (i + 1)) / (its.length + 1) : cyMid;
        placeStation(it, cx, cy, sizes[i][0], sizes[i][1]);
      });
    if (this.stations.length && !plan) {
      const rs = this.stations.map((st) => st.rect);
      this.keepClear = { x0: Math.min(...rs.map((r) => r.x0)) - 2.2 * T, y0: Math.min(...rs.map((r) => r.y0)) - 2.6 * T, x1: Math.max(...rs.map((r) => r.x1)) + 2.2 * T, y1: Math.max(...rs.map((r) => r.y1)) + 2.2 * T };
    }
    if (plan) this.buildPlan(plan, accent);
    else this.layoutFurniture();
    // Name sign over the back wall.
    this.add
      .text(W / 2, -16, this.building.name ?? s.label, { fontFamily: 'system-ui, sans-serif', fontSize: '18px', fontStyle: 'bold', color: '#ffffff', stroke: '#11131f', strokeThickness: 5, resolution: 3 })
      .setOrigin(0.5, 1)
      .setDepth(999_000);

    // The shopkeeper, by the right-hand end of the back wall.
    const cfg = this.app.cfg;
    if (plan) {
      // (The planned room has its own staff.)
    } else if (s.keeper) {
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

    // 🚶 Customers: in at the door, to the counter (the shopkeeper / till), a word, and out.
    if (s.keeper || this.stations.length) {
      this.walkers = new Walkers(this, cfg.character, this.app.items, plan && W > 30 * T ? 5 : 3);
      const kopi = this.extraIts.some((i) => i.type === 'kitchen');
      const lines = kopi ? COUNTER_LINES.kopitiam : COUNTER_LINES.shop;
      const inDoor = { bottom: [dr.pos, H + T * 0.6], top: [dr.pos, 2 * T - T * 0.4], left: [-T * 0.6, dr.pos], right: [W + T * 0.6, dr.pos] }[dr.side];
      const inside = { bottom: [dr.pos, H - T * 1.2], top: [dr.pos, 2 * T + T * 1.2], left: [T * 1.2, dr.pos], right: [W - T * 1.2, dr.pos] }[dr.side];
      const counters = plan?.spots.length
        ? [...plan.spots.map((p) => ({ x: p.x * T, y: p.y * T })), ...this.stations.map((st) => ({ x: st.x, y: st.y + T * 0.4 }))]
        : this.stations.length ? this.stations.map((st) => ({ x: st.x + (Math.random() - 0.5) * T, y: st.y + T * 0.4 })) : [{ x: W / 2, y: cyMid + T }];
      const visit = () => {
        const c = counters[Math.floor(Math.random() * counters.length)];
        const say = lines[Math.floor(Math.random() * lines.length)];
        this.walkers?.walk({ x: inDoor[0], y: inDoor[1] }, [
          { x: inside[0], y: inside[1] },
          { x: c.x, y: c.y, say, waitMs: 2200 },
          { x: inside[0], y: inside[1] },
          { x: inDoor[0], y: inDoor[1] },
        ]);
      };
      this.time.addEvent({ delay: kopi ? 3500 : 5500, loop: true, callback: visit, startAt: 2500 });
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
      if (this.roomKey && this.textures.exists(this.roomKey)) this.textures.remove(this.roomKey); // (furniture textures are shared, kept)
      this.me?.destroy();
      this.keeper?.destroy();
      for (const n of this.npcs) n.destroy();
      this.npcs = [];
      this.walkers?.destroy();
      this.walkers = null;
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
      bakedPiece(this, `fu_${f}_${accent}`, { w: (fw + 4) * T, h: (fh + 6) * T, padL: (fw / 2 + 2) * T, padT: (fh / 2 + 4) * T }, cx, cy, (g, x, y) =>
        drawFurniture(g, f, x, y, accent),
      ).setDepth(AVATAR_DEPTH + cy + (fh * T) / 2);
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

  /** 🏬 The plan for a designed room (from the shared planner: the tests walk every one of them). */
  private makePlan(its: Interactable[], sizes: Array<[number, number]>): Plan {
    const s = this.style;
    const content = this.app.cfg.interiors.content;
    const crateIt = its.find((i) => i.type === 'crate' && i.crate);
    const pool = crateIt?.crate ? this.app.crates.get(crateIt.crate)?.pool ?? [] : [];
    const door = { side: this.door.side, pos: this.door.pos / T };
    if (s.plan === 'mall') this.lots = mallLots(content, this.building.id, mallLotCount(s.w, s.h, door.side, !!s.grocery));
    return planInterior({
      kind: s.plan!, grocery: s.grocery, buildingId: this.building.id, w: s.w, h: s.h, door,
      stations: its.map((it, i) => ({ id: it.id, w: sizes[i][0], h: sizes[i][1] })), content,
      crate: s.plan === 'capsule' && crateIt?.crate ? { id: crateIt.crate, itemNames: pool.map((id) => this.app.items.get(id)?.name ?? id) } : undefined,
      keeper: s.keeper, greeting: s.greeting,
    });
  }

  /** Draws the plan's props (baked: identical ones share a picture), their labels, and the staff. */
  private buildPlan(plan: Plan, accent: number) {
    const cfg = this.app.cfg;
    const promptOf = (p: PlanProp): string => {
      const a = p.act!;
      if (a.kind === 'food') return `${p.label ?? '🍽️'}: order`;
      if (a.kind === 'potions') return `${a.title}: potions for 💎`;
      if (a.kind === 'directory') return '🗺️ Mall directory';
      if (a.kind === 'odds') return a.title;
      if (a.kind === 'info') return `🔎 ${a.title}`;
      return p.label ?? '🔎 Look';
    };
    for (const p of plan.props) {
      const cx = p.x * T, cy = p.y * T, w = p.w * T, h = p.h * T;
      const key = `pp_${p.kind}_${p.w.toFixed(1)}x${p.h.toFixed(1)}_${p.color ?? ''}_${p.face ?? ''}_${accent}`;
      bakedPiece(this, key, { w: w + 4 * T, h: h + 5 * T, padL: w / 2 + 2 * T, padT: h / 2 + 3 * T }, cx, cy, (g, x, y) => drawProp(g, p, x, y, accent)).setDepth(p.solid ? AVATAR_DEPTH + cy + h / 2 : -2);
      const rect = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
      if (p.solid) this.blockers.push(rect);
      if (p.label) {
        const big = p.kind === 'lot';
        this.add
          .text(cx, cy - h / 2 - (p.kind === 'board' || p.kind === 'notice' || p.kind === 'poster' || p.kind === 'directory' || p.kind === 'banner' ? 0.35 * T : 2), p.label, {
            fontFamily: 'system-ui, sans-serif', fontSize: big ? '13px' : '11px', fontStyle: 'bold', color: big ? '#ffffff' : '#11131f',
            backgroundColor: big ? p.color ?? '#495057' : 'rgba(255,255,255,0.88)', padding: { x: big ? 6 : 4, y: 2 }, resolution: 2,
          })
          .setOrigin(0.5, 1)
          .setDepth(big ? 999_000 : AVATAR_DEPTH + cy + h / 2 + 1);
      }
      if (p.act) this.spots.push({ rect, prompt: promptOf(p), act: p.act });
    }
    // The staff: shared crowd faces (memory), each standing at their post.
    let first = true;
    for (const n of plan.npcs) {
      let seed = 0;
      for (const ch of this.building.id + n.name) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
      const av = new Avatar(this, cfg.character, this.app.items, { name: n.name, level: 1, appearance: crowdLook(cfg.character, Math.abs(seed)), x: n.x * T, y: n.y * T, isSelf: false, npc: true });
      av.setState(n.dir, false);
      this.npcs.push(av);
      const x = n.x * T, y = n.y * T;
      this.blockers.push({ x0: x - 12, y0: y - 10, x1: x + 12, y1: y + 4 });
      if (n.role === 'balloon') bakedPiece(this, 'pp_balloons', { w: 70, h: 70, padL: 35, padT: 62 }, x + 14, y - 14, (g, bx, by) => drawBalloons(g, bx, by, 4)).setDepth(AVATAR_DEPTH + y + 2);
      const prompt = n.act?.kind === 'balloon' ? `🎈 ${n.name}: a free balloon` : n.act?.kind === 'sample' ? `🍢 ${n.name}: free sample` : `💬 Talk to ${n.name}`;
      this.spots.push({ rect: { x0: x - 14, y0: y - 30, x1: x + 14, y1: y + 6 }, prompt, act: n.act ?? { kind: 'say', lines: n.lines }, npc: av });
      if (n.role === 'keeper' && first) {
        first = false;
        this.time.delayedCall(350, () => av.say(n.lines[0], 4500));
      }
    }
  }

  /** E at a usable prop or person in a designed room. */
  private useSpot(sp: Spot) {
    const a = sp.act;
    const line = (lines: string[]) => lines[Math.floor(Math.random() * lines.length)];
    sfx.click();
    switch (a.kind) {
      case 'info':
        return openInfo(a.title, a.lines);
      case 'food': {
        const lot = this.app.cfg.interiors.content.lots.find((l) => l.id === a.lot);
        return lot && openFood(this.app, lot);
      }
      case 'potions':
        return openPotionShop(this.app, a.title);
      case 'directory':
        return openDirectory(this.building.name ?? 'Mall', this.lots);
      case 'odds':
        return openCratePrizes(this.app, a.crate, a.title);
      case 'say':
        return sp.npc?.say(line(a.lines), 3200);
      case 'balloon': {
        sp.npc?.say(line(this.app.cfg.interiors.content.mall.balloonLines), 3000);
        if (this.balloon) return toast('🎈 You already have a balloon. Hold on to it!', 'info');
        this.balloon = true;
        // Your balloon, floating over your shoulder while you're in here.
        const key = 'pp_balloon1';
        const img = bakedPiece(this, key, { w: 30, h: 46, padL: 15, padT: 42 }, 0, 0, (g, bx, by) => drawBalloons(g, bx, by, 1));
        img.setPosition(this.me.container.x + 8, this.me.container.y - 20).setDepth(999_000 - 2);
        this.events.on(Phaser.Scenes.Events.UPDATE, () => img.setPosition(this.me.container.x + 8 - 15, this.me.container.y - 20 - 42));
        return toast('🎈 A balloon! It\'s yours while you\'re here.', 'good');
      }
      case 'sample':
        sp.npc?.say(line(this.app.cfg.interiors.content.grocery.sampleLines), 3000);
        return this.app.socket?.timeout(5000).emit('mall:sample', (err, res) => {
          if (err || !res.ok) return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'info');
          sfx.coin();
          toast(res.text, 'good');
        });
    }
  }

  /**
   * Zoom so the room fills most of the screen; a room too big for that (malls, hypermarkets)
   * keeps a comfortable zoom and the camera follows you around it. Called on resize too.
   */
  fit() {
    const s = this.style;
    const W = s.w * T, H = s.h * T;
    const cam = this.cameras?.main;
    if (!cam) return; // the scene has shut down (left it, or not built yet)
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
    const gapX = Math.abs(x - pos) < this.doorHalf - hw, gapY = Math.abs(y - pos) < this.doorHalf - hh;
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
    for (const n of this.npcs) n.tick(now);
    this.walkers?.update(now);
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
    let spot: Spot | null = null;
    for (const sp of this.spots) {
      const r = sp.rect;
      const d = Math.hypot(Math.max(r.x0 - this.pos.x, 0, this.pos.x - r.x1), Math.max(r.y0 - this.pos.y, 0, this.pos.y - r.y1));
      if (d < bd) {
        bd = d;
        spot = sp;
        best = null;
      }
    }
    if (best !== this.near || spot !== this.nearSpot) {
      this.near = best;
      this.nearSpot = spot;
      const crate = best?.it.crate ? this.app.crates.get(best.it.crate) : undefined;
      if (best) this.app.hud?.setPrompt(crate ? `${best.it.name} (${formatMoney(crate.priceSen)})` : best.it.name, this.app.touch);
      else if (spot) this.app.hud?.setPrompt(spot.prompt, this.app.touch);
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
    if (!this.near && this.nearSpot) return this.useSpot(this.nearSpot);
    if (!this.near) return;
    const use = this.extra.get(this.near.it.id);
    if (use) use();
    else this.app.openInteractable(this.near.it);
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
