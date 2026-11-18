// Config schemas for property (Phase 5): furniture stats (furniture.json) and property types,
// rent/Airbnb rules and the star-rating weights (properties.json).
import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const furnitureConfigSchema = z.object({
  storeName: z.string(),
  themes: z.record(z.string(), z.object({ name: z.string(), color: hex })),
  /** Each missing one caps the star rating. */
  essentials: z.array(z.string()).min(1),
  amenities: z.array(z.string()),
  /** Keyed by item id (the item itself lives in items.json, type "furniture"). */
  pieces: z.record(
    z.string(),
    z.object({
      category: z.string(),
      /** Footprint in cells (1 cell = 1 m). Rotating swaps w and h. */
      w: z.number().int().min(1).max(4),
      h: z.number().int().min(1).max(4),
      comfort: z.number().nonnegative(),
      style: z.number().nonnegative(),
      theme: z.string().nullable(),
      essential: z.string().optional(),
      amenity: z.string().optional(),
      /** Hangs on a wall (must touch one). */
      wall: z.boolean().optional(),
      /** Lies on the floor (rugs): other pieces may stand on it. */
      floor: z.boolean().optional(),
      /** Sold at the furniture store for this price (else gacha only). */
      storeSen: z.number().int().positive().optional(),
    }),
  ),
});
export type FurnitureConfig = z.infer<typeof furnitureConfigSchema>;
export type FurniturePiece = FurnitureConfig['pieces'][string];

export const propertiesConfigSchema = z.object({
  types: z.record(
    z.string(),
    z.object({
      name: z.string(),
      icon: z.string(),
      /** Floor plan in cells (1 cell = 1 m). */
      w: z.number().int().min(5).max(20),
      h: z.number().int().min(5).max(16),
      priceSen: z.number().int().positive(),
      requires: z.object({ stage: z.number().int().positive().optional(), level: z.number().int().positive().optional() }).default({}),
      rentPerDaySen: z.number().int().positive(),
      nightBaseSen: z.number().int().positive(),
    }),
  ),
  /** Building kind → its homes. `perM2`: one unit per this much floor (capped at `units`), so a
   *  bigger building holds more players. */
  byKind: z.record(z.string(), z.object({ type: z.string().optional(), types: z.array(z.string()).optional(), units: z.number().int().positive(), perM2: z.number().positive().optional() })),
  /** Claiming homes: your first one is free if it costs up to `firstFreeMaxSen`; at most `maxHomes` each. */
  claim: z.object({ firstFreeMaxSen: z.number().int().nonnegative(), maxHomes: z.number().int().positive() }).default({ firstFreeMaxSen: 10_000_000, maxHomes: 3 }),
  hotspots: z.array(z.object({ name: z.string(), building: z.string().optional(), point: z.tuple([z.number(), z.number()]).optional() })),
  locationBonus: z.number().nonnegative(),
  locationRangeTiles: z.number().positive(),
  priceJitter: z.number().min(0).max(0.5),
  sellBackRate: z.number().min(0).max(1),
  assetValueRate: z.number().min(0).max(1),
  costs: z.object({
    taxPerDayRate: z.number().nonnegative(),
    maintenancePerDayRate: z.number().nonnegative(),
    contractorRate: z.number().nonnegative(),
    managerCut: z.number().min(0).max(1),
    cleanerPerStaySen: z.number().min(0).max(1),
  }),
  rent: z.object({
    applyChancePerHour: z.number().min(0).max(1),
    latePayChanceAtDouble: z.number().min(0).max(1),
    moveOutBelowHappiness: z.number(),
    moveOutChancePerDay: z.number().min(0).max(1),
    maintenanceChancePerDay: z.number().min(0).max(1),
    conditionLossPerOpenRequest: z.number().nonnegative(),
    tenants: z.array(z.object({ id: z.string(), name: z.string(), icon: z.string(), rentTolerance: z.number().positive() })).min(1),
    requests: z.array(z.string()).min(1),
    diyMs: z.number().int().positive(),
  }),
  airbnb: z.object({
    minStars: z.number(),
    bookingBase: z.number(),
    bookingPerStar: z.number(),
    weekendBoost: z.number(),
    eventChancePerDay: z.number(),
    eventBoost: z.number(),
    cleanLossPerStay: z.tuple([z.number(), z.number()]),
    tipChance: z.number(),
    damageChance: z.number(),
    vipChance: z.number(),
    vipMult: z.number(),
    superhostAfter: z.number().int().positive(),
    superhostBonus: z.number(),
    cleanMs: z.number().int().positive(),
    reviews: z.record(z.string(), z.array(z.string()).min(1)),
  }),
  rating: z.object({
    comfortPerM2: z.number().positive(),
    /** [pieces of one theme, style score] steps, e.g. 3 → 0.4, 5 → 0.7, 8 → 1. */
    themeSets: z.array(z.tuple([z.number().int().positive(), z.number()])),
    missingCap: z.number(),
    missingCapStep: z.number(),
    /** Stars lost per missing essential (on top of the cap), so adding one always shows a gain. */
    missingPenalty: z.number().nonnegative(),
    idealFill: z.tuple([z.number(), z.number()]),
    weights: z.object({ comfort: z.number(), style: z.number(), rarity: z.number(), amenities: z.number(), clean: z.number(), space: z.number() }),
    amenitiesForMax: z.number().positive(),
    rarityForMax: z.number().positive(),
  }),
});
export type PropertiesConfig = z.infer<typeof propertiesConfigSchema>;
export type UnitTypeDef = PropertiesConfig['types'][string];

/** A furniture item placed in a unit: which inventory instance, where, which way round. */
export interface Placed {
  iid: number;
  item: string;
  x: number;
  y: number;
  /** 0-3 quarter turns; odd turns swap the footprint. */
  rot: number;
}

export type PropertyMode = 'none' | 'rent' | 'airbnb' | 'home';
