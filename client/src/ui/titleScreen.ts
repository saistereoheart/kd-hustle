// The start screen, shown on every page load: an animated scene drawn in code (Kota
// Damansara at dusk, a hustler leaning on their car, traffic passing, the city lights coming
// on) behind three options: START GAME, HINTS, SETTINGS.
import { randomAppearance, type Appearance, type PublicConfig } from '@kh/shared';
import { drawCharacter, FRAME_W } from '../character/draw';
import { el, uiRoot } from './dom';
import { openSettings } from './settings';

const LOOK_KEY = 'kh_last_look';

/** Remember the player's look so the start screen shows THEIR character next time. */
export function rememberLook(a: Appearance) {
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(a));
  } catch {
    /* private mode */
  }
}
function lastLook(cfg: PublicConfig): Appearance {
  try {
    const raw = localStorage.getItem(LOOK_KEY);
    if (raw) return JSON.parse(raw) as Appearance;
  } catch {
    /* ignore */
  }
  let s = 7;
  return randomAppearance(cfg.character, () => ((s = (s * 16807) % 2147483647) / 2147483647));
}

export interface TitleOptions {
  /** A line under the title (e.g. "Connection lost"). */
  notice?: string;
  /** Who is logged in (shown under the menu; Settings gets "Log out"). */
  username: string;
  onStart: () => void;
  onLogout: () => void;
}

export function showTitleScreen(cfg: PublicConfig, opts: TitleOptions): { close: () => void } {
  const canvas = el('canvas', { class: 'title-bg' });
  const items: Array<[string, () => void]> = [
    ['START GAME', () => start()],
    ['HINTS', () => showHints(cfg)],
    ['SETTINGS', () => openSettings({ onLogout: opts.onLogout })],
  ];
  let sel = 0;
  const buttons = items.map(([label, fn], i) => {
    const b = el('button', { class: 'title-item', type: 'button', 'data-testid': `title-${label.split(' ')[0].toLowerCase()}` }, label);
    b.addEventListener('click', fn);
    b.addEventListener('mouseenter', () => select(i));
    return b;
  });
  const select = (i: number) => {
    sel = (i + buttons.length) % buttons.length;
    buttons.forEach((b, k) => b.classList.toggle('sel', k === sel));
  };
  select(0);
  const menu = el('nav', { class: 'title-menu' }, ...buttons);
  const logo = el('div', { class: 'title-logo' }, el('div', { class: 'title-name' }, 'KOTA', el('span', {}, 'HUSTLE')), el('div', { class: 'title-tag' }, 'From Budak Baru to Tan Sri · Kota Damansara'));
  const notice = opts.notice ? el('div', { class: 'title-notice' }, opts.notice) : null;
  const credit = el('div', { class: 'title-credit' }, 'Map © OpenStreetMap contributors');
  const who = el('div', { class: 'title-who' }, '👤 ', el('b', {}, opts.username), ' · ');
  const switchBtn = el('button', { class: 'title-switch', type: 'button' }, 'Not you? Log out');
  switchBtn.addEventListener('click', () => opts.onLogout());
  who.append(switchBtn);
  menu.append(who);
  const root = el('div', { class: 'title-screen', 'data-testid': 'title-screen' }, canvas, logo, ...(notice ? [notice] : []), menu, credit);
  uiRoot().append(root);
  document.body.dataset.state = 'title';

  const onKey = (e: KeyboardEvent) => {
    if (document.querySelector('.modal-backdrop, .title-hints')) return;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') select(sel + 1);
    else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') select(sel - 1);
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      items[sel][1]();
    }
  };
  window.addEventListener('keydown', onKey);

  const scene = new TitleScene(canvas, lastLook(cfg), cfg);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    scene.stop();
    window.removeEventListener('keydown', onKey);
    root.classList.add('leaving');
    setTimeout(() => root.remove(), 350);
  };
  const start = () => {
    close();
    opts.onStart();
  };
  return { close };
}

