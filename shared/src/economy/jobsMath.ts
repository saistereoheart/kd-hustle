// Job pay maths (spec §8.1), shared by the server (which pays) and the balance simulator.
import type { JobsConfig } from './schemas';

export function jobLevel(cfg: JobsConfig, done: number): number {
  return Math.min(cfg.maxLevel, 1 + Math.floor(done / cfg.levelUpEvery));
}

export function levelMult(cfg: JobsConfig, level: number): number {
  return 1 + (level - 1) * cfg.payPerLevel;
}

/** Delivery pay in sen: base + distance, × level; tip for arriving early; 30% cut if late. */
export function deliveryPay(cfg: JobsConfig, meters: number, level: number, elapsedMs: number, budgetMs: number) {
  const d = cfg.delivery;
  const base = Math.round((d.baseSen + d.perMeterSen * meters) * levelMult(cfg, level));
  if (elapsedMs > budgetMs) return { paySen: Math.round(base * 0.7), tipSen: 0, late: true };
  const remaining = 1 - elapsedMs / budgetMs;
  return { paySen: base, tipSen: Math.round(base * d.maxTip * remaining), late: false };
}

export function carwashPay(cfg: JobsConfig, cleaned: number, durationMs: number, level: number): number {
  const c = cfg.carwash;
  if (cleaned < c.minCleanToPay) return 0;
  const fast = cleaned >= 1 ? 1 + c.speedBonus * Math.max(0, 1 - durationMs / (c.timeLimitSec * 1000)) : 1;
  return Math.round(c.baseSen * cleaned * fast * levelMult(cfg, level));
}
