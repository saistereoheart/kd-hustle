// Cooking a dish (spec §8.2): the steps the server built, played one after another on a canvas.
// We record raw inputs (press/release times, taps, pointer paths) relative to each step's start
// and send them all at the end; the server grades them. The "PERFECT!" popups here use the same
// shared grader, so what you see matches what you're paid for.
import { gradeStep, meterLevel, type DishState, type Grade, type RecipesConfig, type StepInput, type StepParams } from '@kh/shared';
import { el, uiRoot } from '../dom';
import { sfx } from '../sound';

const GRADE_TEXT: Record<Grade, string> = { perfect: 'PERFECT!', great: 'GREAT!', good: 'GOOD', miss: 'MISS' };
const GRADE_COLOR: Record<Grade, string> = { perfect: '#ffd43b', great: '#69db7c', good: '#74c0fc', miss: '#ff6b6b' };

/** Plays a dish. Resolves with the inputs to send (or null if the player gave up). */
export function playDish(recipes: RecipesConfig, dish: DishState, title: string, onCancel: () => void): Promise<StepInput[] | null> {
  return new Promise((resolve) => {
    const W = Math.min(innerWidth - 28, 520);
    const H = Math.round(Math.min(W * 0.72, innerHeight * 0.48));
    const dpr = Math.min(3, devicePixelRatio || 1);
    const canvas = el('canvas', { class: 'cook-canvas', 'data-testid': 'cook-canvas' });
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const stepPills = dish.steps.map((s, i) => el('span', { class: `cw-stage${i === 0 ? ' active' : ''}`, 'data-step': String(i) }, `${i + 1}. ${s.label}`));
    const label = el('div', { class: 'cook-label' });
    const hint = el('div', { class: 'muted cook-hint' });
    const action = el('button', { class: 'btn primary cook-action', type: 'button', 'data-action': 'cook-action' });
    const options = el('div', { class: 'cook-options' });
    const quit = el('button', { class: 'btn small', type: 'button', 'data-action': 'cook-quit' }, 'Give up');
    const box = el(
      'div',
      { class: 'carwash-box cook-box' },
      el('h3', {}, title, dish.blogger ? el('span', { class: 'lv-badge blogger' }, '📸 Food blogger!') : null),
      el('div', { class: 'cw-stages' }, ...stepPills),
      label,
      hint,
      canvas,
      options,
      el('div', { class: 'cw-foot' }, action, quit),
    );
    const host = el('div', { class: 'reveal-overlay cook', 'data-testid': 'cook' }, box);
    uiRoot().append(host);

    const t0 = performance.now();
    const inputs: StepInput[] = [];
    let idx = -1;
    let raf = 0;
    let stepStart = 0;
    let ev: number[] = [];
    let holding = false;
    let finishedStep = false;
    /** Undo per-step listeners (the path drag). */
    let stepCleanup: Array<() => void> = [];
    const cleanup: Array<() => void> = [];
    const now = () => performance.now() - stepStart;

    const done = (result: StepInput[] | null) => {
      cancelAnimationFrame(raf);
      for (const c of [...stepCleanup, ...cleanup]) c();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      host.remove();
      resolve(result);
    };
    quit.addEventListener('click', () => {
      onCancel();
      done(null);
    });

    // Keyboard: Space = the action button; 1–4 = sequence options.
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space') {
        e.preventDefault();
        press();
      } else if (/^Digit[1-9]$/.test(e.code)) {
        const b = options.querySelectorAll('button')[Number(e.code.slice(5)) - 1] as HTMLButtonElement | undefined;
        b?.click();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') release();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    action.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      press();
    });
    action.addEventListener('pointerup', () => release());
    action.addEventListener('pointerleave', () => release());

    const step = () => dish.steps[idx];
    function press() {
      const s = step();
      if (!s || finishedStep) return;
      const t = now();
      if (s.kind === 'hold') {
        if (!ev.length) {
          ev = [t];
          holding = true;
        }
      } else if (s.kind === 'timing') {
        if (!ev.length) {
          ev = [t];
          finish();
        }
      } else if (s.kind === 'rhythm') {
        ev.push(t);
        sfx.tick();
      } else if (s.kind === 'meter') {
        if (!holding) {
          ev.push(t);
          holding = true;
        }
      }
    }
    function release() {
      const s = step();
      if (!s || !holding) return;
      holding = false;
      const t = now();
      if (s.kind === 'hold' && ev.length === 1) {
        ev.push(t);
        finish();
      } else if (s.kind === 'meter') ev.push(t);
    }

    /** End the current step: show its grade, then move on. */
    function finish() {
      if (finishedStep) return;
      finishedStep = true;
      const s = step();
      if (s.kind === 'meter' && holding) {
        ev.push(Math.min(now(), s.durationMs));
        holding = false;
      }
      inputs.push({ startMs: Math.round(stepStart - t0), ev: ev.map((v) => Math.round(v * 1000) / 1000) });
      const g = gradeStep(recipes, s, ev, dish.windowMult).grade;
      stepPills[idx].classList.remove('active');
      stepPills[idx].classList.add('done', `g-${g}`);
      sfx.reveal(g === 'perfect' ? 3 : g === 'great' ? 2 : g === 'good' ? 1 : 0);
      const pop = el('div', { class: 'cook-grade' }, GRADE_TEXT[g]);
      pop.style.color = GRADE_COLOR[g];
      box.append(pop);
      setTimeout(() => {
        pop.remove();
        next();
      }, 650);
    }

    function next() {
      for (const c of stepCleanup) c();
      stepCleanup = [];
      idx++;
      if (idx >= dish.steps.length) return done(inputs);
      const s = step();
      stepPills[idx].classList.add('active');
      label.textContent = s.label;
      hint.textContent = s.hint;
      ev = [];
      holding = false;
      finishedStep = false;
      stepStart = performance.now();
      options.replaceChildren();
      action.classList.toggle('hidden', s.kind === 'sequence' || s.kind === 'path');
      action.textContent = s.kind === 'hold' ? 'Hold' : s.kind === 'timing' ? 'Now!' : s.kind === 'rhythm' ? 'Tap!' : 'Hold to pour';
      if (s.kind === 'sequence') setupSequence(s);
      if (s.kind === 'path') setupPath(s);
    }

    // ---------------------------------------------------------------- sequence
    function setupSequence(s: Extract<StepParams, { kind: 'sequence' }>) {
      s.options.forEach((o, i) => {
        const b = el('button', { class: 'btn cook-opt', type: 'button', 'data-opt': o.id }, el('span', { class: 'cook-opt-icon' }, o.icon), `${i + 1}. ${o.name}`);
        b.addEventListener('click', () => {
          if (finishedStep) return;
          ev.push(i, now());
          sfx.click();
          if (ev.length / 2 >= s.order.length) finish();
        });
        options.append(b);
      });
    }

    // ---------------------------------------------------------------- path (drag through dots)
    let passed = 0;
    let trail: Array<[number, number]> = [];
    function setupPath(s: Extract<StepParams, { kind: 'path' }>) {
      passed = 0;
      trail = [];
      let down = false;
      let last = 0;
      const pos = (e: PointerEvent): [number, number] => {
        const r = canvas.getBoundingClientRect();
        return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
      };
      const move = (e: PointerEvent) => {
        if (!down || finishedStep) return;
        const t = now();
        if (t - last < 8) return;
        last = t;
        const [x, y] = pos(e);
        ev.push(Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, t);
        trail.push([x, y]);
        const [px, py] = s.points[passed] ?? [9, 9];
        if (Math.hypot(x - px, y - py) <= s.radius * dish.windowMult) {
          passed++;
          sfx.tick();
          if (passed >= s.points.length) finish();
        }
      };
      const start = (e: PointerEvent) => {
        down = true;
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic or already-released pointer */
        }
        move(e);
      };
      const end = () => (down = false);
      canvas.addEventListener('pointerdown', start);
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', end);
      stepCleanup.push(() => {
        canvas.removeEventListener('pointerdown', start);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', end);
      });
    }
    // Hold/timing/rhythm/meter can also be played by touching the canvas itself.
    const cDown = (e: PointerEvent) => {
      const s = step();
      if (s && s.kind !== 'path' && s.kind !== 'sequence') {
        e.preventDefault();
        press();
      }
    };
    const cUp = () => release();
    canvas.addEventListener('pointerdown', cDown);
    canvas.addEventListener('pointerup', cUp);

    // ---------------------------------------------------------------- drawing + timeouts
    const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));
    const mix = (c1: [number, number, number], c2: [number, number, number], t: number) => `rgb(${c1.map((v, i) => Math.round(lerp(v, c2[i], t))).join(',')})`;

    function draw() {
      raf = requestAnimationFrame(draw);
      const s = step();
      if (!s) return;
      const t = now();
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#2b2f45');
      bg.addColorStop(1, '#1b1e2e');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (s.kind === 'hold') {
        const v = ev.length ? ((holding ? t : ev[1]) - ev[0]) / s.fillMs : 0;
        // A plate with a mound of rice that grows while you hold.
        ctx.fillStyle = '#e9ecef';
        ctx.beginPath();
        ctx.ellipse(cx - 30, cy + H * 0.22, W * 0.28, H * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        const r = Math.min(1.2, v) * H * 0.28;
        ctx.beginPath();
        ctx.ellipse(cx - 30, cy + H * 0.2, r * 1.3, r, 0, Math.PI, 0);
        ctx.fill();
        meter(W - 50, H * 0.1, 26, H * 0.8, Math.min(1.2, v) / 1.2, [s.zone[0] / 1.2, s.zone[1] / 1.2]);
        if (!ev.length && t > s.maxMs) finish();
        if (holding && v > 2.2) release();
      } else if (s.kind === 'timing') {
        const p = t / s.targetMs; // 1 = exactly right
        const raw: [number, number, number] = s.art === 'tea' ? [240, 220, 180] : [250, 250, 245];
        const gold: [number, number, number] = s.art === 'tea' ? [196, 120, 40] : [242, 178, 60];
        const burnt: [number, number, number] = [70, 40, 20];
        const col = p <= 1 ? mix(raw, gold, p) : mix(gold, burnt, (p - 1) * 2);
        if (s.art === 'tea') {
          ctx.fillStyle = '#dee2e6';
          ctx.fillRect(cx - 50, cy - 55, 100, 120);
          ctx.fillStyle = col;
          ctx.fillRect(cx - 44, cy - 35, 88, 94);
        } else {
          // A pan with an egg / roti that browns from the edges.
          ctx.fillStyle = '#343a40';
          ctx.beginPath();
          ctx.arc(cx, cy, H * 0.36, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(cx, cy, H * 0.27, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = s.art === 'egg' ? '#ffd43b' : mix([255, 240, 200], [230, 170, 90], p);
          ctx.beginPath();
          ctx.arc(cx, cy, H * (s.art === 'egg' ? 0.1 : 0.2), 0, Math.PI * 2);
          ctx.fill();
        }
        // The colour gauge: the marker moves; the notch is the perfect moment.
        const gx = W * 0.12, gw = W * 0.76, gy = H - 26;
        const grad = ctx.createLinearGradient(gx, 0, gx + gw, 0);
        grad.addColorStop(0, mix(raw, raw, 0));
        grad.addColorStop(0.5, mix(gold, gold, 0));
        grad.addColorStop(1, mix(burnt, burnt, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(gx, gy, gw, 10);
        ctx.fillStyle = '#69db7c';
        ctx.fillRect(gx + gw * 0.5 - 2, gy - 6, 4, 22);
        ctx.fillStyle = '#fff';
        const mx = gx + gw * Math.min(1, p / 2);
        ctx.beginPath();
        ctx.moveTo(mx, gy - 4);
        ctx.lineTo(mx - 7, gy - 14);
        ctx.lineTo(mx + 7, gy - 14);
        ctx.fill();
        if (!ev.length && t > s.maxMs) finish();
      } else if (s.kind === 'rhythm') {
        // Rings close in on the target; tap when a ring meets it.
        const tx = cx, ty = cy;
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(tx, ty, 34, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = '34px system-ui';
        ctx.fillText(s.art === 'pull' ? '🫖' : '🫓', tx, ty + 2);
        for (const b of s.beats) {
          const dt = b - t;
          if (dt < -150 || dt > 1400) continue;
          const r = 34 + Math.max(0, dt) * 0.09;
          ctx.strokeStyle = dt < 0 ? 'rgba(255,107,107,0.6)' : '#ffd43b';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(tx, ty, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.font = 'bold 14px system-ui';
        ctx.fillStyle = '#adb5bd';
        ctx.fillText(`${Math.min(ev.length, s.beats.length)} / ${s.beats.length}`, tx, H - 18);
        if (t > s.beats[s.beats.length - 1] + 600) finish();
      } else if (s.kind === 'sequence') {
        ctx.font = 'bold 16px system-ui';
        ctx.fillStyle = '#fff';
        ctx.fillText('The customer wants:', cx, 26);
        const picks: string[] = [];
        for (let i = 0; i < ev.length; i += 2) picks.push(s.options[ev[i]]?.id ?? '?');
        s.order.forEach((id, i) => {
          const o = s.options.find((x) => x.id === id)!;
          const x = cx + (i - (s.order.length - 1) / 2) * 100;
          ctx.fillStyle = picks[i] === undefined ? 'rgba(255,255,255,0.1)' : picks[i] === id ? 'rgba(105,219,124,0.35)' : 'rgba(255,107,107,0.35)';
          ctx.fillRect(x - 42, cy - 40, 84, 80);
          ctx.font = '34px system-ui';
          ctx.fillText(o.icon, x, cy - 6);
          ctx.font = 'bold 12px system-ui';
          ctx.fillStyle = '#fff';
          ctx.fillText(`${i + 1}. ${o.name}`, x, cy + 28);
        });
        if (t > s.maxMs) finish();
      } else if (s.kind === 'path') {
        // A leaf / plate with numbered dots; your trail shows where you've been.
        ctx.fillStyle = s.art === 'leaf' ? '#2f9e44' : s.art === 'sambal' ? '#f1f3f5' : '#ffe8cc';
        ctx.beginPath();
        ctx.ellipse(cx, cy, W * 0.42, H * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = s.art === 'sambal' ? '#c92a2a' : '#fff';
        ctx.lineWidth = s.art === 'sambal' ? 9 : 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        trail.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
        ctx.stroke();
        s.points.forEach(([x, y], i) => {
          ctx.fillStyle = i < passed ? 'rgba(105,219,124,0.9)' : i === passed ? '#ffd43b' : 'rgba(255,255,255,0.45)';
          ctx.beginPath();
          ctx.arc(x * W, y * H, s.radius * dish.windowMult * Math.min(W, H) * 0.9, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#11131f';
          ctx.font = 'bold 13px system-ui';
          ctx.fillText(String(i + 1), x * W, y * H);
        });
        if (t > s.maxMs) finish();
      } else if (s.kind === 'meter') {
        const v = meterLevel(s, holding ? [...ev] : ev, Math.min(t, s.durationMs));
        // A glass of teh tarik with foam on top.
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(cx - 60, cy - 70, 120, 150);
        ctx.fillStyle = '#c47c3c';
        ctx.fillRect(cx - 56, cy + 76 - 140 * 0.6, 112, 140 * 0.6);
        ctx.fillStyle = '#fff4e0';
        ctx.fillRect(cx - 56, cy + 76 - 140 * 0.6 - 140 * v * 0.4, 112, 140 * v * 0.4);
        meter(W - 50, H * 0.1, 26, H * 0.8, v, s.zone);
        ctx.fillStyle = '#adb5bd';
        ctx.font = 'bold 14px system-ui';
        ctx.fillText(`${Math.max(0, (s.durationMs - t) / 1000).toFixed(1)} s`, cx, H - 16);
        if (t >= s.durationMs) finish();
      }
    }

    /** A vertical meter with a green zone (zone in 0..1 of the meter's height). */
    function meter(x: number, y: number, w: number, h: number, v: number, zone: [number, number]) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(105,219,124,0.55)';
      ctx.fillRect(x, y + h * (1 - zone[1]), w, h * (zone[1] - zone[0]));
      ctx.fillStyle = '#ffd43b';
      ctx.fillRect(x - 4, y + h * (1 - Math.min(1, v)) - 2, w + 8, 4);
    }

    next();
    raf = requestAnimationFrame(draw);
    cleanup.push(() => {
      canvas.removeEventListener('pointerdown', cDown);
      canvas.removeEventListener('pointerup', cUp);
    });
  });
}
