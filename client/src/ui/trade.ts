// The trade window (spec §14): both players put in items and/or RM, both lock, both confirm,
// then the server swaps everything at once. Any change unlocks both sides. Estimated values
// help you judge the deal. Also: the incoming request prompt.
import { formatMoney, gradeDef, gradeMult, itemValueSen, type InventoryItem, type TradeSide, type TradeView } from '@kh/shared';
import type { App } from '../app';
import { el, toast, uiRoot } from './dom';
import { itemCard } from './panel';
import { sfx } from './sound';

let host: HTMLElement | null = null;
let picking = false;

const ack = (err: Error | null, res: { ok: boolean; error?: string }) => {
  if (err || !res.ok) {
    sfx.error();
    toast(err ? 'No response.' : (res.error ?? ''), 'bad');
  }
};

function valueOf(app: App, i: InventoryItem): number {
  const def = app.items.get(i.itemId);
  return def ? itemValueSen(app.cfg.rarities, def, app.cratesOfItem.get(i.itemId), i.variant, gradeMult(app.cfg.grades, i.grade ?? 'D')) : 0;
}

function card(app: App, i: InventoryItem, onClick?: () => void): HTMLElement {
  const def = app.items.get(i.itemId)!;
  const g = i.grade ?? 'D';
  const c = itemCard(app.cfg.rarities, def, i.variant, { grade: g, gradeColor: gradeDef(app.cfg.grades, g).color, serial: i.serial, size: 56, caption: formatMoney(valueOf(app, i)) });
  if (onClick) {
    c.style.cursor = 'pointer';
    c.addEventListener('click', onClick);
  }
  return c;
}

function sideEl(app: App, s: TradeSide, mine: boolean, onRemove?: (iid: number) => void): HTMLElement {
  const total = s.items.reduce((a, i) => a + valueOf(app, i), 0) + s.sen;
  return el(
    'div',
    { class: `trade-side${s.locked ? ' locked' : ''}`, 'data-side': mine ? 'me' : 'them' },
    el('h4', {}, mine ? 'You give' : `${s.name} gives`, el('span', { class: `lv-badge${s.locked ? ' good' : ''}` }, s.confirmed ? '✅ confirmed' : s.locked ? '🔒 locked' : 'editing')),
    el('div', { class: 'item-grid small' }, ...s.items.map((i) => card(app, i, mine && onRemove ? () => onRemove(i.iid) : undefined))),
    s.sen ? el('div', { class: 'trade-money' }, `💵 ${formatMoney(s.sen)}`) : null,
    !s.items.length && !s.sen ? el('p', { class: 'muted small' }, 'Nothing yet.') : null,
    el('div', { class: 'muted small' }, `Worth about ${formatMoney(total)}`),
  );
}

export function showTrade(app: App, t: TradeView | null) {
  if (!t) {
    host?.remove();
    host = null;
    picking = false;
    return;
  }
  host ??= el('div', { class: 'modal-backdrop panel-backdrop trade-backdrop' });
  if (!host.isConnected) uiRoot().append(host);
  const offer = (items: number[], sen: number) => app.socket?.timeout(5000).emit('trade:offer', { items, sen }, ack);
  const myIids = t.me.items.map((i) => i.iid);
  const box = el('div', { class: 'panel wide trade-panel', role: 'dialog', 'data-testid': 'trade' });
  const cancel = el('button', { class: 'btn', type: 'button', 'data-action': 'trade-cancel' }, 'Cancel trade');
  cancel.addEventListener('click', () => app.socket?.timeout(5000).emit('trade:cancel', ack));
  const lock = el('button', { class: 'btn primary', type: 'button', 'data-action': 'trade-lock', disabled: t.me.locked }, t.me.locked ? '🔒 Locked' : '🔒 Lock my offer');
  lock.addEventListener('click', () => app.socket?.timeout(5000).emit('trade:lock', ack));
  const both = t.me.locked && t.them.locked;
  const confirmBtn = el('button', { class: 'btn primary', type: 'button', 'data-action': 'trade-confirm', disabled: !both || t.me.confirmed }, t.me.confirmed ? `Waiting for ${t.them.name}…` : '🤝 Confirm the trade');
  confirmBtn.addEventListener('click', () => app.socket?.timeout(5000).emit('trade:confirm', ack));
  const money = el('button', { class: 'btn small', type: 'button', 'data-action': 'trade-money' }, t.me.sen ? `💵 ${formatMoney(t.me.sen)} (change)` : '💵 Add money');
  money.addEventListener('click', () => {
    const v = Number(prompt(`How much RM do you put in? (You have ${formatMoney(app.store.walletSen)})`, String(t.me.sen / 100)));
    if (Number.isFinite(v) && v >= 0) offer(myIids, Math.round(v * 100));
  });
  const add = el('button', { class: 'btn small', type: 'button', 'data-action': 'trade-add' }, picking ? 'Done adding' : '➕ Add items');
  add.addEventListener('click', () => {
    picking = !picking;
    showTrade(app, app.store.trade);
  });
  const pickGrid = el('div', { class: 'item-grid small trade-pick' });
  if (picking) {
    const worn = new Set(Object.values(app.store.equipped));
    for (const i of app.store.inventory) {
      if (myIids.includes(i.iid) || worn.has(i.iid) || !app.items.get(i.itemId)) continue;
      pickGrid.append(card(app, i, () => offer([...myIids, i.iid], t.me.sen)));
    }
    if (!pickGrid.childElementCount) pickGrid.append(el('p', { class: 'muted small' }, 'Nothing else to add (worn items can\'t be traded).'));
  }
  box.append(
    el('div', { class: 'panel-head' }, el('h3', {}, `🤝 Trade with ${t.them.name}`)),
    el(
      'div',
      { class: 'panel-body' },
      el('div', { class: 'trade-sides' }, sideEl(app, t.me, true, (iid) => offer(myIids.filter((x) => x !== iid), t.me.sen)), sideEl(app, t.them, false)),
      el('div', { class: 'biz-actions' }, add, money),
      picking ? el('div', {}, el('p', { class: 'muted small' }, 'Tap an item to add it (tap it in your offer to take it out):'), pickGrid) : null,
      el('p', { class: 'hint' }, both ? 'Both locked: check the offers, then confirm. Any change unlocks both of you.' : 'Lock when you\'re happy. If anyone changes their offer, both of you have to lock again.'),
      el('div', { class: 'stall-actions' }, cancel, lock, confirmBtn),
    ),
  );
  host.replaceChildren(box);
}

/** Someone wants to trade: accept or decline (gone after 60 s). */
export function showTradeRequest(app: App, from: number, name: string) {
  sfx.tick();
  const yes = el('button', { class: 'btn primary', type: 'button', 'data-action': 'trade-accept' }, 'Trade');
  const no = el('button', { class: 'btn', type: 'button', 'data-action': 'trade-decline' }, 'No thanks');
  const card = el('div', { class: 'modal trade-request', role: 'dialog' }, el('h3', {}, '🤝 Trade request'), el('p', {}, `${name} wants to trade with you.`), el('div', { class: 'actions' }, no, yes));
  const back = el('div', { class: 'modal-backdrop' }, card);
  const close = () => back.remove();
  const t = window.setTimeout(close, 60_000);
  const answer = (accept: boolean) => {
    clearTimeout(t);
    close();
    app.socket?.timeout(5000).emit('trade:respond', { from, accept }, ack);
  };
  yes.addEventListener('click', () => answer(true));
  no.addEventListener('click', () => answer(false));
  uiRoot().append(back);
}
