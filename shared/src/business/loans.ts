// Loans (Phase 6, spec §10): Bank Kota (credit score 300–850, personal / business / property
// loans, daily instalments, penalties and repossession) and the Ah Long (instant cash, 20% a
// day, debt collectors). Pure maths shared by server and client.
import { z } from 'zod';

export const loansConfigSchema = z.object({
  credit: z.object({
    start: z.number().int(),
    min: z.number().int(),
    max: z.number().int(),
    onTime: z.number(),
    repaidLoan: z.number(),
    late: z.number(),
    default: z.number(),
    netWorthBonusPer: z.number().positive(),
    netWorthBonusMax: z.number(),
  }),
  bank: z.object({
    name: z.string(),
    types: z.record(
      z.string(),
      z.object({
        name: z.string(),
        icon: z.string(),
        maxBaseSen: z.number().int().positive().optional(),
        /** Property loans: up to this share of the property's value. */
        maxLtv: z.number().min(0).max(1).optional(),
        termDays: z.number().int().positive(),
        collateral: z.enum(['business', 'property']).nullable(),
      }),
    ),
    maxMultByStage: z.array(z.number().positive()).min(1),
    maxMultPerLevel: z.number().nonnegative(),
    interestPerDayAtBest: z.number().nonnegative(),
    interestPerDayAtWorst: z.number().nonnegative(),
    penaltyRate: z.number().nonnegative(),
    graceMissed: z.number().int().nonnegative(),
    repossessAfterMissed: z.number().int().positive(),
    auctionRate: z.number().min(0).max(1),
    maxLoans: z.number().int().positive(),
  }),
  ahlong: z.object({
    name: z.string(),
    interestPerDay: z.number().nonnegative(),
    termDays: z.number().int().positive(),
    maxByStage: z.array(z.number().int().positive()).min(1),
    incomePenalty: z.number().min(0).max(1),
    survivorTitleSen: z.number().int().positive(),
    collectors: z.number().int().nonnegative(),
  }),
});
export type LoansConfig = z.infer<typeof loansConfigSchema>;

export type LoanKind = 'personal' | 'business' | 'property' | 'ahlong';

export interface Loan {
  id: number;
  kind: LoanKind;
  principalSen: number;
  /** What's left to pay (principal + interest so far + penalties). */
  owedSen: number;
  /** Interest per in-game day (fraction). */
  ratePerDay: number;
  takenDay: number;
  dueDay: number;
  /** Instalment due each in-game day. */
  instalmentSen: number;
  missed: number;
  /** Collateral: a property unit id or a business type id. */
  collateral: string | null;
}

/** Interest per in-game day for a credit score: from the worst rate at 300 to the best at 850. */
export function interestRate(cfg: LoansConfig, score: number): number {
  const c = cfg.credit, b = cfg.bank;
  const k = Math.max(0, Math.min(1, (score - c.min) / (c.max - c.min)));
  return b.interestPerDayAtWorst + (b.interestPerDayAtBest - b.interestPerDayAtWorst) * k;
}

/** How much the bank lends for a loan type (property loans: a share of the property's value). */
export function maxLoanSen(cfg: LoansConfig, kind: Exclude<LoanKind, 'ahlong'>, opts: { stage: number; level: number; score: number; collateralValueSen?: number }): number {
  const t = cfg.bank.types[kind];
  if (!t) return 0;
  if (t.maxLtv !== undefined) return Math.floor((opts.collateralValueSen ?? 0) * t.maxLtv * creditFactor(cfg, opts.score));
  const stageMult = cfg.bank.maxMultByStage[Math.min(cfg.bank.maxMultByStage.length - 1, Math.max(0, opts.stage - 1))];
  return Math.floor((t.maxBaseSen ?? 0) * stageMult * (1 + cfg.bank.maxMultPerLevel * opts.level) * creditFactor(cfg, opts.score));
}

/** Good credit lends more: 0.4× at the worst score, 1.2× at the best. */
function creditFactor(cfg: LoansConfig, score: number): number {
  const c = cfg.credit;
  return 0.4 + 0.8 * Math.max(0, Math.min(1, (score - c.min) / (c.max - c.min)));
}

export function ahLongMaxSen(cfg: LoansConfig, stage: number): number {
  return cfg.ahlong.maxByStage[Math.min(cfg.ahlong.maxByStage.length - 1, Math.max(0, stage - 1))];
}

/** Equal daily instalments that pay off principal + simple interest over the term. */
export function instalmentSen(principalSen: number, ratePerDay: number, termDays: number): number {
  return Math.ceil((principalSen * (1 + ratePerDay * termDays)) / termDays);
}

export function clampScore(cfg: LoansConfig, score: number): number {
  return Math.max(cfg.credit.min, Math.min(cfg.credit.max, Math.round(score)));
}
