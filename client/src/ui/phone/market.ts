// HustlePhone → Pasar Online (spec §14): the marketplace. Browse and buy / bid, sell at a fixed
// price or as an auction (in-game hours), see each item's price history. A fee on every sale.
import { formatMoney, gradeDef, gradeMult, itemValueSen, minNextBid, type MarketListing } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { starName } from '../stars';
import { itemCard } from '../panel';
import { sfx } from '../sound';
import type { PhoneCtx } from './phone';

let tab: 'browse' | 'sell' | 'mine' = 'browse';
let picking: number | null = null; // iid being sold
let lastFetch = 0;
const history = new Map<string, string>(); // itemId → summary line

const ack = (ok?: string) => (err: Error | null, res: { ok: boolean; error?: string }) => {
  if (err || !res.ok) return (sfx.error(), toast(err ? 'No response.' : (res.error ?? ''), 'bad'));
  sfx.coin();
  if (ok) toast(ok, 'good');
};

function left(app: App, endsAt: number | null): string {
  if (!endsAt) return '';
  const s = Math.max(0, Math.round((endsAt - app.store.serverNow()) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)} min left` : `${s} s left`;
}

function listingCard(app: App, l: MarketListing, rerender: () => void): HTMLElement | null {
  const def = app.items.get(l.itemId);
  if (!def) return null;
  const me = app.lastInit?.you.id;
  const mc = app.cfg.market;
  const card = itemCard(app.cfg.rarities, def, l.variant, { grade: l.grade, gradeColor: gradeDef(app.cfg.grades, l.grade).color, serial: l.serial, size: 56 });
  const value = itemValueSen(app.cfg.rarities, def, app.cratesOfItem.get(l.itemId), l.variant, gradeMult(app.cfg.grades, l.grade));
  const btns: HTMLElement[] = [];
  if (l.seller === me) {
    const c = el('button', { class: 'btn small', type: 'button', 'data-action': `mk-cancel-${l.id}`, disabled: l.topBidder !== null }, l.topBidder !== null ? 'Has bids' : 'Take back');
    c.addEventListener('click', () => app.socket?.timeout(5000).emit('market:cancel', { id: l.id }, ack()));
    btns.push(c);
  } else if (l.kind === 'fixed') {
    const b = el('button', { class: 'btn small primary', type: 'button', 'data-action': `mk-buy-${l.id}`, disabled: app.store.walletSen < l.priceSen }, 'Buy', el('small', {}, formatMoney(l.priceSen)));
    b.addEventListener('click', () => confirm(`Buy ${def.name} for ${formatMoney(l.priceSen)}?`) && app.socket?.timeout(5000).emit('market:buy', { id: l.id }, ack(`🛒 ${def.name} is yours!`)));
    btns.push(b);
  } else {
    const min = minNextBid(mc, l);
    const mine = l.topBidder === me;
    const b = el('button', { class: 'btn small primary', type: 'button', 'data-action': `mk-bid-${l.id}`, disabled: mine || app.store.walletSen < min }, mine ? 'You lead' : 'Bid', el('small', {}, mine ? formatMoney(l.topBidSen) : `${formatMoney(min)}+`));
    b.addEventListener('click', () => {
      const v = Number(prompt(`Your bid for ${def.name} (at least ${formatMoney(min)}). It's held until someone outbids you.`, String(min / 100)));
      if (v > 0) app.socket?.timeout(5000).emit('market:bid', { id: l.id, sen: Math.round(v * 100) }, ack('Bid placed.'));
    });
    btns.push(b);
  }
  const hist = el('button', { class: 'btn small', type: 'button', 'data-action': `mk-hist-${l.id}` }, '📈');
  hist.addEventListener('click', () =>
    app.socket?.timeout(5000).emit('market:history', { itemId: l.itemId }, (err, res) => {
      if (err || !res.ok) return;
      history.set(l.itemId, res.sales.length ? `Last ${res.sales.length} sales avg ${formatMoney(res.avgSen!)}: ${res.sales.slice(0, 5).map((s) => formatMoney(s.priceSen)).join(', ')}` : 'No sales yet.');
      rerender();
    }),
  );
  btns.push(hist);
  const price = l.kind === 'fixed' ? formatMoney(l.priceSen) : l.topBidder !== null ? `top bid ${formatMoney(l.topBidSen)} (${l.topBidderName})` : `starts at ${formatMoney(l.priceSen)}`;
  return el(
    'div',
    { class: 'job-card bq-card', 'data-listing': String(l.id) },
    card,
    el('div', { class: 'job-info' },
      el('h4', {}, def.name, el('span', { class: 'lv-badge' }, l.kind === 'fixed' ? 'Buy now' : `🔨 ${left(app, l.endsAt)}`)),
      el('div', { class: 'small' }, price),
      el('div', { class: 'muted small' }, `${l.seller === me ? 'Your listing' : `by ${starName(l.sellerName)}`} · worth about ${formatMoney(value)}`),
      history.has(l.itemId) ? el('div', { class: 'muted small' }, history.get(l.itemId)!) : null,
      el('div', { class: 'biz-actions' }, ...btns)),
  );
}

