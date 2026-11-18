// "Welcome back! While you were away you earned RM X" (spec §8.7), with the Lucky Spin: a
// 10-second wheel that doubles it (an in-game wheel, no ads). The server pays the bonus.
import { formatMoney } from '@kh/shared';
import type { App } from '../../app';
import { el, toast, uiRoot } from '../dom';
import { sfx } from '../sound';

export function showWelcomeBack(app: App, w: { awayMs: number; earnedSen: number; lines: Array<{ label: string; sen: number }> }) {
  const h = Math.floor(w.awayMs / 3_600_000), m = Math.floor((w.awayMs % 3_600_000) / 60_000);
  const away = h ? `${h} h ${m} min` : `${m} min`;
  const wheel = el('div', { class: 'spin-wheel' }, el('div', { class: 'spin-face' }, '×2'));
  const spin = el('button', { class: 'btn primary', type: 'button', 'data-action': 'lucky-spin' }, '🎡 Lucky Spin: double it!');
  const ok = el('button', { class: 'btn', type: 'button', 'data-action': 'welcome-ok' }, 'Collect');
  const card = el(
    'div',
    { class: 'modal welcome-back', role: 'dialog', 'data-testid': 'welcome-back' },
    el('h3', {}, '👋 Welcome back!'),
    el('p', {}, `While you were away (${away}), your homes kept working:`),
    el('div', { class: 'welcome-total' }, `${w.earnedSen >= 0 ? '+' : ''}${formatMoney(w.earnedSen)}`),
    el('div', { class: 'welcome-lines' }, ...w.lines.map((l) => el('div', { class: 'setting-row' }, el('span', {}, l.label), el('b', {}, formatMoney(l.sen))))),
    el('p', { class: 'muted small' }, `Offline income runs at ${Math.round(app.cfg.economy.offline.efficiency * 100)}% for up to ${app.cfg.economy.offline.capHours} hours.`),
    ...(w.earnedSen > 0 ? [wheel] : []),
    el('div', { class: 'actions' }, ...(w.earnedSen > 0 ? [spin] : []), ok),
  );
  const back = el('div', { class: 'modal-backdrop' }, card);
  ok.addEventListener('click', () => back.remove());
  spin.addEventListener('click', () => {
    spin.disabled = true;
    ok.disabled = true;
    wheel.classList.add('spinning');
    let n = 0;
    const tick = window.setInterval(() => (n++ % 2 ? sfx.tick() : null), 250);
    window.setTimeout(() => {
      clearInterval(tick);
      app.socket?.timeout(5000).emit('welcome:spin', (err, res) => {
        ok.disabled = false;
        wheel.classList.remove('spinning');
        if (err || !res.ok) return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
        sfx.fanfare();
        toast(`🎡 Doubled! +${formatMoney(res.bonusSen)}`, 'good', 4000);
        spin.textContent = '✅ Doubled!';
      });
    }, 10_000);
  });
  uiRoot().append(back);
}
