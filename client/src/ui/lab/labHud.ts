// 🗝️ Labirin Purba's HUD: the floor and your coins along the top, a minimap of the rooms you've
// explored around you (top right; tap it, or press M, for the whole floor), and Leave where you can.
import { labFloor, seenHas, type LabFloor, type LabRoomView } from '@kh/shared';
import type { App } from '../../app';
import { el } from '../dom';
import { openLabBag } from './labBag';
import { openLabParty } from './labParty';
import { LabLoadout } from './labLoadout';

/** A Syiling Purba coin, drawn in CSS (the 🪙 emoji is missing from older emoji fonts). */
export function coinIcon(): HTMLElement {
  return el('i', { class: 'lab-coin', 'aria-label': 'Syiling Purba' });
}

/** The minimap shows this many rooms each way around you, each this big (px). */
const RANGE = 4;
const CELL = 26;

export class LabHud {
  private root: HTMLElement;
  private title: HTMLElement;
  private coins: HTMLElement;
  private hp: HTMLElement;
  private mini: HTMLCanvasElement;
  private full: HTMLElement | null = null;
  private view: LabRoomView | null = null;
  /** ⚔️ Your gear down the left. */
  private loadout: LabLoadout;

  constructor(private app: App) {
    this.title = el('b', { class: 'lab-title' });
    this.coins = el('span', { class: 'lab-coins', 'data-testid': 'lab-coins' });
    this.hp = el('span', { class: 'lab-hp', 'data-testid': 'lab-hp' });
    const mapBtn = el('button', { class: 'btn small', type: 'button', title: 'The whole floor (M)' }, '🗺️ Map');
    mapBtn.addEventListener('click', () => this.openFull());
    const bagBtn = el('button', { class: 'btn small', type: 'button', 'data-action': 'lab-bag', title: 'Your Labirin gear and potions' }, '🎒 Bag');
    bagBtn.addEventListener('click', () => openLabBag(this.app, 'gear'));
    const partyBtn = el('button', { class: 'btn small', type: 'button', 'data-action': 'lab-party', title: 'Your party: fight together' }, '👥');
    partyBtn.addEventListener('click', () => openLabParty(this.app));
    this.root = el('div', { class: 'lab-hud', 'data-testid': 'lab-hud' }, this.title, this.hp, this.coins, bagBtn, partyBtn, mapBtn);
    this.mini = el('canvas', { class: 'lab-minimap', title: 'Tap for the whole floor (M)' }) as HTMLCanvasElement;
    this.mini.addEventListener('click', () => this.openFull());
    document.body.append(this.root, this.mini);
    this.loadout = new LabLoadout(app);
  }

  destroy() {
    this.root.remove();
    this.mini.remove();
    this.loadout.destroy();
    this.closeFull();
  }

  hasSeen(floor: number, room: number, seenHex: string): boolean {
    return this.view?.floor === floor ? seenHas(seenHex, room) : false;
  }

  update(v: LabRoomView) {
    this.view = v;
    const lc = this.app.cfg.lab;
    const f = labFloor(lc, v.floor);
    const room = f.rooms[v.room];
    this.title.textContent = `🗝️ ${lc.floors[v.floor].name} · B${v.floor + 1}`;
    this.updateSelf(v.self);
    this.coins.title = 'Banked coins are safe. Carried coins are banked when you rest or leave; half is lost if your party falls.';
    this.drawMini(f, v);
    if (this.full) this.openFull(true);
  }

  /** 👥 The party changed (someone moved rooms): redraw where they are. */
  partyChanged() {
    const v = this.view;
    if (!v) return;
    this.drawMini(labFloor(this.app.cfg.lab, v.floor), v);
    if (this.full) this.openFull(true);
  }

  /** Your labyrinth save as last heard (potions for the battle screen). */
  get self(): LabRoomView['self'] | null {
    return this.view?.self ?? null;
  }

  /** Coins and HP (after a fight, a chest...). */
  updateSelf(self: LabRoomView['self']) {
    if (this.view) this.view = { ...this.view, self };
    this.loadout.update(self);
    this.coins.replaceChildren(coinIcon(), ` ${self.coins}${self.carried ? ` (+${self.carried} carried)` : ''}`);
    const pct = self.maxHp ? self.hp / self.maxHp : 1;
    // 🍵 A tavern drink working on you: its icon and the fights it has left.
    const d = self.drink ? this.app.cfg.lab.tavern.drinks.find((x) => x.id === self.drink!.id) : undefined;
    this.hp.textContent = `❤️ ${self.hp}/${self.maxHp}${d && self.drink ? `  ${d.icon}×${self.drink.left}` : ''}`;
    this.hp.title = d ? `${d.name}: ${d.desc} (${self.drink!.left} fight${self.drink!.left === 1 ? '' : 's'} left)` : '';
    this.hp.classList.toggle('low', pct < 0.3);
  }

