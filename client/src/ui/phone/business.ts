// HustlePhone → Business: buy and grow your food stall (pasar malam → food truck → kopitiam),
// stock, staff, upgrades and the menu (recipe mastery).
import {
  dishBaseSen, formatMoney, masteryLevel, menuRecipes, staffCookMs, staffPayRate, STALL_UPGRADES, stockCount, tierDef, upgradeCostSen, upgradeLevel,
  wagePerHourSen, type StallUpgrade,
} from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { sfx } from '../sound';
import { hoursText, stars } from '../stall/stallPanel';
import { stockList } from '../stall/stock';
import type { PhoneCtx } from './phone';

let tab = 'overview';

const ack = (app: App, ok?: string) => (err: Error | null, res: { ok: true } | { ok: false; error: string }) => {
  if (err || !res.ok) {
    sfx.error();
    return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
  }
  sfx.coin();
  if (ok) toast(ok, 'good');
};

function tierCard(app: App, tierN: number, action: string) {
  const t = tierDef(app.cfg.stalls, tierN);
  const pr = app.store.progress;
  const lock = t.requires.stage && pr.stage < t.requires.stage
    ? `Needs wealth stage ${t.requires.stage}`
    : t.requires.level && pr.level < t.requires.level
      ? `Needs Level ${t.requires.level}`
      : null;
  const b = el('button', { class: 'btn primary', type: 'button', 'data-action': action, disabled: !!lock || app.store.walletSen < t.priceSen }, lock ? `🔒 ${lock}` : 'Buy', lock ? null : el('small', {}, formatMoney(t.priceSen)));
  b.addEventListener('click', () => app.socket?.timeout(6000).emit('stall:buy', { tier: tierN }, ack(app, `${t.icon} Your ${t.name} is ready!`)));
  return el(
    'div',
    { class: 'job-card' },
    el('div', { class: 'job-icon' }, t.icon),
    el('div', { class: 'job-info' }, el('h4', {}, t.name), el('p', {}, t.desc), el('div', { class: 'muted small' }, `${t.priceMult}× prices · up to ${t.staffMax} cook${t.staffMax > 1 ? 's' : ''} · busiest ${hoursText(t.hours)}, open any time`)),
    b,
  );
}

