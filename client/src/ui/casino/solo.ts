// Solo casino games: the slot machines and High-Low. The server spins / draws; this animates.
import { cardLabel, cardRank, formatMoney, highLowMult, slotsRtp, type Card, type CasinoSession } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { openPanel } from '../panel';
import { sfx } from '../sound';
import { betPicker, cardEl, ok, sessionLine } from './common';

export function openSlots(app: App) {
  const panel = openPanel('🎰 Slot Machines', { testId: 'casino-slots' });
  const cc = app.cfg.casino;
  const syms = cc.slots.symbols;
  const icon = (id: string) => syms.find((s) => s.id === id)?.icon ?? '❔';
  const reels = [0, 1, 2].map(() => el('div', { class: 'slot-reel' }, icon(syms[0].id)));
  const result = el('div', { class: 'slot-result' }, 'Pull the lever!');
  let session: CasinoSession | null = null;
  const sess = el('div');
  const picker = betPicker(app, 'slots');
  const spin = el('button', { class: 'btn primary', type: 'button', 'data-action': 'slots-spin' }, '🎰 Spin');
  let busy = false;
  spin.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    spin.disabled = true;
    sfx.click();
    result.textContent = '…';
    // Spin the reels while the server decides.
    const t0 = performance.now();
    const anim = window.setInterval(() => reels.forEach((r) => (r.textContent = syms[Math.floor(Math.random() * syms.length)].icon)), 70);
    const bet = picker.get();
    app.socket?.timeout(5000).emit('casino:slots', { sen: bet }, (err, res) => {
      const stopAt = Math.max(0, 900 - (performance.now() - t0));
      window.setTimeout(() => {
        clearInterval(anim);
        busy = false;
        spin.disabled = false;
        if (!ok(err, res)) return (result.textContent = 'Pull the lever!');
        if (!res.ok) return;
        // Stop the reels one by one.
        res.reels.forEach((id, i) => window.setTimeout(() => {
          reels[i].textContent = icon(id);
          reels[i].classList.add('stop');
          window.setTimeout(() => reels[i].classList.remove('stop'), 300);
          sfx.tick();
        }, i * 220));
        window.setTimeout(() => {
          if (res.paidSen > 0 && res.mult < 1) {
            // Two cherries: part of the bet back. Not a win, so don't dress it up as one.
            result.textContent = `${icon(syms[0].id)}${icon(syms[0].id)} ${formatMoney(res.paidSen)} back (${Math.round(res.mult * 100)}% of your bet)`;
            result.className = 'slot-result';
          } else if (res.paidSen > 0) {
            sfx.reveal(res.mult >= 25 ? 4 : res.mult >= 5 ? 3 : 2);
            result.textContent = res.mult >= 100 ? `💥 JACKPOT! +${formatMoney(res.paidSen - bet)} profit (×${res.mult})` : `WIN ×${res.mult}: ${formatMoney(res.paidSen)} (+${formatMoney(res.paidSen - bet)} profit)`;
            result.className = 'slot-result win';
          } else {
            result.textContent = 'No luck. Again?';
            result.className = 'slot-result';
          }
          refresh();
        }, 700);
      }, stopAt);
    });
  });
  const pays = el('div', { class: 'casino-pays muted small' }, ...syms.map((s) => el('span', {}, `${s.icon}${s.icon}${s.icon} ×${s.three}`)), el('span', {}, `${syms[0].icon}${syms[0].icon} anywhere: ${Math.round(cc.slots.twoOfFirst * 100)}% back`), el('span', {}, `Returns ${(slotsRtp(cc) * 100).toFixed(1)}% on average`));
  const refresh = () =>
    app.socket?.timeout(5000).emit('casino:session', (err, res) => {
      if (err || !res.ok) return;
      session = res.session;
      sess.replaceChildren(sessionLine(session));
    });
  refresh();
  panel.body.append(el('div', { class: 'slot-machine' }, ...reels), result, picker.el, spin, pays, sess);
}