  // ---------------------------------------------------------------- maps
  /** Draws seen rooms of a floor into a canvas: `around` = only near you (the minimap). */
  private paint(c: HTMLCanvasElement, f: LabFloor, v: LabRoomView, cell: number, around: boolean) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const here = f.rooms[v.room];
    const x0 = around ? here.cx - RANGE : 0, y0 = around ? here.cy - RANGE : 0;
    const cols = around ? RANGE * 2 + 1 : f.w, rows = around ? RANGE * 2 + 1 : f.h;
    c.width = Math.round(cols * cell * dpr);
    c.height = Math.round(rows * cell * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = 'rgba(8,10,18,0.92)';
    g.fillRect(0, 0, cols * cell, rows * cell);
    const pad = Math.max(2, cell * 0.16);
    const seen = (id: number) => seenHas(v.seen, id);
    for (const r of f.rooms) {
      if (!seen(r.id)) continue;
      const x = (r.cx - x0) * cell, y = (r.cy - y0) * cell;
      if (x < -cell || y < -cell || x > cols * cell || y > rows * cell) continue;
      g.fillStyle = r.kind === 'rest' ? '#e8590c' : r.kind === 'boss' ? '#862e9c' : r.kind === 'treasure' ? '#e0a800' : r.kind === 'start' ? '#2b8a3e' : '#495057';
      g.fillRect(x + pad, y + pad, cell - pad * 2, cell - pad * 2);
      // Doorways to the next rooms (dim if that room isn't seen yet).
      g.fillStyle = '#868e96';
      const m = cell / 2, dw = Math.max(2, cell * 0.22);
      for (const [d, door] of Object.entries(r.doors)) {
        if (!door) continue;
        g.fillStyle = door.lock !== undefined ? '#f59f00' : seen(door.to) ? '#adb5bd' : '#5c5f66';
        if (d === 'n') g.fillRect(x + m - dw / 2, y, dw, pad);
        if (d === 's') g.fillRect(x + m - dw / 2, y + cell - pad, dw, pad);
        if (d === 'w') g.fillRect(x, y + m - dw / 2, pad, dw);
        if (d === 'e') g.fillRect(x + cell - pad, y + m - dw / 2, pad, dw);
      }
      const icon = r.kind === 'rest' ? '🔥' : r.kind === 'boss' ? (v.self.bosses.includes(v.floor) ? '🕳️' : '👹') : r.kind === 'treasure' ? '💰' : r.kind === 'start' ? (v.floor === 0 ? '🏙️' : '🪜') : r.key !== undefined && !v.self.keys.includes(`${v.floor}:${r.key}`) && !v.self.used.includes(`${v.floor}:${r.key}`) ? '🗝️' : '';
      if (icon && cell >= 16) {
        g.font = `${Math.round(cell * 0.5)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(icon, x + m, y + m + 1);
      }
    }
    // 👥 Party members on this floor (shown even in rooms you haven't seen: go and find them).
    const me = this.app.lastInit?.you.id;
    let k = 0;
    for (const m of this.app.labParty?.members ?? []) {
      if (m.id === me || !m.inside || m.floor !== v.floor || m.room === undefined) continue;
      const r = f.rooms[m.room];
      if (!r) continue;
      const mx = (r.cx - x0 + 0.5) * cell + ((k++ % 3) - 1) * cell * 0.18, my = (r.cy - y0 + 0.5) * cell;
      if (mx < 0 || my < 0 || mx > cols * cell || my > rows * cell) continue;
      g.fillStyle = m.fighting ? '#ff6b6b' : '#4dabf7';
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(mx, my, Math.max(3, cell * 0.14), 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    // You.
    const yx = (here.cx - x0 + 0.5) * cell, yy = (here.cy - y0 + 0.5) * cell;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.strokeRect(yx - cell / 2 + pad - 1, yy - cell / 2 + pad - 1, cell - pad * 2 + 2, cell - pad * 2 + 2);
    g.fillStyle = '#69db7c';
    g.beginPath();
    g.arc(yx, yy, Math.max(3, cell * 0.16), 0, Math.PI * 2);
    g.fill();
  }

  private drawMini(f: LabFloor, v: LabRoomView) {
    this.paint(this.mini, f, v, CELL, true);
    this.mini.style.width = `${(RANGE * 2 + 1) * CELL}px`;
    this.mini.style.height = `${(RANGE * 2 + 1) * CELL}px`;
  }

  /** The whole floor (only what you've explored), as big as fits. */
  openFull(refresh = false) {
    const v = this.view;
    if (!v) return;
    if (this.full && !refresh) return this.closeFull();
    const f = labFloor(this.app.cfg.lab, v.floor);
    const cell = Math.max(14, Math.min(44, Math.floor(Math.min(innerWidth * 0.9 / f.w, (innerHeight * 0.72) / f.h))));
    const c = el('canvas', { class: 'lab-fullmap-canvas' }) as HTMLCanvasElement;
    this.paint(c, f, v, cell, false);
    c.style.width = `${f.w * cell}px`;
    c.style.height = `${f.h * cell}px`;
    const seen = f.rooms.filter((r) => seenHas(v.seen, r.id)).length;
    const close = el('button', { class: 'btn small', type: 'button' }, '✕ Close');
    close.addEventListener('click', () => this.closeFull());
    const box = el(
      'div',
      { class: 'lab-fullmap', 'data-testid': 'lab-fullmap' },
      el('div', { class: 'lab-fullmap-head' }, el('b', {}, `🗺️ ${this.app.cfg.lab.floors[v.floor].name} · B${v.floor + 1}`), el('span', { class: 'muted small' }, `${seen} / ${f.rooms.length} rooms explored`), close),
      c,
      el('div', { class: 'muted small' }, '🟢 you · 🔥 rest chamber · 🕳️ stairs down · 💰 treasure · 🗝️ key · 🟧 locked door'),
    );
    const backdrop = el('div', { class: 'modal-backdrop lab-fullmap-backdrop' }, box);
    backdrop.addEventListener('click', (e) => e.target === backdrop && this.closeFull());
    this.full?.remove();
    this.full = backdrop;
    document.body.append(backdrop);
  }

  closeFull() {
    this.full?.remove();
    this.full = null;
  }

  get fullOpen() {
    return !!this.full;
  }
}
