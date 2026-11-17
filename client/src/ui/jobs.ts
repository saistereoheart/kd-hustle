// Jobs Board, the delivery objective HUD and the car wash mini-game.
import { formatMoney, type JobState } from '@kh/shared';
import type { App } from '../app';
import { el, toast, uiRoot } from './dom';
import { closePanel, openPanel } from './panel';
import { sfx } from './sound';

// ------------------------------------------------------------------ Jobs Board
export function openJobsPanel(app: App) {
  const panel = openPanel('📋 Jobs Board', { testId: 'jobs-panel' });
  const j = app.cfg.jobs;
  const render = () => {
    const st = app.store;
    const lvl = (k: string) => st.jobs[k]?.level ?? 1;
    const done = (k: string) => st.jobs[k]?.done ?? 0;
    const mult = (k: string) => 1 + (lvl(k) - 1) * j.payPerLevel;
    const card = (kind: 'delivery' | 'carwash', icon: string, desc: string, pay: string) => {
      const start = el('button', { class: 'btn primary', type: 'button', 'data-job': kind, disabled: !!st.job }, st.job ? 'On a job' : 'Start');
      start.addEventListener('click', () => startJob(app, kind));
      const toNext = j.levelUpEvery - (done(kind) % j.levelUpEvery);
      return el(
        'div',
        { class: 'job-card' },
        el('div', { class: 'job-icon' }, icon),
        el('div', { class: 'job-info' }, el('h4', {}, j[kind].name, el('span', { class: 'lv-badge' }, `Lv ${lvl(kind)}`)), el('p', {}, desc), el('div', { class: 'muted' }, `${pay} · ${done(kind)} done · next level in ${toNext}`)),
        start,
      );
    };
    const dPay = Math.round((j.delivery.baseSen + j.delivery.perMeterSen * 300) * mult('delivery'));
    const cPay = Math.round(j.carwash.baseSen * mult('carwash'));
    const cancel = st.job ? el('button', { class: 'btn danger', type: 'button', 'data-action': 'cancel-job' }, 'Cancel current job') : null;
    cancel?.addEventListener('click', () => cancelJob(app));
    panel.body.replaceChildren(
      card('delivery', '🛵', 'Ride a kapcai to pick up food and deliver it. Fast riders get tips. Roads are quick, grass is slow.', `~${formatMoney(dPay)} + tips per 300 m`),
      card('carwash', '🚿', 'Scrub every dirty spot off the car before time runs out. Spotless and fast pays best.', `up to ${formatMoney(Math.round(cPay * (1 + j.carwash.speedBonus)))}`),
      ...(cancel ? [cancel] : []),
    );
  };
  const off = app.store.on(render);
  panel.onClose = () => off();
  render();
}

function startJob(app: App, kind: 'delivery' | 'carwash') {
  app.socket?.timeout(6000).emit('job:start', { kind }, (err, res) => {
    if (err || !res.ok) {
      sfx.error();
      return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
    }
    sfx.click();
    closePanel();
    app.store.job = res.job;
    app.store.emit();
    if (res.job.kind === 'carwash') playCarwash(app, res.job);
    else toast(`🛵 Ride to ${res.job.pickup.name} to pick up the order!`, 'info', 4000);
  });
}

export function cancelJob(app: App) {
  app.socket?.timeout(5000).emit('job:cancel', (err, res) => {
    if (err || !res.ok) return;
    app.store.job = null;
    app.store.emit();
    toast('Job cancelled.');
  });
}

// ------------------------------------------------------------------ delivery HUD
export class DeliveryHud {
  private root: HTMLElement;
  private title: HTMLElement;
  private meta: HTMLElement;
  private arrow: HTMLElement;
  private pending = false;

  constructor(private app: App) {
    this.title = el('div', { class: 'job-hud-title' });
    this.meta = el('div', { class: 'job-hud-meta' });
    const cancel = el('button', { class: 'btn small', type: 'button', 'data-action': 'cancel-job' }, '✕');
    cancel.addEventListener('click', () => cancelJob(app));
    this.root = el('div', { class: 'job-hud hidden', 'data-testid': 'job-hud' }, el('div', {}, this.title, this.meta), cancel);
    this.arrow = el('div', { class: 'job-arrow hidden' }, '➤');
    uiRoot().append(this.root, this.arrow);
  }