function showHints(cfg: PublicConfig) {
  const g = cfg.guide;
  const close = el('button', { class: 'btn', type: 'button' }, 'Back');
  const box = el(
    'div',
    { class: 'title-hints', role: 'dialog' },
    el('h2', {}, '📘 How to play'),
    ...g.handbook.map((c) => el('section', {}, el('h3', {}, `${c.icon} ${c.title}`), el('ol', {}, ...c.steps.map((s) => el('li', {}, s))))),
    el('h3', {}, '💡 Tips'),
    el('ul', {}, ...g.hints.map((h) => el('li', {}, h))),
    close,
  );
  const back = el('div', { class: 'modal-backdrop title-hints-back' }, box);
  const dismiss = () => {
    back.remove();
    window.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismiss();
  window.addEventListener('keydown', onKey);
  close.addEventListener('click', dismiss);
  back.addEventListener('click', (e) => e.target === back && dismiss());
  uiRoot().append(back);
}

/** The animated dusk scene on its own (behind the login screen). */
export function titleBackdrop(cfg: PublicConfig): { canvas: HTMLCanvasElement; stop: () => void } {
  const canvas = el('canvas', { class: 'title-bg' });
  const scene = new TitleScene(canvas, lastLook(cfg), cfg);
  return { canvas, stop: () => scene.stop() };
}

// ------------------------------------------------------------------ the animated scene
interface Car {
  x: number;
  lane: number;
  speed: number;
  color: string;
}

class TitleScene {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private t0 = performance.now();
  private cars: Car[] = [];
  private stars: Array<[number, number, number]> = [];
  private towers: Array<{ x: number; w: number; h: number; c: string; seed: number }> = [];
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  private blinkAt = 0;

  constructor(private canvas: HTMLCanvasElement, private look: Appearance, private cfg: PublicConfig) {
    this.ctx = canvas.getContext('2d')!;
    let s = 11;
    const r = () => ((s = (s * 48271) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) this.stars.push([r(), r() * 0.45, r()]);
    const cols = ['#2b2f4a', '#30365a', '#272b44', '#353b63', '#2d3352'];
    for (let x = -0.02; x < 1.05; ) {
      const w = 0.04 + r() * 0.07;
      this.towers.push({ x, w, h: 0.18 + r() * 0.38, c: cols[Math.floor(r() * cols.length)], seed: Math.floor(r() * 1e6) });
      x += w + 0.004;
    }
    const carCols = ['#e03131', '#1c7ed6', '#f1f3f5', '#f59f00', '#2f9e44', '#ae3ec9'];
    for (let i = 0; i < 5; i++) this.cars.push({ x: r(), lane: i % 2, speed: (0.05 + r() * 0.06) * (i % 2 ? -1 : 1), color: carCols[i % carCols.length] });
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  private frame(now: number) {
    this.raf = requestAnimationFrame(this.frame);
    const c = this.canvas;
    const w = Math.round(innerWidth * this.dpr), h = Math.round(innerHeight * this.dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const t = (now - this.t0) / 1000;
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    // Dusk sliding into night and back, very slowly.
    const dusk = 0.5 + 0.5 * Math.sin(t / 18);
    const sky = g.createLinearGradient(0, 0, 0, h * 0.7);
    sky.addColorStop(0, mix('#141a3a', '#2a1e5c', dusk));
    sky.addColorStop(0.55, mix('#3b2a6b', '#d9480f', dusk * 0.85));
    sky.addColorStop(1, mix('#4c3a7a', '#ffa94d', dusk));
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    // sun / moon
    g.fillStyle = `rgba(255, 214, 140, ${0.35 + dusk * 0.5})`;
    g.beginPath();
    g.arc(w * 0.78, h * (0.42 - dusk * 0.08), h * 0.07, 0, Math.PI * 2);
    g.fill();
    // stars
    for (const [sx, sy, ph] of this.stars) {
      g.fillStyle = `rgba(255,255,255,${(1 - dusk) * (0.4 + 0.6 * Math.abs(Math.sin(t * 1.3 + ph * 9)))})`;
      g.fillRect(sx * w, sy * h, 2 * this.dpr, 2 * this.dpr);
    }
    // skyline with windows lighting up as it gets dark (portrait: the road sits higher, so
    // the hero stands clear of the menu at the bottom)
    const portrait = h > w;
    const ground = h * (portrait ? 0.5 : 0.7);
    for (const b of this.towers) {
      const x = b.x * w, bw = b.w * w, bh = b.h * h;
      g.fillStyle = b.c;
      g.fillRect(x, ground - bh, bw, bh);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(x, ground - bh, bw * 0.18, bh);
      let s = b.seed;
      const cell = 9 * this.dpr;
      for (let yy = ground - bh + cell; yy < ground - cell; yy += cell * 1.6)
        for (let xx = x + cell * 0.6; xx < x + bw - cell; xx += cell * 1.4) {
          s = (s * 16807) % 2147483647;
          const lit = (s % 100) / 100 < 0.25 + (1 - dusk) * 0.45 + 0.08 * Math.sin(t * 0.5 + s);
          if (!lit) continue;
          g.fillStyle = (s % 7) === 0 ? 'rgba(165,216,255,0.85)' : 'rgba(255,224,130,0.8)';
          g.fillRect(xx, yy, cell * 0.6, cell * 0.8);
        }
    }
    // road with lane marks, kerb, streetlights
    g.fillStyle = '#3a3d45';
    g.fillRect(0, ground, w, h * 0.16);
    g.fillStyle = '#d6cfc0';
    g.fillRect(0, ground + h * 0.16, w, h);
    g.fillStyle = '#a19c90';
    g.fillRect(0, ground + h * 0.16, w, 5 * this.dpr);
    g.fillStyle = 'rgba(255,255,255,0.7)';
    const dash = 40 * this.dpr;
    for (let x = -((t * 60 * this.dpr) % (dash * 2)); x < w; x += dash * 2) g.fillRect(x, ground + h * 0.08 - 2 * this.dpr, dash, 4 * this.dpr);
    for (let x = w * 0.08; x < w; x += w * 0.28) {
      g.fillStyle = '#495057';
      g.fillRect(x, ground + h * 0.16 - h * 0.28, 5 * this.dpr, h * 0.28);
      g.fillRect(x, ground + h * 0.16 - h * 0.28, 40 * this.dpr, 5 * this.dpr);
      const glow = 1 - dusk * 0.7;
      const rg = g.createRadialGradient(x + 38 * this.dpr, ground - h * 0.1, 2, x + 38 * this.dpr, ground - h * 0.1, h * 0.22);
      rg.addColorStop(0, `rgba(255,236,170,${0.45 * glow})`);
      rg.addColorStop(1, 'rgba(255,236,170,0)');
      g.fillStyle = rg;
      g.fillRect(x - h * 0.2, ground - h * 0.32, h * 0.5, h * 0.5);
    }
    // traffic
    const dt = 1 / 60;
    for (const car of this.cars) {
      car.x += car.speed * dt;
      if (car.x > 1.15) car.x = -0.15;
      if (car.x < -0.15) car.x = 1.15;
      this.drawSideCar(car.x * w, ground + h * (car.lane ? 0.05 : 0.115), h * 0.07, car.color, car.speed < 0, true);
    }
    // the hero: a parked car on the pavement and our hustler leaning on it
    // Character ~24% of the screen height (feet to hair), the car about 2.4× as long.
    const charH = Math.min(h * (portrait ? 0.2 : 0.26), w * (portrait ? 0.42 : 0.3));
    const s = charH / 64;
    const cx = portrait ? w * 0.3 : w * 0.16, base = ground + h * (portrait ? 0.2 : 0.25);
    const scale = s / 4;
    this.drawSideCar(cx + 30 * s, base - 1 * s, 66 * s, '#e8590c', false, false, t);
    this.drawHustler(cx - 4 * s, base + 2 * s, s, t);
    // drifting RM sparkles
    for (let i = 0; i < 6; i++) {
      const p = ((t * 0.08 + i / 6) % 1);
      g.globalAlpha = Math.sin(p * Math.PI) * 0.8;
      g.fillStyle = '#ffe066';
      g.font = `900 ${Math.round(16 * this.dpr)}px system-ui, sans-serif`;
      g.fillText('RM', cx - 120 * scale + i * 50 * scale, base - 120 * scale - p * 160 * scale);
    }
    g.globalAlpha = 1;
  }

  /** A side-view hatchback, bottom-centre at (x, y), `len` px long. */
  private drawSideCar(x: number, y: number, len: number, color: string, flip: boolean, small: boolean, t = 0) {
    const g = this.ctx;
    g.save();
    g.translate(x, y);
    if (flip) g.scale(-1, 1);
    const L = len, H = len * 0.36;
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(0, 0, L * 0.55, H * 0.12, 0, 0, Math.PI * 2);
    g.fill();
    // body
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(-L / 2, -H * 0.22);
    g.lineTo(-L / 2, -H * 0.62);
    g.quadraticCurveTo(-L * 0.45, -H * 0.72, -L * 0.3, -H * 0.72);
    g.lineTo(-L * 0.16, -H * 1.08);
    g.quadraticCurveTo(-L * 0.1, -H * 1.16, L * 0.12, -H * 1.12);
    g.lineTo(L * 0.3, -H * 0.74);
    g.quadraticCurveTo(L * 0.5, -H * 0.7, L * 0.5, -H * 0.45);
    g.lineTo(L * 0.5, -H * 0.22);
    g.closePath();
    g.fill();
    // shading + shine
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(-L / 2, -H * 0.4, L, H * 0.18);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(-L * 0.42, -H * 0.66, L * 0.75, H * 0.05);
    // windows
    g.fillStyle = small ? 'rgba(30,40,60,0.8)' : 'rgba(165,216,255,0.9)';
    g.beginPath();
    g.moveTo(-L * 0.27, -H * 0.76);
    g.lineTo(-L * 0.15, -H * 1.03);
    g.lineTo(L * 0.1, -H * 1.04);
    g.lineTo(L * 0.25, -H * 0.76);
    g.closePath();
    g.fill();
    g.fillStyle = color;
    g.fillRect(-L * 0.03, -H * 1.05, L * 0.03, H * 0.3);
    // lights
    g.fillStyle = '#fff3bf';
    g.fillRect(L * 0.46, -H * 0.58, L * 0.04, H * 0.1);
    g.fillStyle = '#ff6b6b';
    g.fillRect(-L * 0.5, -H * 0.58, L * 0.03, H * 0.12);
    if (!small) {
      // headlight beam flickers on at night
      g.fillStyle = `rgba(255, 243, 191, ${0.08 + 0.05 * Math.sin(t * 2)})`;
      g.beginPath();
      g.moveTo(L * 0.5, -H * 0.55);
      g.lineTo(L * 1.2, -H * 0.9);
      g.lineTo(L * 1.2, -H * 0.05);
      g.closePath();
      g.fill();
    }
    // wheels
    for (const wx of [-L * 0.3, L * 0.3]) {
      g.fillStyle = '#212529';
      g.beginPath();
      g.arc(wx, -H * 0.18, H * 0.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#adb5bd';
      g.beginPath();
      g.arc(wx, -H * 0.18, H * 0.09, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  /** The player's own character, leaning back on the car: arms crossed, breathing, blinking. */
  private drawHustler(x: number, feetY: number, scale: number, t: number) {
    const g = this.ctx;
    if (t > this.blinkAt + 3.5) this.blinkAt = t + Math.random() * 2;
    const blinking = t > this.blinkAt && t < this.blinkAt + 0.14;
    g.save();
    g.translate(x, feetY);
    g.scale(scale, scale);
    g.translate(-FRAME_W / 2, -68);
    // lean back towards the car (rotate around the feet)
    g.translate(FRAME_W / 2, 68);
    g.rotate(0.12);
    g.translate(-FRAME_W / 2, -68);
    drawCharacter(g, this.look, this.cfg.character, {
      view: 'front', armL: 0.5, armR: 0.5, bendL: -1.9, bendR: -1.9, legR: 0.35, tilt: -0.04,
      bob: Math.sin(t * 2.2) > 0 ? 0.4 : 0, mouth: 'smile', ...(blinking ? { eyes: 'closed' as const } : {}),
    });
    g.restore();
  }
}

function mix(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
