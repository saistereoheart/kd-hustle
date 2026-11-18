// 💰 Money breakdown (tap your cash in the HUD): where your money came from and went over the
// last hour / day (from the server's transaction log), how much of your income is base pay and
// how much comes from each bonus ("RM 100 + RM 20 (Hustle Harder Lv 4)"), what you're earning
// right now, and what you owe (loans, wages, running costs).
import {
  formatMoney, formatMoneyExact, gearBonuses, gearOf, incomePerHourSen, rebirthMods, skillLevel, skillValue, stallLevelMult, wagePerHourSen,
  splitIncome, type IncomeFactor as Factor, type LedgerRow, type SkillEffect, type BuffKind,
} from '@kh/shared';
import type { App } from '../app';
import { el } from './dom';
import { openPanel } from './panel';

type IncomeKind = 'jobs' | 'passive' | 'stall' | 'rent' | 'airbnb';

interface Cat {
  id: string;
  icon: string;
  name: string;
  match: (reason: string) => boolean;
  /** Bonuses that apply to this category's income. */
  income?: IncomeKind;
}

const CATS: Cat[] = [
  { id: 'jobs', icon: '📋', name: 'Jobs', match: (r) => r.startsWith('job-'), income: 'jobs' },
  { id: 'manifest', icon: '🧘', name: 'Manifesting', match: (r) => r === 'manifest', income: 'passive' },
  { id: 'ventures', icon: '🏢', name: 'Ventures', match: (r) => r === 'business' || r.startsWith('business-') || r.startsWith('retail-'), income: 'passive' },
  { id: 'stall', icon: '🍳', name: 'Food stall', match: (r) => r.startsWith('stall-'), income: 'stall' },
  { id: 'rent', icon: '🏠', name: 'Rent', match: (r) => r === 'property-rent', income: 'rent' },
  { id: 'airbnb', icon: '🛏️', name: 'Airbnb', match: (r) => r === 'property-airbnb', income: 'airbnb' },
  { id: 'homes', icon: '🏘️', name: 'Homes & furniture', match: (r) => r.startsWith('property-') || r === 'furniture' || r === 'welcome-spin' },
  { id: 'boutique', icon: '👜', name: 'Butik', match: (r) => r.startsWith('boutique-') },
  { id: 'crates', icon: '🎰', name: 'Crates, pawn & shards', match: (r) => r.startsWith('crate') || r === 'pawn-sell' || r === 'scrap' || r === 'shard-shop' || r === 'merge' || r.startsWith('reroll') },
  { id: 'casino', icon: '🎲', name: 'Casino & coinflip', match: (r) => r.startsWith('casino') || r.startsWith('coinflip') },
  { id: 'loans', icon: '🏦', name: 'Loans', match: (r) => r.startsWith('bank-') || r.startsWith('ahlong') },
  { id: 'market', icon: '🛒', name: 'Trades, gifts & Pasar Online', match: (r) => r.startsWith('market') || r.startsWith('trade') || r.startsWith('gift') },
  { id: 'skills', icon: '⬆️', name: 'Skills', match: (r) => r === 'skill' },
  { id: 'rides', icon: '🛵', name: 'Ronda rides', match: (r) => r === 'ride' },
  { id: 'other', icon: '🎁', name: 'Rewards & other', match: () => true },
];

let windowSel: 'hour' | 'day' = 'hour';

export function openMoneyPanel(app: App) {
  const panel = openPanel('💰 Money', { testId: 'money-panel' });
  let ledger: { hour: LedgerRow[]; day: LedgerRow[] } | null = null;
  let failed = false;

  const load = () =>
    app.socket?.timeout(6000).emit('money:ledger', (err, res) => {
      if (err || !res.ok) {
        failed = true;
        return render();
      }
      ledger = { hour: res.hour, day: res.day };
      render();
    });

  function render() {
    const st = app.store;
    const head = el('div', { class: 'money-head' }, el('div', { class: 'money-big' }, formatMoneyExact(st.walletSen)), el('div', { class: 'muted small' }, `💎 ${st.shards.toLocaleString('en-US')} shards`));
    const tabs = el('div', { class: 'seg' });
    for (const [id, label] of [['hour', 'Last hour'], ['day', 'Last 24 hours']] as const) {
      const b = el('button', { class: `btn small${windowSel === id ? ' primary' : ''}`, type: 'button' }, label);
      b.addEventListener('click', () => {
        windowSel = id;
        render();
      });
      tabs.append(b);
    }
    panel.body.replaceChildren(head, el('h4', {}, '📒 In and out'), tabs, ledgerView(app, ledger?.[windowSel] ?? null, failed), el('h4', {}, '⏱️ Earning right now'), ...ratesView(app), el('h4', {}, '🧾 What you owe'), ...payablesView(app), el('p', { class: 'hint' }, 'Base = what you\'d earn with no skills, gear, chef, potions, title or rebirth bonus. Bonus splits use your current bonuses.'));
  }

  const timer = window.setInterval(load, 15_000);
  panel.onClose = () => clearInterval(timer);
  render();
  load();
}

