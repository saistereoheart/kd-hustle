// Finding your way: a guide arrow that points at where your current goal (or a quest, or a
// place you picked) happens, a pin over the spot when it's on screen, and random hints.
import { resolvePois, type Poi } from '@kh/shared';
import type { App } from '../app';
import { isPanelOpen } from './panel';
import { el, toast, uiRoot } from './dom';
import { loadPrefs } from './settings';

export interface GuideTarget {
  id: string;
  label: string;
  icon: string;
  x: number;
  y: number;
}

export class Guide {
  readonly pois: Poi[];
  /** A place the player asked for (📍 buttons), until they get there. */
  private manual: string | null = null;
  /** Point at the current goal's place. */
  private followGoal = false;
  private arrow: HTMLElement;
  private arrowLabel: HTMLElement;
  private pin: HTMLElement;
  private hintTimer: number;
  private hintOrder: number[] = [];
  private lastDist = Infinity;

  constructor(private app: App) {
    this.pois = resolvePois(app.map, app.cfg.guide);
    this.arrowLabel = el('span', { class: 'guide-arrow-label' });
    this.arrow = el('div', { class: 'guide-arrow hidden', 'data-testid': 'guide-arrow' }, el('span', { class: 'guide-arrow-head' }, '➤'), this.arrowLabel);
    this.pin = el('div', { class: 'guide-pin hidden' }, '⬇');
    uiRoot().append(this.arrow, this.pin);
    const first = window.setTimeout(() => this.hint(), 45_000);
    this.hintTimer = window.setInterval(() => this.hint(), app.cfg.guide.hintEveryMs);
    this.cleanup = () => clearTimeout(first);
  }
  private cleanup: () => void;

  /** A POI (or "mystall": your stall, else the pasar malam) placed on the map. */
  resolve(id: string): GuideTarget | null {
    if (id === 'mystall') {
      const plot = this.app.store.stall?.plot;
      const p = plot ? this.app.map.stallPlots.find((s) => s.id === plot) : undefined;
      if (p) return { id, label: 'YOUR STALL', icon: '🍳', x: p.x, y: p.y };
      return this.resolve('pasar');
    }
    const p = this.pois.find((x) => x.id === id);
    return p ? { id, label: p.label, icon: p.icon, x: p.x, y: p.y } : null;
  }

  /** Where the current goal happens (null for goals with no place, e.g. "reach level 5"). */
  goalTarget(): GuideTarget | null {
    const goal = this.app.cfg.goals.goals[this.app.store.progress.path];
    const id = goal ? this.app.cfg.guide.targets[`goal:${goal.id}`] : undefined;
    return id ? this.resolve(id) : null;
  }

  questTarget(questId: string): GuideTarget | null {
    const id = this.app.cfg.guide.targets[`quest:${questId}`];
    return id ? this.resolve(id) : null;
  }

  get following() {
    return this.followGoal || this.manual !== null;
  }

  /** The 🎯 card's "Show me": toggle the arrow to the current goal. */
  toggleGoal() {
    this.manual = null;
    this.followGoal = !this.followGoal;
    const t = this.goalTarget();
    if (this.followGoal && t) toast(`${t.icon} Follow the arrow to ${t.label}`, 'info', 3000);
    this.app.store.emit();
  }

  /** Point at any spot (e.g. your home) until you get there. */
  pointAt(t: GuideTarget) {
    this.extra = t;
    this.manual = '__extra';
    this.followGoal = false;
    toast(`${t.icon} Follow the arrow to ${t.label}`, 'info', 3000);
    this.app.store.emit();
  }
  private extra: GuideTarget | null = null;

  /** Point at a place until you get there. */
  point(id: string) {
    const t = this.resolve(id);
    if (!t) return;
    this.manual = id;
    this.followGoal = false;
    this.lastDist = Infinity;
    toast(`${t.icon} Follow the arrow to ${t.label}`, 'info', 3000);
    this.app.store.emit();
  }

  stop() {
    this.manual = null;
    this.followGoal = false;
    this.app.store.emit();
  }

