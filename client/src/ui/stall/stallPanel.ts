// At a stall plot (E): your own stall's counter (queue, cook, open/close), someone else's stall,
// or a free spot. Cooking itself is ./cook.ts; the result card is here.
import { formatMoney, formatMoneyExact, gameTime, menuRecipes, rushHour, stallOpenNow, stockCount, tierDef, type DishState, type ServeResult } from '@kh/shared';
import type { App } from '../../app';
import { el, toast, uiRoot, keepUiState } from '../dom';
import { closePanel, openPanel } from '../panel';
import { sfx } from '../sound';
import { playDish, type CookStock } from './cook';
import { foodIcon } from './foodArt';

const QUALITY: Record<string, { text: string; color: string }> = {
  perfect: { text: 'PERFECT!', color: '#ffd43b' },
  great: { text: 'Great!', color: '#69db7c' },
  good: { text: 'Good', color: '#74c0fc' },
  ok: { text: 'OK…', color: '#adb5bd' },
  burnt: { text: 'Burnt 🔥', color: '#ff6b6b' },
};
const GRADE_ICON: Record<string, string> = { perfect: '🌟', great: '✅', good: '👍', miss: '❌' };

export function hoursText(h: [number, number]) {
  const f = (x: number) => `${x % 12 === 0 ? 12 : x % 12} ${x < 12 || x === 24 ? 'AM' : 'PM'}`;
  return `${f(h[0])} – ${f(h[1])}`;
}

export function stars(rep: number, max: number) {
  const n = Math.round((rep / max) * 5 * 2) / 2;
  return '★'.repeat(Math.floor(n)) + (n % 1 ? '½' : '') + '☆'.repeat(5 - Math.ceil(n));
}

function paintBar(fill: HTMLElement, left: number) {
  fill.style.width = `${left * 100}%`;
  fill.style.background = left > 0.5 ? '#40c057' : left > 0.25 ? '#fab005' : '#fa5252';
}

