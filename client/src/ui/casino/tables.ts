// Shared casino tables: roulette, the Wheel of Fortune and Crash. Everyone watching sees the
// same round; bets show with players' names. The server runs the rounds and settles.
import { crashMultAt, formatMoney, ROULETTE_RED, type CrashView, type RouletteView, type WheelView } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { openPanel } from '../panel';
import { sfx } from '../sound';
import { betPicker, ok, secsLeft, sessionLine, watchTable } from './common';

const numColor = (n: number) => (n === 0 ? 'green' : ROULETTE_RED.has(n) ? 'red' : 'black');
const BET_LABEL: Record<string, string> = {
  red: '🔴 Red', black: '⚫ Black', odd: 'Odd', even: 'Even', low: '1–18', high: '19–36', dozen1: '1st 12', dozen2: '2nd 12', dozen3: '3rd 12', col1: 'Col 1', col2: 'Col 2', col3: 'Col 3',
};
const betLabel = (b: string) => (b.startsWith('n:') ? `#${b.slice(2)}` : BET_LABEL[b] ?? b);

// ------------------------------------------------------------------ roulette
export function openRoulette(app: App) {
  const panel = openPanel('🎡 Roulette', { wide: true, testId: 'casino-roulette' });
  const picker = betPicker(app, 'roulette');
  const ball = el('div', { class: 'roulette-ball' }, '–');
  const status = el('div', { class: 'casino-status' });
  const history = el('div', { class: 'roulette-history' });
  const bets = el('div', { class: 'casino-bets' });
  const sess = el('div');
  let view: RouletteView | null = null;
  let spinTimer = 0;
  const bet = (b: string) =>
    app.socket?.timeout(5000).emit('casino:roulette:bet', { bet: b, sen: picker.get() }, (err, res) => {
      if (ok(err, res)) sfx.coin();
    });
  const outside = el('div', { class: 'roulette-outside' }, ...Object.keys(BET_LABEL).map((b) => {
    const btn = el('button', { class: `rbet ${b}`, type: 'button', 'data-rbet': b }, BET_LABEL[b]);
    btn.addEventListener('click', () => bet(b));
    return btn;
  }));
  const grid = el('div', { class: 'roulette-grid' });
  for (let n = 0; n <= 36; n++) {
    const btn = el('button', { class: `rnum ${numColor(n)}${n === 0 ? ' zero' : ''}`, type: 'button', 'data-rbet': `n:${n}` }, String(n));
    btn.addEventListener('click', () => bet(`n:${n}`));
    grid.append(btn);
  }
  const render = () => {
    if (!view) return;
    const v = view;
    const me = app.lastInit?.you.id;
    // Settled: always show the real number (also if the panel opened mid-spin).
    if (v.phase === 'result' && v.result !== null && ball.textContent !== String(v.result)) {
      clearInterval(spinTimer);
      ball.textContent = String(v.result);
      ball.className = `roulette-ball ${numColor(v.result)}`;
    }
    status.textContent = v.phase === 'betting' ? `Place your bets · ${secsLeft(app, v.endsAt)}` : v.phase === 'spinning' ? 'No more bets! The ball is spinning…' : `${v.result} ${numColor(v.result!).toUpperCase()}`;
    history.replaceChildren(...v.history.map((n) => el('span', { class: `rnum small ${numColor(n)}` }, String(n))));
    bets.replaceChildren(
      el('div', { class: 'muted small' }, v.bets.length ? 'Bets this round:' : 'No bets yet this round.'),
      ...v.bets.map((b) => el('div', { class: `casino-bet${b.player === me ? ' mine' : ''}` }, `${b.name}: ${formatMoney(b.sen)} on ${betLabel(b.bet)}`)),
    );
    outside.classList.toggle('closed', v.phase !== 'betting');
    grid.classList.toggle('closed', v.phase !== 'betting');
  };
  const onView = (v: RouletteView) => {
    const was = view?.phase;
    view = v;
    if (v.phase === 'spinning' && was !== 'spinning') {
      // Spin through numbers, slowing down, then land on the result.
      clearInterval(spinTimer);
      let i = 0;
      // Only as long as the spin has left (the panel may open mid-spin).
      const ticks = Math.max(1, Math.min(30, Math.floor((v.endsAt - app.store.serverNow() - 600) / 120)));
      ball.className = 'roulette-ball spinning';
      spinTimer = window.setInterval(() => {
        ball.textContent = String(Math.floor(Math.random() * 37));
        if (++i > ticks) {
          clearInterval(spinTimer);
          ball.textContent = String(v.result);
          ball.className = `roulette-ball ${numColor(v.result!)}`;
          const mine = v.bets.filter((b) => b.player === app.lastInit?.you.id);
          if (mine.length) sfx.reveal(2);
        }
      }, 120);
    } else if (v.phase === 'betting' && was !== 'betting') {
      ball.className = 'roulette-ball';
    }
    render();
  };
  const stop = watchTable<RouletteView>(app, 'roulette', onView, (s) => sess.replaceChildren(sessionLine(s)));
  const clock = window.setInterval(render, 500);
  panel.onClose = () => {
    stop();
    clearInterval(clock);
    clearInterval(spinTimer);
  };
  panel.body.append(
    el('div', { class: 'roulette-top' }, ball, el('div', {}, status, history)),
    picker.el,
    outside,
    grid,
    el('p', { class: 'muted small' }, 'European wheel (one zero). Colours, odd/even and halves pay 1:1, dozens and columns 2:1, a single number 35:1.'),
    bets,
    sess,
  );
}

