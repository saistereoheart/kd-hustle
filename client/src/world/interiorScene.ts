// A building's interior, Pokémon style: runs ON TOP of the town scene, which keeps running
// (other players, the network) but is blurred and darkened behind a small room. You walk
// around the room; the shops/machines inside are used here. Your town position stays at the
// door, which is what the server checks when you use something inside.
import Phaser from 'phaser';
import { formatMoney, randomAppearance, type BuiltBuilding, type BuiltMap, type Furniture, type RoomStyle } from '@kh/shared';
import type { App } from '../app';
import { el, toast, uiRoot } from '../ui/dom';
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
  private exitBtn: HTMLElement | null = null;
  private leaving = false;

  constructor() {
    super('interior');
  }

  init(data: { app: App; building: BuiltBuilding; style: RoomStyle }) {
    this.app = data.app;
    this.building = data.building;
    this.style = data.style;
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

    // Stations along the back wall (what this building is FOR).
    const its = this.app.map.interactables.filter((i) => i.building === this.building.id);
    its.forEach((it, i) => {
      const cx = ((i + 1) * W) / (its.length + 1);
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

    // Furniture: big pieces in the middle (either side of the walkway), small ones along the walls.
    const big: ReadonlySet<Furniture> = new Set(['shelf', 'fountain', 'table', 'slot', 'gate', 'kiosk', 'trolleys', 'bed', 'sofa', 'glasscase']);
    const mid: Array<[number, number]> = [];
    const rows = s.h >= 10 ? [0.5, 0.78] : [0.62];
    for (const r of rows) for (const c of [0.24, 0.76]) mid.push([W * c, H * r]);
    const side: Array<[number, number]> = [];
    for (let y = 4.2; y < s.h - 1.4; y += 2) side.push([T * 1.1, y * T], [W - T * 1.1, y * T]);
    for (const f of s.furniture) {
      const slot = (big.has(f) ? mid.shift() ?? side.shift() : side.shift() ?? mid.shift());
      if (!slot) break;
      const [fw, fh] = FURNITURE_SIZE[f];
      const [cx, cy] = slot;
      const g = this.add.graphics().setDepth(AVATAR_DEPTH + cy + (fh * T) / 2);
      drawFurniture(g, f, cx, cy, accent);
      this.blockers.push({ x0: cx - (fw * T) / 2, y0: cy - (fh * T) / 2, x1: cx + (fw * T) / 2, y1: cy + (fh * T) / 2 });
    }

    // Name sign over the back wall.
    this.add
      .text(W / 2, -16, this.building.name ?? s.label, { fontFamily: 'system-ui, sans-serif', fontSize: '18px', fontStyle: 'bold', color: '#ffffff', stroke: '#11131f', strokeThickness: 5, resolution: 3 })
      .setOrigin(0.5, 1)
      .setDepth(999_000);

    // The shopkeeper, by the right-hand end of the back wall.
    const cfg = this.app.cfg;
    if (s.keeper) {
      const kx = its.length ? W - T * 1.6 : W / 2, ky = 2 * T + T * 0.9;
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

    // A big touch-friendly way out (Esc / walking onto the mat work too).
    this.exitBtn = el('button', { class: 'interior-exit', 'data-testid': 'interior-exit' }, '🚪 Leave');
    this.exitBtn.addEventListener('click', () => this.leave());
    uiRoot().append(this.exitBtn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.exitBtn?.remove();
      this.exitBtn = null;
      this.me?.destroy();
      this.keeper?.destroy();
      for (const a of this.others.values()) a.destroy();
      this.others.clear();
    });
  }

  /** Zoom so the room fills most of the screen; called on resize too. */
  fit() {
    const s = this.style;
    const cam = this.cameras.main;
    cam.setSize(this.scale.width, this.scale.height);
    const zoom = Math.min((this.scale.width * 0.92) / (s.w * T + 40), (this.scale.height * 0.74) / (s.h * T + 80));
    cam.setZoom(Math.min(zoom, 3 * this.app.dpr));
    cam.centerOn((s.w * T) / 2, (s.h * T) / 2 - 10);
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
      this.app.hud?.setPrompt(best ? (crate ? `${best.it.name} (${formatMoney(crate.priceSen)})` : best.it.name) : '🚪 Leave', this.app.touch);
    }
    this.othersAcc += delta;
    if (this.othersAcc > 800) {
      this.othersAcc = 0;
      this.syncOthers();
    }
  }

  /** E / the interact button: use the station we're at, else leave. */
  interact() {
    if (this.near) this.app.openInteractable(this.near.it);
    else this.leave();
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
