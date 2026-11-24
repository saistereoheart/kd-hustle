// Blackjack (spec §7.6): up to 5 players at one table against the dealer. Sit, bet, then act in
// turn: hit, stand, double, split. Dealer stands on 17. The server deals and settles.
import { formatMoney, handValue, type BlackjackView, type BjHand } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { starName } from '../stars';
import { openPanel } from '../panel';
import { sfx } from '../sound';
import { betPicker, cardEl, ok, secsLeft, sessionLine, watchTable } from './common';

const RESULT: Record<string, string> = { blackjack: '🃏 BLACKJACK', win: '✅ Win', push: '🤝 Push', lose: '❌ Lose', bust: '💥 Bust' };

function handEl(h: BjHand, active: boolean): HTMLElement {
  const v = handValue(h.cards.filter((c) => c >= 0));
  return el(
    'div',
    { class: `bj-hand${active ? ' active' : ''}${h.result ? ` r-${h.result}` : ''}` },
    el('div', { class: 'bj-cards' }, ...h.cards.map((c) => cardEl(c))),
    el('div', { class: 'small' }, `${v.soft && v.total < 21 ? 'soft ' : ''}${v.total} · ${formatMoney(h.bet)}${h.doubled ? ' (×2)' : ''}`),
    h.result ? el('div', { class: 'bj-result' }, `${RESULT[h.result]}${h.paid ? ` +${formatMoney(h.paid)}` : ''}`) : null,
  );
}