  /** Called ~7×/s by the town scene with the player's position (world px) and screen info. */
  update(px: number, py: number, screen: { x: number; y: number; zoom: number; cx: number; cy: number }) {
    const job = this.app.store.job;
    if (!job || job.kind !== 'delivery') {
      this.root.classList.add('hidden');
      this.arrow.classList.add('hidden');
      return;
    }
    const T = this.app.map.tileSize;
    const target = job.stage === 'pickup' ? job.pickup : job.dropoff;
    const dx = target.x * T - px;
    const dy = target.y * T - py;
    const meters = Math.round((Math.hypot(dx, dy) / T) * this.app.map.metersPerTile);
    this.root.classList.remove('hidden');
    this.title.textContent = job.stage === 'pickup' ? `📦 Pick up at ${target.name}` : `🏠 Deliver to ${target.name}`;
    let timer = '';
    if (job.stage === 'dropoff' && job.deadline) {
      const left = Math.round((job.deadline - Date.now()) / 1000);
      timer = left >= 0 ? ` · ⏱ ${left}s (tip!)` : ` · ⏱ late ${-left}s`;
      this.root.classList.toggle('late', left < 0);
    }
    this.meta.textContent = `${meters} m${timer} · ~${formatMoney(job.baseSen)}`;
    // Arrow at the screen edge pointing at the target when it's off-screen.
    const sx = screen.cx + dx * screen.zoom;
    const sy = screen.cy + dy * screen.zoom;
    const offscreen = sx < 40 || sy < 80 || sx > innerWidth - 40 || sy > innerHeight - 40;
    this.arrow.classList.toggle('hidden', !offscreen);
    if (offscreen) {
      const a = Math.atan2(dy, dx);
      const r = Math.min(innerWidth, innerHeight) * 0.38;
      this.arrow.style.left = `${innerWidth / 2 + Math.cos(a) * r}px`;
      this.arrow.style.top = `${innerHeight / 2 + Math.sin(a) * r}px`;
      this.arrow.style.transform = `translate(-50%, -50%) rotate(${a}rad)`;
    }
    // Arrived? Ask the server to advance (it re-checks the distance).
    const tiles = Math.hypot(dx, dy) / T;
    if (tiles <= this.app.cfg.jobs.delivery.pickupRadiusTiles - 0.5 && !this.pending) this.advance();
  }

  private advance() {
    this.pending = true;
    this.app.socket?.timeout(5000).emit('job:progress', (err, res) => {
      this.pending = false;
      if (err || !res.ok) return;
      this.app.store.job = res.job;
      this.app.store.emit();
      if (res.job) {
        sfx.click();
        toast(`📦 Got it! Now deliver to ${res.job.kind === 'delivery' ? res.job.dropoff.name : ''}`, 'info', 4000);
      } else if (res.paidSen !== undefined) {
        sfx.coin();
        toast(`✅ Delivered! +${formatMoney(res.paidSen)}${res.tipSen ? ` + ${formatMoney(res.tipSen)} tip` : ''}`, 'good', 4500);
        if (res.levelUp) toast(`⬆️ Delivery Rider level ${res.levelUp}! Better pay.`, 'good', 4500);
      }
    });
  }

  destroy() {
    this.root.remove();
    this.arrow.remove();
  }
}

