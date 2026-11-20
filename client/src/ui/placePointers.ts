// Edge-of-screen pointers: a round badge on the edge of the screen for a place that's just off
// screen, pointing the way, with how far it is. Only places close by (yours and signposted ones);
// everything else is on the minimap and the full map, not on the game screen. Tap one and the
// guide arrow leads you there. Settings → "📍 Pointers to places" turns them off.
import type { Poi } from '@kh/shared';
import type { App } from '../app';
import { el, uiRoot } from './dom';
import { loadPrefs } from './settings';

const KIND_COLOR: Record<string, string> = { mine: '#f59f00', work: '#2f9e44', crate: '#7048e8', shop: '#1c7ed6', stall: '#e8590c' };
/** Places further than this (metres) don't get a pointer: see the minimap / full map. */
const RANGE_M = 120;
const MAX_POIS = 5;

interface View {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class PlacePointers {
  private root = el('div', { class: 'place-pointers' });
  private els = new Map<string, { box: HTMLElement; dist: HTMLElement; arrow: HTMLElement }>();
  private last = 0;
  private alive = 0;
  private timer: number;

  constructor(private app: App) {
    uiRoot().append(this.root);
    // Out of town (inside a building / home) the town stops updating: hide them.
    this.timer = window.setInterval(() => {
      if (performance.now() - this.alive > 600) this.root.classList.add('hidden');
    }, 300);
  }

  /** From the town each frame: the camera's view (world px) and where you are (world px). */
  update(view: View, me: { x: number; y: number }) {
    const now = performance.now();
    this.alive = now;
    if (now - this.last < 100) return;
    this.last = now;
    const on = loadPrefs().pointers !== false && document.body.dataset.state === 'town';
    this.root.classList.toggle('hidden', !on);
    if (!on) return;
    const T = this.app.map.tileSize;
    const mpt = this.app.map.metersPerTile;
    const W = innerWidth, H = innerHeight;
    const meTx = me.x / T, meTy = me.y / T;
    const mine = this.app.myPlaces().filter((p) => Math.hypot(p.x - meTx, p.y - meTy) * mpt <= RANGE_M);
    const pois = (this.app.guide?.pois ?? [])
      .filter((p) => p.kind !== 'soon')
      .map((p) => ({ p, d: Math.hypot(p.x - meTx, p.y - meTy) * mpt }))
      .filter((x) => x.d <= RANGE_M)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_POIS)
      .map((x) => x.p);
    const want = new Map<string, Poi>();
    for (const p of [...mine, ...pois]) want.set(p.id, p);
    // Safe box the pointers sit on (clear of the HUD corners).
    const L = 14, R = W - 14, TOP = 96, BOT = H - (document.body.classList.contains('touch') ? 180 : 125);
    const cx = W / 2, cy = H / 2;
    // Read the layout ONCE (reading it after writing styles forces the browser to lay the page out
    // again, once per pointer).
    const mm = document.querySelector<HTMLElement>('.minimap:not(.hidden)')?.getBoundingClientRect();
    const goalEl = document.querySelector<HTMLElement>('.progress-hud');
    const goal = goalEl?.getBoundingClientRect();
    for (const [id, p] of want) {
      const sx = ((p.x * T - view.x) / view.width) * W;
      const sy = ((p.y * T - view.y) / view.height) * H;
      let e = this.els.get(id);
      const visible = sx > 0 && sx < W && sy > 40 && sy < H;
      if (visible) {
        e?.box.classList.add('hidden');
        continue;
      }
      if (!e) {
        const arrow = el('span', { class: 'pp-arrow' }, '▲');
        const dist = el('span', { class: 'pp-dist' });
        const box = el('button', { class: `pp${p.kind === ('mine' as Poi['kind']) ? ' mine' : ''}`, type: 'button', title: p.label, 'data-pointer': id }, arrow, el('span', { class: 'pp-icon' }, p.icon), dist);
        box.style.setProperty('--pp', KIND_COLOR[p.kind] ?? '#495057');
        box.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (id.startsWith('mine:')) this.app.guide?.pointAt({ id, label: p.label, icon: p.icon, x: p.x, y: p.y });
          else this.app.guide?.point(id);
        });
        e = { box, dist, arrow };
        this.els.set(id, e);
        this.root.append(box);
      }
      e.box.classList.remove('hidden');
      // From the middle of the screen towards the place, stopped at the safe box's edge.
      const dx = sx - cx, dy = sy - cy;
      let t = Infinity;
      if (dx > 0) t = Math.min(t, (R - cx) / dx);
      if (dx < 0) t = Math.min(t, (L - cx) / dx);
      if (dy > 0) t = Math.min(t, (BOT - cy) / dy);
      if (dy < 0) t = Math.min(t, (TOP - cy) / dy);
      const px = cx + dx * t;
      let py = cy + dy * t;
      // Keep clear of the minimap (top right) and the goal card (top left).
      if (mm && px > mm.left - 30 && py < mm.bottom + 28) py = mm.bottom + 28;
      if (goal && goal.height && px < goal.right + 30 && py < goal.bottom + 28) py = goal.bottom + 28;
      const tr = `translate(${Math.round(px)}px, ${Math.round(py)}px) translate(-50%, -50%)`;
      if (e.box.style.transform !== tr) e.box.style.transform = tr;
      const rot = `rotate(${Math.round((Math.atan2(dy, dx) * 180) / Math.PI + 90)}deg)`;
      if (e.arrow.style.transform !== rot) e.arrow.style.transform = rot;
      const m = Math.hypot(p.x - meTx, p.y - meTy) * mpt;
      const dist = m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
      if (e.dist.textContent !== dist) e.dist.textContent = dist;
    }
    for (const [id, e] of this.els) if (!want.has(id)) e.box.classList.add('hidden');
  }

  destroy() {
    clearInterval(this.timer);
    this.root.remove();
  }
}
