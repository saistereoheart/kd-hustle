// PvP coinflip on the client: the incoming challenge prompt and the coin spin result.
import { formatMoney } from '@kh/shared';
import type { App } from '../app';
import { el, toast, uiRoot } from './dom';
import { sfx } from './sound';

export function showCoinflipChallenge(app: App, from: number, name: string, sen: number) {
  sfx.tick();
  const yes = el('button', { class: 'btn primary', type: 'button', 'data-action': 'coinflip-accept' }, `🪙 Flip for ${formatMoney(sen)}`);
  const no = el('button', { class: 'btn', type: 'button', 'data-action': 'coinflip-decline' }, 'No thanks');
  const back = el('div', { class: 'modal-backdrop' }, el('div', { class: 'modal', role: 'dialog' }, el('h3', {}, '🪙 Coinflip challenge'),
    el('p', {}, `${name} challenges you: ${formatMoney(sen)} each, winner takes the pot (minus a 2% house fee). ${name} is heads, you're tails.`),
    el('div', { class: 'actions' }, no, yes)));
  const t = window.setTimeout(() => back.remove(), 60_000);
  const answer = (accept: boolean) => {
    clearTimeout(t);
    back.remove();
    app.socket?.timeout(5000).emit('coinflip:respond', { from, accept }, (err, res) => {
      if (err || !res.ok) (sfx.error(), toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad'));
    });
  };
  yes.addEventListener('click', () => answer(true));
  no.addEventListener('click', () => answer(false));
  uiRoot().append(back);
}

export function showCoinflipResult(app: App, r: { a: string; b: string; winner: string; side: 'heads' | 'tails'; sen: number; wonSen: number }) {
  const me = app.lastInit?.you.name;
  const coin = el('div', { class: `coin spin-${r.side}` }, el('span', { class: 'coin-face heads' }, 'H'), el('span', { class: 'coin-face tails' }, 'T'));
  const text = el('div', { class: 'dish-quality' }, '…');
  const ok = el('button', { class: 'btn', type: 'button' }, 'OK');
  const host = el('div', { class: 'reveal-overlay' }, el('div', { class: 'carwash-box', 'data-testid': 'coinflip' }, el('p', { class: 'muted' }, `${r.a} (heads) vs ${r.b} (tails) · ${formatMoney(r.sen)} each`), coin, text, el('div', { class: 'cw-foot' }, ok)));
  ok.addEventListener('click', () => host.remove());
  uiRoot().append(host);
  window.setTimeout(() => {
    const won = r.winner === me;
    text.textContent = `${r.side === 'heads' ? 'Heads' : 'Tails'}! ${won ? `You win ${formatMoney(r.wonSen)}!` : `${r.winner} wins.`}`;
    text.style.color = won ? '#69db7c' : '#ff8787';
    if (won) sfx.reveal(3);
    else sfx.error();
  }, 1800);
}