export function openHighLow(app: App) {
  const panel = openPanel('🔼 High-Low', { testId: 'casino-highlow' });
  const cc = app.cfg.casino;
  const picker = betPicker(app, 'highlow');
  const body = el('div', { class: 'hl-body' });
  const sess = el('div');
  panel.body.append(body, sess);
  let state: { card: Card; pot: number; bet: number; streak: number } | null = null;
  let last: Card | null = null;
  let note = 'Higher or lower than the card? Each right guess multiplies your pot. Cash out any time.';

  const render = () => {
    if (!state) {
      const start = el('button', { class: 'btn primary', type: 'button', 'data-action': 'hl-start' }, '🃏 Deal', el('small', {}, `bet ${formatMoney(picker.get())}`));
      start.addEventListener('click', () =>
        app.socket?.timeout(5000).emit('casino:hl:start', { sen: picker.get() }, (err, res) => {
          if (!ok(err, res) || !res.ok) return;
          sfx.click();
          state = res.state;
          last = null;
          note = 'Higher or lower?';
          render();
        }),
      );
      body.replaceChildren(el('div', { class: 'hl-cards' }, last !== null ? cardEl(last, 'big') : cardEl(-1, 'big')), el('p', { class: 'muted' }, note), picker.el, start);
      return;
    }
    const r = cardRank(state.card);
    const guess = (g: 'higher' | 'lower') => {
      const m = highLowMult(cc, r, g);
      const b = el('button', { class: 'btn primary', type: 'button', 'data-action': `hl-${g}`, disabled: !m }, g === 'higher' ? '⬆️ Higher' : '⬇️ Lower', el('small', {}, m ? `×${m}` : '—'));
      b.addEventListener('click', () =>
        app.socket?.timeout(5000).emit('casino:hl:guess', { guess: g }, (err, res) => {
          if (!ok(err, res) || !res.ok) return;
          last = res.card;
          if (res.correct) {
            sfx.reveal(2);
            state = res.state;
            if (!state) note = `🔥 Max streak! Paid ${formatMoney(res.paidSen)}.`;
          } else {
            sfx.error();
            note = `❌ ${cardLabel(res.card)}: not ${g}. You lost the pot.`;
            state = null;
          }
          render();
          refresh();
        }),
      );
      return b;
    };
    const cash = el('button', { class: 'btn', type: 'button', 'data-action': 'hl-cashout', disabled: state.streak === 0 }, '💰 Cash out', el('small', {}, formatMoney(state.pot)));
    cash.addEventListener('click', () =>
      app.socket?.timeout(5000).emit('casino:hl:cashout', (err, res) => {
        if (!ok(err, res) || !res.ok) return;
        sfx.coin();
        toast(`+${formatMoney(res.paidSen)}`, 'good');
        note = `Cashed out ${formatMoney(res.paidSen)}. Deal again?`;
        last = state?.card ?? null;
        state = null;
        render();
        refresh();
      }),
    );
    body.replaceChildren(
      el('div', { class: 'hl-cards' }, last !== null && state.streak ? cardEl(last, 'small') : null, cardEl(state.card, 'big')),
      el('div', { class: 'hl-pot' }, `Pot ${formatMoney(state.pot)}`, el('span', { class: 'muted small' }, ` · streak ${state.streak}/${cc.highlow.maxStreak}`)),
      el('div', { class: 'stall-actions' }, guess('lower'), guess('higher')),
      cash,
      el('p', { class: 'muted small' }, 'A tie counts as a miss. Leaving cashes you out.'),
    );
  };
  const refresh = () =>
    app.socket?.timeout(5000).emit('casino:session', (err, res) => {
      if (err || !res.ok) return;
      sess.replaceChildren(sessionLine(res.session));
      if (res.highlow && !state) {
        state = res.highlow; // a game was already going
        render();
      }
    });
  render();
  refresh();
}