// ------------------------------------------------------------------ bonus factors
function factors(app: App, kind: IncomeKind): Factor[] {
  const st = app.store;
  const cfg = app.cfg;
  const sk = (k: SkillEffect) => skillValue(cfg.upgrades, st.skills, k);
  const skillName = (k: SkillEffect) => {
    const id = Object.keys(cfg.upgrades.skills).find((s) => cfg.upgrades.skills[s].effect.kind === k);
    return id ? `${cfg.upgrades.skills[id].name} Lv ${skillLevel(cfg.upgrades, st.skills, id)}` : k;
  };
  const gear = gearBonuses(cfg.grades, gearOf({ itemById: app.items }, st.equipped, st.inventory));
  const potions = (b: BuffKind) => st.buffs().filter((x) => x.kind === b && x.leftMs > 0).reduce((a, x) => a * x.mult, 1) - 1;
  const title = st.progress.title ? cfg.titles.titles.find((t) => t.id === st.progress.title) : undefined;
  const rb = rebirthMods(cfg.rebirth, { count: st.rebirth?.count ?? app.lastInit?.you.rebirths ?? 0 });
  const part = (label: string, add: number | undefined) => (add && add > 1e-9 ? [{ label, add }] : []);
  const rebirth: Factor = part(`Rebirth ×${rb.income}`, rb.income - 1);
  const passive: Factor[] = [[...part(skillName('passiveIncome'), sk('passiveIncome')), ...part('Potions', potions('passive')), ...part('Gear', gear.passive)], rebirth];
  switch (kind) {
    case 'jobs':
      return [[...part(skillName('jobPay'), sk('jobPay')), ...part('Potions', potions('jobPay')), ...part(title?.name ?? 'Title', title?.bonus?.jobPay ? title.bonus.jobPay - 1 : 0), ...part('Gear', gear.jobPay)], rebirth];
    case 'passive':
      return passive;
    case 'stall': {
      const s = st.stall;
      const chef = app.mods().chef;
      const chefName = chef ? (app.items.get(chef.id)?.name ?? 'Head chef') : '';
      return [
        part(`Stall level`, s ? stallLevelMult(cfg.stalls, s) - 1 : 0),
        [...part(skillName('dishPrice'), sk('dishPrice')), ...part('Gear', gear.dishPrice), ...part(`${chefName} (flavour)`, chef?.stats.flavour)],
        rebirth,
      ];
    }
    case 'rent':
      return [part(skillName('rentIncome'), sk('rentIncome')), ...passive];
    case 'airbnb':
      return [part(skillName('airbnbIncome'), sk('airbnbIncome')), ...passive];
  }
}

function splitLine(app: App, total: number, kind: IncomeKind): HTMLElement {
  const { base, parts } = splitIncome(total, factors(app, kind));
  if (!parts.length) return el('div', { class: 'muted small' }, 'All base pay (no bonuses yet)');
  return el('div', { class: 'money-split small' }, `${formatMoney(Math.round(base))} base`, ...parts.map((p) => el('span', {}, ` + ${formatMoney(Math.round(p.sen))} (${p.label})`)));
}

// ------------------------------------------------------------------ views
function ledgerView(app: App, rows: LedgerRow[] | null, failed: boolean): HTMLElement {
  if (!rows) return el('p', { class: 'muted' }, failed ? 'Couldn\'t load your history.' : 'Loading…');
  const by = new Map<string, { in: number; out: number; n: number }>();
  for (const r of rows) {
    const c = CATS.find((x) => x.match(r.reason))!;
    const e = by.get(c.id) ?? { in: 0, out: 0, n: 0 };
    e.in += r.inSen;
    e.out += r.outSen;
    e.n += r.n;
    by.set(c.id, e);
  }
  if (!by.size) return el('p', { class: 'muted' }, 'Nothing yet in this window.');
  let tin = 0, tout = 0;
  const list = el('div', { class: 'money-list' });
  for (const c of CATS) {
    const e = by.get(c.id);
    if (!e) continue;
    tin += e.in;
    tout += e.out;
    const net = e.in - e.out;
    list.append(
      el('div', { class: 'money-row' },
        el('div', { class: 'money-row-head' }, el('span', {}, `${c.icon} ${c.name}`), el('b', { class: net >= 0 ? 'good' : 'bad' }, `${net >= 0 ? '+' : '−'}${formatMoney(Math.abs(net))}`)),
        el('div', { class: 'muted small' }, [e.in ? `in ${formatMoney(e.in)}` : '', e.out ? `out ${formatMoney(e.out)}` : ''].filter(Boolean).join(' · ')),
        c.income && e.in > 0 ? splitLine(app, e.in, c.income) : null),
    );
  }
  list.append(el('div', { class: 'money-row total' }, el('div', { class: 'money-row-head' }, el('span', {}, 'Net'), el('b', { class: tin - tout >= 0 ? 'good' : 'bad' }, `${tin - tout >= 0 ? '+' : '−'}${formatMoney(Math.abs(tin - tout))}`)), el('div', { class: 'muted small' }, `in ${formatMoney(tin)} · out ${formatMoney(tout)}`)));
  return list;
}

