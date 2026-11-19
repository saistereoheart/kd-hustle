// Cooking a dish (spec §8.2): the steps the server built, played one after another on a canvas.
// We record raw inputs (press/release times, taps, pointer paths) relative to each step's start
// and send them all at the end; the server grades them. The "PERFECT!" popups here use the same
// shared grader, so what you see matches what you're paid for.
import { gradeStep, meterLevel, meterZoneAt, type DishState, type Grade, type RecipesConfig, type StepInput, type StepParams } from '@kh/shared';
import { el, uiRoot } from '../dom';
import { sfx } from '../sound';
import { foodIcon, drawBowl, drawCounter, drawDough, drawFood, drawGlass, drawGriddle, drawPlate, drawRice, drawRoti, drawSteelMug, trayCanvas, drawFriedRice, drawMurtabak, drawNoodles, drawWok } from './foodArt';

const GRADE_TEXT: Record<Grade, string> = { perfect: 'PERFECT!', great: 'GREAT!', good: 'GOOD', miss: 'MISS' };
const GRADE_COLOR: Record<Grade, string> = { perfect: '#ffd43b', great: '#69db7c', good: '#74c0fc', miss: '#ff6b6b' };

/** Live stock shown while you cook: the dish's portions and each add-on (id → count). */
export interface CookStock {
  dish: { id: string; icon: string; name: string; qty: number };
  addons: Array<{ id: string; icon: string; name: string; qty: number }>;
}

/** Plays a dish. Resolves with the inputs to send (or null if the player gave up). */
/** Plays a dish. Resolves with the inputs to send, null if the player gave up, or 'restart' if they
 *  threw it away to start over (only offered when `canRestart`). */
