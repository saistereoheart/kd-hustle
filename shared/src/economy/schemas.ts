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

export const ITEM_TYPES = ['hat', 'face', 'aura', 'back', 'namecolor', 'trinket', 'furniture', 'booster', 'potion', 'chef', 'cashier', 'pet', 'petgear'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
/** What a potion does when used: multiplies one kind of buff for a while. */
export const BUFF_KINDS = ['luck', 'xp', 'passive', 'jobPay', 'customers', 'staffSpeed', 'perfectCook'] as const;
export type BuffKind = (typeof BUFF_KINDS)[number];
/** Item types that can be equipped, and the slot they go into. */
export const EQUIP_SLOTS = ['hat', 'face', 'aura', 'back', 'namecolor', 'chef', 'cashier'] as const;
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
      /** Potions: the buff they give when used. */
      /** Timed buffs have `durationSec`; perfectCook gives `charges` (dishes auto-Perfect). */
      effect: z.object({ buff: z.enum(BUFF_KINDS), mult: z.number().min(1), durationSec: z.number().int().positive().optional(), charges: z.number().int().positive().optional() }).optional(),
      /** Fixed value (sen) for items that don't come from a crate (potions from rewards). */
      valueSen: z.number().int().positive().optional(),
      /** Shard Shop price, overriding the price for its rarity. */
      shardPrice: z.number().int().positive().optional(),
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
      /** Paid in 💎 shards instead of RM (the Chef Search); `priceSen` then only sets item values. */
      priceShards: z.number().int().positive().optional(),
      color: hex,
      /** Guaranteed tier after this many rolls without it (e.g. Epic+ every 50). */
      pity: z.object({ epic: z.number().int().positive(), legendary: z.number().int().positive() }),
      pool: z.array(z.string()).min(1),
      /** Wealth stage / player level needed to roll it. */
      requires: z.object({ stage: z.number().int().positive().optional(), level: z.number().int().positive().optional() }).default({}),
      /** A limited crate: only rollable while this server event runs. Its pool reuses other crates' items. */
      event: z.string().optional(),
    }),
  ),
});
export type CratesConfig = z.infer<typeof cratesConfigSchema>;
export type CrateDef = CratesConfig['crates'][number];

export const economyConfigSchema = z.object({
  startingWalletSen: z.number().int().nonnegative(),
  /** Quick rolls from the phone (no walking to the machine) cost this much extra (share of the price). */
  phoneRollFee: z.number().min(0).default(0.1),
  /** Pawn shop pays this fraction of an item's value. */
  pawnRate: z.number().min(0).max(1),
  shardShopPrices: z.record(z.string(), z.number().int().positive()),
  /** Completing a crate's Item Index page pays crate price × this. */
  indexPageRewardMultiplier: z.number().nonnegative(),
  interactRadiusTiles: z.number().positive(),
  /** Spec §8.7: passive income keeps going while you're logged out, capped and at a discount. */
  offline: z.object({ capHours: z.number().positive(), efficiency: z.number().min(0).max(1) }).default({ capHours: 8, efficiency: 0.5 }),
  /** Most pieces of furniture you can buy in one go. */
  furnitureMaxQty: z.number().int().positive().default(10),
  rollRateLimit: rateLimit,
  /** Delay before other players see a rare-pull announcement (so it lands after the reel). */
  announceDelayMs: z.number().int().nonnegative(),
  /** A potion can be stacked (drunk again while active) up to this many minutes in total. */
  potionMaxStackMin: z.number().positive(),
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
  /** Flyer Run: drop flyers at houses near you, in any order. */
  flyers: z.object({
    name: z.string(),
    stops: z.number().int().min(2).max(12),
    /** Houses within this many metres of where you start. */
    radiusMeters: z.number().positive(),
    baseSen: z.number().int().nonnegative(),
    perStopSen: z.number().int().positive(),
    stopRadiusTiles: z.number().positive(),
    /** Done within this time: + speedBonus. */
    timeBudgetSec: z.number().positive(),
    speedBonus: z.number().nonnegative(),
  }),
  /** Mamak Helper: make drinks at the mamak with the cooking mini-game; paid per drink by quality. */
  mamak: z.object({
    name: z.string(),
    recipe: z.string(),
    drinks: z.number().int().min(1).max(10),
    perDrinkSen: z.number().int().positive(),
    /** Wider timing windows than at your own stall (it's a starter job). */
    windowMult: z.number().positive(),
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
      /** Showroom vehicles (🚗 Motor Kota): a car (you sit inside) or a big bike. */
      kind: z.enum(['car', 'bike']).optional(),
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
  /** Rides follow the roads (keeping left, one-ways respected) unless that's longer than this
   *  many times the direct route (+30 tiles); then they take the direct route. */
  roadDetourMax: z.number().min(1).default(1.6),
});
export type RidesConfig = z.infer<typeof ridesConfigSchema>;

/** Fare for a trip of `meters`: base + per-km, at least the minimum, rounded. */
export function rideFareSen(cfg: RidesConfig, meters: number): number {
  const raw = cfg.baseFareSen + (cfg.perKmSen * meters) / 1000;
  return Math.max(cfg.minFareSen, Math.round(raw / cfg.fareRoundSen) * cfg.fareRoundSen);
}

/** Items that count towards the Item Index (potions are consumables, not collectibles). */
export function isCollectible(def: ItemDef): boolean {
  // Potions and store-bought furniture (fixed price, not from a crate) aren't collectibles.
  return def.type !== 'potion' && !(def.type === 'furniture' && def.valueSen);
}

/** Cross-file checks: every pool item exists, every collectible is in exactly one crate (potions may
 *  be in none, then they need a fixed value), rarities exist. */
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
      if (c.event) continue; // event crates reuse items from their home crates
      if (seen.has(id)) errors.push(`item ${id} is in crates ${seen.get(id)} and ${c.id}`);
      seen.set(id, c.id);
    }
  }
  for (const i of items.items) {
    if (i.type === 'potion' && !i.effect) errors.push(`potion ${i.id} has no effect`);
    if (i.effect && (i.effect.buff === 'perfectCook' ? !i.effect.charges : !i.effect.durationSec)) errors.push(`item ${i.id}: effect needs ${i.effect.buff === 'perfectCook' ? 'charges' : 'durationSec'}`);
    if (seen.has(i.id)) continue;
    if (isCollectible(i)) errors.push(`item ${i.id} is not in any crate`);
    else if (!i.valueSen) errors.push(`item ${i.id} is in no crate and has no valueSen`);
  }
  if (!tierIds.has(r.luckAffectsFrom)) errors.push(`luckAffectsFrom: unknown tier ${r.luckAffectsFrom}`);
  return errors;
}
