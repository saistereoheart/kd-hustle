// Rebirth (prestige, spec §13): at the top (wealth stage 6) you can start a new life. Cash,
// homes, businesses, stalls and loans go; cosmetics, furniture, the Item Index, titles, level and
// skills stay. You get Rebirth Tokens (more for a bigger net worth) to spend in the Rebirth Shop on
// permanent bonuses. Your rebirth count shows as stars by your name.
import { z } from 'zod';

export const REBIRTH_PERKS = ['luck', 'income', 'startCash', 'offlineCap', 'offlineEff'] as const;
export type RebirthPerk = (typeof REBIRTH_PERKS)[number];

export const rebirthConfigSchema = z.object({
  minStage: z.number().int().positive(),
  /** Tokens = base × (net worth / perNetWorthSen) ^ exponent (at least `min`). */
  tokens: z.object({ base: z.number().positive(), perNetWorthSen: z.number().positive(), exponent: z.number().positive(), min: z.number().int().nonnegative() }),
  shop: z.array(
    z.object({
      id: z.enum(REBIRTH_PERKS),
      name: z.string(),
      icon: z.string(),
      desc: z.string(),
      /** What one level adds (a share, sen, or hours, depending on the perk). */
      perLevel: z.number().positive(),
      maxLevel: z.number().int().positive(),
      baseCost: z.number().int().positive(),
      growth: z.number().min(1),
    }),
  ),
});
export type RebirthConfig = z.infer<typeof rebirthConfigSchema>;

export interface RebirthState {
  count: number;
  tokens: number;
  shop: Partial<Record<RebirthPerk, number>>;
}

/** What the Rebirth app shows (sent by the server). */
export interface RebirthView {
  count: number;
  tokens: number;
  shop: Partial<Record<RebirthPerk, number>>;
  can: boolean;
  reason: string | null;
  /** Tokens you'd get if you were reborn right now. */
  tokensNow: number;
  minStage: number;
}

export const emptyRebirth = (): RebirthState => ({ count: 0, tokens: 0, shop: {} });

export function rebirthTokens(cfg: RebirthConfig, netWorthSen: number): number {
  const t = cfg.tokens;
  return Math.max(t.min, Math.floor(t.base * Math.pow(Math.max(0, netWorthSen) / t.perNetWorthSen, t.exponent)));
}

export function perkCost(cfg: RebirthConfig, id: RebirthPerk, level: number): number {
  const p = cfg.shop.find((x) => x.id === id)!;
  return Math.ceil(p.baseCost * Math.pow(p.growth, level));
}

/** What a perk gives at its current level. */
export function perkValue(cfg: RebirthConfig, s: Pick<RebirthState, 'shop'>, id: RebirthPerk): number {
  const p = cfg.shop.find((x) => x.id === id);
  return p ? p.perLevel * (s.shop[id] ?? 0) : 0;
}

/** Multipliers for computeMods (luck and income). */
export function rebirthMods(cfg: RebirthConfig, s: Pick<RebirthState, 'shop'>): { luck: number; income: number } {
  return { luck: 1 + perkValue(cfg, s, 'luck'), income: 1 + perkValue(cfg, s, 'income') };
}
