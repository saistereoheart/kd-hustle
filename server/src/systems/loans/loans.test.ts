import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ahLongMaxSen, interestRate, maxLoanSen } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { Economy } from '../economy/economy';
import { emptyProgress } from '../progression/progression';
import { LoanSystem } from './loans';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const lc = cfg.loans;

function setup(walletSen = 10_000_000, stage = 3) {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const id = repos.accounts.create('debtor', 'h', false, { x: 0, y: 0 }, 2, walletSen);
  const p = {
    id, name: 'debtor', walletSen, shards: 0, inventory: [], equipped: {}, cosmetics: {}, index: new Set<string>(), pages: new Set<string>(), pity: {}, jobs: {}, skills: {},
    prog: emptyProgress(),
  } as unknown as OnlinePlayer;
  p.prog.stage = stage;
  p.prog.level = 10;
  const econ = new Economy(repos, cfg);
  const events: string[] = [];
  const homes = new Map<string, number>([['home#1', 50_000_000]]);
  const taken: string[] = [];
  let flags = 0;
  const loans = new LoanSystem(cfg, repos, econ, {
    wallet: () => {}, changed: () => {}, check: () => {}, event: (_p, t) => events.push(t), publicFlag: () => flags++,
    netWorth: (pl) => pl.walletSen - loans.owedOf(pl),
    property: {
      value: (_p, unit) => homes.get(unit) ?? null,
      repossess: (_p, unit) => {
        taken.push(unit);
        const v = homes.get(unit) ?? 0;
        homes.delete(unit);
        return Math.round(v * lc.bank.auctionRate);
      },
      list: () => [...homes].map(([id, v]) => ({ id, name: id, valueSen: v })),
    },
    business: { value: () => null, repossess: () => 0, list: () => [] },
  });
  /** Run `n` loan days of play. */
  const days = (n: number) => loans.tick(p, loans.dayMs * n);
  return { repos, p, econ, loans, days, events, taken, homes, flags: () => flags };
}

describe('Bank Kota', () => {
  it('better credit means a lower rate and bigger loans; limits grow with the wealth stage', () => {
    expect(interestRate(lc, 800)).toBeLessThan(interestRate(lc, 500));
    const opts = { stage: 3, level: 10 };
    expect(maxLoanSen(lc, 'personal', { ...opts, score: 800 })).toBeGreaterThan(maxLoanSen(lc, 'personal', { ...opts, score: 500 }));
    expect(maxLoanSen(lc, 'personal', { ...opts, stage: 5, score: 600 })).toBeGreaterThan(maxLoanSen(lc, 'personal', { ...opts, score: 600 }));
    expect(maxLoanSen(lc, 'property', { ...opts, score: 850, collateralValueSen: 1_000_000 })).toBeLessThanOrEqual(1_000_000 * (lc.bank.types.property.maxLtv ?? 1) * 1.2);
  });

  it('a personal loan pays out, then daily instalments pay it off and raise the score', () => {
    const s = setup();
    const w = s.p.walletSen;
    const score0 = s.loans.of(s.p).score;
    const max = s.loans.view(s.p).limits.personal;
    expect(() => s.loans.take(s.p, 'personal', max + 100)).toThrow(/up to/);
    expect(() => s.loans.take(s.p, 'personal', 50)).toThrow(/smallest/);
    const { loan } = s.loans.take(s.p, 'personal', 100_000);
    expect(s.p.walletSen - w).toBe(100_000);
    s.days(lc.bank.types.personal.termDays + 2);
    expect(s.loans.of(s.p).loans).toEqual([]);
    expect(s.loans.of(s.p).score).toBeGreaterThan(score0);
    expect(s.p.prog.stats.loansRepaid).toBe(1);
    // Paid back more than borrowed (interest), but not crazily more.
    const paid = w + 100_000 - s.p.walletSen;
    expect(paid).toBeGreaterThan(100_000);
    expect(paid).toBeLessThan(100_000 * (1 + loan.ratePerDay * (lc.bank.types.personal.termDays + 2)) * 1.1);
  });

  it('loan days only pass with play time', () => {
    const s = setup();
    s.loans.take(s.p, 'personal', 100_000);
    s.loans.tick(s.p, s.loans.dayMs - 1000);
    expect(s.loans.of(s.p).day).toBe(0);
    s.loans.tick(s.p, 2000);
    expect(s.loans.of(s.p).day).toBe(1);
  });

  it('paying early stops the interest', () => {
    const s = setup();
    const { loan } = s.loans.take(s.p, 'personal', 100_000);
    const r = s.loans.repay(s.p, loan.id);
    expect(r).toEqual({ paidSen: 100_000, owedSen: 0 });
    expect(s.loans.of(s.p).loans).toEqual([]);
  });

  it('missed instalments: warnings, penalty interest, then the bank takes your wallet and your score crashes', () => {
    const s = setup(0);
    s.loans.take(s.p, 'personal', 100_000);
    // Spend it all (e.g. on crates): nothing left for instalments.
    s.econ.run(s.p, () => s.econ.change(s.p, -s.p.walletSen, 0, 'test', null));
    const score0 = s.loans.of(s.p).score;
    s.days(1);
    expect(s.loans.of(s.p).loans[0].missed).toBe(1);
    expect(s.events.some((e) => /missed an instalment/.test(e))).toBe(true);
    s.days(lc.bank.repossessAfterMissed - 1);
    expect(s.loans.of(s.p).loans).toEqual([]);
    expect(s.loans.of(s.p).score).toBeLessThan(score0 + lc.credit.default / 2);
    expect(s.p.prog.stats.repossessions).toBe(1);
    expect(s.p.prog.stats.bankrupt).toBe(1); // nothing left, and nothing to show for it
  });

  it('a defaulted property loan repossesses the home; the auction pays the debt and you get the rest', () => {
    const s = setup(0);
    const max = s.loans.view(s.p).collateral.property[0].maxSen;
    expect(() => s.loans.take(s.p, 'property', 1_000_000)).toThrow(/collateral/);
    expect(() => s.loans.take(s.p, 'property', 1_000_000, 'nope')).toThrow(/your property/);
    s.loans.take(s.p, 'property', Math.min(max, 1_000_000), 'home#1');
    expect(() => s.loans.take(s.p, 'property', 100_000, 'home#1')).toThrow(/already pledged/);
    s.econ.run(s.p, () => s.econ.change(s.p, -s.p.walletSen, 0, 'test', null));
    s.days(lc.bank.repossessAfterMissed);
    expect(s.taken).toEqual(['home#1']);
    expect(s.loans.of(s.p).loans).toEqual([]);
    // RM 500K home × auction rate, minus a ~RM 10K debt: the rest comes back.
    expect(s.p.walletSen).toBeGreaterThan(50_000_000 * lc.bank.auctionRate - 2_000_000);
  });

  it('caps the number of bank loans', () => {
    const s = setup();
    for (let i = 0; i < lc.bank.maxLoans; i++) s.loans.take(s.p, 'personal', 10_000);
    expect(() => s.loans.take(s.p, 'personal', 10_000)).toThrow(/at most/);
  });
});