// ------------------------------------------------------------------ car wash mini-game
function drawCar(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#d0ebff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#868e96';
  ctx.fillRect(0, h * 0.84, w, h * 0.16);
  // body
  ctx.fillStyle = '#e03131';
  ctx.beginPath();
  ctx.moveTo(w * 0.06, h * 0.72);
  ctx.lineTo(w * 0.08, h * 0.5);
  ctx.lineTo(w * 0.26, h * 0.44);
  ctx.lineTo(w * 0.36, h * 0.24);
  ctx.lineTo(w * 0.68, h * 0.24);
  ctx.lineTo(w * 0.8, h * 0.44);
  ctx.lineTo(w * 0.94, h * 0.48);
  ctx.lineTo(w * 0.95, h * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#a5d8ff';
  ctx.beginPath();
  ctx.moveTo(w * 0.38, h * 0.28);
  ctx.lineTo(w * 0.5, h * 0.28);
  ctx.lineTo(w * 0.5, h * 0.43);
  ctx.lineTo(w * 0.3, h * 0.43);
  ctx.closePath();
  ctx.moveTo(w * 0.53, h * 0.28);
  ctx.lineTo(w * 0.66, h * 0.28);
  ctx.lineTo(w * 0.76, h * 0.43);
  ctx.lineTo(w * 0.53, h * 0.43);
  ctx.closePath();
  ctx.fill();
  for (const x of [0.24, 0.76]) {
    ctx.fillStyle = '#212529';
    ctx.beginPath();
    ctx.arc(w * x, h * 0.74, h * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#adb5bd';
    ctx.beginPath();
    ctx.arc(w * x, h * 0.74, h * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function playCarwash(app: App, job: Extract<JobState, { kind: 'carwash' }>) {
  const canvas = el('canvas', { class: 'carwash-canvas', 'data-testid': 'carwash' });
  const bar = el('div', { class: 'progress' }, el('i', {}));
  const info = el('div', { class: 'muted' }, 'Scrub (drag) over every brown dirt spot!');
  const box = el('div', { class: 'carwash-box' }, el('h3', {}, '🚿 Car Wash'), bar, canvas, info);
  const host = el('div', { class: 'reveal-overlay carwash' }, box);
  uiRoot().append(host);

  const W = Math.min(innerWidth - 32, 640);
  const H = Math.round(W * 0.55);
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const hits = job.spots.map(() => 0);
  const points: number[] = [];
  const t0 = performance.now();
  const limit = job.timeLimitSec * 1000;
  let last: [number, number] | null = null;
  let lastT = -1000;
  let finished = false;
  const bubbles: Array<{ x: number; y: number; r: number; life: number }> = [];

  const draw = () => {
    drawCar(ctx, W, H);
    job.spots.forEach(([sx, sy], k) => {
      const left = 1 - Math.min(1, hits[k] / job.hitsPerSpot);
      if (left <= 0) return;
      ctx.globalAlpha = 0.25 + left * 0.75;
      ctx.fillStyle = '#7c5a3a';
      const r = job.spotRadius * W * 0.75;
      ctx.beginPath();
      ctx.arc(sx * W, sy * H, r, 0, Math.PI * 2);
      ctx.arc(sx * W + r * 0.5, sy * H - r * 0.3, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    for (const b of bubbles) {
      ctx.strokeStyle = `rgba(255,255,255,${b.life})`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
      b.y -= 0.6;
      b.life -= 0.03;
    }
    for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].life <= 0) bubbles.splice(i, 1);
  };

  const submit = () => {
    if (finished) return;
    finished = true;
    app.socket?.timeout(6000).emit('carwash:submit', { jobId: job.jobId, points }, (err, res) => {
      host.remove();
      app.store.job = null;
      app.store.emit();
      if (err || !res.ok) return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      if (res.paidSen > 0) {
        sfx.coin();
        toast(`🚿 ${Math.round(res.cleaned * 100)}% clean! +${formatMoney(res.paidSen)}`, 'good', 4500);
      } else toast(`🚿 Only ${Math.round(res.cleaned * 100)}% clean. No pay this time.`, 'bad', 4500);
      if (res.levelUp) toast(`⬆️ Car Wash Helper level ${res.levelUp}!`, 'good', 4500);
    });
  };

  const onMove = (e: PointerEvent) => {
    if (finished || !(e.buttons & 1) && e.pointerType === 'mouse') return;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    const t = performance.now() - t0;
    if (t - lastT < 12) return; // ~80 samples/s max
    lastT = t;
    points.push(Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, Math.round(t));
    if (last && Math.hypot(x - last[0], y - last[1]) >= 0.004) {
      job.spots.forEach(([sx, sy], k) => {
        if (Math.hypot(x - sx, y - sy) <= job.spotRadius) {
          hits[k]++;
          if (hits[k] === job.hitsPerSpot) sfx.click();
        }
      });
      if (Math.random() < 0.5) bubbles.push({ x: x * W, y: y * H, r: 3 + Math.random() * 5, life: 1 });
    }
    last = [x, y];
    if (hits.every((h) => h >= job.hitsPerSpot)) submit();
  };
  canvas.addEventListener('pointerdown', (e) => {
    last = null;
    canvas.setPointerCapture?.(e.pointerId);
    onMove(e);
  });
  canvas.addEventListener('pointermove', onMove);

  const loop = () => {
    if (finished) return;
    const t = performance.now() - t0;
    (bar.firstChild as HTMLElement).style.width = `${Math.max(0, 100 - (t / limit) * 100)}%`;
    draw();
    if (t >= limit) submit();
    else requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