function ratesView(app: App): HTMLElement[] {
  const st = app.store;
  const cfg = app.cfg;
  const m = app.mods();
  const out: HTMLElement[] = [];
  const row = (icon: string, name: string, perHour: number, kind: IncomeKind | null, note: string) =>
    el('div', { class: 'money-row' }, el('div', { class: 'money-row-head' }, el('span', {}, `${icon} ${name}`), el('b', {}, `${formatMoney(Math.round(perHour))}/h`)), el('div', { class: 'muted small' }, note), kind ? splitLine(app, perHour, kind) : null);
  // Manifesting: the Manifest skill sets the rate, Passive Income multiplies it.
  const mid = Object.keys(cfg.upgrades.skills).find((k) => cfg.upgrades.skills[k].effect.kind === 'manifestRate');
  if (mid) {
    const def = cfg.upgrades.skills[mid];
    const lv = skillLevel(cfg.upgrades, st.skills, mid);
    const rate = skillValue(cfg.upgrades, st.skills, 'manifestRate') * 3600;
    const fromSkill = (def.effect.perLevel * (lv - def.startLevel)) * 3600;
    out.push(row('🧘', 'Manifesting', rate * m.passive, 'passive', `While you manifest (sit still). ${fromSkill > 0 ? `${def.name} Lv ${lv} adds ${formatMoney(Math.round(fromSkill))}/h to the ${formatMoney(Math.round(rate - fromSkill))}/h starting rate.` : ''}`));
  }
  // Ventures (idle businesses), after tax.
  const bc = cfg.businesses;
  let biz = 0;
  for (const t of bc.types) {
    const b = st.ventures.businesses[t.id];
    if (b?.level) biz += incomePerHourSen(bc, t, b.level) * (1 - bc.taxRate);
  }
  if (biz > 0) out.push(row('🏢', 'Ventures', biz * m.passive, 'passive', `After ${Math.round(bc.taxRate * 100)}% tax; businesses without a manager only pay when you collect.`));
  // Jobs: what a job that pays RM 100 at base pays you.
  const jobRow = row('📋', 'Jobs', 10_000 * m.jobPay, 'jobs', `A job worth ${formatMoney(10_000)} at base pays you ${formatMoney(Math.round(10_000 * m.jobPay))} (×${m.jobPay.toFixed(2)}).`);
  jobRow.querySelector('b')!.textContent = `×${m.jobPay.toFixed(2)}`;
  out.push(jobRow);
  if (!out.length) out.push(el('p', { class: 'muted' }, 'No steady income yet.'));
  return out;
}

function payablesView(app: App): HTMLElement[] {
  const st = app.store;
  const cfg = app.cfg;
  const out: HTMLElement[] = [];
  const row = (icon: string, name: string, amount: string, note: string, bad = false) =>
    el('div', { class: 'money-row' }, el('div', { class: 'money-row-head' }, el('span', {}, `${icon} ${name}`), el('b', { class: bad ? 'bad' : '' }, amount)), el('div', { class: 'muted small' }, note));
  const bank = st.bank;
  if (bank) {
    for (const l of bank.loans) {
      const name = l.kind === 'ahlong' ? '🦈 Ah Long' : `🏦 ${l.kind[0].toUpperCase()}${l.kind.slice(1)} loan`;
      out.push(row('', name, `${formatMoney(l.instalmentSen)}/day`, `Still owe ${formatMoney(l.owedSen)} · due by day ${l.dueDay} (now day ${bank.day})${l.missed ? ` · ⚠️ ${l.missed} missed` : ''}`, l.missed > 0));
    }
  }
  const s = st.stall;
  if (s?.staff) {
    const per = wagePerHourSen(cfg.stalls, s.tier, app.mods().stall) * s.staff;
    out.push(row('🧑‍🍳', `Stall cooks (${s.staff})`, `${formatMoney(per * 60)}/h`, `${formatMoney(per)} per in-game hour (1 real minute) while the stall is open${s.open ? '' : ' (closed now: no wages)'}`));
  }
  const pc = cfg.properties.costs;
  const homes = st.myProps;
  if (homes.length) {
    const daily = homes.reduce((a, h) => a + h.boughtSen * (pc.taxPerDayRate + pc.maintenancePerDayRate), 0);
    out.push(row('🏘️', `Home running costs (${homes.length})`, `${formatMoney(Math.round(daily))}/day`, `Assessment tax + upkeep per in-game day (24 real minutes)${homes.some((h) => h.manager) ? ` · managers take ${Math.round(pc.managerCut * 100)}% of rent` : ''}`));
  }
  if (!out.length) out.push(el('p', { class: 'muted' }, 'Nothing owed. 🎉'));
  return out;
}

