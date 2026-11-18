// HustlePhone → Players: who's online, with Trade and Gift (RM or an item, after a confirm).
import { formatMoney, gradeDef } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { itemCard } from '../panel';
import { sfx } from '../sound';
import type { PhoneCtx } from './phone';

let list: Array<{ id: number; name: string; level: number; title: string | null }> = [];
let lastFetch = 0;
/** Gifting an item to this player: show the bag picker. */
let giftTo: { id: number; name: string } | null = null;

const ack = (ok?: string) => (err: Error | null, res: { ok: boolean; error?: string }) => {
  if (err || !res.ok) return (sfx.error(), toast(err ? 'No response.' : (res.error ?? ''), 'bad'));
  sfx.coin();
  if (ok) toast(ok, 'good');
};

export function renderPlayers({ app, rerender }: PhoneCtx): HTMLElement[] {
  if (Date.now() - lastFetch > 3000) {
    lastFetch = Date.now();
    app.socket?.timeout(5000).emit('players:list', (err, res) => {
      if (err || !res.ok) return;
      list = res.players;
      rerender();
    });
  }
  if (giftTo) {
    const to = giftTo;
    const back = el('button', { class: 'btn small', type: 'button' }, '‹ Back');
    back.addEventListener('click', () => {
      giftTo = null;
      rerender();
    });
    const worn = new Set(Object.values(app.store.equipped));
    const grid = el('div', { class: 'item-grid small' });
    for (const i of app.store.inventory) {
      const def = app.items.get(i.itemId);
      if (!def || worn.has(i.iid)) continue;
      const g = i.grade ?? 'D';
      const c = itemCard(app.cfg.rarities, def, i.variant, { grade: g, gradeColor: gradeDef(app.cfg.grades, g).color, serial: i.serial, size: 56 });
      c.style.cursor = 'pointer';
      c.addEventListener('click', () => {
        if (!confirm(`Give your ${def.name} to ${to.name}? You can't undo this.`)) return;
        app.socket?.timeout(5000).emit('gift:send', { to: to.id, sen: 0, items: [i.iid] }, ack());
      });
      grid.append(c);
    }
    return [back, el('h4', { class: 'phone-section' }, `🎁 Pick an item for ${to.name}`), grid];
  }
  if (!list.length) return [el('p', { class: 'muted' }, 'Nobody else is online right now.')];
  return list.map((p) => {
    const trade = el('button', { class: 'btn small primary', type: 'button', 'data-action': `trade-${p.id}` }, '🤝 Trade');
    trade.addEventListener('click', () => app.socket?.timeout(5000).emit('trade:request', { to: p.id }, ack()));
    const money = el('button', { class: 'btn small', type: 'button', 'data-action': `giftrm-${p.id}` }, '🎁 RM');
    money.addEventListener('click', () => {
      const v = Number(prompt(`How much RM do you give ${p.name}? (You have ${formatMoney(app.store.walletSen)})`, '100'));
      if (!(v > 0)) return;
      const sen = Math.round(v * 100);
      if (!confirm(`Give ${formatMoney(sen)} to ${p.name}? You can't undo this.`)) return;
      app.socket?.timeout(5000).emit('gift:send', { to: p.id, sen, items: [] }, ack());
    });
    const flip = el('button', { class: 'btn small', type: 'button', 'data-action': `coinflip-${p.id}` }, '🪙 Coinflip');
    flip.addEventListener('click', () => {
      const v = Number(prompt(`Coinflip ${p.name}: how much RM each? Winner takes the pot (minus 2%).`, '10'));
      if (v > 0) app.socket?.timeout(5000).emit('coinflip:challenge', { to: p.id, sen: Math.round(v * 100) }, ack());
    });
    const item = el('button', { class: 'btn small', type: 'button', 'data-action': `giftitem-${p.id}` }, '🎁 Item');
    item.addEventListener('click', () => {
      giftTo = { id: p.id, name: p.name };
      rerender();
    });
    return el(
      'div',
      { class: 'job-card', 'data-player': String(p.id) },
      el('div', { class: 'job-icon' }, '👤'),
      el('div', { class: 'job-info' }, el('h4', {}, p.name, el('span', { class: 'lv-badge' }, `Lv ${p.level}`)), el('div', { class: 'biz-actions' }, trade, flip, money, item)),
    );
  });
}