// ------------------------------------------------------------------ the wheel of fortune
export function openWheel(app: App) {
  const panel = openPanel('🎯 Wheel of Fortune', { testId: 'casino-wheel' });
  const cc = app.cfg.casino.wheel;
  const picker = betPicker(app, 'wheel');
  const disc = el('div', { class: 'wof-disc' });
  const wheel = el('div', { class: 'wof' }, disc, el('div', { class: 'wof-pointer' }, '▼'));
  const status = el('div', { class: 'casino-status' });
  const bets = el('div', { class: 'casino-bets' });
  const history = el('div', { class: 'roulette-history' });
  const sess = el('div');
  let view: (WheelView & { layout: string[] }) | null = null;
  let angle = 0;
  const segBtns = el('div', { class: 'wof-bets' }, ...cc.segments.map((s) => {
    const b = el('button', { class: 'rbet', type: 'button', 'data-wbet': s.id }, s.label, el('small', {}, `${s.count} slots`));
    b.style.background = s.color;
    b.addEventListener('click', () =>
      app.socket?.timeout(5000).emit('casino:wheel:bet', { segment: s.id, sen: picker.get() }, (err, res) => {
        if (ok(err, res)) sfx.coin();
      }),
    );
    return b;
  }));
  const paintDisc = (layout: string[]) => {
    const n = layout.length;
    const stops = layout.map((id, i) => `${cc.segments.find((s) => s.id === id)?.color ?? '#888'} ${(i / n) * 360}deg ${((i + 1) / n) * 360}deg`);
    disc.style.background = `conic-gradient(${stops.join(',')})`;
  };
  const render = () => {
    if (!view) return;
    const me = app.lastInit?.you.id;
    const seg = view.result !== null ? cc.segments.find((s) => s.id === view!.layout[view!.result!]) : null;
    status.textContent = view.phase === 'betting' ? `Next spin in ${secsLeft(app, view.endsAt)}` : `Spinning… ${seg ? '' : ''}`;
    history.replaceChildren(...view.history.map((id) => {
      const s = cc.segments.find((x) => x.id === id);
      const c = el('span', { class: 'rnum small' }, s?.label ?? id);
      c.style.background = s?.color ?? '#888';
      return c;
    }));
    bets.replaceChildren(...view.bets.map((b) => el('div', { class: `casino-bet${b.player === me ? ' mine' : ''}` }, `${b.name}: ${formatMoney(b.sen)} on ${cc.segments.find((s) => s.id === b.segment)?.label}`)));
    segBtns.classList.toggle('closed', view.phase !== 'betting');
  };
  const onView = (v: WheelView & { layout: string[] }) => {
    const was = view?.phase;
    if (!view) paintDisc(v.layout);
    view = v;
    if (v.phase === 'spinning' && was !== 'spinning' && v.result !== null) {
      // Land the pointer (at the top) on the winning slot: a few turns plus the slot's angle.
      const n = v.layout.length;
      const target = 360 - ((v.result + 0.5) / n) * 360;
      angle = angle - (angle % 360) + 360 * 5 + target;
      disc.style.transition = `transform ${app.cfg.casino.wheel.spinMs - 1000}ms cubic-bezier(0.15, 0.8, 0.2, 1)`;
      disc.style.transform = `rotate(${angle}deg)`;
      window.setTimeout(() => {
        const seg = cc.segments.find((s) => s.id === v.layout[v.result!]);
        status.textContent = `🎯 ${seg?.label}!`;
        if (v.bets.some((b) => b.player === app.lastInit?.you.id && b.segment === seg?.id)) {
          sfx.reveal(3);
          toast(`🎯 ${seg?.label}! You won.`, 'good');
        }
      }, app.cfg.casino.wheel.spinMs - 900);
    }
    render();
  };
  const stop = watchTable<WheelView & { layout: string[] }>(app, 'wheel', onView, (s) => sess.replaceChildren(sessionLine(s)));
  const clock = window.setInterval(() => view?.phase === 'betting' && render(), 1000);
  panel.onClose = () => {
    stop();
    clearInterval(clock);
  };
  panel.body.append(wheel, status, history, picker.el, segBtns, el('p', { class: 'muted small' }, `A shared wheel every ${cc.everyMs / 60000} minutes: bet on a colour; it pays its number × your bet.`), bets, sess);
}