export function playDish(recipes: RecipesConfig, dish: DishState, title: string, onCancel: () => void, stock?: () => CookStock | null, canRestart = false): Promise<StepInput[] | null | 'restart'> {
  return new Promise((resolve) => {
    const W0 = Math.min(innerWidth - 28, 520);
    const H0 = Math.round(Math.min(W0 * 0.72, innerHeight * 0.48));
    let W = W0, H = H0;
    const dpr = Math.min(3, devicePixelRatio || 1);
    const canvas = el('canvas', { class: 'cook-canvas', 'data-testid': 'cook-canvas' });
    /** (Re)size the drawing area (the "pack the order" step gets a much bigger one). */
    const sizeCanvas = (w: number, h: number) => {
      W = Math.round(w);
      H = Math.round(h);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      canvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sizeCanvas(W0, H0);
    const ctx = canvas.getContext('2d')!;
    const stepPills = dish.steps.map((s, i) => el('span', { class: `cw-stage${i === 0 ? ' active' : ''}`, 'data-step': String(i) }, `${i + 1}. ${s.label}`));
    const label = el('div', { class: 'cook-label' });
    const hint = el('div', { class: 'muted cook-hint' });
    const action = el('button', { class: 'btn primary cook-action', type: 'button', 'data-action': 'cook-action' });
    const options = el('div', { class: 'cook-options' });
    /** The add-on trays, beside the plate on a wide screen. */
    const side = el('div', { class: 'cook-side hidden' });
    const quit = el('button', { class: 'btn small', type: 'button', 'data-action': 'cook-quit' }, 'Give up');
    const redo = el('button', { class: 'btn small', type: 'button', 'data-action': 'cook-redo', title: 'Throw this one away and start again (free)' }, '↺ Start over');
    if (!canRestart) redo.classList.add('hidden');
    // Stock, big and always visible: portions left and every add-on.
    const stockBar = el('div', { class: 'cook-stock', 'data-testid': 'cook-stock' });
    const paintStock = () => {
      const st = stock?.();
      if (!st) return void stockBar.classList.add('hidden');
      const chip = (id: string, name: string, qty: number, main = false) =>
        el('span', { class: `cook-stock-chip${qty <= 0 ? ' out' : qty <= 5 ? ' low' : ''}${main ? ' main' : ''}`, title: name }, foodIcon(id, 24), el('b', {}, `x ${qty}`), main ? ` ${name}` : '');
      stockBar.replaceChildren(el('span', { class: 'cook-stock-label' }, '📦'), chip(st.dish.id, st.dish.name, st.dish.qty, true), ...st.addons.map((a) => chip(a.id, a.name, a.qty)));
    };
    paintStock();
    const stockTimer = window.setInterval(paintStock, 1000);
    const box = el(
      'div',
      { class: 'carwash-box cook-box' },
      el('h3', {}, title, dish.blogger ? el('span', { class: 'lv-badge blogger' }, '📸 Food blogger!') : null),
      stockBar,
      el('div', { class: 'cw-stages' }, ...stepPills),
      label,
      hint,
      el('div', { class: 'cook-stage' }, canvas, side),
      options,
      el('div', { class: 'cw-foot' }, action, redo, quit),
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

    const done = (result: StepInput[] | null | 'restart') => {
      cancelAnimationFrame(raf);
      clearInterval(stockTimer);
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
    redo.addEventListener('click', () => done('restart'));

    // Keyboard: Space = the action button; 1–4 = sequence options.
    const onKey = (e: KeyboardEvent) => {
      if (step()?.kind === 'track' && ['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS'].includes(e.code)) {
        e.preventDefault();
        setSlider(slider + (e.code === 'ArrowUp' || e.code === 'KeyW' ? 0.06 : -0.06));
        return;
      }
      if (e.repeat) return;
      if (e.code === 'Space') {
        e.preventDefault();
        press();
      } else if (/^Digit[1-9]$/.test(e.code)) {
        const n = Number(e.code.slice(5)) - 1;
        const b = (trays.length ? trays[n] : (options.querySelectorAll('button')[n] as HTMLButtonElement | undefined)) ?? undefined;
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
      } else if (s.kind === 'assemble') finish(); // "Serve it" with what's in the box
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
      side.replaceChildren();
      side.classList.add('hidden');
      trays = [];
      box.classList.toggle('assemble', s.kind === 'assemble');
      box.classList.toggle('track', s.kind === 'track');
      if (s.kind !== 'assemble' && (W !== W0 || H !== H0)) sizeCanvas(W0, H0);
      action.classList.toggle('hidden', s.kind === 'sequence' || s.kind === 'path' || s.kind === 'track');
      action.textContent = s.kind === 'hold' ? 'Hold' : s.kind === 'timing' ? 'Now!' : s.kind === 'rhythm' ? (s.art.startsWith('wok') ? 'Toss!' : 'Tap!') : s.kind === 'assemble' ? (s.art === 'boxes' ? '✅ Bungkus! (serve)' : '✅ Serve') : s.art === 'kole' ? 'Hold to lift' : 'Hold to pour';
      if (s.kind === 'sequence') setupSequence(s);
      if (s.kind === 'assemble') setupAssemble(s);
      if (s.kind === 'track') setupTrack();
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

    // ---------------------------------------------------------------- assemble (ingredient trays)
    // Big steel trays of food drawn in code: the base sides in a row under the plate, the paid
    // add-ons in a column beside it (stacked under on a narrow screen), so nothing scrolls.
    let picked: string[] = [];
    let trays: HTMLButtonElement[] = [];
    function setupAssemble(s: Extract<StepParams, { kind: 'assemble' }>) {
      picked = [];
      const wide = innerWidth >= 760;
      const boxW = Math.min(innerWidth - 16, 1100);
      const tw = wide ? Math.min(124, Math.max(92, Math.round((innerHeight - 330) / 3.6))) : Math.max(60, Math.min(110, Math.floor((boxW - 44) / 4) - 18)); // phone: 4 per row
      const th = Math.round(tw * 0.68);
      const addons = s.options.filter((o) => o.addon).length;
      const sideW = wide && addons ? 2 * (tw + 16) + 10 : 0; // two columns of trays
      // Room for: the header (title, stock, steps, hint ~210), the tray row(s), the footer (~80).
      const rows = wide ? 1 : Math.ceil(s.options.length / 4);
      const spare = innerHeight - 210 - rows * (th + 36) - 80;
      const cw = boxW - 32 - sideW;
      sizeCanvas(cw, Math.max(170, Math.min(cw * 0.6, spare, wide && addons ? 3 * (th + 36) + 10 : Infinity)));
      side.classList.toggle('hidden', !sideW);
      side.style.width = sideW ? `${sideW}px` : '';
      options.classList.add('cook-boxes');
      stepCleanup.push(() => options.classList.remove('cook-boxes'));
      const counts = new Map((stock?.()?.addons ?? []).map((a) => [a.id, a.qty]));
      trays = s.options.map((o, i) => {
        const qty = o.addon ? counts.get(o.id) : undefined;
        const b = el(
          'button',
          { class: `cook-tray${o.addon ? ' addon' : ''}${qty === 0 ? ' empty' : ''}`, type: 'button', 'data-opt': o.id, 'data-name': o.name, title: o.name, 'aria-label': o.name },
          trayCanvas(o.id, tw, th),
          el('span', { class: 'cook-tray-name' }, `${i < 9 ? `${i + 1} · ` : ''}${o.name}`),
          o.addon ? el('span', { class: 'cook-box-qty' }, qty === undefined ? '' : `×${qty}`) : null,
          o.addon ? el('span', { class: 'cook-tray-tag' }, '+ ADD-ON') : null,
        ) as HTMLButtonElement;
        b.style.width = `${tw + 14}px`;
        b.addEventListener('click', () => {
          if (finishedStep) return;
          ev.push(i, now());
          picked.push(o.id);
          // Right while you haven't put in more of it than the order asks for (spoons, ice).
          const right = picked.filter((x) => x === o.id).length <= s.want.filter((x) => x === o.id).length;
          b.classList.remove('right', 'wrong');
          void b.offsetWidth;
          b.classList.add(right ? 'right' : 'wrong');
          if (right) sfx.click();
          else sfx.error();
          if (s.want.every((w) => picked.filter((x) => x === w).length >= s.want.filter((x) => x === w).length)) finish();
        });
        (o.addon && sideW ? side : options).append(b);
        return b;
      });
    }

    // ---------------------------------------------------------------- track (hold the slider)
    // A tall slider beside the scene: hold its thumb and drag it up and down (or W/S, ↑/↓) to set
    // the kole's height. We record [t, level] whenever it moves.
    let slider = 0.5;
    let thumb: HTMLElement | null = null;
    function setSlider(v: number) {
      if (step()?.kind !== 'track' || finishedStep) return;
      slider = Math.max(0, Math.min(1, v));
      if (thumb) thumb.style.bottom = `calc(${slider * 100}% - 22px)`;
      const t = Math.round(now()), lv = Math.round(slider * 1000) / 1000;
      if (ev.length >= 2 && t - ev[ev.length - 2] < 25) ev[ev.length - 1] = lv;
      else ev.push(t, lv);
    }
    function setupTrack() {
      // Room for the slider beside the canvas on a narrow screen.
      if (W + 100 > innerWidth - 24) sizeCanvas(Math.max(200, innerWidth - 24 - 104), H);
      slider = 0.5;
      ev = [0, 0.5];
      const track = el('div', { class: 'tarik-track', 'data-testid': 'tarik-slider' });
      thumb = el('div', { class: 'tarik-thumb' }, '☕');
      track.append(el('div', { class: 'tarik-rail' }), thumb);
      thumb.style.bottom = 'calc(50% - 22px)';
      track.style.height = `${H}px`;
      let dragging = false;
      const at = (e: PointerEvent) => {
        const r = track.getBoundingClientRect();
        setSlider(1 - (e.clientY - r.top) / r.height);
      };
      track.addEventListener('pointerdown', (e) => {
        dragging = true;
        try {
          track.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointer */
        }
        at(e);
      });
      track.addEventListener('pointermove', (e) => dragging && at(e));
      track.addEventListener('pointerup', () => (dragging = false));
      track.addEventListener('pointercancel', () => (dragging = false));
      side.replaceChildren(el('div', { class: 'tarik-side' }, el('div', { class: 'tarik-tip' }, '▲ lift'), track, el('div', { class: 'tarik-tip' }, '▼ lower')));
      side.classList.remove('hidden');
      side.style.width = '';
      stepCleanup.push(() => {
        thumb = null;
        side.replaceChildren();
        side.classList.add('hidden');
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
      if (s && s.kind !== 'path' && s.kind !== 'sequence' && s.kind !== 'assemble') {
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
        // A banana leaf on a plate, with a mound of rice that grows while you hold.
        drawPlate(ctx, cx - 30, cy + H * 0.12, W * 0.32, H * 0.3);
        const r = Math.min(1.2, v) * H * 0.26;
        if (r > 1) drawRice(ctx, cx - 30, cy + H * 0.14, r * 1.3, r);
        meter(W - 50, H * 0.1, 26, H * 0.8, Math.min(1.2, v) / 1.2, [s.zone[0] / 1.2, s.zone[1] / 1.2]);
        if (!ev.length && t > s.maxMs) finish();
        if (holding && v > 2.2) release();
      } else if (s.kind === 'timing') {
        const p = t / s.targetMs; // 1 = exactly right
        const raw: [number, number, number] = s.art === 'tea' ? [240, 220, 180] : [250, 250, 245];
        const gold: [number, number, number] = s.art === 'tea' ? [196, 120, 40] : [242, 178, 60];
        const burnt: [number, number, number] = [70, 40, 20];
        if (s.art === 'tea') {
          // Tea steeping in a glass: pale → deep amber → stewed; steam rising.
          const col = p <= 1 ? mix([236, 214, 170], [176, 96, 30], p) : mix([176, 96, 30], [60, 30, 12], (p - 1) * 2);
          const gw = Math.min(W * 0.28, 150), gh = Math.min(H * 0.6, gw * 1.3);
          drawGlass(ctx, cx - gw / 2, cy - gh / 2 - 10, gw, gh, 0.85, 0, col);
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 3;
          for (let k = 0; k < 3; k++) {
            const sx = cx - gw * 0.25 + k * gw * 0.25, ph = t / 400 + k;
            ctx.beginPath();
            ctx.moveTo(sx, cy - gh / 2 - 16);
            ctx.bezierCurveTo(sx + Math.sin(ph) * 10, cy - gh / 2 - 34, sx - Math.sin(ph) * 10, cy - gh / 2 - 46, sx, cy - gh / 2 - 60);
            ctx.stroke();
          }
        } else if (s.art === 'wok_mee') {
          // Mee goreng in a blazing wok: pale noodles → saucy red-brown → burnt.
          const rad = Math.min(W * 0.3, H * 0.46);
          drawWok(ctx, cx - rad * 0.2, cy - 6, rad, 1, t);
          drawNoodles(ctx, cx - rad * 0.2, cy - 10, rad * 0.62, rad * 0.36, p);
        } else if (s.art === 'murtabak') {
          // A murtabak on the griddle, browning.
          const rad = Math.min(W, H) * 0.34;
          drawGriddle(ctx, cx, cy - 8, rad * 1.15);
          drawMurtabak(ctx, cx, cy - 8, rad * 1.3, p);
        } else {
          // Roti on a hot griddle, browning from pale to golden to burnt.
          const rad = Math.min(W, H) * 0.34;
          drawGriddle(ctx, cx, cy - 8, rad * 1.15);
          drawRoti(ctx, cx, cy - 8, rad * 0.9, p);
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
        // The scene, then rings closing in on the target: tap when a ring meets it.
        const tx = cx, ty = s.art === 'pull' ? H * 0.68 : cy;
        const done = Math.min(ev.length, s.beats.length) / s.beats.length;
        if (s.art === 'pull') {
          // Teh tarik: pouring from a mug held high into one held low, the stream stretching.
          const mw = Math.min(70, W * 0.14), mh = mw * 1.15;
          const lift = 0.5 + 0.5 * Math.sin(t / 160);
          const upX = tx - mw * 1.6, upY = H * 0.12 + (1 - lift) * 20;
          drawSteelMug(ctx, upX - mw / 2, upY, mw, mh, 0.9);
          drawSteelMug(ctx, tx - mw / 2, ty - mh / 2, mw, mh, 0);
          ctx.strokeStyle = '#b5651d';
          ctx.lineWidth = 6;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(upX + mw * 0.55, upY + mh * 0.25);
          ctx.quadraticCurveTo(tx - mw * 0.2, upY + mh, tx, ty - mh / 2 + 4);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255, 230, 190, 0.6)';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (s.art.startsWith('wok')) {
          // Tossing in the wok: the food jumps after every tap and settles back down.
          const rad = Math.min(W * 0.3, H * 0.46);
          const since = ev.length ? t - ev[ev.length - 1] : 9999;
          const jump = since < 320 ? Math.sin((since / 320) * Math.PI) * rad * 0.45 : 0;
          drawWok(ctx, tx, ty, rad, 1, t);
          const fy = ty - 4 - jump;
          if (s.art === 'wok_mee') drawNoodles(ctx, tx, fy, rad * 0.6, rad * 0.34, 0.3 + done * 0.6);
          else drawFriedRice(ctx, tx, fy, rad * 0.6, rad * 0.34, 0.2 + done * 0.8);
        } else {
          // Roti dough on an oiled steel counter, getting thinner and wider with every slap.
          drawCounter(ctx, W, H);
          drawDough(ctx, tx, ty, Math.min(W, H) * 0.42, done);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(tx, ty, 34, 0, Math.PI * 2);
        ctx.stroke();
        for (const b of s.beats) {
          const dt = b - t;
          if (dt < -150 || dt > 1400) continue;
          const r = 34 + Math.max(0, dt) * 0.09;
          ctx.strokeStyle = dt < 0 ? 'rgba(255,107,107,0.8)' : '#ffd43b';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(tx, ty, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.font = 'bold 14px system-ui';
        ctx.fillStyle = s.art === 'pull' ? '#adb5bd' : '#343a40';
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
      } else if (s.kind === 'assemble') {
        // The order ticket: a big picture of each thing with its name, in tray order; the base
        // items, then a divider and the add-ons. ✓ once it's on the plate.
        // One cell per thing; repeats show how many ("2 sudu", "more ice", ×2).
        const uniq = [...new Set(s.want)];
        const need = (id: string) => s.want.filter((x) => x === id).length;
        const have = (id: string) => picked.filter((x) => x === id).length;
        const baseIds = uniq.filter((id) => !s.options.find((o) => o.id === id)?.addon);
        const addIds = uniq.filter((id) => s.options.find((o) => o.id === id)?.addon);
        const sepW = addIds.length && baseIds.length ? 26 : 0;
        const cell = Math.min(96, (W - 30 - sepW) / Math.max(1, uniq.length));
        const tw = cell * uniq.length + 20 + sepW, tx0 = cx - tw / 2;
        ctx.fillStyle = '#fff9db';
        ctx.beginPath();
        ctx.roundRect(tx0, 8, tw, cell * 0.95 + 26, 8);
        ctx.fill();
        ctx.fillStyle = '#868e96';
        ctx.font = 'bold 11px system-ui';
        let title = 'ORDER';
        if (s.art === 'drink') title = `${s.want.some((id) => id.startsWith('susu_')) ? 'TEH TARIK' : 'TEH O'} ${s.want.includes('cup_ais') ? 'AIS' : 'PANAS'}`;
        ctx.fillText(title, tx0 + 10 + (baseIds.length * cell) / 2, 18);
        const item = (id: string, x: number) => {
          const o = s.options.find((q) => q.id === id)!;
          const n = need(id), h = have(id);
          const got = h >= n;
          ctx.globalAlpha = got ? 0.4 : 1;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.ellipse(x + cell / 2, 26 + cell * 0.32, cell * 0.42, cell * 0.3, 0, 0, Math.PI * 2);
          ctx.fill();
          drawFood(ctx, id, x + cell * 0.14, 26 + cell * 0.06, cell * 0.72, cell * 0.52, 0.6);
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#212529';
          ctx.font = `bold ${cell < 70 ? 10 : 12}px system-ui`;
          ctx.fillText(o.name, x + cell / 2, 26 + cell * 0.72, cell - 4);
          if (n > 1 || o.countLabels) {
            ctx.fillStyle = '#c92a2a';
            ctx.font = `bold ${cell < 70 ? 10 : 12}px system-ui`;
            ctx.fillText(`${o.countLabels?.[n - 1] ?? `×${n}`}${h && !got ? ` (${h}/${n})` : ''}`, x + cell / 2, 26 + cell * 0.86, cell - 2);
          }
          if (got) {
            ctx.fillStyle = '#2f9e44';
            ctx.font = 'bold 26px system-ui';
            ctx.fillText('✓', x + cell * 0.78, 26 + cell * 0.2);
          }
        };
        baseIds.forEach((id, i) => item(id, tx0 + 10 + i * cell));
        if (addIds.length) {
          const ax = tx0 + 10 + baseIds.length * cell + sepW;
          if (sepW) {
            ctx.strokeStyle = '#e8590c';
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(ax - sepW / 2, 14);
            ctx.lineTo(ax - sepW / 2, 26 + cell * 0.9);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          ctx.fillStyle = '#e8590c';
          ctx.font = 'bold 11px system-ui';
          ctx.fillText('+ ADD-ONS', ax + (addIds.length * cell) / 2, 18);
          ctx.fillStyle = 'rgba(232, 89, 12, 0.1)';
          ctx.fillRect(ax - 4, 24, addIds.length * cell + 8, cell * 0.9);
          addIds.forEach((id, i) => item(id, ax + i * cell));
        }
        const top = cell * 0.95 + 40;
        const pcy = top + (H - top) / 2;
        const prx = Math.min(W * 0.4, (H - top) * 0.78), pry = Math.min(prx * 0.62, (H - top) / 2 - 4);
        if (s.art === 'drink') {
          // The cup you picked fills as you go: tea, milk lightens it, ice cubes or steam.
          const has = (id: string) => picked.includes(id);
          const iced = has('cup_ais'), hot = has('cup_panas');
          const milkN = picked.filter((id) => id.startsWith('susu_')).length;
          const ice = picked.filter((id) => id === 'ais').length;
          const fill = (has('teh') ? 0.55 : 0) + Math.min(0.25, milkN * 0.09) + ice * 0.04;
          const col = has('teh') ? (milkN ? (has('susu_pekat') ? '#c98b4e' : '#d29a62') : '#6b2f0c') : milkN ? '#f4ecdb' : '#bfe0f5';
          if (hot || iced) {
            const gh = Math.min(H - top - 16, iced ? 240 : 190), gw = gh * (iced ? 0.5 : 0.72);
            const gx = cx - gw / 2, gy = top + (H - top - gh) / 2;
            drawGlass(ctx, gx, gy, gw, gh, fill, 0, col, hot);
            // Ice cubes floating in the top of the drink: 2 per tap of ice.
            for (let k = 0; k < ice * 2; k++) {
              const cs = gw * 0.3, ix = gx + 8 + (k % 2) * gw * 0.42 + (k % 3) * 3, iy = gy + gh * (1 - fill) - cs * 0.3 + Math.floor(k / 2) * cs * 0.7;
              ctx.save();
              ctx.translate(ix + cs / 2, iy + cs / 2);
              ctx.rotate(((k * 37) % 20) / 40 - 0.25);
              ctx.fillStyle = 'rgba(220, 240, 255, 0.85)';
              ctx.fillRect(-cs / 2, -cs / 2, cs, cs);
              ctx.strokeStyle = 'rgba(116, 192, 252, 0.95)';
              ctx.lineWidth = 1.5;
              ctx.strokeRect(-cs / 2, -cs / 2, cs, cs);
              ctx.fillStyle = 'rgba(255,255,255,0.9)';
              ctx.fillRect(-cs / 2 + 3, -cs / 2 + 3, cs * 0.35, cs * 0.15);
              ctx.restore();
            }
            if (hot && has('teh')) {
              ctx.strokeStyle = 'rgba(255,255,255,0.4)';
              ctx.lineWidth = 3;
              for (let k = 0; k < 3; k++) {
                const sx = gx + gw * (0.25 + k * 0.25), ph = t / 400 + k;
                ctx.beginPath();
                ctx.moveTo(sx, gy - 6);
                ctx.bezierCurveTo(sx + Math.sin(ph) * 8, gy - 22, sx - Math.sin(ph) * 8, gy - 34, sx, gy - 46);
                ctx.stroke();
              }
            }
          } else {
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = 'bold 16px system-ui';
            ctx.fillText('Pick a cup first', cx, top + (H - top) / 2);
          }
        } else if (s.art === 'curry') {
          // Roti canai on a plate, the curries in little bowls beside it.
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.beginPath();
          ctx.ellipse(cx + 3, pcy + 5, prx, pry, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#f8f9fa';
          ctx.beginPath();
          ctx.ellipse(cx, pcy, prx, pry, 0, 0, Math.PI * 2);
          ctx.fill();
          drawRoti(ctx, cx - prx * 0.25, pcy, pry * 0.78, 0.95);
          // Roti telur: the egg goes on the roti; everything else comes in a little bowl.
          if (picked.includes('telur_roti')) drawFood(ctx, 'telur_mata', cx - prx * 0.25 - pry * 0.4, pcy - pry * 0.36, pry * 0.8, pry * 0.72, 0.6);
          picked.filter((id) => id !== 'telur_roti').forEach((id, i) => drawBowl(ctx, id, cx + prx * (0.42 + (i % 2) * 0.02), pcy + (i % 2 ? 0.42 : -0.42) * pry * (i > 1 ? 0.2 : 1), pry * 0.42));
        } else if (s.art === 'filling') {
          // Murtabak: the stretched dough sheet on the counter, the fillings spread on top.
          drawCounter(ctx, W, H);
          drawDough(ctx, cx, pcy, Math.min(prx * 1.1, (H - top) * 0.6), 1);
          picked.forEach((id, i) => {
            const a = (i / Math.max(1, picked.length)) * Math.PI * 2 + 0.4;
            const fw = prx * 0.6, fh = pry * 0.6;
            drawFood(ctx, id, cx + Math.cos(a) * prx * 0.28 - fw / 2, pcy + Math.sin(a) * pry * 0.3 - fh / 2, fw, fh, 0.7);
          });
        } else {
          // The plate: banana leaf, the rice (or fried rice / mee goreng), and what you've added.
          drawPlate(ctx, cx, pcy, prx, pry);
          if (s.art === 'friedrice') drawFriedRice(ctx, cx - prx * 0.12, pcy + pry * 0.02, prx * 0.36, pry * 0.46, 1);
          else if (s.art === 'mee') drawNoodles(ctx, cx - prx * 0.12, pcy + pry * 0.02, prx * 0.38, pry * 0.46, 1);
          else drawRice(ctx, cx - prx * 0.12, pcy + pry * 0.05, prx * 0.3, pry * 0.42);
          const slots: Array<[number, number]> = [[0.32, -0.42], [0.5, 0.05], [0.3, 0.45], [-0.05, 0.55], [-0.45, 0.42], [-0.55, -0.05], [-0.38, -0.48], [0.05, -0.6]];
          picked.forEach((id, i) => {
            const [sx, sy] = slots[i % slots.length];
            const fw = prx * 0.5, fh = pry * 0.5;
            drawFood(ctx, id, cx + sx * prx - fw / 2, pcy + sy * pry - fh / 2, fw, fh, 0.5);
          });
        }
        ctx.fillStyle = t > s.fastMs * dish.windowMult ? '#ffa94d' : '#adb5bd';
        ctx.font = 'bold 14px system-ui';
        ctx.fillText(`${Math.max(0, (s.maxMs - t) / 1000).toFixed(1)} s`, W - 34, H - 16);
        if (t > s.maxMs) finish();
      } else if (s.kind === 'path') {
        // Roti: a thin dough sheet on the oiled counter; each corner you bring in folds over.
        drawCounter(ctx, W, H);
        const sw = W * 0.7, sh = H * 0.7, x0 = cx - sw / 2, y0 = cy - sh / 2;
        ctx.fillStyle = 'rgba(255, 244, 214, 0.9)';
        ctx.beginPath();
        ctx.roundRect(x0, y0, sw, sh, 14);
        ctx.fill();
        // folded flaps: one per corner passed (every second point is the middle)
        const folds = Math.floor(passed / 2);
        ctx.fillStyle = 'rgba(240, 215, 160, 0.95)';
        ctx.strokeStyle = 'rgba(180, 130, 70, 0.5)';
        ctx.lineWidth = 1.5;
        for (let k = 0; k < folds && k * 2 < s.points.length; k++) {
          const [px, py] = s.points[k * 2];
          ctx.beginPath();
          ctx.moveTo(px * W, py * H);
          ctx.lineTo(cx + (px * W - cx) * 0.15 + (py * H - cy) * 0.6, cy + (py * H - cy) * 0.15 - (px * W - cx) * 0.6 * (H / W));
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx + (px * W - cx) * 0.15 - (py * H - cy) * 0.6, cy + (py * H - cy) * 0.15 + (px * W - cx) * 0.6 * (H / W));
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 4;
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
      } else if (s.kind === 'track' || s.kind === 'meter') {
        const v = s.kind === 'track' ? slider : meterLevel(s, holding ? [...ev] : ev, Math.min(t, s.durationMs));
        const zone = meterZoneAt(s, Math.min(t, s.durationMs));
        if (s.art === 'kole') {
          // Tarik: the kole (pouring jug) goes up and down with the slider; the tea stream
          // stretches down into the mug. Keep the jug's height in the moving green zone.
          const mw = Math.min(W * 0.2, 110), mh = mw * 1.05;
          const mugX = cx - 40, mugY = H - mh - 30;
          const koleY = mugY - 30 - v * (mugY - 70);
          drawSteelMug(ctx, cx - 40 - mw * 0.9, koleY, mw * 0.8, mw * 0.85, 0.85);
          drawGlass(ctx, mugX - mw / 2, mugY, mw, mh, 0.55, 0.25, '#b5651d', true);
          ctx.strokeStyle = '#b5651d';
          ctx.lineWidth = 6;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(cx - 40 - mw * 0.25, koleY + mw * 0.2);
          ctx.quadraticCurveTo(mugX - 6, (koleY + mugY) / 2, mugX, mugY + 6);
          ctx.stroke();
          const inZone = Math.abs(v - (zone[0] + zone[1]) / 2) <= (zone[1] - zone[0]) / 2;
          ctx.fillStyle = inZone ? '#69db7c' : '#ff8787';
          ctx.font = 'bold 15px system-ui';
          ctx.fillText(inZone ? 'TARIK! 👍' : v < zone[0] ? '▲ higher' : '▼ lower', cx + 70, 30);
        } else {
          // A glass of teh tarik: the higher you pour, the thicker the froth.
          const gw = Math.min(W * 0.26, 140), gh = Math.min(H * 0.66, gw * 1.35);
          drawGlass(ctx, cx - gw / 2 - 20, cy - gh / 2 + 4, gw, gh, 0.6, v, '#b5651d');
          if (holding) {
            ctx.strokeStyle = '#b5651d';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(cx - 20, 6);
            ctx.lineTo(cx - 20, cy - gh / 2 + 10);
            ctx.stroke();
          }
        }
        meter(W - 50, H * 0.1, 26, H * 0.8, v, zone);
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
