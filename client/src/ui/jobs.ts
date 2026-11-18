// Jobs Board, the delivery objective HUD and the car wash mini-game.
import { formatMoney, type JobState } from '@kh/shared';
import type { App } from '../app';
import { el, toast, uiRoot } from './dom';
import { closePanel, openPanel } from './panel';
import { sfx } from './sound';

// ------------------------------------------------------------------ Jobs Board
type JobKind = 'delivery' | 'carwash';

/** One job's card: level, pay, progress, and a Start button (or where to go instead). */
function jobCard(app: App, kind: JobKind, icon: string, desc: string, pay: string, startHere: boolean) {
  const j = app.cfg.jobs;
  const st = app.store;
  const lvl = st.jobs[kind]?.level ?? 1;
  const done = st.jobs[kind]?.done ?? 0;
  const start = el(
    'button',
    { class: `btn${startHere ? ' primary' : ''}`, type: 'button', 'data-job': kind, disabled: !!st.job },
    st.job ? 'On a job' : startHere ? 'Start' : 'Where?',
  );
  start.addEventListener('click', () => {
    if (startHere) startJob(app, kind);
    else {
      toast('🧽 Car washes happen inside Kilat Car Wash, north-east of the square. Follow the arrow!', 'info', 5000);
      closePanel();
      app.guide?.point('carwash');
    }
  });
  const toNext = j.levelUpEvery - (done % j.levelUpEvery);
  return el(
    'div',
    { class: 'job-card' },
    el('div', { class: 'job-icon' }, icon),
    el('div', { class: 'job-info' }, el('h4', {}, j[kind].name, el('span', { class: 'lv-badge' }, `Lv ${lvl}`)), el('p', {}, desc), el('div', { class: 'muted' }, `${pay} · ${done} done · next level in ${toNext}`)),
    start,
  );
}

const levelMult = (app: App, kind: JobKind) => 1 + ((app.store.jobs[kind]?.level ?? 1) - 1) * app.cfg.jobs.payPerLevel;
const carwashBlurb = 'Three steps: 🧽 soap off the dirt (bird droppings need extra scrubbing), 🚿 rinse the whole car, ✨ buff the shine marks before they fade.';
const carwashPayText = (app: App) =>
  `up to ${formatMoney(Math.round(app.cfg.jobs.carwash.baseSen * levelMult(app, 'carwash') * (1 + app.cfg.jobs.carwash.speedBonus)))}`;

/** `remote`: from the phone (deliveries start anywhere; the car wash is done at Kilat). */
export function openJobsPanel(app: App, opts: { remote?: boolean } = {}) {
  const panel = openPanel(opts.remote ? '📱 Jobs' : '📋 Jobs Board', { testId: 'jobs-panel' });
  remoteJobs = !!opts.remote;
  const j = app.cfg.jobs;
  const render = () => {
    const st = app.store;
    const dPay = Math.round((j.delivery.baseSen + j.delivery.perMeterSen * 300) * levelMult(app, 'delivery'));
    const cancel = st.job ? el('button', { class: 'btn danger', type: 'button', 'data-action': 'cancel-job' }, 'Cancel current job') : null;
    cancel?.addEventListener('click', () => cancelJob(app));
    panel.body.replaceChildren(
      jobCard(app, 'delivery', '🛵', 'Pick up food and deliver it: walk, ride your 🚲 basikal, or order a 🛵 kapcai from your 📱 Phone (P) for faster trips and bigger tips.', `~${formatMoney(dPay)} + tips per 300 m`, true),
      jobCard(app, 'carwash', '🚿', `At Kilat Car Wash${opts.remote ? '' : ' (east of here)'}. ${carwashBlurb}`, carwashPayText(app), false),
      ...(cancel ? [cancel] : []),
    );
  };
  const off = app.store.on(render);
  panel.onClose = () => off();
  render();
}

/** The counter at Kilat Car Wash. */
export function openCarwashPanel(app: App) {
  const panel = openPanel('🚿 Kilat Car Wash', { testId: 'carwash-panel' });
  const render = () => {
    panel.body.replaceChildren(
      jobCard(app, 'carwash', '🚿', carwashBlurb, carwashPayText(app), true),
      el('p', { class: 'hint' }, 'Spotless and fast pays best. Under 30% clean pays nothing.'),
    );
  };
  const off = app.store.on(render);
  panel.onClose = () => off();
  render();
}