// ------------------------------------------------------------------ crash
export function openCrash(app: App) {
  const panel = openPanel('📈 Crash', { testId: 'casino-crash' });
  const cc = app.cfg.casino;
  const picker = betPicker(app, 'crash');
  const mult = el('div', { class: 'crash-mult' }, '1.00×');
  const status = el('div', { class: 'casino-status' });
  const history = el('div', { class: 'roulette-history' });
  const bets = el('div', { class: 'casino-bets' });
  const sess = el('div');
  let auto: number | null = null;
  const autos = el('div', { class: 'casino-chips' });
  const paintAutos = () =>
    autos.replaceChildren(
      el('span', { class: 'muted small' }, 'Auto cash-out:'),
      ...[null, 1.5, 2, 3, 5, 10].map((a) => {
        const b = el('button', { class: `casino-chip${auto === a ? ' on' : ''}`, type: 'button', 'data-auto': String(a) }, a ? `${a}×` : 'Off');
        b.addEventListener('click', () => {
          auto = a;
          paintAutos();
        });
        return b;
      }),
    );
  paintAutos();
  const betBtn = el('button', { class: 'btn primary', type: 'button', 'data-action': 'crash-bet' }, 'Bet');
  betBtn.addEventListener('click', () =>
    app.socket?.timeout(5000).emit('casino:crash:bet', { sen: picker.get(), auto }, (err, res) => {
      if (ok(err, res)) sfx.coin();
    }),
  );
  const cashBtn = el('button', { class: 'btn primary crash-cash', type: 'button', 'data-action': 'crash-cashout' }, '💰 Cash out');
  cashBtn.addEventListener('click', () =>
    app.socket?.timeout(5000).emit('casino:crash:cashout', (err, res) => {
      if (!ok(err, res) || !res.ok) return;
      sfx.reveal(2);
      toast(`💰 Out at ${res.mult}×: +${formatMoney(res.paidSen)}`, 'good');
    }),
  );
  let view: CrashView | null = null;
  let raf = 0;
  const frame = () => {
    if (view?.phase === 'running') {
      const m = crashMultAt(cc, app.store.serverNow() - view.startedAt);
      mult.textContent = `${m.toFixed(2)}×`;
      mult.className = 'crash-mult running';
      raf = requestAnimationFrame(frame);
    }
  };
  const render = () => {
    if (!view) return;
    const v = view;
    const me = app.lastInit?.you.id;
    const mine = v.bets.find((b) => b.player === me);
    status.textContent = v.phase === 'betting' ? `Bets close in ${secsLeft(app, v.endsAt)}` : v.phase === 'running' ? 'Going up… cash out before it crashes!' : `💥 Crashed at ${v.crashAt}×`;
    if (v.phase === 'crashed') {
      mult.textContent = `${v.crashAt?.toFixed(2)}×`;
      mult.className = 'crash-mult crashed';
    } else if (v.phase === 'betting') {
      mult.textContent = '1.00×';
      mult.className = 'crash-mult';
    }
    betBtn.disabled = v.phase !== 'betting' || !!mine;
    cashBtn.disabled = v.phase !== 'running' || !mine || mine.cashedAt !== null;
    cashBtn.style.display = mine && v.phase === 'running' ? '' : 'none';
    history.replaceChildren(...v.history.map((m) => el('span', { class: `rnum small ${m >= 2 ? 'green' : 'red'}` }, `${m}×`)));
    bets.replaceChildren(...v.bets.map((b) => el('div', { class: `casino-bet${b.player === me ? ' mine' : ''}${b.cashedAt ? ' won' : v.phase === 'crashed' ? ' lost' : ''}` }, `${b.name}: ${formatMoney(b.sen)}${b.cashedAt ? ` → out at ${b.cashedAt}× (+${formatMoney(Math.floor(b.sen * b.cashedAt) - b.sen)})` : b.auto ? ` · auto ${b.auto}×` : ''}`)));
  };
  const onView = (v: CrashView) => {
    const was = view?.phase;
    view = v;
    if (v.phase === 'running' && was !== 'running') {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    }
    if (v.phase === 'crashed' && was === 'running') {
      cancelAnimationFrame(raf);
      if (v.bets.some((b) => b.player === app.lastInit?.you.id && b.cashedAt === null)) sfx.error();
    }
    render();
  };
  const stop = watchTable<CrashView>(app, 'crash', onView, (s) => sess.replaceChildren(sessionLine(s)));
  const clock = window.setInterval(() => view?.phase === 'betting' && render(), 500);
  panel.onClose = () => {
    stop();
    clearInterval(clock);
    cancelAnimationFrame(raf);
  };
  panel.body.append(mult, status, history, picker.el, autos, el('div', { class: 'stall-actions' }, betBtn, cashBtn), el('p', { class: 'muted small' }, 'Everyone rides the same rocket. The longer you wait, the more it pays, but it can crash any moment (even at 1.00×).'), bets, sess);
}
