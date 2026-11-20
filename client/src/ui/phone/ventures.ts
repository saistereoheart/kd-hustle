// HustlePhone → Ventures (Phase 6, spec §8.5–8.6): idle businesses (buy levels, milestones,
// managers, collect, the rush mini-game) and your kedai runcit (stock, prices, cashier).
import {
  cycleMs, formatMoney, formatMoneyExact, incomePerHourSen, levelCostSen, managerCostSen, maxAffordable, milestonesReached, nextMilestone, retailDemand,
  type BizState, type BusinessTypeDef,
} from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { sfx } from '../sound';
import { openCheckout } from '../checkout';
import { openRush } from '../rush';
import type { PhoneCtx } from './phone';
import { openVentureSpotPicker } from '../ventureSpotPicker';
import { closePanel } from '../panel';

let tab: 'biz' | 'shop' = 'biz';

const ack = (app: App, ok?: string) => (err: Error | null, res: { ok: true } | { ok: false; error: string }) => {
  if (err || !res.ok) {
    sfx.error();
    return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
  }
  sfx.coin();
  if (ok) toast(ok, 'good');
};

/** A progress bar that fills over one cycle, driven by CSS (no re-render needed). */
function cycleBar(b: BizState, lenMs: number, now: number, loop: boolean) {
  const bar = el('div', { class: `progress biz-cycle${loop ? ' loop' : ''}${b.stored ? ' ready' : ''}` }, el('i', {}));
  const fill = bar.firstChild as HTMLElement;
  if (b.stored && !loop) {
    fill.style.width = '100%';
    return bar;
  }
  const elapsed = Math.max(0, now - b.cycleAt);
  fill.style.animationDuration = `${lenMs}ms`;
  fill.style.animationDelay = `-${loop ? elapsed % lenMs : Math.min(elapsed, lenMs)}ms`;
  return bar;
}

function bizCard(app: App, t: BusinessTypeDef, now: number): HTMLElement {
  const bc = app.cfg.businesses;
  const st = app.store;
  const b = st.ventures.businesses[t.id];
  const level = b?.level ?? 0;
  const lock = t.requires.stage && st.progress.stage < t.requires.stage ? `Needs wealth stage ${t.requires.stage}` : t.requires.level && st.progress.level < t.requires.level ? `Needs Level ${t.requires.level}` : null;
  const card = el('div', { class: `job-card biz-card${level ? '' : ' locked'}`, 'data-biz': t.id });
  const icon = el('div', { class: 'job-icon' }, t.icon);
  const info = el('div', { class: 'job-info' });
  const mult = app.mods().passive;
  if (!level) {
    const cost = levelCostSen(bc, t, 0, 1);
    const buy = el('button', { class: 'btn primary', type: 'button', 'data-action': `biz-open-${t.id}`, disabled: !!lock || st.walletSen < cost }, lock ? `🔒 ${lock}` : 'Open', lock ? null : el('small', {}, formatMoney(cost)));
    buy.addEventListener('click', () => app.socket?.timeout(5000).emit('biz:buy', { type: t.id, n: 1 }, ack(app, `${t.icon} ${t.name} is open!`)));
    info.append(el('h4', {}, t.name), el('p', {}, `Earns ${formatMoney(t.revenueSen)} every ${t.cycleSec} s per level.`));
    card.append(icon, info, buy);
    return card;
  }
  const len = cycleMs(bc, t, level);
  const perHour = incomePerHourSen(bc, t, level) * mult * (1 - bc.taxRate);
  const rushing = b.rushUntil > now;
  const next = nextMilestone(bc, level);
  info.append(
    el('h4', {}, t.name, el('span', { class: 'lv-badge' }, `Lv ${level}`), b.manager ? el('span', { class: 'lv-badge good' }, '👔 managed') : null, rushing ? el('span', { class: 'lv-badge blogger' }, `🔥 ×${bc.rush.mult}`) : null),
    cycleBar(b, len, now, b.manager),
    el('div', { class: 'muted small' }, `${formatMoney(Math.round(perHour))}/hour${b.manager ? '' : ' if you keep collecting'} · ${(len / 1000).toFixed(len < 10_000 ? 1 : 0)} s a cycle${next ? ` · Lv ${next}: ${bc.milestoneSpeedMult}× speed` : ' · all milestones'}`),
  );
  const actions = el('div', { class: 'biz-actions' });
  if (!b.manager) {
    const c = el('button', { class: `btn${b.stored ? ' primary' : ''}`, type: 'button', 'data-action': `biz-collect-${t.id}`, disabled: !b.stored }, b.stored ? '💰 Collect' : 'Working…');
    c.addEventListener('click', () =>
      app.socket?.timeout(5000).emit('biz:collect', { type: t.id }, (err, res) => {
        if (err || !res.ok) return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
        if (res.paidSen) {
          sfx.coin();
          toast(`${t.icon} +${formatMoney(res.paidSen)}`, 'good');
        }
      }),
    );
    actions.append(c);
  }
  for (const n of [1, 10]) {
    const cost = levelCostSen(bc, t, level, n);
    const up = el('button', { class: 'btn small', type: 'button', 'data-action': `biz-up${n}-${t.id}`, disabled: st.walletSen < cost }, `+${n} Lv`, el('small', {}, formatMoney(cost)));
    up.addEventListener('click', () => app.socket?.timeout(5000).emit('biz:buy', { type: t.id, n }, ack(app)));
    actions.append(up);
  }
  const max = maxAffordable(bc, t, level, st.walletSen);
  if (max.n > 10) {
    const up = el('button', { class: 'btn small', type: 'button', 'data-action': `biz-upmax-${t.id}` }, `+${max.n} Lv`, el('small', {}, formatMoney(max.costSen)));
    up.addEventListener('click', () => app.socket?.timeout(5000).emit('biz:buy', { type: t.id, n: max.n }, ack(app)));
    actions.append(up);
  }
  if (!b.manager) {
    const cost = managerCostSen(bc, t);
    const m = el('button', { class: 'btn small', type: 'button', 'data-action': `biz-manager-${t.id}`, disabled: st.walletSen < cost }, '👔 Hire manager', el('small', {}, formatMoney(cost)));
    m.addEventListener('click', () => app.socket?.timeout(5000).emit('biz:manager', { type: t.id }, ack(app, `👔 A manager runs ${t.name} now (also while you're away).`)));
    actions.append(m);
  }
  const ready = b.rushReadyAt <= now;
  const r = el('button', { class: 'btn small', type: 'button', 'data-action': `biz-rush-${t.id}`, disabled: !ready }, `🔥 ${t.rushName}`, el('small', {}, ready ? `×${bc.rush.mult} for ${bc.rush.durationMs / 1000} s` : `in ${Math.ceil((b.rushReadyAt - now) / 1000)} s`));
  r.addEventListener('click', () => openRush(app, t));
  actions.append(r);
  // 🏪 Its shoplot in town: show it, or move it.
  const lot = app.store.shoplots.find((s) => s.ownerId === app.town?.selfId && s.ref === t.id);
  const spot = lot ? app.shoplotSpot(lot.building) : null;
  if (spot) {
    const show = el('button', { class: 'btn small', type: 'button', 'data-action': `biz-show-${t.id}` }, '📍 Show');
    show.addEventListener('click', () => {
      closePanel();
      app.guide?.pointAt({ id: `biz:${t.id}`, label: `YOUR ${t.name.toUpperCase()}`, icon: t.icon, x: spot.x, y: spot.y });
    });
    const move = el('button', { class: 'btn small', type: 'button', 'data-action': `biz-move-${t.id}` }, '🚚 Move', el('small', {}, formatMoney(app.cfg.businesses.moveFeeSen)));
    move.addEventListener('click', () => openVentureSpotPicker(app, t.id));
    actions.append(show, move);
  }
  info.append(actions);
  card.append(icon, info);
  return card;
}

