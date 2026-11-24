// HustlePhone → Butik (Phase 6, spec §8.5): the player-item boutique. Browse what other players
// have on display and buy it, or open your own butik and put gacha items on display at your
// prices. Sales while you're offline are paid at your next login.
import { formatMoney, gradeDef, gradeMult, itemValueSen, type Listing } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { starName } from '../stars';
import { itemCard } from '../panel';
import { sfx } from '../sound';
import type { PhoneCtx } from './phone';

let tab: 'browse' | 'mine' = 'browse';
/** The stack you're about to list (key), if any. */
let picking: string | null = null;

const fail = (err: Error | null, res: { ok: boolean; error?: string }) => {
  sfx.error();
  toast(err ? 'No response.' : (res.error ?? ''), 'bad');
};

function valueOf(app: App, itemId: string, variant: string, grade: string): number {
  const def = app.items.get(itemId);
  if (!def) return 0;
  return itemValueSen(app.cfg.rarities, def, app.cratesOfItem.get(itemId), variant, gradeMult(app.cfg.grades, grade));
}

function listingCard(app: App, l: Listing, mine: boolean): HTMLElement | null {
  const def = app.items.get(l.itemId);
  if (!def) return null;
  const card = itemCard(app.cfg.rarities, def, l.variant, { grade: l.grade, gradeColor: gradeDef(app.cfg.grades, l.grade).color, serial: l.serial, caption: formatMoney(l.priceSen) });
  const value = valueOf(app, l.itemId, l.variant, l.grade);
  const btn = mine
    ? el('button', { class: 'btn small', type: 'button', 'data-action': `bq-cancel-${l.id}` }, 'Take back')
    : el('button', { class: 'btn small primary', type: 'button', 'data-action': `bq-buy-${l.id}`, disabled: app.store.walletSen < l.priceSen }, 'Buy', el('small', {}, formatMoney(l.priceSen)));
  btn.addEventListener('click', () => {
    if (!mine && !confirm(`Buy ${def.name} from ${l.sellerName} for ${formatMoney(l.priceSen)}?`)) return;
    app.socket?.timeout(5000).emit(mine ? 'boutique:cancel' : 'boutique:buy', { id: l.id }, (err, res) => {
      if (err || !res.ok) return fail(err, res as { ok: boolean; error?: string });
      sfx.coin();
      toast(mine ? `${def.name} is back in your bag.` : `👜 ${def.name} is yours!`, 'good');
    });
  });
  return el(
    'div',
    { class: 'job-card bq-card', 'data-listing': String(l.id) },
    card,
    el(
      'div',
      { class: 'job-info' },
      el('h4', {}, def.name),
      el('div', { class: 'muted small' }, `${mine ? 'On display' : `From ${starName(l.sellerName)}'s butik`} · worth about ${formatMoney(value)}`),
      el('div', { class: 'biz-actions' }, btn),
    ),
  );
}

function browse(app: App): HTMLElement[] {
  const me = app.lastInit?.you.id;
  const others = app.store.listings.filter((l) => l.seller !== me);
  if (!others.length) return [el('p', { class: 'muted' }, 'Nothing on display right now. When other players put items in their butik, they show up here (even while they\'re offline).')];
  // Rarest first.
  const tiers = app.cfg.rarities.tiers.map((t) => t.id);
  const rank = (l: Listing) => tiers.indexOf(app.items.get(l.itemId)?.rarity ?? 'common');
  return [...others].sort((a, b) => rank(b) - rank(a) || a.priceSen - b.priceSen).map((l) => listingCard(app, l, false)).filter((x): x is HTMLElement => !!x);
}

function mine(app: App, rerender: () => void): HTMLElement[] {
  const b = app.cfg.businesses.boutique;
  const st = app.store;
  const self = st.boutique;
  if (!self?.open) {
    const lock = b.requires.stage && st.progress.stage < b.requires.stage ? `Needs wealth stage ${b.requires.stage}` : null;
    const open = el('button', { class: 'btn primary', type: 'button', 'data-action': 'bq-open', disabled: !!lock || st.walletSen < b.openSen }, lock ? `🔒 ${lock}` : `Open a ${b.name}`, lock ? null : el('small', {}, formatMoney(b.openSen)));
    open.addEventListener('click', () => app.socket?.timeout(5000).emit('boutique:open', (err, res) => (err || !res.ok ? fail(err, res as { ok: boolean; error?: string }) : (sfx.coin(), toast(`${b.icon} Your ${b.name} is open!`, 'good')))));
    return [el('div', { class: 'job-card' }, el('div', { class: 'job-icon' }, b.icon), el('div', { class: 'job-info' }, el('h4', {}, b.name), el('p', {}, `Put up to ${b.slots} of your gacha items on display at your own prices. Other players can buy them any time, even while you're offline. ${Math.round(b.feeRate * 100)}% consignment fee on each sale.`)), open)];
  }
  const me = app.lastInit?.you.id;
  const listed = st.listings.filter((l) => l.seller === me);
  const out: HTMLElement[] = [
    el('div', { class: 'job-card' }, el('div', { class: 'job-icon' }, b.icon), el('div', { class: 'job-info' }, el('h4', {}, `Your ${b.name}`, el('span', { class: 'lv-badge' }, `${listed.length}/${b.slots} on display`)), el('div', { class: 'muted small' }, `${self.soldCount} sold · ${formatMoney(self.earnedSen)} earned (after the ${Math.round(b.feeRate * 100)}% fee)`))),
  ];
  if (listed.length) out.push(el('h4', { class: 'phone-section' }, 'On display'), ...listed.map((l) => listingCard(app, l, true)).filter((x): x is HTMLElement => !!x));
  if (listed.length >= b.slots) return out;
  // Pick something from your bag to put on display (not worn; placed furniture can't be sold).
  const worn = new Set(Object.values(st.equipped));
  const stacks = st.stacks().filter((s) => s.items.some((i) => !worn.has(i.iid)));
  out.push(el('h4', { class: 'phone-section' }, 'Put on display'));
  if (!stacks.length) return [...out, el('p', { class: 'muted' }, 'Nothing to sell: roll some crates!')];
  const grid = el('div', { class: 'item-grid small' });
  for (const s of stacks) {
    const def = app.items.get(s.itemId);
    if (!def) continue;
    const key = `${s.itemId}|${s.variant}|${s.grade}|${s.serial ?? ''}`;
    const card = itemCard(app.cfg.rarities, def, s.variant, { count: s.items.length, grade: s.grade, gradeColor: gradeDef(app.cfg.grades, s.grade).color, serial: s.serial, size: 56 });
    card.dataset.pick = key;
    if (picking === key) card.classList.add('selected');
    card.addEventListener('click', () => {
      picking = picking === key ? null : key;
      rerender();
    });
    grid.append(card);
  }
  const chosen = stacks.find((s) => `${s.itemId}|${s.variant}|${s.grade}|${s.serial ?? ''}` === picking);
  if (chosen) {
    const def = app.items.get(chosen.itemId)!;
    const iid = chosen.items.find((i) => !worn.has(i.iid))!.iid;
    const value = Math.max(100, valueOf(app, chosen.itemId, chosen.variant, chosen.grade));
    const row = el('div', { class: 'biz-actions' });
    const list = (priceSen: number) =>
      app.socket?.timeout(5000).emit('boutique:list', { iid, priceSen }, (err, res) => {
        if (err || !res.ok) return fail(err, res as { ok: boolean; error?: string });
        sfx.coin();
        st.removeItems([iid]);
        picking = null;
        toast(`${def.name} is on display for ${formatMoney(priceSen)}.`, 'good');
      });
    for (const k of [1, 1.5, 2, 3]) {
      const price = Math.round((value * k) / 100) * 100;
      const btn = el('button', { class: 'btn small', type: 'button', 'data-price': String(k) }, `${formatMoney(price)}`, el('small', {}, k === 1 ? 'its value' : `${k}× value`));
      btn.addEventListener('click', () => list(price));
      row.append(btn);
    }
    const custom = el('button', { class: 'btn small', type: 'button', 'data-action': 'bq-custom' }, 'Other price…');
    custom.addEventListener('click', () => {
      const v = Number(prompt(`Price for ${def.name} in RM:`, String(Math.round(value / 100))));
      if (v > 0) list(Math.round(v * 100));
    });
    row.append(custom);
    out.push(el('div', { class: 'job-card' }, el('div', { class: 'job-info' }, el('h4', {}, `Sell ${def.name}`), el('div', { class: 'muted small' }, `Worth about ${formatMoney(value)}. Pick a price:`), row)));
  }
  out.push(grid);
  return out;
}

export function renderBoutique({ app, rerender }: PhoneCtx): HTMLElement[] {
  const tabsEl = el('div', { class: 'branch-tabs' });
  for (const [id, name] of [['browse', '🛍️ Browse'], ['mine', `${app.cfg.businesses.boutique.icon} My ${app.cfg.businesses.boutique.name}`]] as const) {
    const b = el('button', { class: `branch-tab${tab === id ? ' active' : ''}`, type: 'button', 'data-bqtab': id }, name);
    b.addEventListener('click', () => {
      tab = id;
      rerender();
    });
    tabsEl.append(b);
  }
  return [tabsEl, ...(tab === 'browse' ? browse(app) : mine(app, rerender))];
}
