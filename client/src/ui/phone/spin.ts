// HustlePhone → Lucky Spin (spec §7.6): a free spin on the reward wheel once a day, for everyone
// (no need to go to the casino). Money prizes grow with your wealth stage. The server picks.
import { formatMoney } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { sfx } from '../sound';
import type { PhoneCtx } from './phone';

/** Ask the server whether today's spin is still there (for the app badge). */
export function refreshSpin(app: App) {
  app.socket?.timeout(5000).emit('casino:session', (err, res) => {
    if (err || !res.ok) return;
    app.store.canSpin = res.canSpin;
    app.store.emit();
  });
}

let angle = 0;

export function renderSpin({ app }: PhoneCtx): HTMLElement[] {
  const d = app.cfg.casino.dailySpin;
  const mult = d.stageMult[Math.min(d.stageMult.length - 1, app.store.progress.stage - 1)];
  const n = d.prizes.length;
  const colors = ['#4dabf7', '#69db7c', '#ffd43b', '#ff922b', '#f06595', '#9775fa', '#20c997', '#e64980'];
  const disc = el('div', { class: 'wof-disc spin-disc' });
  disc.style.background = `conic-gradient(${d.prizes.map((_, i) => `${colors[i % colors.length]} ${(i / n) * 360}deg ${((i + 1) / n) * 360}deg`).join(',')})`;
  disc.style.transform = `rotate(${angle}deg)`;
  // Prize labels around the wheel.
  d.prizes.forEach((p, i) => {
    const lab = el('span', { class: 'spin-label' }, p.sen ? formatMoney(p.sen * mult) : p.label);
    lab.style.transform = `rotate(${((i + 0.5) / n) * 360}deg) translateY(-38%)`;
    disc.append(lab);
  });
  const can = app.store.canSpin !== false;
  const btn = el('button', { class: 'btn primary', type: 'button', 'data-action': 'daily-spin', disabled: !can }, can ? '🎡 Spin!' : 'Come back tomorrow');
  btn.addEventListener('click', () => {
    btn.disabled = true;
    app.socket?.timeout(5000).emit('casino:spin', (err, res) => {
      if (err || !res.ok) {
        sfx.error();
        toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
        return;
      }
      sfx.click();
      const target = 360 - ((res.index + 0.5) / n) * 360;
      angle = angle - (angle % 360) + 360 * 6 + target;
      disc.style.transition = 'transform 4s cubic-bezier(0.15, 0.8, 0.2, 1)';
      disc.style.transform = `rotate(${angle}deg)`;
      window.setTimeout(() => {
        sfx.fanfare();
        const p = d.prizes[res.index];
        toast(`🎡 You won ${res.sen ? formatMoney(res.sen) : p.label}!`, 'good', 4000);
        app.store.canSpin = false;
        app.store.emit();
      }, 4100);
    });
  });
  return [
    el('p', { class: 'muted' }, 'One free spin every day. Money prizes grow with your wealth stage.'),
    el('div', { class: 'wof spin-wheel-big' }, disc, el('div', { class: 'wof-pointer' }, '▼')),
    btn,
    el('p', { class: 'hint' }, 'The Lucky Strand Casino (at The Strand) has slots, roulette, blackjack, crash, a shared wheel and High-Low.'),
  ];
}