function shopView(app: App): HTMLElement[] {
  const r = app.cfg.businesses.retail;
  const st = app.store;
  const s = st.ventures.retail;
  if (!s) {
    const lock = r.requires.stage && st.progress.stage < r.requires.stage ? `Needs wealth stage ${r.requires.stage}` : null;
    const open = el('button', { class: 'btn primary', type: 'button', 'data-action': 'shop-open', disabled: !!lock || st.walletSen < r.openSen }, lock ? `🔒 ${lock}` : `Open a ${r.name}`, lock ? null : el('small', {}, formatMoney(r.openSen)));
    open.addEventListener('click', () => app.socket?.timeout(5000).emit('shop:open', ack(app, `${r.icon} Your ${r.name} is open!`)));
    return [
      el('div', { class: 'job-card' }, el('div', { class: 'job-icon' }, r.icon), el('div', { class: 'job-info' }, el('h4', {}, r.name), el('p', {}, 'Buy stock wholesale, set your own prices, and sell: hire a cashier, or be the cashier yourself for a 50% bonus on every basket.')), open),
    ];
  }
  const rows: HTMLElement[] = [];
  for (const pr of r.products) {
    const price = s.prices[pr.id] ?? pr.marketSen;
    const qty = s.stock[pr.id] ?? 0;
    const demand = retailDemand(app.cfg.businesses, price, pr.marketSen);
    const step = Math.max(10, Math.round(pr.marketSen / 20 / 10) * 10);
    const setPrice = (v: number) => app.socket?.timeout(5000).emit('shop:price', { product: pr.id, priceSen: Math.max(step, v) }, ack(app));
    const minus = el('button', { class: 'btn small', type: 'button', 'data-action': `price-down-${pr.id}` }, '−');
    minus.addEventListener('click', () => setPrice(price - step));
    const plus = el('button', { class: 'btn small', type: 'button', 'data-action': `price-up-${pr.id}` }, '+');
    plus.addEventListener('click', () => setPrice(price + step));
    const buy = (n: number) => {
      const b = el('button', { class: 'btn small', type: 'button', 'data-action': `stock-${n}-${pr.id}`, disabled: st.walletSen < pr.costSen * n || qty + n > r.maxStockPerProduct }, `+${n}`, el('small', {}, formatMoneyExact(pr.costSen * n)));
      b.addEventListener('click', () => app.socket?.timeout(5000).emit('shop:stock', { product: pr.id, qty: n }, ack(app)));
      return b;
    };
    const tag = demand >= 1.2 ? '🔥 flying off the shelf' : demand >= 0.8 ? '🙂 fair price' : demand >= 0.4 ? '🤨 pricey' : '😬 nobody buys';
    rows.push(
      el(
        'div',
        { class: `job-card shop-row${qty ? '' : ' locked'}`, 'data-product': pr.id },
        el('div', { class: 'job-icon' }, pr.icon),
        el(
          'div',
          { class: 'job-info' },
          el('h4', {}, pr.name, el('span', { class: 'lv-badge' }, `${qty} in stock`)),
          el('div', { class: 'shop-price' }, minus, el('b', {}, formatMoneyExact(price)), plus, el('span', { class: 'muted small' }, ` market ${formatMoneyExact(pr.marketSen)} · cost ${formatMoneyExact(pr.costSen)}`)),
          el('div', { class: 'muted small' }, `${tag} · profit ${formatMoneyExact(price - pr.costSen)} each`),
          el('div', { class: 'biz-actions' }, buy(10), buy(50)),
        ),
      ),
    );
  }
  const cashier = el('button', { class: `btn${s.cashier ? '' : ' primary'}`, type: 'button', 'data-action': 'shop-cashier' }, s.cashier ? 'Let the cashier go' : 'Hire a cashier', el('small', {}, `${formatMoney(r.cashierWagePerDaySen)} a day`));
  cashier.addEventListener('click', () => app.socket?.timeout(5000).emit('shop:cashier', { on: !s.cashier }, ack(app)));
  const self = el('button', { class: 'btn primary', type: 'button', 'data-action': 'shop-checkout' }, '🧾 Be the cashier', el('small', {}, `+${Math.round(r.cashierBonus * 100)}% when you're right`));
  self.addEventListener('click', () => openCheckout(app));
  return [
    el(
      'div',
      { class: 'job-card' },
      el('div', { class: 'job-icon' }, r.icon),
      el('div', { class: 'job-info' }, el('h4', {}, `Your ${r.name}`), el('p', {}, s.cashier ? '🧑‍💼 Your cashier sells while you\'re online.' : 'No cashier: sell by being the cashier yourself.'), el('div', { class: 'muted small' }, `Sold today: ${s.soldToday} · earned ${formatMoney(s.earnedSen)} in total`)),
    ),
    el('div', { class: 'stall-actions' }, self, cashier),
    el('h4', { class: 'phone-section' }, 'Shelves'),
    ...rows,
    el('p', { class: 'hint' }, 'Cheaper than market: more customers buy. Pricier: fewer, but more profit each. Find the sweet spot.'),
  ];
}

