// A business "rush" (spec §8.6, the small optional interaction): tap the big button N times
// within a few seconds. The server checks the tap times and gives ×3 output for a while.
import type { BusinessTypeDef } from '@kh/shared';
import type { App } from '../app';
import { el, toast, uiRoot } from './dom';
import { sfx } from './sound';

export function openRush(app: App, t: BusinessTypeDef) {
  const r = app.cfg.businesses.rush;
  const taps: number[] = [];
  let t0 = 0;
  let done = false;
  const count = el('div', { class: 'rush-count' }, `0 / ${r.taps}`);
  const bar = el('div', { class: 'progress' }, el('i', {}));
  const fill = bar.firstChild as HTMLElement;
  const big = el('button', { class: 'rush-btn', type: 'button', 'data-testid': 'rush-tap' }, t.icon, el('span', {}, t.rushName));
  const close = el('button', { class: 'btn', type: 'button', 'data-action': 'rush-close' }, 'Close');
  const box = el(
    'div',
    { class: 'carwash-box rush-box', 'data-testid': 'rush' },
    el('h3', {}, `🔥 ${t.rushName}`),
    el('p', { class: 'muted' }, `Tap ${r.taps} times within ${r.windowMs / 1000} s: ${t.name} earns ×${r.mult} for ${r.durationMs / 1000} s.`),
    big,
    count,
    bar,
    el('div', { class: 'cw-foot' }, close),
  );
  const host = el('div', { class: 'reveal-overlay' }, box);
  uiRoot().append(host);
  const finish = () => host.remove();
  close.addEventListener('click', finish);
  let timer = 0;
  const tick = () => {
    const left = Math.max(0, 1 - (performance.now() - t0) / r.windowMs);
    fill.style.width = `${left * 100}%`;
    if (left > 0 && !done) timer = requestAnimationFrame(tick);
    else if (!done) {
      done = true;
      sfx.error();
      count.textContent = 'Too slow! Try again in a moment.';
    }
  };
  big.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (done) return;
    const now = performance.now();
    if (!taps.length) {
      t0 = now;
      timer = requestAnimationFrame(tick);
    }
    taps.push(Math.round(now - t0));
    sfx.click();
    big.classList.remove('pop');
    void big.offsetWidth;
    big.classList.add('pop');
    count.textContent = `${taps.length} / ${r.taps}`;
    if (taps.length >= r.taps) {
      done = true;
      cancelAnimationFrame(timer);
      app.socket?.timeout(5000).emit('biz:rush', { type: t.id, taps }, (err, res) => {
        if (err || !res.ok) {
          sfx.error();
          count.textContent = err ? 'No response.' : res.ok ? '' : res.error;
          return;
        }
        sfx.reveal(3);
        const b = app.store.ventures.businesses[t.id];
        if (b) b.rushUntil = res.rushUntil;
        toast(`🔥 ${t.name} ×${r.mult} for ${r.durationMs / 1000} s!${b && !b.manager ? ' Collect when it\'s ready.' : ''}`, 'good');
        app.store.emit();
        finish();
      });
    }
  });
}