export function renderMarket({ app, rerender }: PhoneCtx): HTMLElement[] {
  const mc = app.cfg.market;
  if (Date.now() - lastFetch > 10_000) {
    lastFetch = Date.now();
    app.socket?.timeout(5000).emit('market:view', (err, res) => {
      if (err || !res.ok) return;
      app.store.marketListings = res.listings;
      app.store.emit();
    });
  }
  const tabs = el('div', { class: 'branch-tabs' });
  for (const [id, name] of [['browse', '🛍️ Browse'], ['sell', '🏷️ Sell'], ['mine', '📋 Mine']] as const) {
    const b = el('button', { class: `branch-tab${tab === id ? ' active' : ''}`, type: 'button', 'data-mtab': id }, name);
    b.addEventListener('click', () => {
      tab = id;
      rerender();
    });
    tabs.append(b);
  }
  const me = app.lastInit?.you.id;
  const all = app.store.marketListings;
  if (mc.requires.stage && app.store.progress.stage < mc.requires.stage) return [tabs, el('p', { class: 'muted' }, `🔒 ${mc.name} opens at wealth stage ${mc.requires.stage}.`)];
  if (tab === 'browse') {
    const others = all.filter((l) => l.seller !== me).sort((a, b) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity));
    return [tabs, ...(others.length ? others.map((l) => listingCard(app, l, rerender)).filter((x): x is HTMLElement => !!x) : [el('p', { class: 'muted' }, 'Nothing for sale right now. Be the first!')]),
      el('p', { class: 'hint' }, `Bids are held until someone outbids you (then refunded). A bid in the last ${mc.antiSnipeMs / 1000} s extends the auction.`)];
  }
  if (tab === 'mine') {
    const mine = all.filter((l) => l.seller === me || l.topBidder === me);
    return [tabs, ...(mine.length ? mine.map((l) => listingCard(app, l, rerender)).filter((x): x is HTMLElement => !!x) : [el('p', { class: 'muted' }, 'No listings or bids.')])];
  }
  // Sell: pick an item, then fixed price or auction.
  const worn = new Set(Object.values(app.store.equipped));
  const grid = el('div', { class: 'item-grid small' });
  for (const i of app.store.inventory) {
    const def = app.items.get(i.itemId);
    if (!def || worn.has(i.iid)) continue;
    const g = i.grade ?? 'D';
    const c = itemCard(app.cfg.rarities, def, i.variant, { grade: g, gradeColor: gradeDef(app.cfg.grades, g).color, serial: i.serial, size: 56 });
    if (picking === i.iid) c.classList.add('selected');
    c.addEventListener('click', () => {
      picking = picking === i.iid ? null : i.iid;
      rerender();
    });
    grid.append(c);
  }
  const out: HTMLElement[] = [tabs];
  const inst = app.store.inventory.find((i) => i.iid === picking);
  if (inst) {
    const def = app.items.get(inst.itemId)!;
    const value = Math.max(100, itemValueSen(app.cfg.rarities, def, app.cratesOfItem.get(inst.itemId), inst.variant, gradeMult(app.cfg.grades, inst.grade ?? 'D')));
    const sell = (kind: 'fixed' | 'auction', priceSen: number, hours?: number) =>
      app.socket?.timeout(5000).emit('market:list', { iid: inst.iid, kind, priceSen, hours }, (err, res) => {
        if (err || !res.ok) return (sfx.error(), toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad'));
        sfx.coin();
        app.store.removeItems([res.removed]);
        picking = null;
        toast(`${def.name} is on ${mc.name}.`, 'good');
      });
    const fixed = el('div', { class: 'biz-actions' }, ...[1, 1.5, 2].map((k) => {
      const p = Math.round((value * k) / 100) * 100;
      const b = el('button', { class: 'btn small', type: 'button', 'data-fixed': String(k) }, `🏷️ ${formatMoney(p)}`, el('small', {}, k === 1 ? 'its value' : `${k}× value`));
      b.addEventListener('click', () => sell('fixed', p));
      return b;
    }));
    const other = el('button', { class: 'btn small', type: 'button' }, '🏷️ Other price…');
    other.addEventListener('click', () => {
      const v = Number(prompt(`Fixed price for ${def.name} in RM:`, String(Math.round(value / 100))));
      if (v > 0) sell('fixed', Math.round(v * 100));
    });
    fixed.append(other);
    const auction = el('div', { class: 'biz-actions' }, ...mc.auctionHours.map((h) => {
      const b = el('button', { class: 'btn small', type: 'button', 'data-auction': String(h) }, `🔨 ${h} game h`, el('small', {}, `${Math.round((h * 60 * app.cfg.time.realMsPerGameMinute) / 60000)} real min`));
      b.addEventListener('click', () => {
        const v = Number(prompt(`Starting price for ${def.name} in RM:`, String(Math.max(1, Math.round(value / 200)))));
        if (v > 0) sell('auction', Math.round(v * 100), h);
      });
      return b;
    }));
    out.push(el('div', { class: 'job-card' }, el('div', { class: 'job-info' }, el('h4', {}, `Sell ${def.name}`), el('div', { class: 'muted small' }, `Worth about ${formatMoney(value)}. ${Math.round(mc.feeRate * 100)}% fee when it sells.`), el('div', { class: 'small' }, 'Fixed price:'), fixed, el('div', { class: 'small' }, 'Or auction it:'), auction)));
  }
  out.push(el('p', { class: 'muted small' }, 'Tap an item to sell it:'), grid);
  return out;
}
