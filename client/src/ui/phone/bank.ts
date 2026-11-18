// HustlePhone → Bank (Phase 6, spec §10): Bank Kota (credit score, personal / business /
// property loans, repayments) and, in the other tab, the Ah Long's number (instant cash at 20% a
// day). The server does all the maths; this shows it and sends requests.
import { creditBand, formatMoney, type BankView, type Loan } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { sfx } from '../sound';
import type { PhoneCtx } from './phone';

let tab: 'bank' | 'ahlong' = 'bank';
/** Which loan type the "new loan" form is on, and how much of the limit (%). */
let kind: 'personal' | 'business' | 'property' = 'personal';
let pct = 50;
let pick = '';

/** Ask the server for a fresh view (the store keeps the last one). */
export function refreshBank(app: App) {
  app.socket?.timeout(5000).emit('bank:view', (err, res) => {
    if (err || !res.ok) return;
    app.store.bank = res.bank;
    app.store.emit();
  });
}

function loanCard(app: App, l: Loan, bank: BankView): HTMLElement {
  const lc = app.cfg.loans;
  const ah = l.kind === 'ahlong';
  const name = ah ? lc.ahlong.name : lc.bank.types[l.kind]?.name ?? l.kind;
  const icon = ah ? '🦈' : lc.bank.types[l.kind]?.icon ?? '💳';
  const daysLeft = l.dueDay - bank.day;
  const late = ah && daysLeft < 0;
  const all = el('button', { class: 'btn primary', type: 'button', 'data-action': `repay-${l.id}`, disabled: app.store.walletSen <= 0 }, app.store.walletSen >= l.owedSen ? 'Pay it all off' : 'Pay what I can', el('small', {}, formatMoney(Math.min(l.owedSen, app.store.walletSen))));
  all.addEventListener('click', () =>
    app.socket?.timeout(5000).emit('loan:repay', { id: l.id }, (err, res) => {
      if (err || !res.ok) return (sfx.error(), toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad'));
      sfx.coin();
      toast(res.owedSen ? `Paid ${formatMoney(res.paidSen)}. ${formatMoney(res.owedSen)} left.` : 'Paid off! 🎉', 'good');
    }),
  );
  const collateral = l.collateral ? l.collateral.split(':')[1] : null;
  return el(
    'div',
    { class: `job-card loan-card${late ? ' late' : ''}`, 'data-loan': String(l.id) },
    el('div', { class: 'job-icon' }, icon),
    el(
      'div',
      { class: 'job-info' },
      el('h4', {}, name, el('span', { class: `lv-badge${late ? ' blogger' : ''}` }, late ? 'LATE' : daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'due')),
      el('p', {}, `You owe ${formatMoney(l.owedSen)} (borrowed ${formatMoney(l.principalSen)}) · ${(l.ratePerDay * 100).toFixed(1)}% a day`),
      el('div', { class: 'muted small' }, ah
        ? late ? 'The collectors take what\'s in your wallet each day, and your homes and businesses earn half.' : `Pay it before day ${l.dueDay} or the collectors come.`
        : `${formatMoney(Math.min(l.owedSen, l.instalmentSen))} is taken from your wallet each loan day${l.missed ? ` · ⚠️ ${l.missed} missed` : ''}${collateral ? ` · collateral: ${collateral}` : ''}`),
      el('div', { class: 'biz-actions' }, all),
    ),
  );
}

function bankTab(app: App, b: BankView): HTMLElement[] {
  const lc = app.cfg.loans;

  const bankLoans = b.loans.filter((l) => l.kind !== 'ahlong');
  const gauge = el('div', { class: 'progress credit' }, el('i', {}));
  (gauge.firstChild as HTMLElement).style.width = `${((b.score - lc.credit.min) / (lc.credit.max - lc.credit.min)) * 100}%`;
  const out: HTMLElement[] = [
    el(
      'div',
      { class: 'job-card' },
      el('div', { class: 'job-icon' }, '🏦'),
      el(
        'div',
        { class: 'job-info' },
        el('h4', {}, `Credit score ${b.score}`, el('span', { class: 'lv-badge' }, creditBand(b.score))),
        gauge,
        el('div', { class: 'muted small' }, `Rate at your score: ${(b.ratePerDay * 100).toFixed(2)}% a day. On-time instalments and paying off loans raise it; missed ones drop it. Net worth helps too.`),
      ),
    ),
  ];
  if (bankLoans.length) out.push(el('h4', { class: 'phone-section' }, 'Your loans'), ...bankLoans.map((l) => loanCard(app, l, b)));
  // New loan.
  out.push(el('h4', { class: 'phone-section' }, `New loan (${bankLoans.length}/${lc.bank.maxLoans})`));
  const kinds = el('div', { class: 'branch-tabs' });
  for (const k of ['personal', 'business', 'property'] as const) {
    const t = lc.bank.types[k];
    const btn = el('button', { class: `branch-tab${kind === k ? ' active' : ''}`, type: 'button', 'data-loankind': k }, `${t.icon} ${t.name}`);
    btn.addEventListener('click', () => {
      kind = k;
      pick = '';
      app.store.emit();
    });
    kinds.append(btn);
  }
  out.push(kinds);
  const t = lc.bank.types[kind];
  let max = kind === 'personal' ? b.limits.personal : kind === 'business' ? b.limits.business : 0;
  const options = kind === 'business' ? b.collateral.business : kind === 'property' ? b.collateral.property : [];
  if (t.collateral) {
    if (!options.length) {
      out.push(el('p', { class: 'muted' }, kind === 'business' ? 'Pledge a business you own (📱 → Ventures) as collateral.' : 'Pledge a home you own as collateral (up to 90% of its value).'));
      return out;
    }
    if (!options.some((o) => o.id === pick)) pick = options[0].id;
    const sel = el('div', { class: 'biz-actions' });
    for (const o of options) {
      const btn = el('button', { class: `btn small${o.id === pick ? ' primary' : ''}`, type: 'button', 'data-collateral': o.id }, o.name, el('small', {}, `worth ${formatMoney(o.valueSen)}`));
      btn.addEventListener('click', () => {
        pick = o.id;
        app.store.emit();
      });
      sel.append(btn);
    }
    out.push(el('p', { class: 'muted small' }, 'Collateral (taken if you miss too many instalments):'), sel);
    if (kind === 'property') max = (options as BankView['collateral']['property']).find((o) => o.id === pick)?.maxSen ?? 0;
  }
  const amount = Math.max(0, Math.floor((max * pct) / 100 / 100) * 100);
  const pcts = el('div', { class: 'biz-actions' });
  for (const p of [10, 25, 50, 100]) {
    const btn = el('button', { class: `btn small${pct === p ? ' primary' : ''}`, type: 'button', 'data-pct': String(p) }, `${p}%`);
    btn.addEventListener('click', () => {
      pct = p;
      app.store.emit();
    });
    pcts.append(btn);
  }
  const total = Math.ceil(amount * (1 + b.ratePerDay * t.termDays));
  const take = el('button', { class: 'btn primary', type: 'button', 'data-action': 'loan-take', disabled: amount < 10_000 || bankLoans.length >= lc.bank.maxLoans }, `Borrow ${formatMoney(amount)}`, el('small', {}, `${formatMoney(Math.ceil(total / t.termDays))} a day for ${t.termDays} days`));
  take.addEventListener('click', () => {
    if (!confirm(`Borrow ${formatMoney(amount)} from ${lc.bank.name}? About ${formatMoney(Math.ceil(total / t.termDays))} is taken from your wallet each loan day for ${t.termDays} days.`)) return;
    app.socket?.timeout(5000).emit('loan:take', { kind, amountSen: amount, collateral: t.collateral ? pick : undefined }, (err, res) => {
      if (err || !res.ok) return (sfx.error(), toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad'));
      sfx.coin();
      toast(`🏦 +${formatMoney(amount)}. Don't miss your instalments!`, 'good');
    });
  });
  out.push(el('p', { class: 'muted small' }, `You can borrow up to ${formatMoney(max)}.`), pcts, take);
  out.push(el('p', { class: 'hint' }, `A loan day is an in-game day of play (${Math.round((1440 * app.cfg.time.realMsPerGameMinute) / 60000)} real minutes online): nothing is taken while you're offline. Miss ${lc.bank.repossessAfterMissed} in a row and the bank takes your collateral (or your wallet).`));

  return out;
}

function ahLongTab(app: App, b: BankView): HTMLElement[] {
  const a = app.cfg.loans.ahlong;
  const loan = b.loans.find((l) => l.kind === 'ahlong');
  const out: HTMLElement[] = [
    el(
      'div',
      { class: 'job-card ahlong-card' },
      el('div', { class: 'job-icon' }, '🦈'),
      el('div', { class: 'job-info' }, el('h4', {}, `${a.name}`, el('span', { class: 'lv-badge blogger' }, 'no checks')), el('p', {}, `"Need cash fast, boss? No problem." ${Math.round(a.interestPerDay * 100)}% a day, pay back in ${a.termDays} days. Late? My boys will find you.`)),
    ),
  ];
  if (loan) {
    out.push(loanCard(app, loan, b));
    return out;
  }
  const amounts = [0.1, 0.25, 0.5, 1].map((k) => Math.max(10_000, Math.floor((b.limits.ahlong * k) / 100) * 100));
  const row = el('div', { class: 'biz-actions' });
  for (const amt of [...new Set(amounts)]) {
    const owe = Math.ceil(amt * (1 + a.interestPerDay) ** a.termDays);
    const btn = el('button', { class: 'btn small', type: 'button', 'data-ahlong': String(amt) }, `Take ${formatMoney(amt)}`, el('small', {}, `owe ~${formatMoney(owe)} in ${a.termDays} days`));
    btn.addEventListener('click', () => {
      if (!confirm(`Take ${formatMoney(amt)} from the Ah Long? You'll owe about ${formatMoney(owe)} in ${a.termDays} days, more every day after that.`)) return;
      app.socket?.timeout(5000).emit('loan:take', { kind: 'ahlong', amountSen: amt }, (err, res) => {
        if (err || !res.ok) return (sfx.error(), toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad'));
        sfx.coin();
        toast(`🦈 +${formatMoney(amt)}. "See you in ${a.termDays} days, boss."`, 'info', 5000);
      });
    });
    row.append(btn);
  }
  out.push(row, el('p', { class: 'hint' }, `Paying back ${formatMoney(a.survivorTitleSen)} or more earns the "Survived Ah Long" title.`));
  return out;
}

export function renderBank({ app, rerender }: PhoneCtx): HTMLElement[] {
  const b = app.store.bank;
  const tabsEl = el('div', { class: 'branch-tabs' });
  for (const [id, name] of [['bank', `🏦 ${app.cfg.loans.bank.name}`], ['ahlong', '🦈 Ah Long']] as const) {
    const btn = el('button', { class: `branch-tab${tab === id ? ' active' : ''}`, type: 'button', 'data-banktab': id }, name);
    btn.addEventListener('click', () => {
      tab = id;
      rerender();
    });
    tabsEl.append(btn);
  }
  if (!b) {
    refreshBank(app);
    return [tabsEl, el('p', { class: 'muted' }, 'Connecting to the bank…')];
  }
  return [tabsEl, ...(tab === 'bank' ? bankTab(app, b) : ahLongTab(app, b))];
}
