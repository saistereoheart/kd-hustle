// HustlePhone → Business: buy and grow your food stall (pasar malam → food truck → kopitiam),
// stock, staff, upgrades and the menu (recipe mastery).
import {
  CASHIER_STAT_INFO, CASHIER_STATS, cashierStats, CHEF_STAT_INFO, CHEF_STATS, chefStats, gradeDef, skillLevel, skillValue, dishBaseSen, formatMoney, masteryLevel, menuRecipes, staffCookMs, staffPayRate, STALL_UPGRADES, stockCount, tierDef, upgradeCostSen, upgradeLevel,
  wagePerHourSen, type StallUpgrade,
} from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { tabStrip } from '../tabStrip';
import { sfx } from '../sound';
import { byRarity } from '../itemSort';
import { hoursText, stars } from '../stall/stallPanel';
import { stockList } from '../stall/stock';
import { openSpotPicker } from '../stall/spotPicker';
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
  // More than one free spot: pick where (or a random one).
  b.addEventListener('click', () => openSpotPicker(app, tierN, 'buy'));
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
  const tabsEl = tabStrip();
  for (const [id, name] of [['overview', '🏪 Stall'], ['stock', '📦 Stock'], ['staff', '🧑‍🍳 Staff'], ['chef', '👨‍🍳 Chef & cashier'], ['upgrades', '⬆️ Upgrades'], ['menu', '📜 Menu']]) {
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
    const go = el('button', { class: 'btn', type: 'button', 'data-action': 'stall-go' }, '📍 Take me there');
    go.addEventListener('click', () => {
      const plot = app.map.stallPlots.find((p) => p.id === st.plot);
      if (plot) app.guide?.pointAt({ id: plot.id, label: `YOUR ${t.name.toUpperCase()}`, icon: t.icon, x: plot.x, y: plot.y });
    });
    const move = el('button', { class: 'btn', type: 'button', 'data-action': 'stall-move' }, '🚚 Move', el('small', {}, t.moveFeeSen ? formatMoney(t.moveFeeSen) : 'free'));
    move.addEventListener('click', () => openSpotPicker(app, st.tier, 'move'));
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
      el('div', { class: 'stall-actions' }, toggle, go, move),
      el('p', { class: 'hint' }, st.tier >= cfg.cashierFromTier
        ? 'Your kopitiam is a real shoplot: walk to its door, press E to go in, and cook in the kitchen. Customers queue outside; your cashier works the till.'
        : 'Cook at the stall (walk there, press E). Customers come while it is open and you have ingredients; they leave if they wait too long.'),
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
        el('p', {}, `Each cook makes a dish every ${secs.toFixed(1)} s at ${Math.round(staffPayRate(cfg, st) * 100)}% of the normal price (a Good dish; Staff level raises it; no combo or tips), while the stall is open, even when you're elsewhere.`),
        el('div', { class: 'muted small' }, `Wage: ${formatMoney(wagePerHourSen(cfg, st.tier, b))} per cook per in-game hour (1 real minute) while open.`)), hire),
      el('div', { class: 'stall-actions' }, fire),
      el('p', { class: 'hint' }, `📸 Food bloggers: cook for them yourself for ${cfg.blogger.payMult}× pay and a reputation boost. If you're busy or away, a cook serves them after a short wait (${cfg.blogger.staffPayMult}× pay, no change to reputation). Staff level and equipment make cooks faster; Staff level also raises what their sales earn.`),
    );
  } else if (tab === 'chef') {
    body.push(...chefTab(app));
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
              : el('p', {}, `🔒 Sell ${cfg.mastery.thresholds[r.unlock!.mastery - 1]} ${unlock?.name ?? r.unlock!.recipe} (you or your cooks) to unlock.`),
            el('div', { class: 'muted small' }, `${dishes} cooked${nextAt ? ` · next mastery at ${nextAt} (+${Math.round(cfg.mastery.pricePerLevel * 100)}% price)` : ' · max mastery'} · ${r.steps.length} steps`),
          ),
        ),
      );
    }
  }
  return [tabsEl, ...body.filter((x): x is HTMLElement => !!x)];
}

/** The head chef and (at a kopitiam) the cashier: who's working, their stats, and who you could swap in. */
function chefTab(app: App): HTMLElement[] {
  const kopi = (app.store.stall?.tier ?? 0) >= app.cfg.stalls.cashierFromTier;
  return [
    ...roleSection(app, 'chef'),
    el('h4', { class: 'phone-section' }, `💵 Cashier${kopi ? ' (+1 staff)' : ' (kopitiam only)'}`),
    ...roleSection(app, 'cashier'),
  ];
}