describe('Ah Long', () => {
  it('lends instantly (up to a stage limit), 20% a day, one loan at a time', () => {
    const s = setup();
    expect(() => s.loans.take(s.p, 'ahlong', ahLongMaxSen(lc, 3) + 100)).toThrow(/up to/);
    const { loan } = s.loans.take(s.p, 'ahlong', 100_000);
    expect(loan.ratePerDay).toBe(lc.ahlong.interestPerDay);
    expect(() => s.loans.take(s.p, 'ahlong', 10_000)).toThrow(/Pay what you owe/);
    s.days(1);
    expect(s.loans.of(s.p).loans[0].owedSen).toBe(Math.ceil(100_000 * (1 + lc.ahlong.interestPerDay)));
  });

  it('late: the tag goes up, income halves, collectors take your wallet; paying off clears it (and big ones earn the title)', () => {
    const s = setup(0, 4);
    const big = lc.ahlong.survivorTitleSen;
    s.loans.take(s.p, 'ahlong', big);
    s.econ.run(s.p, () => s.econ.change(s.p, -s.p.walletSen, 0, 'test', null)); // gambled it away
    s.days(lc.ahlong.termDays + 1);
    expect(s.p.owesAhLong).toBe(true);
    expect(s.flags()).toBe(1);
    expect(s.loans.incomeMult(s.p)).toBeCloseTo(1 - lc.ahlong.incomePenalty);
    // Some money comes in: the collectors take it.
    s.econ.run(s.p, () => s.econ.change(s.p, 300_000, 0, 'test', null));
    s.days(1);
    expect(s.p.walletSen).toBe(0);
    // Pay the rest.
    const owed = s.loans.owedOf(s.p);
    s.econ.run(s.p, () => s.econ.change(s.p, owed, 0, 'test', null));
    s.loans.repay(s.p, s.loans.of(s.p).loans[0].id);
    expect(s.p.owesAhLong).toBe(false);
    expect(s.loans.incomeMult(s.p)).toBe(1);
    expect(s.p.prog.stats.ahlongSurvived).toBe(1);
  });

  it('loans survive a reload (and the tag is restored)', () => {
    const s = setup(0);
    s.loans.take(s.p, 'ahlong', 100_000);
    s.econ.run(s.p, () => s.econ.change(s.p, -s.p.walletSen, 0, 'test', null));
    s.days(lc.ahlong.termDays + 1);
    s.loans.unload(s.p);
    s.p.owesAhLong = false;
    expect(s.loans.of(s.p).loans).toHaveLength(1);
    expect(s.p.owesAhLong).toBe(true);
  });
});