/** The jobs panel was opened from the phone (deliveries start anywhere). */
let remoteJobs = false;

function startJob(app: App, kind: JobKind) {
  app.socket?.timeout(6000).emit('job:start', { kind, ...(remoteJobs && kind === 'delivery' ? { remote: true } : {}) }, (err, res) => {
    if (err || !res.ok) {
      sfx.error();
      return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
    }
    sfx.click();
    closePanel();
    app.store.job = res.job;
    app.store.emit();
    if (res.job.kind === 'carwash') playCarwash(app, res.job);
    else toast(`📦 Head to ${res.job.pickup.name} to pick up the order! (Faster: 🚲 key 1, or order a 🛵 from the 📱 Phone.)`, 'info', 5000);
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
function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

function drawCar(ctx: CanvasRenderingContext2D, w: number, h: number, color: string) {
  ctx.clearRect(0, 0, w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#d0ebff');
  sky.addColorStop(1, '#e7f5ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#868e96';
  ctx.fillRect(0, h * 0.84, w, h * 0.16);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  for (let x = 0; x < w; x += w / 8) ctx.fillRect(x, h * 0.9, w / 16, h * 0.02);
  // body
  const body = ctx.createLinearGradient(0, h * 0.24, 0, h * 0.74);
  body.addColorStop(0, shade(color, 1.15));
  body.addColorStop(1, shade(color, 0.8));
  ctx.fillStyle = body;
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
  ctx.strokeStyle = shade(color, 0.55);
  ctx.lineWidth = 2;
  ctx.stroke();
  // windows
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
  // door line, handle, lights
  ctx.strokeStyle = shade(color, 0.6);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(w * 0.515, h * 0.44);
  ctx.lineTo(w * 0.515, h * 0.7);
  ctx.stroke();
  ctx.fillStyle = shade(color, 0.6);
  ctx.fillRect(w * 0.56, h * 0.5, w * 0.04, h * 0.015);
  ctx.fillStyle = '#ffe066';
  ctx.fillRect(w * 0.9, h * 0.52, w * 0.04, h * 0.05);
  ctx.fillStyle = '#ff6b6b';
  ctx.fillRect(w * 0.07, h * 0.53, w * 0.025, h * 0.06);
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

const STAGES = [
  { icon: '🧽', name: 'Soap', tip: 'Scrub every dirty spot (drag back and forth). Bird droppings need extra scrubbing!' },
  { icon: '🚿', name: 'Rinse', tip: 'Hose the foam off: sweep over the whole car until it is gone.' },
  { icon: '✨', name: 'Polish', tip: 'Buff each shine mark before its ring runs out. They appear one by one.' },
] as const;

/**
 * Three-stage car wash. The client records the raw pointer streams per stage and the server
 * grades them (see gradeCarwash on the server); the progress shown here mirrors that grading.
 */
export function playCarwash(app: App, job: Extract<JobState, { kind: 'carwash' }>) {
  const canvas = el('canvas', { class: 'carwash-canvas', 'data-testid': 'carwash' });
  const bar = el('div', { class: 'progress' }, el('i', {}));
  const pills = STAGES.map((s, i) => el('span', { class: `cw-stage${i === 0 ? ' active' : ''}`, 'data-stage': String(i) }, `${s.icon} ${s.name}`));
  const info = el('div', { class: 'muted cw-tip' }, STAGES[0].tip);
  const next = el('button', { class: 'btn small', type: 'button', 'data-action': 'cw-next' }, 'Next step ⏭');
  const box = el('div', { class: 'carwash-box' }, el('h3', {}, '🚿 Kilat Car Wash'), el('div', { class: 'cw-stages' }, ...pills), bar, canvas, el('div', { class: 'cw-foot' }, info, next));
  const host = el('div', { class: 'reveal-overlay carwash' }, box);
  uiRoot().append(host);

  const W = Math.min(innerWidth - 32, 640);
  const H = Math.round(W * 0.55);
  const dpr = Math.min(3, devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const streams: [number[], number[], number[]] = [[], [], []];
  const spotHits = job.spots.map(() => 0);
  const r = job.rinse;
  const cellHits = new Array(r.cols * r.rows).fill(0);
  const p = job.polish;
  const markHits = p.spots.map(() => 0);
  const t0 = performance.now();
  const limit = job.timeLimitSec * 1000;
  let stage = 0;
  let polishStart = -1;
  let lastT = -1000;
  let finished = false;
  const foam: Array<{ x: number; y: number; r: number }> = [];
  const drops: Array<{ x: number; y: number; vx: number; vy: number; life: number }> = [];

  const spotDone = (k: number) => spotHits[k] >= job.spots[k][2];
  const cellDone = (k: number) => cellHits[k] >= r.hitsPerCell;
  const markWindow = (k: number) => [polishStart + k * p.intervalMs, polishStart + k * p.intervalMs + p.windowMs] as const;
  const polishEnd = () => polishStart + (p.spots.length - 1) * p.intervalMs + p.windowMs;

  const setStage = (s: number) => {
    stage = s;
    pills.forEach((pl, i) => {
      pl.classList.toggle('active', i === s);
      pl.classList.toggle('done', i < s);
    });
    info.textContent = STAGES[Math.min(s, 2)].tip;
    if (s === 2) {
      polishStart = Math.round(performance.now() - t0);
      next.textContent = 'Finish ✓';
      if (!p.spots.length) submit();
    }
    sfx.click();
  };

  const draw = (t: number) => {
    drawCar(ctx, W, H, job.color);
    if (stage === 0) {
      job.spots.forEach(([sx, sy, need], k) => {
        const left = 1 - Math.min(1, spotHits[k] / need);
        if (left <= 0) return;
        const rad = job.spotRadius * W * 0.75;
        ctx.globalAlpha = 0.25 + left * 0.75;
        if (need > app.cfg.jobs.carwash.hitsPerSpot) {
          // bird dropping: white splat with a grey-green centre
          ctx.fillStyle = '#f1f3f5';
          ctx.beginPath();
          ctx.arc(sx * W, sy * H, rad * 1.1, 0, Math.PI * 2);
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 + k;
            ctx.moveTo(sx * W + Math.cos(a) * rad * 1.4, sy * H + Math.sin(a) * rad * 1.1);
            ctx.arc(sx * W + Math.cos(a) * rad * 1.3, sy * H + Math.sin(a) * rad * 1.0, rad * 0.32, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.fillStyle = '#868e96';
          ctx.beginPath();
          ctx.arc(sx * W, sy * H, rad * 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = '#7c5a3a';
          ctx.beginPath();
          ctx.arc(sx * W, sy * H, rad, 0, Math.PI * 2);
          ctx.arc(sx * W + rad * 0.5, sy * H - rad * 0.3, rad * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      });
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (const f of foam) {
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (stage === 1) {
      // foam left on each rinse cell
      const [x0, y0, x1, y1] = r.area;
      const cw = ((x1 - x0) * W) / r.cols, ch = ((y1 - y0) * H) / r.rows;
      for (let k = 0; k < cellHits.length; k++) {
        const left = 1 - Math.min(1, cellHits[k] / r.hitsPerCell);
        if (left <= 0) continue;
        const cx = x0 * W + (k % r.cols) * cw, cy = y0 * H + Math.floor(k / r.cols) * ch;
        ctx.fillStyle = `rgba(255,255,255,${0.35 + left * 0.55})`;
        for (let i = 0; i < 5; i++) {
          const ox = ((i * 37 + k * 13) % 100) / 100, oy = ((i * 61 + k * 29) % 100) / 100;
          ctx.beginPath();
          ctx.arc(cx + ox * cw, cy + oy * ch, Math.min(cw, ch) * (0.28 + 0.12 * ((i + k) % 3)), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      // polish: shiny paint + the marks that are showing right now
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(W * 0.38, H * 0.25, W * 0.06, H * 0.45);
      p.spots.forEach(([sx, sy], k) => {
        const [from, to] = markWindow(k);
        const done = markHits[k] >= p.hits;
        if (t < from) return;
        const rad = p.radius * W * 0.7;
        if (done) {
          if (t > to + 600) return;
          ctx.fillStyle = '#fff3bf';
          ctx.font = `${Math.round(rad * 1.6)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('✨', sx * W, sy * H);
          return;
        }
        if (t > to) return; // missed
        const frac = 1 - (t - from) / (to - from);
        ctx.fillStyle = 'rgba(206,212,218,0.85)';
        ctx.beginPath();
        ctx.arc(sx * W, sy * H, rad * (0.6 + 0.4 * (1 - markHits[k] / p.hits)), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fcc419';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(sx * W, sy * H, rad + 6, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
      });
    }
    // water drops (rinse)
    for (const d of drops) {
      ctx.fillStyle = `rgba(116,192,252,${d.life})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      d.x += d.vx;
      d.y += d.vy;
      d.vy += 0.25;
      d.life -= 0.04;
    }
    for (let i = drops.length - 1; i >= 0; i--) if (drops[i].life <= 0) drops.splice(i, 1);
  };

  function submit() {
    if (finished) return;
    finished = true;
    const [soap, rinse, polish] = streams;
    app.socket?.timeout(6000).emit('carwash:submit', { jobId: job.jobId, soap, rinse, polish, polishStartMs: Math.max(0, polishStart) }, (err, res) => {
      host.remove();
      app.store.job = null;
      app.store.emit();
      if (err || !res.ok) return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      const detail = `🧽 ${pct(res.soap)} · 🚿 ${pct(res.rinse)} · ✨ ${pct(res.polish)}`;
      if (res.paidSen > 0) {
        sfx.coin();
        toast(`🚿 ${pct(res.cleaned)} clean (${detail}) +${formatMoney(res.paidSen)}`, 'good', 5000);
      } else toast(`🚿 Only ${pct(res.cleaned)} clean (${detail}). No pay this time.`, 'bad', 5000);
      if (res.levelUp) toast(`⬆️ Car Wash Helper level ${res.levelUp}!`, 'good', 4500);
    });
  }

  next.addEventListener('click', () => {
    if (stage < 2) setStage(stage + 1);
    else submit();
  });

  const onMove = (e: PointerEvent) => {
    if (finished || (!(e.buttons & 1) && e.pointerType === 'mouse')) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const t = performance.now() - t0;
    if (t - lastT < 12) return; // ~80 samples/s max
    lastT = t;
    const s = streams[stage];
    const moved = s.length >= 3 && Math.hypot(x - s[s.length - 3], y - s[s.length - 2]) >= 0.004;
    s.push(Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, Math.round(t));
    if (!moved) return;
    if (stage === 0) {
      job.spots.forEach(([sx, sy], k) => {
        if (Math.hypot(x - sx, y - sy) <= job.spotRadius) {
          spotHits[k]++;
          if (spotHits[k] === job.spots[k][2]) sfx.click();
        }
      });
      if (Math.random() < 0.6 && foam.length < 400) foam.push({ x: x * W + (Math.random() - 0.5) * 10, y: y * H + (Math.random() - 0.5) * 10, r: 3 + Math.random() * 5 });
      if (job.spots.every((_, k) => spotDone(k))) setStage(1);
    } else if (stage === 1) {
      const [x0, y0, x1, y1] = r.area;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        const k = Math.floor(((y - y0) / (y1 - y0)) * r.rows) * r.cols + Math.floor(((x - x0) / (x1 - x0)) * r.cols);
        cellHits[k]++;
      }
      for (let i = 0; i < 3; i++) drops.push({ x: x * W, y: y * H, vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 3, life: 1 });
      if (cellHits.every((_, k) => cellDone(k))) setStage(2);
    } else {
      p.spots.forEach(([sx, sy], k) => {
        const [from, to] = markWindow(k);
        if (t >= from && t <= to && Math.hypot(x - sx, y - sy) <= p.radius) {
          markHits[k]++;
          if (markHits[k] === p.hits) sfx.coin();
        }
      });
    }
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    onMove(e);
  });
  canvas.addEventListener('pointermove', onMove);

  const loop = () => {
    if (finished) return;
    const t = performance.now() - t0;
    (bar.firstChild as HTMLElement).style.width = `${Math.max(0, 100 - (t / limit) * 100)}%`;
    draw(t);
    if (t >= limit || (stage === 2 && t > polishEnd() + 300)) submit();
    else requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

