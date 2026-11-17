// Schemas for the Phase 2 economy config files (rarities, items, crates, economy, jobs, vehicles).
import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const rateLimit = z.object({ count: z.number().int().positive(), windowMs: z.number().int().positive() });

export const raritiesConfigSchema = z.object({
  tiers: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        color: hex,
        /** Base weight (parts per 100,000). */
        weight: z.number().nonnegative(),
        /** Item value = crate price × valueFactor. */
        valueFactor: z.number().positive(),
        /** Shards for scrapping one Normal item of this tier. */
        shards: z.number().int().positive(),
        /** Broadcast a server-wide announcement when rolled. */
        announce: z.boolean(),
      }),
    )
    .min(2),
  luckAffectsFrom: z.string(),
  maxLuck: z.number().min(1),
  variants: z
    .array(z.object({ id: z.string(), name: z.string(), oneIn: z.number().min(1), valueMult: z.number().positive() }))
    .min(1),
});
export type RaritiesConfig = z.infer<typeof raritiesConfigSchema>;

export const ITEM_TYPES = ['hat', 'face', 'aura', 'back', 'namecolor', 'trinket', 'furniture', 'booster'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
/** Item types that can be equipped, and the slot they go into. */
export const EQUIP_SLOTS = ['hat', 'face', 'aura', 'back', 'namecolor'] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

export const itemsConfigSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9_]+$/),
      name: z.string(),
      type: z.enum(ITEM_TYPES),
      rarity: z.string(),
      shape: z.string(),
      color: hex,
      color2: hex.optional(),
      desc: z.string().optional(),
      /** Limited items: only this many can ever be rolled on the server (serial #1..limit). */
      limit: z.number().int().positive().optional(),
    }),
  ),
});
export type ItemsConfig = z.infer<typeof itemsConfigSchema>;
export type ItemDef = ItemsConfig['items'][number];

export const cratesConfigSchema = z.object({
  crates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      priceSen: z.number().int().positive(),
      color: hex,
      /** Guaranteed tier after this many rolls without it (e.g. Epic+ every 50). */
      pity: z.object({ epic: z.number().int().positive(), legendary: z.number().int().positive() }),
      pool: z.array(z.string()).min(1),
    }),
  ),
});
export type CratesConfig = z.infer<typeof cratesConfigSchema>;
export type CrateDef = CratesConfig['crates'][number];

export const economyConfigSchema = z.object({
  startingWalletSen: z.number().int().nonnegative(),
  /** Pawn shop pays this fraction of an item's value. */
  pawnRate: z.number().min(0).max(1),
  shardShopPrices: z.record(z.string(), z.number().int().positive()),
  /** Completing a crate's Item Index page pays crate price × this. */
  indexPageRewardMultiplier: z.number().nonnegative(),
  interactRadiusTiles: z.number().positive(),
  rollRateLimit: rateLimit,
  /** Delay before other players see a rare-pull announcement (so it lands after the reel). */
  announceDelayMs: z.number().int().nonnegative(),
});
export type EconomyConfig = z.infer<typeof economyConfigSchema>;

export const jobsConfigSchema = z.object({
  levelUpEvery: z.number().int().positive(),
  maxLevel: z.number().int().positive(),
  payPerLevel: z.number().nonnegative(),
  delivery: z.object({
    name: z.string(),
    baseSen: z.number().int().nonnegative(),
    perMeterSen: z.number().nonnegative(),
    minMeters: z.number().positive(),
    maxMeters: z.number().positive(),
    timeBudgetFactor: z.number().positive(),
    timeBudgetSlackSec: z.number().nonnegative(),
    maxTip: z.number().nonnegative(),
    pickupRadiusTiles: z.number().positive(),
    /** The time budget (and so the tip) is set for this vehicle's speed. Faster rides tip more. */
    budgetVehicle: z.string(),
  }),
  carwash: z.object({
    name: z.string(),
    baseSen: z.number().int().nonnegative(),
    timeLimitSec: z.number().positive(),
    /** Stage 1, soap: scrub dirt spots. Some are stubborn and need more scrubbing. */
    spots: z.number().int().positive(),
    stubbornSpots: z.number().int().nonnegative(),
    hitsPerSpot: z.number().int().positive(),
    stubbornHits: z.number().int().positive(),
    spotRadius: z.number().positive(),
    /** Stage 2, rinse: hose down every cell of the car body (a cols × rows grid over `rinseArea`). */
    rinseCols: z.number().int().positive(),
    rinseRows: z.number().int().positive(),
    rinseHitsPerCell: z.number().int().positive(),
    rinseArea: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    /** Stage 3, polish: shine marks pop up one by one; buff each before it fades. */
    polishSpots: z.number().int().nonnegative(),
    polishIntervalMs: z.number().int().positive(),
    polishWindowMs: z.number().int().positive(),
    polishHits: z.number().int().positive(),
    polishRadius: z.number().positive(),
    /** How much each stage counts towards the final score (sums to 1). */
    weights: z.object({ soap: z.number(), rinse: z.number(), polish: z.number() }),
    maxPointsPerSec: z.number().positive(),
    minCleanToPay: z.number().min(0).max(1),
    speedBonus: z.number().nonnegative(),
  }),
});
export type JobsConfig = z.infer<typeof jobsConfigSchema>;