export function renderBusiness({ app, rerender }: PhoneCtx): HTMLElement[] {
  const st = app.store.stall;
  const cfg = app.cfg.stalls;
  if (!st) {
    return [
      el('p', { class: 'muted' }, 'Run your own food stall: cook with quick mini-games (Perfect dishes pay 1.8×), or hire cooks to sell while you do other things.'),
      tierCard(app, 1, 'stall-buy-1'),
      el('p', { class: 'hint' }, 'The pasar malam is in the car park south of Dataran Sunway. Later: a food truck, then your own kopitiam.'),
    ];
  }
  const t = tierDef(cfg, st.tier);
  const pub = app.store.stalls.get(st.plot);
  const tabsEl = el('div', { class: 'branch-tabs' });
  for (const [id, name] of [['overview', '🏪 Stall'], ['stock', '📦 Stock'], ['staff', '🧑‍🍳 Staff'], ['upgrades', '⬆️ Upgrades'], ['menu', '📜 Menu']]) {
    const b = el('button', { class: `branch-tab${tab === id ? ' active' : ''}`, type: 'button', 'data-btab': id }, name);
    b.addEventListener('click', () => {
      tab = id;
      rerender();
    });
    tabsEl.append(b);
  }
  const body: Array<HTMLElement | null> = [];
  if (tab === 'overview') {
    const toggle = el('button', { class: `btn${st.open ? '' : ' primary'}`, type: 'button', 'data-action': 'stall-toggle' }, st.open ? 'Close for now' : 'Open for business');
    toggle.addEventListener('click', () => app.socket?.timeout(5000).emit('stall:open', { open: !st.open }, ack(app)));
    const go = el('button', { class: 'btn', type: 'button', 'data-action': 'stall-go' }, '🗺️ Where is it?');
    go.addEventListener('click', () => {
      const plot = app.map.stallPlots.find((p) => p.id === st.plot);
      if (plot) app.minimap?.openFull();
    });
    body.push(
      el(
        'div',
        { class: 'job-card' },
        el('div', { class: 'job-icon' }, t.icon),
        el(
          'div',
          { class: 'job-info' },
          el('h4', {}, `Your ${t.name}`),
          el('p', {}, pub?.open ? `🟢 Open now · ${pub.queue.length} in the queue` : st.open ? '🟡 Opening…' : '🔴 Closed (switched off)'),
          el('div', { class: 'muted small' }, `${stars(st.rep, cfg.reputation.max)} reputation · combo +${Math.round(st.combo * 100)}% · ${st.perfectTokens} Perfect Cook Tokens`),
          el('div', { class: 'muted small' }, `Earned today: ${formatMoney(st.earnedToday)} · value ${formatMoney(Math.floor(st.investedSen * cfg.assetValueRate))} (counts in net worth)`),
        ),
      ),
      el('div', { class: 'stall-actions' }, toggle, go),
      el('p', { class: 'hint' }, 'Cook at the stall (walk there, press E). Customers come while it is open and you have ingredients; they leave if they wait too long.'),
    );
    const next = cfg.tiers.find((x) => x.tier === st.tier + 1);
    if (next) body.push(el('h4', { class: 'phone-section' }, 'Next step'), tierCard(app, next.tier, `stall-buy-${next.tier}`));
  } else if (tab === 'stock') {
    body.push(stockList(app, true));
  } else if (tab === 'staff') {
    const b = app.mods().stall;
    const hire = el('button', { class: 'btn primary', type: 'button', 'data-action': 'stall-hire', disabled: st.staff >= t.staffMax || app.store.walletSen < t.hireSen }, st.staff >= t.staffMax ? 'Full' : 'Hire a cook', st.staff >= t.staffMax ? null : el('small', {}, formatMoney(t.hireSen)));
    hire.addEventListener('click', () => app.socket?.timeout(5000).emit('stall:hire', ack(app, '🧑‍🍳 New cook hired!')));
    const fire = el('button', { class: 'btn small', type: 'button', 'data-action': 'stall-fire', disabled: st.staff === 0 }, 'Let one go');
    fire.addEventListener('click', () => app.socket?.timeout(5000).emit('stall:fire', ack(app)));
    const secs = staffCookMs(cfg, st, b) / 1000;
    body.push(
      el('div', { class: 'job-card' }, el('div', { class: 'job-icon' }, '🧑‍🍳'), el('div', { class: 'job-info' },
        el('h4', {}, `Cooks: ${st.staff} / ${t.staffMax}`),
        el('p', {}, `Each cook makes a dish every ${secs.toFixed(1)} s at ${Math.round(staffPayRate(cfg, st) * 100)}% of the normal price (Staff level raises it; no combo or tips), while the stall is open, even when you're elsewhere.`),
        el('div', { class: 'muted small' }, `Wage: ${formatMoney(wagePerHourSen(cfg, st.tier, b))} per cook per in-game hour (1 real minute) while open.`)), hire),
      el('div', { class: 'stall-actions' }, fire),
      el('p', { class: 'hint' }, 'Food bloggers only trust the boss: cook those yourself. Staff level and equipment make cooks faster; Staff level also raises what their sales earn.'),
    );
  } else if (tab === 'upgrades') {
    for (const key of STALL_UPGRADES) {
      const u = cfg.upgrades[key as StallUpgrade]!;
      const lv = upgradeLevel(st, key);
      const maxed = lv >= u.maxLevel;
      const cost = maxed ? 0 : upgradeCostSen(cfg, st.tier, key, lv);
      const b = el('button', { class: 'btn primary', type: 'button', 'data-action': `stall-up-${key}`, disabled: maxed || app.store.walletSen < cost }, maxed ? 'Maxed' : `Lv ${lv + 1}`, maxed ? null : el('small', {}, formatMoney(cost)));
      b.addEventListener('click', () => app.socket?.timeout(5000).emit('stall:upgrade', { key }, ack(app, `${u.icon} ${u.name} Lv ${lv + 1}`)));
      body.push(el('div', { class: 'job-card skill-card' }, el('div', { class: 'job-icon' }, u.icon), el('div', { class: 'job-info' }, el('h4', {}, u.name, el('span', { class: 'lv-badge' }, `Lv ${lv}/${u.maxLevel}`)), el('p', {}, u.desc)), b));
    }
    body.push(el('p', { class: 'hint' }, `Upgrades stay when you move up a tier, and cost ${t.upgradeCostMult}× at a ${t.name}.`));
  } else {
    const menu = new Set(menuRecipes(cfg, app.cfg.recipes.recipes, st).map((r) => r.id));
    for (const r of app.cfg.recipes.recipes) {
      const dishes = st.mastery[r.id] ?? 0;
      const lv = masteryLevel(cfg, dishes);
      const nextAt = cfg.mastery.thresholds[lv];
      const on = menu.has(r.id);
      const unlock = r.unlock ? app.cfg.recipes.recipes.find((x) => x.id === r.unlock!.recipe) : undefined;
      body.push(
        el(
          'div',
          { class: `job-card${on ? '' : ' locked'}`, 'data-menu': r.id },
          el('div', { class: 'job-icon' }, r.icon),
          el(
            'div',
            { class: 'job-info' },
            el('h4', {}, r.name, el('span', { class: 'lv-badge' }, `Mastery ${lv}`)),
            on
              ? el('p', {}, `Sells for ${formatMoney(dishBaseSen(cfg, r, st, false, app.mods().stall))} (Good) · ${stockCount(st, r.id)} portions in stock`)
              : el('p', {}, `🔒 Cook ${cfg.mastery.thresholds[r.unlock!.mastery - 1]} ${unlock?.name ?? r.unlock!.recipe} to unlock.`),
            el('div', { class: 'muted small' }, `${dishes} cooked${nextAt ? ` · next mastery at ${nextAt} (+${Math.round(cfg.mastery.pricePerLevel * 100)}% price)` : ' · max mastery'} · ${r.steps.length} steps`),
          ),
        ),
      );
    }
  }
  return [tabsEl, ...body.filter((x): x is HTMLElement => !!x)];
}