  current(): GuideTarget | null {
    // An errand comes first: its place, then back to the NPC (who keeps walking).
    const e = this.app.store.errand;
    if (e) {
      if (e.stage === 'go') return { id: 'errand', label: e.place.name.toUpperCase(), icon: '🧺', x: e.place.x, y: e.place.y };
      const at = this.app.town?.npcs?.posOf(e.npc);
      const T = this.app.map.tileSize;
      if (at) return { id: 'errand', label: e.npcName.toUpperCase(), icon: '🧺', x: at.x / T, y: at.y / T };
    }
    if (this.manual === '__extra') return this.extra;
    if (this.manual) return this.resolve(this.manual);
    return this.followGoal ? this.goalTarget() : null;
  }

  /** Distance (m) from the player to the current goal's place, for the 🎯 card. */
  goalDistance(px: number, py: number): number | null {
    const t = this.goalTarget();
    if (!t) return null;
    const T = this.app.map.tileSize;
    return Math.round(Math.hypot(t.x * T - px, t.y * T - py) / T * this.app.map.metersPerTile);
  }

  /** Called ~7×/s by the town scene (player world px + camera → screen). */
  update(px: number, py: number, screen: { x: number; y: number; zoom: number; cx: number; cy: number }) {
    const job = this.app.store.job;
    const t = job?.kind === 'delivery' || this.app.interior || this.app.home ? null : this.current();
    if (!t) {
      this.arrow.classList.add('hidden');
      this.pin.classList.add('hidden');
      return;
    }
    const T = this.app.map.tileSize;
    const dx = t.x * T - px, dy = t.y * T - py;
    const meters = Math.round((Math.hypot(dx, dy) / T) * this.app.map.metersPerTile);
    // Errands move on by themselves when you get there (the server re-checks).
    if (t.id === 'errand') {
      const tiles = Math.hypot(dx, dy) / T;
      const e = this.app.store.errand!;
      if ((e.stage === 'go' && tiles <= 3) || (e.stage === 'return' && tiles <= this.app.cfg.npcs.talkRadiusTiles)) this.app.progressErrand();
    } else if (meters <= 5) {
      if (this.manual || this.followGoal) toast(`📍 You're at ${t.label}!`, 'good', 2500);
      this.manual = null;
      this.followGoal = false;
      this.arrow.classList.add('hidden');
      this.pin.classList.add('hidden');
      this.app.store.emit();
      return;
    }
    this.lastDist = meters;
    void this.lastDist;
    const sx = screen.cx + dx * screen.zoom, sy = screen.cy + dy * screen.zoom;
    const onScreen = sx > 30 && sy > 90 && sx < innerWidth - 30 && sy < innerHeight - 110;
    this.pin.classList.toggle('hidden', !onScreen);
    if (onScreen) {
      this.pin.style.left = `${sx}px`;
      this.pin.style.top = `${sy - 26}px`;
    }
    // The arrow orbits the player, always visible, with the place and distance.
    const a = Math.atan2(dy, dx);
    const r = Math.min(110, Math.min(innerWidth, innerHeight) * 0.22);
    this.arrow.classList.remove('hidden');
    this.arrow.style.left = `${innerWidth / 2 + Math.cos(a) * r}px`;
    this.arrow.style.top = `${innerHeight / 2 + Math.sin(a) * r}px`;
    (this.arrow.firstChild as HTMLElement).style.transform = `rotate(${a}rad)`;
    this.arrowLabel.textContent = `${t.icon} ${t.label} · ${meters} m`;
  }

  /** A random tip as a toast (shuffled so they don't repeat until all have been shown). */
  hint(force = false) {
    if (!force && (loadPrefs().hints === false || isPanelOpen() || document.body.dataset.state !== 'town')) return;
    const hints = this.app.cfg.guide.hints;
    if (!this.hintOrder.length) this.hintOrder = shuffle(hints.map((_, i) => i));
    const i = this.hintOrder.pop()!;
    toast(`💡 ${hints[i]}`, 'info', 7000);
  }

  destroy() {
    clearInterval(this.hintTimer);
    this.cleanup();
    this.arrow.remove();
    this.pin.remove();
  }
}

export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