export function openBlackjack(app: App) {
  const panel = openPanel('🃏 Blackjack', { wide: true, testId: 'casino-blackjack' });
  const cc = app.cfg.casino.blackjack;
  const picker = betPicker(app, 'blackjack');
  const dealer = el('div', { class: 'bj-dealer' });
  const status = el('div', { class: 'casino-status' });
  const seats = el('div', { class: 'bj-seats' });
  const controls = el('div', { class: 'bj-controls' });
  const sess = el('div');
  let view: BlackjackView | null = null;
  const send = (event: 'casino:bj:leave', cb?: () => void) => app.socket?.timeout(5000).emit(event, (err, res) => ok(err, res) && cb?.());
  const act = (action: 'hit' | 'stand' | 'double' | 'split') =>
    app.socket?.timeout(5000).emit('casino:bj:act', { action }, (err, res) => {
      if (ok(err, res)) sfx.click();
    });

  const render = () => {
    if (!view) return;
    const v = view;
    const me = app.lastInit?.you.id;
    const mySeat = v.seats.findIndex((s) => s?.player === me);
    const turnMine = v.turn !== null && v.turn.seat === mySeat;
    const dv = handValue(v.dealer.filter((c) => c >= 0));
    dealer.replaceChildren(
      el('div', { class: 'muted small' }, 'Dealer'),
      el('div', { class: 'bj-cards' }, ...(v.dealer.length ? v.dealer.map((c) => cardEl(c)) : [el('span', { class: 'muted' }, '—')])),
      el('div', { class: 'small' }, !v.dealer.length ? '' : v.dealer.includes(-1) ? `showing ${dv.total}` : `${dv.total}${dv.total > 21 ? ' · bust!' : ''}`),
    );
    status.textContent =
      v.phase === 'waiting' ? (mySeat >= 0 ? 'Place a bet to start the hand.' : 'Take a seat to play.')
      : v.phase === 'betting' ? `Bets close in ${secsLeft(app, v.endsAt)}`
      : v.phase === 'playing' ? (turnMine ? `Your turn! ${secsLeft(app, v.endsAt)}` : `${starName(v.seats[v.turn!.seat]?.name)}'s turn · ${secsLeft(app, v.endsAt)}`)
      : 'Hand over.';
    seats.replaceChildren(
      ...v.seats.map((s, i) => {
        if (!s) {
          const sit = el('button', { class: 'btn small', type: 'button', 'data-action': `bj-sit-${i}`, disabled: mySeat >= 0 }, '🪑 Sit here');
          sit.addEventListener('click', () => app.socket?.timeout(5000).emit('casino:bj:sit', { seat: i }, (err, res) => ok(err, res) && sfx.click()));
          return el('div', { class: 'bj-seat empty' }, el('div', { class: 'muted small' }, `Seat ${i + 1}`), sit);
        }
        return el(
          'div',
          { class: `bj-seat${s.player === me ? ' mine' : ''}${v.turn?.seat === i ? ' turn' : ''}`, 'data-seat': String(i) },
          el('div', { class: 'bj-name' }, starName(s.name), s.bet && !s.hands.length ? el('span', { class: 'muted small' }, ` · bet ${formatMoney(s.bet)}`) : null),
          ...s.hands.map((h, hi) => handEl(h, v.turn?.seat === i && v.turn.hand === hi)),
        );
      }),
    );
    const btns: HTMLElement[] = [];
    if (mySeat >= 0) {
      const seat = v.seats[mySeat]!;
      if ((v.phase === 'waiting' || v.phase === 'betting') && !seat.bet) {
        const b = el('button', { class: 'btn primary', type: 'button', 'data-action': 'bj-bet' }, 'Bet', el('small', {}, formatMoney(picker.get())));
        b.addEventListener('click', () => app.socket?.timeout(5000).emit('casino:bj:bet', { sen: picker.get() }, (err, res) => ok(err, res) && sfx.coin()));
        btns.push(picker.el, b);
      }
      if (turnMine) {
        const h = seat.hands[v.turn!.hand];
        const pair = h.cards.length === 2 && Math.min(10, Math.floor(h.cards[0] / 4)) === Math.min(10, Math.floor(h.cards[1] / 4)) && seat.hands.length === 1;
        const mk = (a: 'hit' | 'stand' | 'double' | 'split', label: string, on = true) => {
          const b = el('button', { class: `btn${a === 'hit' || a === 'stand' ? ' primary' : ''}`, type: 'button', 'data-action': `bj-${a}`, disabled: !on }, label);
          b.addEventListener('click', () => act(a));
          return b;
        };
        btns.push(el('div', { class: 'stall-actions' }, mk('hit', '➕ Hit'), mk('stand', '✋ Stand'), mk('double', '×2 Double', h.cards.length === 2 && app.store.walletSen >= h.bet), mk('split', '✂️ Split', pair && app.store.walletSen >= h.bet)));
      }
      const leave = el('button', { class: 'btn small', type: 'button', 'data-action': 'bj-leave' }, 'Leave the table');
      leave.addEventListener('click', () => send('casino:bj:leave', () => toast('You left the table.', 'info')));
      btns.push(leave);
    }
    controls.replaceChildren(...btns);
  };
  const onView = (v: BlackjackView) => {
    const was = view;
    view = v;
    const me = app.lastInit?.you.id;
    const myNow = v.seats.find((s) => s?.player === me);
    if (v.phase === 'result' && was?.phase !== 'result' && myNow?.hands.length) {
      const won = myNow.hands.reduce((a, h) => a + (h.paid ?? 0) - h.bet, 0);
      if (won > 0) sfx.reveal(3);
      else if (won < 0) sfx.error();
    }
    if (v.turn && v.seats[v.turn.seat]?.player === me && !(was?.turn && was.turn.seat === v.turn.seat)) sfx.tick();
    render();
  };
  const stop = watchTable<BlackjackView>(app, 'blackjack', onView, (s) => sess.replaceChildren(sessionLine(s)));
  const clock = window.setInterval(render, 1000);
  panel.onClose = () => {
    stop();
    clearInterval(clock);
  };
  panel.body.append(
    el('div', { class: 'bj-table' }, dealer, status, seats),
    controls,
    el('p', { class: 'muted small' }, `Up to ${cc.seats} players. Blackjack pays ${cc.blackjackPays === 1.5 ? '3:2' : `${cc.blackjackPays}:1`}; the dealer stands on 17. You can keep your seat between hands.`),
    sess,
  );
}