export function renderVentures({ app, rerender }: PhoneCtx): HTMLElement[] {
  const now = app.store.serverNow();
  const tabsEl = el('div', { class: 'branch-tabs' });
  for (const [id, name] of [['biz', '🏢 Businesses'], ['shop', `${app.cfg.businesses.retail.icon} Shop`]] as const) {
    const b = el('button', { class: `branch-tab${tab === id ? ' active' : ''}`, type: 'button', 'data-vtab': id }, name);
    b.addEventListener('click', () => {
      tab = id;
      rerender();
    });
    tabsEl.append(b);
  }
  if (tab === 'shop') return [tabsEl, ...shopView(app)];
  const v = app.store.ventures;
  const owned = app.cfg.businesses.types.filter((t) => v.businesses[t.id]?.level);
  const waiting = owned.filter((t) => !v.businesses[t.id].manager && v.businesses[t.id].stored).length;
  const all = el('button', { class: 'btn primary', type: 'button', 'data-action': 'biz-collect-all', disabled: !waiting }, `💰 Collect all${waiting ? ` (${waiting})` : ''}`);
  all.addEventListener('click', () =>
    app.socket?.timeout(5000).emit('biz:collect', {}, (err, res) => {
      if (err || !res.ok) return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      if (res.paidSen) (sfx.coin(), toast(`🏢 +${formatMoney(res.paidSen)}`, 'good'));
    }),
  );
  const levels = owned.reduce((a, t) => a + v.businesses[t.id].level, 0);
  const milestones = owned.reduce((a, t) => a + milestonesReached(app.cfg.businesses, v.businesses[t.id].level), 0);
  return [
    tabsEl,
    owned.length ? el('div', { class: 'stall-actions' }, all, el('span', { class: 'muted small' }, `${levels} levels · ${milestones} milestones · ${Math.round(app.cfg.businesses.taxRate * 100)}% business tax`)) : el('p', { class: 'muted' }, 'Buy a business, level it up, and hire a manager so it earns by itself (even while you\'re offline). Every milestone level doubles its speed.'),
    ...app.cfg.businesses.types.map((t) => bizCard(app, t, now)),
  ];
}
