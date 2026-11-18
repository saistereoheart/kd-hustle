// A building's interior, Pokémon style: runs ON TOP of the town scene, which keeps running
// (other players, the network) but is blurred and darkened behind a small room. You walk
// around the room; the shops/machines inside are used here. Your town position stays at the
// door, which is what the server checks when you use something inside.
import Phaser from 'phaser';
import { formatMoney, randomAppearance, roomSize, type BuiltBuilding, type BuiltMap, type Furniture, type RoomStyle } from '@kh/shared';
import type { App } from '../app';
import { toast } from '../ui/dom';
import { loadPrefs } from '../ui/settings';
import { AVATAR_DEPTH, Avatar } from './avatar';
import { drawFurniture, drawRoom, drawStation, FURNITURE_SIZE, stationSize, T } from './interiorArt';

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

  constructor() {
    super('interior');
  }

  init(data: { app: App; building: BuiltBuilding; style: RoomStyle; door?: BuiltBuilding['doors'][number] | null }) {
    this.app = data.app;
    this.building = data.building;
    // The room follows the building's footprint (a long shoplot is a long room, a mall is huge).
    const size = roomSize(data.app.cfg.interiors, data.style, data.building, data.door ?? data.building.door, data.app.map.metersPerTile);
    this.style = { ...data.style, ...size };
    this.blockers = [];
    this.stations = [];
    this.near = undefined;
    this.keeper = null;
    this.others = new Map();
    this.leaving = false;
  }

  create() {
    const s = this.style;
    const W = s.w * T, H = s.h * T;
    const accent = parseInt(s.trim.slice(1), 16);
    // Darken everything behind the room (the town keeps rendering underneath, blurred).
    this.add.rectangle(W / 2, H / 2, 40000, 40000, 0x05060c, 0.72).setDepth(-10);
    drawRoom(this.add.graphics().setDepth(-5), s);
    // Room walls block movement: back wall (top 2 rows) + the room edges.
    this.blockers.push({ x0: -100, y0: -100, x1: W + 100, y1: 2 * T + 4 });

    // Stations along the back wall (what this building is FOR), grouped around the middle.
    const its = this.app.map.interactables.filter((i) => i.building === this.building.id);
    const gap = Math.min(W / (its.length + 1), 6 * T);
    const sx0 = W / 2 - (gap * (its.length - 1)) / 2;
    its.forEach((it, i) => {
      const cx = sx0 + i * gap;
      const [sw, sh] = stationSize(it.type);
      const cy = 2 * T + (sh * T) / 2 + 6;
      const g = this.add.graphics().setDepth(AVATAR_DEPTH + cy + (sh * T) / 2);
      drawStation(g, it.type, it.crate, cx, cy, it.type === 'carwash' ? 0x1971c2 : accent);
      this.blockers.push({ x0: cx - (sw * T) / 2, y0: cy - (sh * T) / 2, x1: cx + (sw * T) / 2, y1: cy + (sh * T) / 2 });
      const crate = it.crate ? this.app.crates.get(it.crate) : undefined;
      const label = this.add
        .text(cx, cy - (sh * T) / 2 - 4, `${it.crate === 'luckybag' ? '🧧' : it.crate === 'mallbox' ? '🎁' : ICON[it.type] ?? '⭐'} ${it.name}${crate ? `\n${formatMoney(crate.priceSen)}` : ''}`, {
          fontFamily: 'system-ui, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#ffe066', stroke: '#11131f', strokeThickness: 4, align: 'center', resolution: 3,
        })
        .setOrigin(0.5, 1)
        .setDepth(999_000);
      this.tweens.add({ targets: label, y: label.y - 4, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.stations.push({ it, x: cx, y: cy + (sh * T) / 2 + T * 0.6 });
    });
    this.layoutFurniture(its.length > 0);
    // Name sign over the back wall.
    this.add
      .text(W / 2, -16, this.building.name ?? s.label, { fontFamily: 'system-ui, sans-serif', fontSize: '18px', fontStyle: 'bold', color: '#ffffff', stroke: '#11131f', strokeThickness: 5, resolution: 3 })
      .setOrigin(0.5, 1)
      .setDepth(999_000);

    // The shopkeeper, by the right-hand end of the back wall.
    const cfg = this.app.cfg;
    if (s.keeper) {
      const lastX = this.stations.length ? this.stations[this.stations.length - 1].x : 0;
      const kx = its.length ? Math.min(W - T * 1.6, lastX + T * 3.2) : W / 2, ky = 2 * T + T * 0.9;
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
    this.pos = { x: W / 2, y: H - T * 0.9 };
    this.me = new Avatar(this, cfg.character, this.app.items, {
      name: you.name, level: this.app.store.progress.level, appearance: you.appearance, x: this.pos.x, y: this.pos.y, isSelf: true,
      cosmetics: this.app.town?.selfCosmetics ?? you.cosmetics, particles: loadPrefs().particles,
    });
    this.me.setState('up', false);

    const cam = this.cameras.main;
    cam.setBackgroundColor('rgba(0,0,0,0)');
    this.fit();
    this.syncOthers();

    // You leave by walking out through the doorway (Esc works too). A small sign shows the way.
    this.add
      .text(W / 2, H + 14, '▼ EXIT ▼', { fontFamily: 'system-ui, sans-serif', fontSize: '11px', fontStyle: 'bold', color: '#c3fae8', stroke: '#11131f', strokeThickness: 4, resolution: 3 })
      .setOrigin(0.5, 0)
      .setDepth(999_000);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.me?.destroy();
      this.keeper?.destroy();
      for (const a of this.others.values()) a.destroy();
      this.others.clear();
    });
  }

  /**
   * Furniture: big pieces in a grid of aisles (either side of the walkway from the door), small
   * pieces along the side walls. A big room repeats the style's `fill` pieces so a hypermarket
   * has rows of shelves and a mall has kiosks and benches all the way along.
   */
  private layoutFurniture(hasStations: boolean) {
    const s = this.style;
    const W = s.w * T, H = s.h * T;
    const accent = parseInt(s.trim.slice(1), 16);
    const big: ReadonlySet<Furniture> = new Set(['shelf', 'fountain', 'table', 'slot', 'gate', 'kiosk', 'trolleys', 'bed', 'sofa', 'glasscase', 'desk', 'bench']);
    const bigList = s.furniture.filter((f) => big.has(f));
    const smallList = s.furniture.filter((f) => !big.has(f));
    const fill = s.fill?.length ? s.fill : bigList;
    // Grid cells either side of a 3.4-tile walkway down the middle; the first rows stay clear
    // in front of the stations along the back wall.
    const walk0 = W / 2 - 1.7 * T, walk1 = W / 2 + 1.7 * T;
    const y0 = (hasStations ? 6 : 3.4) * T, y1 = H - 1.8 * T;
    const cells: Array<[number, number]> = [];
    const cellW = 4.4 * T, cellH = 3 * T;
    for (let y = y0 + cellH / 2; y + cellH / 2 <= y1 + 0.01; y += cellH) {
      for (let x = walk0 - cellW / 2; x - cellW / 2 >= 1.9 * T - 0.01; x -= cellW) cells.push([x, y]);
      for (let x = walk1 + cellW / 2; x + cellW / 2 <= W - 1.9 * T + 0.01; x += cellW) cells.push([x, y]);
    }
    // Middle-most cells first, so a small room gets the style's own pieces near the walkway.
    cells.sort((a, b) => Math.abs(a[0] - W / 2) + Math.abs(a[1] - H * 0.6) * 0.6 - (Math.abs(b[0] - W / 2) + Math.abs(b[1] - H * 0.6) * 0.6));
    const place = (f: Furniture, cx: number, cy: number) => {
      const [fw, fh] = FURNITURE_SIZE[f];
      const g = this.add.graphics().setDepth(AVATAR_DEPTH + cy + (fh * T) / 2);
      drawFurniture(g, f, cx, cy, accent);
      this.blockers.push({ x0: cx - (fw * T) / 2, y0: cy - (fh * T) / 2, x1: cx + (fw * T) / 2, y1: cy + (fh * T) / 2 });
    };
    const bigPieces = bigList.length || fill.length ? cells.map((_, i) => (i < bigList.length ? bigList[i] : fill[(i - bigList.length) % fill.length])) : [];
    const cap = Math.min(cells.length, 90);
    for (let i = 0; i < cap && bigPieces[i]; i++) {
      // Fountains only in big open rooms, one per ~400 tiles.
      if (bigPieces[i] === 'fountain' && i >= bigList.length && i % 7 !== 0) continue;
      place(bigPieces[i], cells[i][0], cells[i][1]);
    }
    // Small pieces along both side walls, every ~3 tiles.
    if (smallList.length) {
      let k = 0;
      for (let y = 4.4; y < s.h - 1.4; y += 3) for (const x of [T * 1.1, W - T * 1.1]) place(smallList[k++ % smallList.length], x, y * T);
    }
  }

  /**
   * Zoom so the room fills most of the screen; a room too big for that (malls, hypermarkets)
   * keeps a comfortable zoom and the camera follows you around it. Called on resize too.
   */
  fit() {
    const s = this.style;
    const cam = this.cameras.main;
    cam.setSize(this.scale.width, this.scale.height);
    const fitZoom = Math.min((this.scale.width * 0.92) / (s.w * T + 40), (this.scale.height * 0.74) / (s.h * T + 80));
    const minZoom = 0.85 * this.app.dpr;
    const zoom = Math.min(Math.max(fitZoom, minZoom), 3 * this.app.dpr);
    cam.setZoom(zoom);
    if (zoom > fitZoom + 1e-6) {
      cam.setBounds(-60, -80, s.w * T + 120, s.h * T + 80 + 200 * this.app.dpr); // room under the doorway for the hotbar
      cam.startFollow(this.me.container, true, 0.2, 0.2);
    } else {
      cam.stopFollow();
      cam.removeBounds();
      cam.centerOn((s.w * T) / 2, (s.h * T) / 2 - 10);
    }
  }

  private blocked(x: number, y: number) {
    const hw = 9, hh = 5;
    const s = this.style;
    const W = s.w * T, H = s.h * T;
    if (x - hw < 4 || x + hw > W - 4) return true;
    // The doorway lets you step down past the bottom wall.
    const inDoor = Math.abs(x - W / 2) < 1.2 * T - hw;
    if (y + hh > H - 2 && !inDoor) return true;
    for (const r of this.blockers) if (x + hw > r.x0 && x - hw < r.x1 && y + hh > r.y0 && y - hh < r.y1) return true;
    return false;
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
      if (this.pos.y > this.style.h * T + 6) return this.leave();
    }
    this.me.setState(this.dir, moving);
    const now = performance.now();
    this.me.tick(now);
    this.keeper?.tick(now);
    for (const a of this.others.values()) a.tick(now);

    // Nearest station within reach.
    let best: Station | null = null;
    let bd = T * 1.6;
    for (const st of this.stations) {
      const d = Math.hypot(st.x - this.pos.x, st.y - this.pos.y);
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