export const vehiclesConfigSchema = z.object({
  vehicles: z.record(
    z.string(),
    z.object({
      name: z.string(),
      icon: z.string(),
      speed: z.number().positive(),
      hitbox: z.object({ w: z.number(), h: z.number() }),
      /** 'walk': goes where people walk (paths, sidewalks, footbridges; no highways).
       *  'drive': goes where cars go (roads, highways, grass; no footbridges). */
      grid: z.enum(['walk', 'drive']),
      /** Slowest terrain multiplier (grass etc. never slows it below this). */
      minTerrainMult: z.number().min(0).max(1),
      /** Everyone owns one from the start. */
      starter: z.boolean().default(false),
      /** A hailed ride (Ronda): drawn with a driver, you sit on the back and can't steer. */
      passenger: z.boolean().default(false),
    }),
  ),
});
export type VehiclesConfig = z.infer<typeof vehiclesConfigSchema>;
export type VehicleDef = VehiclesConfig['vehicles'][string];

/** Ronda: the ride-hailing app on the phone (point A to point B on a kapcai, for a fare). */
export const ridesConfigSchema = z.object({
  appName: z.string(),
  /** Vehicle id drawn while you're a passenger (a `passenger: true` vehicle). */
  vehicle: z.string(),
  baseFareSen: z.number().int().nonnegative(),
  perKmSen: z.number().int().nonnegative(),
  minFareSen: z.number().int().positive(),
  fareRoundSen: z.number().int().positive(),
  speedPxPerSec: z.number().positive(),
  /** The rider "arrives" this long after booking, then sets off. */
  pickupMs: z.number().int().nonnegative(),
  minTripMeters: z.number().nonnegative(),
  quoteTtlSec: z.number().positive(),
  /** Booking fails if you walked further than this from where you asked for the quote. */
  maxQuoteDriftTiles: z.number().positive(),
  /** How far a picked spot may be from a road the rider can use. */
  snapRadiusTiles: z.number().int().positive(),
  /** Route cost per tile = 1 / speedMult^pow, so higher = sticks to roads harder. */
  offroadPenaltyPow: z.number().nonnegative(),
  /** Route simplification tolerance (tiles). */
  simplifyTiles: z.number().nonnegative(),
  maxSearchNodes: z.number().int().positive(),
});
export type RidesConfig = z.infer<typeof ridesConfigSchema>;

/** Fare for a trip of `meters`: base + per-km, at least the minimum, rounded. */
export function rideFareSen(cfg: RidesConfig, meters: number): number {
  const raw = cfg.baseFareSen + (cfg.perKmSen * meters) / 1000;
  return Math.max(cfg.minFareSen, Math.round(raw / cfg.fareRoundSen) * cfg.fareRoundSen);
}

/** Cross-file checks: every pool item exists, every item is in exactly one crate, rarities exist. */
export function validateEconomyConfigs(r: RaritiesConfig, items: ItemsConfig, crates: CratesConfig): string[] {
  const errors: string[] = [];
  const tierIds = new Set(r.tiers.map((t) => t.id));
  const itemIds = new Map(items.items.map((i) => [i.id, i]));
  const seen = new Map<string, string>();
  if (itemIds.size !== items.items.length) errors.push('duplicate item ids');
  for (const i of items.items) if (!tierIds.has(i.rarity)) errors.push(`item ${i.id}: unknown rarity ${i.rarity}`);
  for (const c of crates.crates) {
    for (const id of c.pool) {
      if (!itemIds.has(id)) errors.push(`crate ${c.id}: unknown item ${id}`);
      if (seen.has(id)) errors.push(`item ${id} is in crates ${seen.get(id)} and ${c.id}`);
      seen.set(id, c.id);
    }
  }
  for (const i of items.items) if (!seen.has(i.id)) errors.push(`item ${i.id} is not in any crate`);
  if (!tierIds.has(r.luckAffectsFrom)) errors.push(`luckAffectsFrom: unknown tier ${r.luckAffectsFrom}`);
  return errors;
}

export const skillsConfigSchema = z.object({
  skills: z.object({
    manifest: z.object({
      name: z.string(),
      desc: z.string(),
      maxLevel: z.number().int().positive(),
      /** Cost to go from level L to L+1 = baseCostSen × costGrowth^(L-1). */
      baseCostSen: z.number().int().positive(),
      costGrowth: z.number().min(1),
      /** Earnings while manifesting = baseSenPerSec + (level-1) × senPerSecPerLevel. */
      baseSenPerSec: z.number().nonnegative(),
      senPerSecPerLevel: z.number().nonnegative(),
    }),
  }),
  /** Manifest earnings are banked and paid out (one DB write) every N seconds. */
  manifestFlushEverySec: z.number().int().positive(),
});
export type SkillsConfig = z.infer<typeof skillsConfigSchema>;

export function manifestRateSen(cfg: SkillsConfig, level: number): number {
  const m = cfg.skills.manifest;
  return m.baseSenPerSec + (Math.max(1, level) - 1) * m.senPerSecPerLevel;
}

export function skillUpgradeCostSen(cfg: SkillsConfig, level: number): number {
  const m = cfg.skills.manifest;
  return Math.round(m.baseCostSen * Math.pow(m.costGrowth, Math.max(1, level) - 1));
}
