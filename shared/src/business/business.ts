// Businesses (Phase 6, spec §8.5–8.6): AdVenture Capitalist style idle businesses (a production
// cycle, levels with a growing cost, milestones that double the speed, a manager to automate
// collection, a "rush" interaction for an active bonus) and the retail shop (stock, your own
// prices against a demand curve, a cashier mini-game). Pure maths shared by server and client.
import { z } from 'zod';

const requires = z.object({ stage: z.number().int().positive().optional(), level: z.number().int().positive().optional() }).default({});

export const businessesConfigSchema = z.object({
  costGrowth: z.number().gt(1),
  milestones: z.array(z.number().int().positive()),
  milestoneSpeedMult: z.number().gt(1),
  managerCostMult: z.number().positive(),
  storedCyclesWithoutManager: z.number().int().positive(),
  taxRate: z.number().min(0).max(1),
  rush: z.object({ mult: z.number().gt(1), durationMs: z.number().int().positive(), cooldownMs: z.number().int().positive(), taps: z.number().int().positive(), windowMs: z.number().int().positive() }),
  types: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      icon: z.string(),
      requires,
      baseCostSen: z.number().int().positive(),
      cycleSec: z.number().positive(),
      revenueSen: z.number().int().positive(),
      rushName: z.string(),
    }),
  ),
  retail: z.object({
    name: z.string(),
    icon: z.string(),
    requires,
    openSen: z.number().int().positive(),
    products: z.array(z.object({ id: z.string(), name: z.string(), icon: z.string(), costSen: z.number().int().positive(), marketSen: z.number().int().positive() })).min(1),
    customersPerMin: z.number().positive(),
    elasticity: z.number().positive(),
    itemsPerCustomer: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    cashierBonus: z.number().min(0),
    cashierMinMs: z.number().int().positive(),
    cashierMaxMs: z.number().int().positive(),
    maxStockPerProduct: z.number().int().positive(),
    cashierWagePerDaySen: z.number().int().nonnegative(),
  }),
});
export type BusinessesConfig = z.infer<typeof businessesConfigSchema>;
export type BusinessTypeDef = BusinessesConfig['types'][number];

// ------------------------------------------------------------------ state (saved per player)
export interface BizState {
  level: number;
  manager: boolean;
  /** When the current cycle started (server ms). */
  cycleAt: number;
  /** Finished cycles waiting to be collected (no manager). */
  stored: number;
  rushUntil: number;
  rushReadyAt: number;
  earnedSen: number;
}

export interface RetailState {
  open: boolean;
  stock: Record<string, number>;
  prices: Record<string, number>;
  cashier: boolean;
  /** Customer arrivals are accumulated fractionally between ticks. */
  carry: number;
  earnedSen: number;
  soldToday: number;
  lastWageDay: number;
}

export interface Checkout {
  id: number;
  items: Array<{ product: string; priceSen: number }>;
  totalSen: number;
  paidSen: number;
  options: number[];
  at: number;
}

export interface Ventures {
  businesses: Record<string, BizState>;
  retail: RetailState | null;
}

/** Cost of buying levels `from+1 … from+n` (geometric: base × growth^level). Level 0 → 1 buys the business. */
export function levelCostSen(cfg: BusinessesConfig, t: BusinessTypeDef, from: number, n = 1): number {
  const g = cfg.costGrowth;
  // Σ base·g^k for k = from … from+n-1
  return Math.round((t.baseCostSen * Math.pow(g, from) * (Math.pow(g, n) - 1)) / (g - 1));
}

/** How many levels you can afford with `walletSen` (and their cost). */
export function maxAffordable(cfg: BusinessesConfig, t: BusinessTypeDef, from: number, walletSen: number): { n: number; costSen: number } {
  let n = 0;
  let cost = 0;
  while (n < 1000) {
    const next = levelCostSen(cfg, t, from + n, 1);
    if (cost + next > walletSen) break;
    cost += next;
    n++;
  }
  return { n, costSen: cost };
}

/** Milestones reached at this level (each one doubles the speed). */
export function milestonesReached(cfg: BusinessesConfig, level: number): number {
  return cfg.milestones.filter((m) => level >= m).length;
}

/** Seconds per production cycle at this level. */
export function cycleMs(cfg: BusinessesConfig, t: BusinessTypeDef, level: number): number {
  return (t.cycleSec * 1000) / Math.pow(cfg.milestoneSpeedMult, milestonesReached(cfg, level));
}

/** Money made per cycle (before tax) at this level. */
export function revenuePerCycleSen(t: BusinessTypeDef, level: number): number {
  return t.revenueSen * level;
}

/** Income per real hour at this level (before tax, no rush). */
export function incomePerHourSen(cfg: BusinessesConfig, t: BusinessTypeDef, level: number): number {
  if (level <= 0) return 0;
  return (revenuePerCycleSen(t, level) * 3_600_000) / cycleMs(cfg, t, level);
}

export function managerCostSen(cfg: BusinessesConfig, t: BusinessTypeDef): number {
  return Math.round(t.baseCostSen * cfg.managerCostMult);
}

/** The next milestone level (or null when all are done). */
export function nextMilestone(cfg: BusinessesConfig, level: number): number | null {
  return cfg.milestones.find((m) => m > level) ?? null;
}

// ------------------------------------------------------------------ retail
/**
 * Demand at a price: customers buy at the market price, more when it's cheaper, fewer when it's
 * dearer (elasticity). Returns a multiplier on the base buying chance (0 … 2).
 */
export function retailDemand(cfg: BusinessesConfig, priceSen: number, marketSen: number): number {
  const r = priceSen / Math.max(1, marketSen);
  return Math.max(0, Math.min(2, Math.pow(r, -cfg.retail.elasticity)));
}

/** Profit per item sold at a price. */
export function retailMargin(cfg: BusinessesConfig, productId: string, priceSen: number): number {
  const p = cfg.retail.products.find((x) => x.id === productId);
  return p ? priceSen - p.costSen : 0;
}

/** Expected profit per customer-visit for a product at a price (demand × margin): what to maximise. */
export function retailExpectedProfit(cfg: BusinessesConfig, productId: string, priceSen: number): number {
  const p = cfg.retail.products.find((x) => x.id === productId);
  if (!p) return 0;
  return retailDemand(cfg, priceSen, p.marketSen) * (priceSen - p.costSen);
}
