// HustlePhone → Profile: level + XP, the wealth stage ladder (net worth), where your luck comes
// from, active potions and lifetime stats.
import { buffName } from '../buffName';
import { formatMoney, levelInfo } from '@kh/shared';
import { el } from '../dom';
import { starName } from '../stars';
import type { PhoneCtx } from './phone';

const STAT_LABELS: Array<[string, string, 'n' | 'money' | 'min']> = [
  ['jobs', 'Jobs done', 'n'],
  ['jobs_delivery', 'Deliveries', 'n'],
  ['jobs_carwash', 'Cars washed', 'n'],
  ['perfectWashes', '100% car washes', 'n'],
  ['jobEarnSen', 'Earned from jobs', 'money'],
  ['rolls', 'Crate rolls', 'n'],
  ['crateSpendSen', 'Spent on crates', 'money'],
  ['epicPlusRolls', 'Epic-or-better pulls', 'n'],
  ['bestNoEpicStreak', 'Longest run without an Epic', 'n'],
  ['manifestSecs', 'Time manifesting', 'min'],
  ['sells', 'Items pawned', 'n'],
  ['potionsUsed', 'Potions drunk', 'n'],
  ['questsDone', 'Quests done', 'n'],
  ['bestLoginStreak', 'Best login streak (days)', 'n'],
];

export function renderProfile({ app }: PhoneCtx): HTMLElement[] {
  const pr = app.store.progress;
  const snap = app.snapshot();
  const info = levelInfo(app.cfg.levels, pr.xp);
  const xpBar = el('div', { class: 'progress' }, el('i', {}));
  (xpBar.firstChild as HTMLElement).style.width = info.maxed ? '100%' : `${(info.into / Math.max(1, info.need)) * 100}%`;

  // Wealth stage ladder.
  const ladder = el('div', { class: 'stage-ladder' });
  for (const s of app.cfg.stages.stages) {
    const reached = pr.stage >= s.n;
    const next = s.n === pr.stage + 1;
    const row = el(
      'div',
      { class: `stage-row${reached ? ' reached' : ''}${next ? ' next' : ''}`, 'data-stage': String(s.n) },
      el('span', { class: 'stage-icon' }, s.icon),
      el('div', { class: 'stage-info' }, el('div', { class: 'stage-name' }, `${s.n}. ${s.name}`, el('span', { class: 'muted small' }, ` ${formatMoney(s.minNetWorthSen)}+`)), el('div', { class: 'muted small' }, s.unlocks.join(' · '))),
      el('span', {}, reached ? '✅' : next ? `${Math.floor((snap.netWorthSen / s.minNetWorthSen) * 100)}%` : '🔒'),
    );
    row.style.setProperty('--stage', s.color);
    ladder.append(row);
  }

  // Bonuses.
  const m = app.mods();
  const luckRows = m.luckSources.length ? m.luckSources.map((s) => el('li', {}, `${s.type === 'potion' ? app.items.get(s.label ?? '')?.name ?? 'Potion' : s.label ?? s.type}: ×${s.mult.toFixed(2)}`)) : [el('li', { class: 'muted' }, 'No luck bonuses yet: try a Luck Potion or the Lucky Charm skill.')];
  const bonus = (label: string, v: number) => (Math.abs(v - 1) > 1e-9 ? el('li', {}, `${label}: ×${v.toFixed(2)}`) : null);
  const buffs = app.store.buffs().map((b) => {
    const def = app.items.get(b.item);
    const s = Math.ceil(b.leftMs / 1000);
    return el('li', {}, `${def?.name ?? buffName(app, b.item).name} (${b.mult}× ${b.kind === 'jobPay' ? 'job pay' : b.kind === 'passive' ? 'passive income' : b.kind}): ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left`);
  });

  const stats = el('div', { class: 'stat-grid' });
  for (const [k, label, fmt] of STAT_LABELS) {
    const v = pr.stats[k] ?? 0;
    stats.append(el('div', { class: 'stat' }, el('b', {}, fmt === 'money' ? formatMoney(v) : fmt === 'min' ? `${Math.floor(v / 60)} min` : v.toLocaleString('en-US')), el('span', {}, label)));
  }

  return [
    el('div', { class: 'profile-head' }, el('span', { class: 'lv-badge big' }, `Lv ${pr.level}`), el('div', {}, el('div', { class: 'profile-name' }, starName(app.lastInit?.you.name)), el('div', { class: 'muted small' }, info.maxed ? 'Max level!' : `${info.into.toLocaleString('en-US')} / ${info.need.toLocaleString('en-US')} XP to Level ${pr.level + 1}`))),
    xpBar,
    el('h4', { class: 'phone-section' }, `💰 Net worth ${formatMoney(snap.netWorthSen)}`),
    el('p', { class: 'muted small' }, 'Cash + what your items would sell for at the pawn shop. Your wealth stage never goes back down.'),
    ladder,
    el('h4', { class: 'phone-section' }, `🍀 Luck ×${m.luck.toFixed(2)}`),
    el('ul', { class: 'bonus-list' }, ...luckRows),
    el('h4', { class: 'phone-section' }, '✨ Bonuses'),
    el('ul', { class: 'bonus-list' }, bonus('Job pay', m.jobPay), bonus('XP', m.xp), bonus('Passive income', m.passive), bonus('Walk speed', m.walk), bonus('Variant chance', m.variantChance), m.pityMult < 1 ? el('li', {}, `Pity: ${Math.round((1 - m.pityMult) * 100)}% sooner`) : null, m.carwashExtraSec ? el('li', {}, `Car wash: +${m.carwashExtraSec} s`) : null) ,
    el('h4', { class: 'phone-section' }, '🧪 Active potions'),
    el('ul', { class: 'bonus-list' }, ...(buffs.length ? buffs : [el('li', { class: 'muted' }, 'None. Drink one from the 🎒 Bag.')])),
    el('h4', { class: 'phone-section' }, '📊 Stats'),
    stats,
  ];
}
