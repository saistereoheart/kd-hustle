// 🏍️ The dashboard while you ride a showroom car or bike: a big rev counter (with the redline in
// red and a shift light), the speed in km/h, the gear, and buttons for manual gears (▲ ▼) and
// automatic / manual. Bottom right; above the E button on touch screens.
import { el, uiRoot } from './dom';

export interface DashData {
  kmh: number;
  rpm: number;
  idle: number;
  redline: number;
  gear: number;
  gears: number;
  auto: boolean;
  limiter: boolean;
  /** Share of the redline where it's time to shift up (the shift light). */
  shiftAt: number;
  name: string;
}

export interface DashActions {
  up: () => void;
  down: () => void;
  toggle: () => void;
}

let root: HTMLElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let modeBtn: HTMLButtonElement | null = null;
let actions: DashActions | null = null;
let last = '';
let lastDraw = 0;

function build() {
  canvas = el('canvas', { class: 'dash-canvas', 'aria-label': 'Speed and revs' }) as HTMLCanvasElement;
  const btn = (label: string, title: string, fn: () => void, cls = '') => {
    const b = el('button', { class: `dash-btn ${cls}`, type: 'button', title }) as HTMLButtonElement;
    b.textContent = label;
    // pointerdown: instant on touch, and doesn't steal the joystick.
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
    return b;
  };
  modeBtn = btn('A', 'Automatic / manual (G)', () => actions?.toggle(), 'mode');
  root = el(
    'div',
    { class: 'dash', 'data-testid': 'dashboard' },
    canvas,
    el('div', { class: 'dash-btns' }, btn('▲', 'Shift up (R)', () => actions?.up()), modeBtn, btn('▼', 'Shift down (F)', () => actions?.down())),
  );
  uiRoot().append(root);
}

/** A rounded rectangle path (ctx.roundRect is missing on older phones). */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function draw(d: DashData) {
  if (!canvas) return;
  const cssW = canvas.clientWidth || 280;
  const cssH = canvas.clientHeight || 180;
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const W = cssW, H = cssH;
  const cx = W * 0.42, cy = H * 0.6, R = Math.min(W * 0.38, H * 0.52);
  const maxRpm = Math.ceil((d.redline + 500) / 1000) * 1000;
  const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2; // 252° sweep, gap at the bottom
  const ang = (rpm: number) => a0 + (a1 - a0) * Math.max(0, Math.min(1, rpm / maxRpm));
  // Face
  const face = ctx.createRadialGradient(cx, cy - R * 0.2, R * 0.1, cx, cy, R * 1.1);
  face.addColorStop(0, '#2b2f45');
  face.addColorStop(1, '#0d0f19');
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.stroke();
  // Redline zone
  ctx.lineWidth = R * 0.1;
  ctx.strokeStyle = '#e03131';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.88, ang(d.redline), a1);
  ctx.stroke();
  // Lit arc up to the revs
  const hot = d.rpm >= d.redline * d.shiftAt;
  ctx.strokeStyle = hot ? '#ffa94d' : '#4dabf7';
  ctx.lineWidth = R * 0.06;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.74, a0, ang(d.rpm));
  ctx.stroke();
  // Ticks + numbers (thousands)
  ctx.fillStyle = '#e9ecef';
  ctx.font = `700 ${Math.round(R * 0.15)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = maxRpm > 12000 ? 2000 : 1000;
  for (let r = 0; r <= maxRpm; r += 500) {
    const a = ang(r);
    const major = r % step === 0;
    ctx.strokeStyle = r >= d.redline ? '#ff8787' : 'rgba(255,255,255,0.8)';
    ctx.lineWidth = major ? 2.2 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * (major ? 0.82 : 0.88), cy + Math.sin(a) * R * (major ? 0.82 : 0.88));
    ctx.lineTo(cx + Math.cos(a) * R * 0.95, cy + Math.sin(a) * R * 0.95);
    ctx.stroke();
    if (major) ctx.fillText(String(r / 1000), cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62);
  }
  ctx.font = `600 ${Math.round(R * 0.11)}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('×1000 rpm', cx, cy + R * 0.32);
  // Needle
  const na = ang(d.rpm);
  ctx.strokeStyle = '#ff6b6b';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(na) * R * 0.12, cy - Math.sin(na) * R * 0.12);
  ctx.lineTo(cx + Math.cos(na) * R * 0.9, cy + Math.sin(na) * R * 0.9);
  ctx.stroke();
  ctx.fillStyle = '#343a40';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.09, 0, Math.PI * 2);
  ctx.fill();
  // Speed (big)
  ctx.fillStyle = '#fff';
  ctx.font = `900 ${Math.round(R * 0.42)}px system-ui, sans-serif`;
  ctx.fillText(String(Math.round(d.kmh)), cx, cy + R * 0.62);
  ctx.font = `700 ${Math.round(R * 0.12)}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('km/h', cx, cy + R * 0.86);
  // Gear (right) + shift light
  const gx = W * 0.86, gy = H * 0.44, gw = W * 0.2, gh = H * 0.42;
  const blink = Date.now() % 160 < 80;
  ctx.fillStyle = d.limiter && blink ? '#e03131' : hot ? '#e8590c' : '#11131f';
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  roundRect(ctx, gx - gw / 2, gy - gh / 2, gw, gh, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffd43b';
  ctx.font = `900 ${Math.round(gh * 0.62)}px system-ui, sans-serif`;
  ctx.fillText(d.kmh < 1 && d.gear === 0 && d.auto ? 'N' : String(d.gear + 1), gx, gy + gh * 0.04);
  ctx.font = `800 ${Math.round(gh * 0.16)}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(d.auto ? 'AUTO' : 'MANUAL', gx, gy + gh * 0.66);
  // Shift lights (5 dots that fill near the shift point)
  const lights = 5;
  for (let i = 0; i < lights; i++) {
    const on = d.rpm >= d.redline * (d.shiftAt - 0.25 + (0.25 * (i + 1)) / lights);
    ctx.fillStyle = on ? (i < 3 ? '#40c057' : i < 4 ? '#fab005' : '#fa5252') : 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(gx - gw / 2 + (gw / (lights + 1)) * (i + 1), gy - gh / 2 - 10, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Name
  ctx.font = `700 ${Math.round(Math.max(10, R * 0.1))}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.textAlign = 'right';
  ctx.fillText(d.name, W - 6, H - 8);
}

export const dashboard = {
  show(d: DashData, a: DashActions) {
    actions = a;
    if (!root) build();
    root!.classList.remove('hidden');
    if (modeBtn) {
      modeBtn.textContent = d.auto ? 'A' : 'M';
      modeBtn.classList.toggle('manual', !d.auto);
    }
    // Redraw at most ~30 times a second, and only when something changed.
    const now = performance.now();
    const key = `${Math.round(d.kmh)}|${Math.round(d.rpm / 50)}|${d.gear}|${d.auto}|${d.limiter}|${d.limiter ? Math.floor(Date.now() / 80) : 0}`;
    if (key === last || now - lastDraw < 33) return;
    last = key;
    lastDraw = now;
    try {
      draw(d);
    } catch {
      /* never let the dashboard break the game loop */
    }
  },
  hide() {
    if (root && !root.classList.contains('hidden')) root.classList.add('hidden');
    last = '';
  },
};
