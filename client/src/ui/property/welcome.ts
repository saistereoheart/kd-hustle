// "Welcome back! While you were away you earned RM X" (spec §8.7), with the Lucky Spin: a wheel of
// multipliers (economy.offline.spin) under a pointer. The middle shows what you can claim right now;
// the server picks the segment and pays the extra, and the wheel lands on it.
import { formatMoney } from '@kh/shared';
import type { App } from '../../app';
import { el, toast, uiRoot } from '../dom';
import { sfx } from '../sound';

const COLORS = ['#4dabf7', '#69db7c', '#ffd43b', '#ff922b', '#f06595', '#9775fa', '#20c997', '#e64980'];
const SPIN_MS = 4500;

export function showWelcomeBack(app: App, w: { awayMs: number; earnedSen: number; lines: Array<{ label: string; sen: number; detail?: string }> }) {
  const h = Math.floor(w.awayMs / 3_600_000), m = Math.floor((w.awayMs % 3_600_000) / 60_000);
  const away = h ? `${h} h ${m} min` : `${m} min`;
  const segs = app.cfg.economy.offline.spin;
  const n = segs.length;
  // The wheel: one slice per multiplier, its label along the slice.
  const disc = el('div', { class: 'wof-disc welcome-disc' });
  disc.style.background = `conic-gradient(${segs.map((_, i) => `${COLORS[i % COLORS.length]} ${(i / n) * 360}deg ${((i + 1) / n) * 360}deg`).join(',')})`;
  segs.forEach((s, i) => {
    const lab = el('span', { class: 'spin-label' }, el('b', {}, `×${s.mult}`));
    lab.style.transform = `rotate(${((i + 0.5) / n) * 360}deg)`;
    disc.append(lab);
  });
  const claim = el('b', {}, formatMoney(w.earnedSen));
  const face = el('div', { class: 'welcome-face' }, el('small', {}, 'Claim'), claim);
  const wheel = el('div', { class: 'wof welcome-wheel' }, disc, el('div', { class: 'wof-pointer' }, '▼'), face);
  const spin = el('button', { class: 'btn primary', type: 'button', 'data-action': 'lucky-spin' }, `🎡 Lucky Spin: up to ×${Math.max(...segs.map((s) => s.mult))}!`);
  const ok = el('button', { class: 'btn', type: 'button', 'data-action': 'welcome-ok' }, 'Collect');
  const total = el('div', { class: 'welcome-total' }, `${w.earnedSen >= 0 ? '+' : ''}${formatMoney(w.earnedSen)}`);
  const card = el(
    'div',
    { class: 'modal welcome-back', role: 'dialog', 'data-testid': 'welcome-back' },
    el('h3', {}, '👋 Welcome back!'),
    el('p', {}, `While you were away (${away}), your money kept working:`),
    total,
    el('div', { class: 'welcome-lines' }, ...w.lines.map((l) => el('div', { class: 'setting-row welcome-line' }, el('span', {}, l.label, l.detail ? el('small', { class: 'muted' }, l.detail) : null), el('b', { class: l.sen < 0 ? 'neg' : '' }, `${l.sen >= 0 ? '+' : ''}${formatMoney(l.sen)}`)))),
    el('p', { class: 'muted small' }, `Offline income runs at ${Math.round(app.cfg.economy.offline.efficiency * 100)}% for up to ${app.cfg.economy.offline.capHours} hours.`),
    ...(w.earnedSen > 0 ? [wheel] : []),
    el('div', { class: 'actions' }, ...(w.earnedSen > 0 ? [spin] : []), ok),
  );
  const back = el('div', { class: 'modal-backdrop' }, card);
  ok.addEventListener('click', () => back.remove());
  spin.addEventListener('click', () => {
    spin.disabled = true;
    ok.disabled = true;
    app.socket?.timeout(5000).emit('welcome:spin', (err, res) => {
      if (err || !res.ok) {
        spin.disabled = false;
        ok.disabled = false;
        return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      }
      // Land the pointer (top) in the middle-ish of the winning slice.
      const jitter = (Math.random() - 0.5) * (360 / n) * 0.6;
      const target = 360 * 6 + 360 - ((res.index + 0.5) / n) * 360 + jitter;
      disc.style.transition = `transform ${SPIN_MS}ms cubic-bezier(0.15, 0.8, 0.2, 1)`;
      disc.style.transform = `rotate(${target}deg)`;
      let k = 0;
      const tick = window.setInterval(() => (k++ < 14 ? sfx.tick() : null), 260);
      window.setTimeout(() => {
        clearInterval(tick);
        ok.disabled = false;
        sfx.fanfare();
        claim.textContent = formatMoney(res.totalSen);
        face.classList.add('won');
        total.textContent = `+${formatMoney(res.totalSen)}`;
        spin.textContent = `✅ ×${res.mult}!`;
        toast(`🎡 ×${res.mult}! +${formatMoney(res.bonusSen)} more`, 'good', 4000);
      }, SPIN_MS + 100);
    });
  });
  uiRoot().append(back);
}
