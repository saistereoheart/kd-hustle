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
  /** Which rooms things belong in (the Rooms factor): keyed by piece id, else by category. Things
   *  not listed (lamps, plants, aircond...) are fine anywhere. */
  roomFor: z.record(z.string(), z.array(z.enum(['living', 'bedroom', 'kitchen', 'bath', 'office']))).default({}),
  /** What makes each kind of room complete: a list of needs, each met by any one of its tokens
   *  (a piece id, a category, an essential or an amenity). */
  roomSets: z.record(z.string(), z.array(z.object({ name: z.string(), any: z.array(z.string()).min(1) }))).default({}),
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

/** 🏪 What shop customers write (tables and toilets, not beds and sheets). */
const SHOP_REVIEWS: Record<string, string[]> = {
        great: ['Best kedai in KD! The {theme} look is 🔥', 'Sedap and so comfy. Will come again!', 'Cantik gila, I spent 2 hours here.'],
        good: ['Nice place, good service.', 'Comfy seats, clean tables.', 'Not bad lah, will come back.'],
        meh: ["It's okay. Quite empty inside.", 'Need more tables and chairs.', 'Bit plain. Add some decor?'],
        bad: ['Floor sticky... 😬', 'Messy and nowhere to sit.', 'Dirty tables, not coming back.'],
        noAircond: ['No aircond?! Panas gila. 1★'],
        noWifi: ['No wifi. Cannot even scroll. 1★'],
        noToilet: ['No toilet for customers?! 1★'],
      };

export const propertiesConfigSchema = z.object({
  types: z.record(
    z.string(),
    z.object({
      name: z.string(),
      icon: z.string(),
      /** Floor plan in cells (1 cell = 1 m). */
      w: z.number().int().min(5).max(32),
      h: z.number().int().min(5).max(24),
      priceSen: z.number().int().positive(),
      requires: z.object({ stage: z.number().int().positive().optional(), level: z.number().int().positive().optional() }).default({}),
      rentPerDaySen: z.number().int().positive(),
      nightBaseSen: z.number().int().positive(),
      /** Bedrooms in the floor plan (0 = a small home: one main room, a bathroom, a kitchenette). */
      bedrooms: z.number().int().min(0).max(6).default(0),
      /** 🏪 A business's shop floor (a Venture's or a kopitiam's shoplot): one open room, never sold. */
      shop: z.boolean().default(false),
      /** What this kind of place must have (instead of the home essentials). */
      essentials: z.array(z.string()).optional(),
      /** The extras that count for this kind of place (instead of the home amenities: no bathtub in a kopitiam). */
      amenities: z.array(z.string()).optional(),
      /** This kind of place's own rating numbers (a shop fills up and feels "done" with less). */
      rating: z.object({ comfortPerM2: z.number().positive().optional(), idealFill: z.tuple([z.number(), z.number()]).optional(), amenitiesForMax: z.number().positive().optional() }).optional(),
    }),
  ),
  /** Building kind → its homes. `perM2`: one unit per this much floor (capped at `units`), so a
   *  bigger building holds more players. */
  byKind: z.record(z.string(), z.object({ type: z.string().optional(), types: z.array(z.string()).optional(), units: z.number().int().positive(), perM2: z.number().positive().optional() })),
  /** Claiming homes: your first one is free if it costs up to `firstFreeMaxSen`; at most `maxHomes` each. */
  /** 🏪 Shops (Ventures and kopitiams): stars → business, wear and tear, reviews. */
  shop: z
    .object({
      /** Customers / income × (multBase + multPerStar × stars). */
      multBase: z.number(),
      multPerStar: z.number(),
      /** Cleanliness lost per customer. */
      dirtPerCustomer: z.number().nonnegative(),
      /** A review every this many customers. */
      reviewEvery: z.number().int().positive(),
      /** A cleaner keeps it spotless, for this much a game day. */
      cleanerPerDaySen: z.number().int().nonnegative(),
      /** Customers' reviews: great / good / meh / bad, and for a missing aircond / wifi / toilet. */
      reviews: z.record(z.string(), z.array(z.string()).min(1)).default(SHOP_REVIEWS),
    })
    .default({ multBase: 0.8, multPerStar: 0.08, dirtPerCustomer: 0.5, reviewEvery: 12, cleanerPerDaySen: 4000, reviews: SHOP_REVIEWS }),
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
    /** Asking a tenant to leave: you pay them this many days of rent to go (and lose anything
     *  they still owe). */
    evictFeeDays: z.number().nonnegative().default(1),
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
    weights: z.object({ comfort: z.number(), style: z.number(), rarity: z.number(), amenities: z.number(), clean: z.number(), space: z.number(), rooms: z.number().default(0) }),
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

export type PropertyMode = 'none' | 'rent' | 'airbnb' | 'home' | 'shop';