function roleSection(app: App, role: 'chef' | 'cashier'): HTMLElement[] {
  const st = app.store;
  const gcfg = app.cfg.grades;
  const boost = skillValue(app.cfg.upgrades, st.skills, 'chefBoost');
  const academy = skillLevel(app.cfg.upgrades, st.skills, 'chef_academy');
  const pct = (v: number) => `+${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
  const keys: readonly string[] = role === 'chef' ? CHEF_STATS : CASHIER_STATS;
  const info = (k: string) => (role === 'chef' ? CHEF_STAT_INFO[k as keyof typeof CHEF_STAT_INFO] : CASHIER_STAT_INFO[k as keyof typeof CASHIER_STAT_INFO]);
  const stats = (id: string, rarity: string, grade: string | undefined, variant: string, b: number): Record<string, number> =>
    role === 'chef' ? chefStats(gcfg, { id, rarity, grade, variant }, b) : cashierStats(gcfg, { id, rarity, grade, variant }, b);
  const statRows = (id: string, rarity: string, grade: string | undefined, variant: string) => {
    const raw = stats(id, rarity, grade, variant, 0);
    const full = stats(id, rarity, grade, variant, boost);
    return el('div', { class: 'chef-stats' }, ...keys.map((k) =>
      el('div', { class: 'chef-stat' }, `${info(k).icon} ${info(k).name} `, el('b', {}, pct(full[k])),
        boost ? el('span', { class: 'muted small' }, ` (${pct(raw[k])} + ${pct(full[k] - raw[k])} Academy)`) : null,
        el('span', { class: 'muted small' }, ` · ${info(k).does}`))));
  };
  const icon = role === 'chef' ? '👨‍🍳' : '💵';
  const head = st.equipped[role];
  const worn = head !== undefined ? st.inventory.find((i) => i.iid === head) : undefined;
  const wornDef = worn && app.items.get(worn.itemId);
  const out: HTMLElement[] = [];
  if (worn && wornDef) {
    const off = el('button', { class: 'btn small', type: 'button', 'data-action': `${role}-off` }, 'Send home');
    off.addEventListener('click', () => app.socket?.timeout(5000).emit('inv:unequip', { slot: role }, (err, res) => {
      if (err || !res.ok) return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      const next = { ...app.store.equipped };
      delete next[role];
      app.store.equipped = next;
      app.store.emit();
    }));
    out.push(el('div', { class: 'job-card chef-card on' }, el('div', { class: 'job-icon' }, icon), el('div', { class: 'job-info' },
      el('h4', {}, wornDef.name, el('span', { class: 'lv-badge' }, `${gradeDef(gcfg, worn.grade).name}${worn.variant !== 'normal' ? ` · ${worn.variant}` : ''}`)),
      el('p', { class: 'muted small' }, `${wornDef.rarity} · ${role === 'chef' ? 'in charge of your kitchen' : 'at the till'}`),
      statRows(wornDef.id, wornDef.rarity, worn.grade, worn.variant)), off));
  } else out.push(el('p', { class: 'empty' }, role === 'chef'
    ? 'No head chef yet. A chef makes your cooks faster, raises dish prices and brings more customers.'
    : 'No cashier yet. At a kopitiam a cashier gets you bigger tips (also on your cooks\' sales) and keeps customers waiting longer.'));
  if (role === 'chef') out.push(el('p', { class: 'hint' }, `Staff Academy (📱 Skills → Business) Lv ${academy}: +${Math.round(boost * 100)}% to every chef and cashier stat. Merge 5 copies for a higher tier.`));
  const seen = new Map<string, { iid: number; itemId: string; grade?: string; variant: string; n: number }>();
  for (const i of st.inventory) {
    const d = app.items.get(i.itemId);
    if (d?.type !== role || i.iid === head) continue;
    const k = `${i.itemId}|${i.grade ?? 'D'}|${i.variant}`;
    const e = seen.get(k);
    if (e) e.n++;
    else seen.set(k, { iid: i.iid, itemId: i.itemId, grade: i.grade, variant: i.variant, n: 1 });
  }
  const rows = [...seen.values()].map((r) => {
    const d = app.items.get(r.itemId)!;
    const s = stats(d.id, d.rarity, r.grade, r.variant, boost);
    return { r, d, total: Object.values(s).reduce((a, b) => a + b, 0) };
  });
  // Rarest first (then tier, variant), the strongest first among equals.
  const order = byRarity<{ itemId: string; grade?: string; variant: string; total: number }>(app, (x, y) => y.total - x.total);
  rows.sort((a, b) => order({ ...a.r, total: a.total }, { ...b.r, total: b.total }));
  for (const { r, d } of rows) {
    const b = el('button', { class: 'btn primary', type: 'button', 'data-action': `${role}-on-${r.iid}` }, role === 'chef' ? 'Make head chef' : 'Make cashier');
    b.addEventListener('click', () => app.socket?.timeout(5000).emit('inv:equip', { iid: r.iid }, (err, res) => {
      if (err || !res.ok) return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      app.store.equipped = { ...app.store.equipped, [role]: r.iid };
      sfx.coin();
      toast(`${icon} ${d.name} ${role === 'chef' ? 'runs your kitchen' : 'works your till'} now.`, 'good');
      app.store.emit();
    }));
    out.push(el('div', { class: 'job-card chef-card' }, el('div', { class: 'job-icon' }, icon), el('div', { class: 'job-info' },
      el('h4', {}, d.name, el('span', { class: 'lv-badge' }, `${gradeDef(gcfg, r.grade).name}${r.variant !== 'normal' ? ` · ${r.variant}` : ''}${r.n > 1 ? ` · ×${r.n}` : ''}`)),
      el('p', { class: 'muted small' }, d.rarity),
      statRows(d.id, d.rarity, r.grade, r.variant)), b));
  }
  if (!rows.length && !worn) out.push(el('p', { class: 'hint' }, `Roll ${role === 'chef' ? 'chefs' : 'cashiers'} in 📱 Quick Rolls → 👨‍🍳 Chef & Cashier Search (costs 💎 shards).`));
  return out;
}
