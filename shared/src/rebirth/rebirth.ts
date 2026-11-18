// Rebirth (prestige, spec §13, reworked 2026-11-19): at the top (wealth stage 6) you can start a
// new life. EVERYTHING resets (cash, items, Item Index, skills, titles, homes, businesses, stall,
// loans, shards, job levels, wealth stage) except your XP and level. In return, every rebirth
// doubles the cash you earn: ×2 after the first, ×4 after the second, ×8... (jobs, stall sales,
// manifesting, ventures, rent and Airbnb). Your rebirth count shows as stars by your name.
import { z } from 'zod';

export const rebirthConfigSchema = z.object({
  minStage: z.number().int().positive(),
  /** Cash income multiplier per rebirth (compounds: 2 → ×2, ×4, ×8...). */
  cashMultPerRebirth: z.number().min(1),
});
export type RebirthConfig = z.infer<typeof rebirthConfigSchema>;

export interface RebirthState {
  count: number;
}

/** What the Rebirth app shows (sent by the server). */
export interface RebirthView {
  count: number;
  can: boolean;
  reason: string | null;
  minStage: number;
  /** Cash multiplier now, and after the next rebirth. */
  multNow: number;
  multNext: number;
}

export const emptyRebirth = (): RebirthState => ({ count: 0 });

/** Cash multiplier after `count` rebirths. */
export function rebirthCashMult(cfg: RebirthConfig, count: number): number {
  return Math.pow(cfg.cashMultPerRebirth, Math.max(0, count));
}

/** Multipliers for computeMods (luck stays 1; income doubles per rebirth). */
export function rebirthMods(cfg: RebirthConfig, s: Partial<Pick<RebirthState, 'count'>>): { luck: number; income: number } {
  return { luck: 1, income: rebirthCashMult(cfg, s.count ?? 0) };
}