export function openStallPanel(app: App, plotId: string) {
  const plot = app.map.stallPlots.find((p) => p.id === plotId);
  if (!plot) return;
  const myId = app.lastInit?.you.id;
  const pub = () => app.store.stalls.get(plotId);
  const mine = () => pub()?.owner === myId;
  const tier = tierDef(app.cfg.stalls, plot.tier);
  const panel = openPanel(`${tier.icon} ${tier.name}`, { testId: 'stall-panel' });
  // Your stock: its own box beside the stall window (a strip above it on a phone). Only for
  // your own stall.
  const rail = el('div', { class: 'stall-stock-rail', 'data-testid': 'stall-stock' });
  if (pub()?.owner === myId) panel.side('📦 Your stock').append(rail);
  let busy = false;
  /** Patience bars to refresh in place (no re-render, so buttons never move under a click). */
  let bars: Array<{ fill: HTMLElement; arrivedAt: number; patienceMs: number; serving: boolean }> = [];
  let lastSig = '';

  const render = (force = false) => {
    const s = pub();
    const me0 = app.store.stall;
    const t0 = gameTime(app.cfg.time, app.store.serverNow());
    // Only rebuild when something you can see changed.
    const sig = JSON.stringify([s?.open, s?.queue.map((c) => [c.id, c.serving, c.addons]), s?.ownerName, me0 && [me0.open, me0.perfectTokens, Math.round(me0.combo * 100), Math.round(me0.rep), me0.earnedToday, me0.staff, me0.stock], busy, t0.hour]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    bars = [];
    rail.replaceChildren(); // filled below for your own stall
    const now = app.store.serverNow();
    const t = gameTime(app.cfg.time, now);
    if (!s) {
      // A free spot.
      const st = app.store.stall;
      const canBuy = (!st && plot.tier === 1) || (st && st.tier + 1 === plot.tier);
      const buy = el('button', { class: 'btn primary', type: 'button', 'data-action': `stall-buy-${plot.tier}` }, st ? `Move up to a ${tier.name}` : `Buy a ${tier.name}`, el('small', {}, formatMoney(tier.priceSen)));
      buy.addEventListener('click', () => app.openPhone('business'));
      panel.body.replaceChildren(
        el('p', {}, `This ${tier.name.toLowerCase()} spot is free. ${tier.desc}`),
        canBuy ? buy : el('p', { class: 'muted' }, st && st.tier >= plot.tier ? 'You already have a bigger stall.' : `Unlocks after the earlier tiers.`),
      );
      return;
    }
    if (!mine()) {
      panel.body.replaceChildren(
        el('h4', {}, `${s.ownerName}'s ${tier.name}`),
        el('p', {}, s.open ? `🟢 Open · ${s.queue.length} in the queue · ${stars(s.rep, app.cfg.stalls.reputation.max)}` : '🔴 Closed right now.'),
        el('p', { class: 'hint' }, "Buying food from friends' stalls arrives with trading in Phase 7."),
      );
      return;
    }
    const me = app.store.stall!;
    const rush = rushHour(app.cfg.time, t.hourF);
    const withinHours = stallOpenNow(app.cfg.stalls, me.tier, t.hourF);
    // Open whenever you switch it on; outside the usual hours it's quieter.
    const status = s.open
      ? `🟢 Open${rush ? ` · 🍽️ ${rush}!` : ''}${withinHours ? '' : ` · 🌙 quiet hours (busiest ${hoursText(tier.hours)})`}`
      : !me.open
        ? '🔴 Closed (switched off)'
        : '🔴 Closed';
    const queue = el('div', { class: 'stall-queue' });
    if (!s.queue.length) queue.append(el('p', { class: 'muted' }, s.open ? 'Waiting for customers…' : 'No customers while closed.'));
    for (const c of s.queue) {
      const r = app.cfg.recipes.recipes.find((x) => x.id === c.recipe);
      const extras = (c.addons ?? []).map((id) => r?.addons.find((a) => a.id === id)).filter((a) => !!a);
      const left = Math.max(0, 1 - (now - c.arrivedAt) / c.patienceMs);
      const bar = el('div', { class: 'progress patience' }, el('i', {}));
      const fill = bar.firstChild as HTMLElement;
      bars.push({ fill, arrivedAt: c.arrivedAt, patienceMs: c.patienceMs, serving: !!c.serving });
      paintBar(fill, c.serving ? 1 : left);
      const row = el(
        'button',
        { class: `queue-row${c.serving ? ' serving' : ''}${c.blogger ? ' blogger' : ''}`, type: 'button', 'data-customer': String(c.id), disabled: !!c.serving || busy || !s.open },
        el('span', { class: 'queue-icon' }, `${r?.icon ?? '🍽️'}${extras.map((a) => a.icon).join('')}`),
        el('span', { class: 'queue-info' }, el('b', {}, r?.name ?? c.recipe), extras.length ? el('span', { class: 'queue-addons' }, ` + ${extras.map((a) => a.name).join(', ')}`) : null, c.blogger ? el('span', { class: 'lv-badge blogger' }, '📸 blogger') : null, c.serving ? el('span', { class: 'muted small' }, c.serving === 'staff' ? ' · a cook is on it' : ' · you') : null, bar),
      );
      row.addEventListener('click', () => cook(c.id));
      queue.append(row);
    }
    const cookBtn = el('button', { class: 'btn primary', type: 'button', 'data-action': 'cook-next', disabled: busy || !s.open || !s.queue.some((c) => !c.serving) }, '🍳 Cook the next order');
    cookBtn.addEventListener('click', () => cook());
    const tokenBtn = me.perfectTokens > 0 ? el('button', { class: 'btn', type: 'button', 'data-action': 'cook-token', disabled: busy || !s.open || !s.queue.some((c) => !c.serving) }, `✨ Perfect Cook Token (${me.perfectTokens})`) : null;
    tokenBtn?.addEventListener('click', () => cook(undefined, true));
    const toggle = el('button', { class: 'btn small', type: 'button', 'data-action': 'stall-toggle' }, me.open ? 'Close the stall' : 'Open the stall');
    toggle.addEventListener('click', () =>
      app.socket?.timeout(5000).emit('stall:open', { open: !me.open }, (err, res) => {
        if (err || !res.ok) return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      }),
    );
    const manage = el('button', { class: 'btn small', type: 'button', 'data-action': 'stall-manage' }, '📱 Stock, staff, upgrades');
    manage.addEventListener('click', () => app.openPhone('business'));
    fillStockRail(app, rail);
    panel.body.replaceChildren(el('div', { class: 'stall-main' },
      el('div', { class: 'stall-status' }, el('b', {}, status), el('span', { class: 'muted small' }, ` ${stars(me.rep, app.cfg.stalls.reputation.max)} · combo +${Math.round(me.combo * 100)}% · today ${formatMoney(me.earnedToday)}`)),
      queue,
      el('div', { class: 'stall-actions' }, cookBtn, tokenBtn),
      el('div', { class: 'stall-actions small' }, toggle, manage),
      el('p', { class: 'hint' }, `Tap a customer to cook their order, or cook the next one. ${me.staff ? `Your ${me.staff} cook${me.staff > 1 ? 's' : ''} serve the rest.` : 'Hire a cook to serve while you do other things.'}`)),
    );
  };

  function cook(customerId?: number, token = false) {
    if (busy) return;
    busy = true;
    render(true);
    cookOrder(app, customerId, token, () => {
      busy = false;
      if (document.body.contains(panel.root)) render(true);
    });
  }

  const tickBars = () => {
    const now = app.store.serverNow();
    for (const b of bars) paintBar(b.fill, b.serving ? 1 : Math.max(0, 1 - (now - b.arrivedAt) / b.patienceMs));
    render(); // cheap: returns early unless something changed
  };
  const off = app.store.on(() => keepUiState(panel.body, () => render()));
  const timer = window.setInterval(tickBars, 500);
  panel.onClose = () => {
    off();
    clearInterval(timer);
  };
  render();
}

/** Ask the server for a dish, play it, serve it, show the result. */
export function cookOrder(app: App, customerId: number | undefined, token: boolean, after: () => void) {
  app.socket?.timeout(6000).emit('stall:cook', { customerId, token }, (err, res) => {
    if (err || !res.ok) {
      sfx.error();
      toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      return after();
    }
    if (res.served) {
      showResult(app, res.served, null);
      return after();
    }
    closePanel();
    play(app, res.dish!, after);
  });
}

/** Play a dish the server built; serve it, or start it over (free) when asked. */
function play(app: App, dish: DishState, after: () => void) {
  app.cookingDish = dish;
  const recipe = app.cfg.recipes.recipes.find((r) => r.id === dish.recipe);
  void playDish(app.cfg.recipes, dish, `${recipe?.icon ?? '🍳'} ${recipe?.name ?? 'Dish'}`, () => app.socket?.emit('stall:cancel', () => {}), () => cookStock(app, dish.recipe), true).then((inputs) => {
    app.cookingDish = null;
    if (inputs === 'restart') {
      app.socket?.timeout(5000).emit('stall:redo', (err, res) => {
        if (err || !res.ok) {
          sfx.error();
          toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
          return after();
        }
        sfx.click();
        play(app, res.dish, after);
      });
      return;
    }
    if (!inputs) return after();
    app.socket?.timeout(8000).emit('stall:serve', { dishId: dish.dishId, inputs }, (e2, r2) => {
      if (e2 || !r2.ok) {
        sfx.error();
        toast(e2 ? 'No response.' : r2.ok ? '' : r2.error, 'bad');
        return after();
      }
      showResult(app, r2.result, dish);
      after();
    });
  });
}

/** What's left of this dish and its add-ons (shown big while cooking). */
export function cookStock(app: App, recipeId: string): CookStock | null {
  const st = app.store.stall;
  const r = app.cfg.recipes.recipes.find((x) => x.id === recipeId);
  if (!st || !r) return null;
  return {
    dish: { id: r.id, icon: r.icon, name: r.name, qty: stockCount(st, r.id) },
    addons: r.addons.map((a) => ({ id: a.id, icon: a.icon, name: a.name, qty: stockCount(st, a.id) })),
  };
}

/** Your stock as separate boxes beside the stall window: a big drawn icon per dish and add-on
 *  with "x 12" (orange when low, red when out). Each box is only as wide as its icon and count;
 *  hover or tap one and it stretches out to show the name. */
export function fillStockRail(app: App, col: HTMLElement, restock = true) {
  col.replaceChildren();
  const st = app.store.stall;
  if (!st) return;
  const low = app.cfg.stalls.stock.lowWarn;
  for (const r of menuRecipes(app.cfg.stalls, app.cfg.recipes.recipes, st)) {
    for (const it of [r, ...r.addons]) {
      const qty = stockCount(st, it.id);
      const pill = el(
        'button',
        { class: `stock-pill${it === r ? '' : ' addon'}${qty <= 0 ? ' out' : qty <= low ? ' low' : ''}`, type: 'button', 'data-item': it.id, 'aria-label': `${it.name}: ${qty}` },
        foodIcon(it.id, 36),
        el('span', { class: 'stock-pill-name' }, it.name),
        el('b', { class: 'stock-pill-qty' }, `x ${qty}`),
      );
      pill.addEventListener('click', () => pill.classList.toggle('open'));
      col.append(pill);
    }
  }
  const buy = el('button', { class: 'stock-pill restock', type: 'button', 'data-action': 'stall-restock', 'aria-label': 'Restock' }, el('b', { class: 'stock-pill-qty' }, '＋📦'), el('span', { class: 'stock-pill-name' }, 'Restock'));
  buy.addEventListener('click', () => app.openPhone('business'));
  if (restock) col.append(buy);
}

function showResult(app: App, r: ServeResult, dish: DishState | null) {
  const q = QUALITY[r.quality] ?? QUALITY.good;
  if (r.quality === 'perfect') sfx.reveal(4);
  else sfx.coin();
  const title = el('div', { class: 'dish-quality' }, q.text);
  title.style.color = q.color;
  const plotId = app.store.stall?.plot;
  const nextBtn = el('button', { class: 'btn primary', type: 'button', 'data-action': 'dish-next' }, '🍳 Next order');
  const doneBtn = el('button', { class: 'btn', type: 'button', 'data-action': 'dish-done' }, 'Back to the stall');
  const card = el(
    'div',
    { class: 'carwash-box dish-result', 'data-testid': 'dish-result' },
    title,
    el('div', { class: 'dish-grades' }, ...r.grades.map((g) => el('span', { title: g }, GRADE_ICON[g] ?? '•'))),
    el('div', { class: 'dish-pay' }, `+${formatMoneyExact(r.paidSen)}`, r.tipSen ? el('span', { class: 'dish-tip' }, ` + ${formatMoneyExact(r.tipSen)} tip`) : null),
    el('div', { class: 'muted' }, `${dish?.blogger ? '📸 The food blogger ate it! ' : ''}Combo +${Math.round(r.combo * 100)}% · reputation ${r.rep}`),
    el('div', { class: 'cw-foot' }, doneBtn, nextBtn),
  );
  const host = el('div', { class: 'reveal-overlay cook-result' }, card);
  uiRoot().append(host);
  const close = () => host.remove();
  doneBtn.addEventListener('click', () => {
    close();
    if (plotId) openStallPanel(app, plotId);
  });
  nextBtn.addEventListener('click', () => {
    close();
    cookOrder(app, undefined, false, () => {});
  });
}
