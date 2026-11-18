// Loans (Phase 6, spec §10), server side.
//
// Bank Kota: a credit score (300–850, plus a net-worth bonus), personal / business / property
// loans. The interest rate depends on the score. Interest compounds daily on what you owe, and
// an instalment is taken from your wallet each loan day. Missed instalments: a warning, then
// penalty interest, then the collateral is repossessed and auctioned (personal loans: the bank
// takes what's in your wallet and writes off the rest, and your score crashes).
//
// Ah Long: instant cash, no checks, 20% a day, a 3-day term. Late: debt collectors follow you,
// take whatever is in your wallet each day, your properties and businesses earn half, and a red
// "OWES AH LONG" tag hangs over your head.
//
// Loan days pass while you're online (one per in-game day of play), so nobody gets repossessed
// while they're asleep. Everything is server-side; the client only asks.
import {
  ahLongMaxSen, creditScore, emptyFinance, instalmentSen, interestRate, isAhLongLate, maxLoanSen, clampScore, formatMoney,
  type FinanceState, type Loan, type LoanKind, type LoansConfig,
} from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { Repos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { GameError, type Economy } from '../economy/economy';

export interface Collateral {
  /** What the bank values it at (null if you don't own it). */
  value: (p: OnlinePlayer, id: string) => number | null;
  /** Take it away; returns what the auction raised. */
  repossess: (p: OnlinePlayer, id: string) => number;
  /** For the UI: what you could pledge. */
  list: (p: OnlinePlayer) => Array<{ id: string; name: string; valueSen: number }>;
}

export interface LoanHooks {
  wallet: (p: OnlinePlayer, delta: number, reason: string) => void;
  changed: (p: OnlinePlayer) => void;
  event: (p: OnlinePlayer, text: string, kind: 'good' | 'bad' | 'info') => void;
  /** The Ah Long tag changed (tell everyone). */
  publicFlag: (p: OnlinePlayer) => void;
  /** Net worth after debts. */
  netWorth: (p: OnlinePlayer) => number;
  property: Collateral;
  business: Collateral;
  check: (p: OnlinePlayer) => void;
}

const MIN_LOAN_SEN = 10_000; // RM 100

export class LoanSystem {
  private lc: LoansConfig;
  private state = new Map<number, FinanceState>();

  constructor(
    private cfg: ServerConfig,
    private repos: Repos,
    private econ: Economy,
    private hooks: LoanHooks,
  ) {
    this.lc = cfg.loans;
  }

  /** Real ms of play per loan day (one in-game day). */
  get dayMs() {
    return 1440 * this.cfg.time.realMsPerGameMinute;
  }

  of(p: OnlinePlayer): FinanceState {
    let f = this.state.get(p.id);
    if (!f) {
      f = { ...emptyFinance(this.lc), ...(this.repos.playerData.load<Partial<FinanceState>>(p.id, 'finance') ?? {}) };
      this.state.set(p.id, f);
      p.owesAhLong = isAhLongLate(f);
    }
    return f;
  }

  save(p: OnlinePlayer) {
    const f = this.state.get(p.id);
    if (f) this.repos.playerData.save(p.id, 'finance', f);
  }

  unload(p: OnlinePlayer) {
    this.save(p);
    this.state.delete(p.id);
  }

  score(p: OnlinePlayer): number {
    return creditScore(this.lc, this.of(p).score, this.hooks.netWorth(p));
  }

  /** What you owe (counts against net worth). */
  owedOf(p: OnlinePlayer): number {
    return this.of(p).loans.reduce((a, l) => a + l.owedSen, 0);
  }

  /** Income multiplier for properties and businesses (halved while late on the Ah Long). */
  incomeMult(p: OnlinePlayer): number {
    return p.owesAhLong ? 1 - this.lc.ahlong.incomePenalty : 1;
  }

  /** Everything the Bank app needs: score, rates, limits, your loans, what you could pledge. */
  view(p: OnlinePlayer) {
    const f = this.of(p);
    const score = this.score(p);
    const opts = { stage: p.prog.stage, level: p.prog.level, score };
    const pledged = new Set(f.loans.map((l) => l.collateral).filter(Boolean));
    return {
      score,
      rawScore: f.score,
      day: f.day,
      dayProgress: f.dayMs / this.dayMs,
      ratePerDay: interestRate(this.lc, score),
      limits: {
        personal: maxLoanSen(this.lc, 'personal', opts),
        business: maxLoanSen(this.lc, 'business', opts),
        ahlong: ahLongMaxSen(this.lc, p.prog.stage),
      },
      collateral: {
        business: this.hooks.business.list(p).filter((c) => !pledged.has(c.id)),
        property: this.hooks.property.list(p).filter((c) => !pledged.has(c.id)).map((c) => ({ ...c, maxSen: maxLoanSen(this.lc, 'property', { ...opts, collateralValueSen: c.valueSen }) })),
      },
      loans: f.loans,
      owesAhLong: !!p.owesAhLong,
    };
  }

  // ---------------------------------------------------------------- taking and repaying
  take(p: OnlinePlayer, kind: LoanKind, amountSen: number, collateral?: string) {
    const f = this.of(p);
    const score = this.score(p);
    amountSen = Math.floor(amountSen);
    if (amountSen < MIN_LOAN_SEN) throw new GameError(`The smallest loan is ${formatMoney(MIN_LOAN_SEN)}.`);
    let rate: number;
    let term: number;
    let col: string | null = null;
    if (kind === 'ahlong') {
      if (f.loans.some((l) => l.kind === 'ahlong')) throw new GameError('Ah Long: "Pay what you owe first, boss."');
      const max = ahLongMaxSen(this.lc, p.prog.stage);
      if (amountSen > max) throw new GameError(`Ah Long lends up to ${formatMoney(max)} at your stage.`);
      rate = this.lc.ahlong.interestPerDay;
      term = this.lc.ahlong.termDays;
    } else {
      const t = this.lc.bank.types[kind];
      if (!t) throw new GameError('No such loan.');
      if (f.loans.filter((l) => l.kind !== 'ahlong').length >= this.lc.bank.maxLoans) throw new GameError(`${this.lc.bank.name} gives at most ${this.lc.bank.maxLoans} loans at a time.`);
      let max: number;
      if (t.collateral) {
        if (!collateral) throw new GameError(`A ${t.name.toLowerCase()} needs collateral.`);
        if (f.loans.some((l) => l.collateral === `${t.collateral}:${collateral}`)) throw new GameError('That is already pledged for another loan.');
        const hook = t.collateral === 'property' ? this.hooks.property : this.hooks.business;
        const value = hook.value(p, collateral);
        if (value === null) throw new GameError(t.collateral === 'property' ? "That isn't your property." : "You don't own that business.");
        max = maxLoanSen(this.lc, kind, { stage: p.prog.stage, level: p.prog.level, score, collateralValueSen: value });
        col = `${t.collateral}:${collateral}`;
      } else {
        max = maxLoanSen(this.lc, kind, { stage: p.prog.stage, level: p.prog.level, score });
      }
      if (amountSen > max) throw new GameError(`${this.lc.bank.name} lends you up to ${formatMoney(max)} for that.`);
      rate = interestRate(this.lc, score);
      term = t.termDays;
    }
    const loan: Loan = {
      id: f.nextId++, kind, principalSen: amountSen, owedSen: amountSen, ratePerDay: rate, takenDay: f.day, dueDay: f.day + term,
      instalmentSen: instalmentSen(amountSen, rate, term), missed: 0, collateral: col,
    };
    this.econ.run(p, () => {
      this.econ.change(p, amountSen, 0, kind === 'ahlong' ? 'ahlong-loan' : 'bank-loan', `${kind}:${loan.id}`);
      f.loans.push(loan);
      this.save(p);
    });
    p.prog.stats[kind === 'ahlong' ? 'ahlongLoans' : 'bankLoans'] = (p.prog.stats[kind === 'ahlong' ? 'ahlongLoans' : 'bankLoans'] ?? 0) + 1;
    this.hooks.wallet(p, amountSen, 'loan');
    this.hooks.changed(p);
    return { loan };
  }

  /** Pay some (or all) of a loan early. No more interest on what you pay off. */
  repay(p: OnlinePlayer, id: number, amountSen?: number) {
    const f = this.of(p);
    const l = f.loans.find((x) => x.id === id);
    if (!l) throw new GameError('No such loan.');
    const pay = Math.min(l.owedSen, Math.floor(amountSen ?? l.owedSen), p.walletSen);
    if (pay <= 0) throw new GameError('Not enough money.');
    this.econ.run(p, () => {
      this.econ.change(p, -pay, 0, l.kind === 'ahlong' ? 'ahlong-repay' : 'bank-repay', `${l.kind}:${l.id}`);
      l.owedSen -= pay;
      if (l.owedSen <= 0) this.close(p, f, l);
      this.save(p);
    });
    this.hooks.wallet(p, -pay, 'loan');
    this.refreshFlag(p, f);
    this.hooks.changed(p);
    this.hooks.check(p);
    return { paidSen: pay, owedSen: Math.max(0, l.owedSen) };
  }

  /** A loan is paid off: credit for it, and the Ah Long survivor title for a big one. */
  private close(p: OnlinePlayer, f: FinanceState, l: Loan) {
    f.loans = f.loans.filter((x) => x.id !== l.id);
    if (l.kind === 'ahlong') {
      if (l.principalSen >= this.lc.ahlong.survivorTitleSen) p.prog.stats.ahlongSurvived = (p.prog.stats.ahlongSurvived ?? 0) + 1;
      this.hooks.event(p, '🤝 Ah Long: "Pleasure doing business, boss."', 'good');
    } else {
      f.score = clampScore(this.lc, f.score + this.lc.credit.repaidLoan);
      p.prog.stats.loansRepaid = (p.prog.stats.loansRepaid ?? 0) + 1;
      this.hooks.event(p, `🏦 Loan paid off! Credit score +${this.lc.credit.repaidLoan}.`, 'good');
    }
  }

  private refreshFlag(p: OnlinePlayer, f: FinanceState) {
    const late = isAhLongLate(f);
    if (late !== !!p.owesAhLong) {
      p.owesAhLong = late;
      this.hooks.publicFlag(p);
    }
  }

  /** Rebirth: a fresh start (no loans, the Ah Long forgets you). The credit score stays. */
  clearAll(p: OnlinePlayer) {
    const f = this.of(p);
    f.loans = [];
    f.dayMs = 0;
    this.refreshFlag(p, f);
    this.save(p);
    this.hooks.changed(p);
  }

  // ---------------------------------------------------------------- the clock
  /** Every second for online players: bank play time; a full in-game day runs the loan day. */
  tick(p: OnlinePlayer, dtMs: number) {
    const f = this.of(p);
    if (!f.loans.length) {
      f.dayMs = 0;
      return;
    }
    f.dayMs += dtMs;
    while (f.dayMs >= this.dayMs) {
      f.dayMs -= this.dayMs;
      this.loanDay(p, f);
    }
  }

  /** One loan day: interest, the instalment, missed-payment consequences. */
  loanDay(p: OnlinePlayer, f = this.of(p)) {
    f.day++;
    const b = this.lc.bank;
    for (const l of [...f.loans]) {
      l.owedSen = Math.ceil(l.owedSen * (1 + l.ratePerDay));
      if (l.kind === 'ahlong') {
        this.ahLongDay(p, f, l);
        continue;
      }
      const due = Math.min(l.owedSen, l.instalmentSen);
      if (p.walletSen >= due) {
        this.econ.run(p, () => this.econ.change(p, -due, 0, 'bank-instalment', `${l.kind}:${l.id}`));
        this.hooks.wallet(p, -due, 'loan');
        l.owedSen -= due;
        l.missed = 0;
        f.score = clampScore(this.lc, f.score + this.lc.credit.onTime);
        if (l.owedSen <= 0) this.close(p, f, l);
        continue;
      }
      l.missed++;
      f.score = clampScore(this.lc, f.score + this.lc.credit.late);
      if (l.missed > b.graceMissed) l.owedSen = Math.ceil(l.owedSen * (1 + b.penaltyRate));
      if (l.missed >= b.repossessAfterMissed) this.foreclose(p, f, l);
      else this.hooks.event(p, l.missed > b.graceMissed
        ? `🏦 Missed another ${b.name} instalment (${formatMoney(due)}): penalty interest added. ${b.repossessAfterMissed - l.missed} more and they take ${l.collateral ? 'your collateral' : 'what you have'}.`
        : `🏦 ${b.name}: you missed an instalment of ${formatMoney(due)}. Keep money in your wallet!`, 'bad');
    }
    this.refreshFlag(p, f);
    this.save(p);
    this.hooks.changed(p);
    this.hooks.check(p);
  }

  private ahLongDay(p: OnlinePlayer, f: FinanceState, l: Loan) {
    if (f.day <= l.dueDay) return; // still within the term: interest only
    // Late: the collectors take whatever you have.
    const take = Math.min(l.owedSen, p.walletSen);
    if (take > 0) {
      this.econ.run(p, () => this.econ.change(p, -take, 0, 'ahlong-collect', `ahlong:${l.id}`));
      this.hooks.wallet(p, -take, 'loan');
      l.owedSen -= take;
    }
    if (l.owedSen <= 0) {
      this.close(p, f, l);
      this.hooks.event(p, `💪 The debt collectors took ${formatMoney(take)}. You're square with Ah Long.`, 'info');
    } else {
      this.hooks.event(p, `😠 Ah Long's boys took ${formatMoney(take)}. You still owe ${formatMoney(l.owedSen)} (+${Math.round(l.ratePerDay * 100)}% a day).`, 'bad');
    }
  }

  /** Too many missed instalments: the collateral is repossessed and auctioned. */
  private foreclose(p: OnlinePlayer, f: FinanceState, l: Loan) {
    let raised = 0;
    let what = 'the money in your wallet';
    if (l.collateral) {
      const [kind, id] = l.collateral.split(':') as ['property' | 'business', string];
      const hook = kind === 'property' ? this.hooks.property : this.hooks.business;
      raised = hook.value(p, id) !== null ? hook.repossess(p, id) : 0;
      what = kind === 'property' ? 'your property' : 'your business';
    } else {
      raised = Math.min(p.walletSen, l.owedSen);
      if (raised > 0) this.econ.run(p, () => this.econ.change(p, -raised, 0, 'bank-seize', `${l.kind}:${l.id}`));
      if (raised > 0) this.hooks.wallet(p, -raised, 'loan');
    }
    // Auction proceeds pay the debt; anything left over comes back to you; the rest is written off.
    const left = l.collateral ? raised - l.owedSen : 0;
    if (left > 0) {
      this.econ.run(p, () => this.econ.change(p, left, 0, 'bank-auction-surplus', `${l.kind}:${l.id}`));
      this.hooks.wallet(p, left, 'loan');
    }
    // "Bankrupt" (a title nobody wants): after the bank took what it could, you're still in the
    // red (net worth with this loan's remaining debt counted, before it's written off).
    l.owedSen = Math.max(0, l.owedSen - raised);
    if (this.hooks.netWorth(p) < 0) p.prog.stats.bankrupt = (p.prog.stats.bankrupt ?? 0) + 1;
    f.loans = f.loans.filter((x) => x.id !== l.id);
    f.score = clampScore(this.lc, f.score + this.lc.credit.default);
    p.prog.stats.repossessions = (p.prog.stats.repossessions ?? 0) + 1;
    this.hooks.event(p, `🔨 ${this.lc.bank.name} repossessed ${what} (auction: ${formatMoney(raised)}). Your credit score took a big hit.`, 'bad');
  }
}
