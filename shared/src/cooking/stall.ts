// Food stalls (spec §8.2): one food business per player that moves up the path
// Pasar Malam stall → Food Truck → Kopitiam. Pure maths for prices, customers, staff, stock and
// upgrades, shared by the server (which runs the stall) and the client / simulator.
import { z } from 'zod';
import { inHours } from '../time/clock';
import type { AddonDef, RecipeDef } from './cooking';

const money = z.number().int().nonnegative();
export const STALL_UPGRADES = ['level', 'equipment', 'signage', 'queue', 'supplier', 'training'] as const;
export type StallUpgrade = (typeof STALL_UPGRADES)[number];

export const stallsConfigSchema = z.object({
  tiers: z
    .array(
      z.object({
        tier: z.number().int().positive(),
        id: z.string(),
        name: z.string(),
        icon: z.string(),
        desc: z.string(),
        priceSen: money,
        requires: z.object({ stage: z.number().int().positive().optional(), level: z.number().int().positive().optional() }).default({}),
        /** Opening hours, in-game [from, to) (may wrap past midnight). */
        hours: z.tuple([z.number(), z.number()]),
        /** Dish prices × this. */
        priceMult: z.number().positive(),
        /** Customers per real minute at reputation 50, before bonuses. */
        customersPerMin: z.number().positive(),
        patienceSec: z.tuple([z.number(), z.number()]),
        queueBase: z.number().int().positive(),
        staffMax: z.number().int().nonnegative(),
        hireSen: money,
        /** Per cook per in-game day (charged hourly while they work). */
        wagePerDaySen: money,
        /** Stall upgrade prices × this at this tier. */
        upgradeCostMult: z.number().positive(),
      }),
    )
    .min(1),
  upgrades: z.record(
    z.enum(STALL_UPGRADES),
    z.object({
      name: z.string(), icon: z.string(), desc: z.string(), maxLevel: z.number().int().positive(), baseCostSen: money, costGrowth: z.number().min(1), perLevel: z.number(),
      /** A second effect per level (Staff level: + share of the price your cooks' sales earn). */
      bonusPerLevel: z.number().optional(),
    }),
  ),
  staff: z.object({ cookSec: z.number().positive(), passiveRate: z.number().positive() }),
  /** You can open any time; outside a tier's usual hours customers come at this rate. */
  offHoursCustomers: z.number().min(0).max(1).default(0.45),
  /** Closing up: seconds to serve who's waiting before the shutters come down (orders being made always finish). */
  closingGraceSec: z.number().nonnegative().default(20),
  reputation: z.object({
    start: z.number(), max: z.number(),
    perQuality: z.object({ perfect: z.number(), great: z.number(), good: z.number(), ok: z.number(), burnt: z.number() }),
    lostCustomer: z.number(),
    /** Customer-rate multiplier at reputation 0 and at max. */
    multAtZero: z.number(), multAtMax: z.number(),
    /** Each dish your cooks serve adds this much reputation, up to `staffRepCap` (higher needs
     *  your own cooking). */
    perStaffDish: z.number().nonnegative().default(0),
    staffRepCap: z.number().nonnegative().default(0),
    /** After moving up to a bigger stall: seconds when lost customers cost no reputation. */
    moveGraceSec: z.number().nonnegative().default(0),
  }),
  combo: z.object({ perPerfect: z.number(), max: z.number() }),
  tips: z.object({ max: z.number(), minQuality: z.enum(['perfect', 'great', 'good']) }),
  /** Meal-time rushes: more customers and higher prices. `floorMult`: every open stall gets at
   *  least this × its tier's base rate (so the rush is busy for everyone, not just the best
   *  stalls); `extraQueue`: more room in the queue. */
  rush: z.object({ customers: z.number(), price: z.number(), floorMult: z.number().nonnegative().default(0), extraQueue: z.number().int().nonnegative().default(0) }),
  /** No stall gets fewer than this × its tier's base rate (before quiet hours), however low its
   *  reputation: keeps new players' stalls from being starved. */
  minCustomersMult: z.number().nonnegative().default(0),
  blogger: z.object({
    chance: z.number(), minReputation: z.number(), payMult: z.number(), repBonus: z.number(), repPenalty: z.number(),
    /** More customers for this many in-game hours after a happy blogger. */
    boostCustomers: z.number(), boostGameHours: z.number(),
  }),
  stock: z.object({
    packs: z.array(z.object({ qty: z.number().int().positive(), discount: z.number().min(0).max(0.9) })).min(1),
    /** Ingredients go off after this many in-game hours of play time. */
    shelfLifeGameHours: z.number().positive(),
    /** Ordering from the phone instead of the hypermarket costs this much extra. */
    deliveryFee: z.number().min(0),
    maxPerRecipe: z.number().int().positive(),
    /** Warn the owner when an item is down to this many. */
    lowWarn: z.number().int().nonnegative().default(5),
  }),
  /** Dishes cooked (active) per recipe to reach each mastery level. */
  mastery: z.object({ thresholds: z.array(z.number().int().positive()).min(1), pricePerLevel: z.number() }),
  /** A dish not served this long after its steps' time budget is thrown away. */
  dishTimeoutSlackSec: z.number().positive(),
  cookRadiusTiles: z.number().positive(),
  /** Stall value counted in net worth: this share of what you paid (tier + upgrades). */
  assetValueRate: z.number().min(0).max(1),
});
export type StallsConfig = z.infer<typeof stallsConfigSchema>;
export type StallTierDef = StallsConfig['tiers'][number];

/** A batch of ingredients for one recipe. */
export interface StockBatch {
  qty: number;
  /** In-game minutes it has aged (only while the owner is online). */
  age: number;
}

/** What the owner sees and the server saves. */
export interface StallState {
  tier: number;
  plot: string;
  open: boolean;
  rep: number;
  upgrades: Partial<Record<StallUpgrade, number>>;
  staff: number;
  stock: Record<string, StockBatch[]>;
  /** Dishes cooked by hand per recipe (mastery). */
  mastery: Record<string, number>;
  combo: number;
  perfectTokens: number;
  /** Total paid for the stall + upgrades (net worth counts a share of it). */
  investedSen: number;
  /** Server ms until the food blogger's buzz wears off. */
  buzzUntil: number;
}

export function tierDef(cfg: StallsConfig, tier: number): StallTierDef {
  return cfg.tiers.find((t) => t.tier === tier) ?? cfg.tiers[0];
}

export function stallOpenNow(cfg: StallsConfig, tier: number, hourF: number): boolean {
  const t = tierDef(cfg, tier);
  return inHours(hourF, t.hours[0], t.hours[1]);
}

export function upgradeLevel(s: Pick<StallState, 'upgrades'>, key: StallUpgrade): number {
  return s.upgrades[key] ?? 0;
}

export function upgradeCostSen(cfg: StallsConfig, tier: number, key: StallUpgrade, level: number): number {
  const u = cfg.upgrades[key]!;
  return Math.round(u.baseCostSen * Math.pow(u.costGrowth, level) * tierDef(cfg, tier).upgradeCostMult);
}

export function masteryLevel(cfg: StallsConfig, dishes: number): number {
  let l = 0;
  for (const t of cfg.mastery.thresholds) if (dishes >= t) l++;
  return l;
}

/** Recipes on this stall's menu (unlocked by mastery of another recipe). */
export function menuRecipes(cfg: StallsConfig, recipes: RecipeDef[], s: Pick<StallState, 'mastery'>): RecipeDef[] {
  return recipes.filter((r) => !r.unlock || masteryLevel(cfg, s.mastery[r.unlock.recipe] ?? 0) >= r.unlock.mastery);
}

export function stockCount(s: Pick<StallState, 'stock'>, recipe: string): number {
  return (s.stock[recipe] ?? []).reduce((a, b) => a + b.qty, 0);
}

/** Something you can stock: a dish's ingredients, or one of its add-ons (own stock). */
export interface StockItem {
  id: string;
  name: string;
  icon: string;
  ingredientCostSen: number;
  /** For an add-on: the dish it goes with. */
  parent?: string;
}

/** Everything this stall can stock: each dish on the menu, then its add-ons. */
export function stockItems(cfg: StallsConfig, recipes: RecipeDef[], s: Pick<StallState, 'mastery'>): StockItem[] {
  const out: StockItem[] = [];
  for (const r of menuRecipes(cfg, recipes, s)) {
    out.push({ id: r.id, name: r.name, icon: r.icon, ingredientCostSen: r.ingredientCostSen });
    for (const a of r.addons) out.push({ id: a.id, name: a.name, icon: a.icon, ingredientCostSen: a.ingredientCostSen, parent: r.id });
  }
  return out;
}

/** An add-on's price before quality, combo and tips (tier, skills and rush apply; mastery doesn't). */
export function addonBaseSen(cfg: StallsConfig, addon: AddonDef, s: Pick<StallState, 'tier'> & Partial<Pick<StallState, 'upgrades'>>, rush: boolean, b: StallBonuses = NO_BONUS): number {
  return Math.round(addon.basePriceSen * tierDef(cfg, s.tier).priceMult * stallLevelMult(cfg, s) * (1 + b.dishPrice) * (rush ? cfg.rush.price : 1));
}

/** A whole order's base price: the dish plus its add-ons. */
export function orderBaseSen(cfg: StallsConfig, recipe: RecipeDef, s: Pick<StallState, 'tier' | 'mastery'> & Partial<Pick<StallState, 'upgrades'>>, rush: boolean, addons: readonly string[] = [], b: StallBonuses = NO_BONUS): number {
  let sen = dishBaseSen(cfg, recipe, s, rush, b);
  for (const id of addons) {
    const a = recipe.addons.find((x) => x.id === id);
    if (a) sen += addonBaseSen(cfg, a, s, rush, b);
  }
  return sen;
}

/** Price for a pack of ingredients (bulk discount, supplier upgrade, optional delivery fee). */
export function stockPriceSen(cfg: StallsConfig, recipe: Pick<RecipeDef, 'ingredientCostSen'>, s: Pick<StallState, 'upgrades'>, packQty: number, delivery: boolean): number {
  const pack = cfg.stock.packs.find((p) => p.qty === packQty);
  if (!pack) return NaN;
  const supplier = 1 - upgradeLevel(s, 'supplier') * cfg.upgrades.supplier!.perLevel;
  return Math.round(recipe.ingredientCostSen * packQty * (1 - pack.discount) * Math.max(0.3, supplier) * (delivery ? 1 + cfg.stock.deliveryFee : 1));
}

export interface StallBonuses {
  /** Business skills: + dish price, + customers, − wages (fractions). */
  dishPrice: number;
  customers: number;
  wages: number;
  /** Potions: Customer Rush, Speed Tonic. */
  customerBuff: number;
  staffSpeedBuff: number;
}
export const NO_BONUS: StallBonuses = { dishPrice: 0, customers: 0, wages: 0, customerBuff: 1, staffSpeedBuff: 1 };

/** A dish's base price before quality, combo and tips. */
/** Stall level: every level raises all prices. */
export function stallLevelMult(cfg: StallsConfig, s: Partial<Pick<StallState, 'upgrades'>>): number {
  return 1 + (s.upgrades?.level ?? 0) * (cfg.upgrades.level?.perLevel ?? 0);
}

/** Your cooks' sales: the passive share, raised by Staff level. */
export function staffPayRate(cfg: StallsConfig, s: Pick<StallState, 'upgrades'>): number {
  return cfg.staff.passiveRate * (1 + upgradeLevel(s, 'training') * (cfg.upgrades.training?.bonusPerLevel ?? 0));
}

/** A dish's base price before quality, combo and tips. */
export function dishBaseSen(cfg: StallsConfig, recipe: RecipeDef, s: Pick<StallState, 'tier' | 'mastery'> & Partial<Pick<StallState, 'upgrades'>>, rush: boolean, b: StallBonuses = NO_BONUS): number {
  const mastery = 1 + masteryLevel(cfg, s.mastery[recipe.id] ?? 0) * cfg.mastery.pricePerLevel;
  return Math.round(recipe.basePriceSen * tierDef(cfg, s.tier).priceMult * mastery * stallLevelMult(cfg, s) * (1 + b.dishPrice) * (rush ? cfg.rush.price : 1));
}

/** Customers per real minute right now (`offHours`: outside the tier's usual hours). */
export function customerRate(cfg: StallsConfig, s: Pick<StallState, 'tier' | 'rep' | 'upgrades' | 'buzzUntil'>, rush: boolean, nowMs: number, b: StallBonuses = NO_BONUS, offHours = false): number {
  const r = cfg.reputation;
  const repMult = r.multAtZero + (r.multAtMax - r.multAtZero) * Math.max(0, Math.min(1, s.rep / r.max));
  const signage = 1 + upgradeLevel(s, 'signage') * cfg.upgrades.signage!.perLevel;
  const buzz = s.buzzUntil > nowMs ? cfg.blogger.boostCustomers : 1;
  const mult = repMult * signage * (1 + b.customers) * buzz * b.customerBuff * (rush ? cfg.rush.customers : 1);
  const floor = rush ? Math.max(cfg.rush.floorMult, cfg.minCustomersMult) : cfg.minCustomersMult;
  return tierDef(cfg, s.tier).customersPerMin * Math.max(mult, floor) * (offHours ? cfg.offHoursCustomers : 1);
}

export function queueCapacity(cfg: StallsConfig, s: Pick<StallState, 'tier' | 'upgrades'>, rush = false): number {
  return tierDef(cfg, s.tier).queueBase + upgradeLevel(s, 'queue') * cfg.upgrades.queue!.perLevel + (rush ? cfg.rush.extraQueue : 0);
}

/** Equipment widens the cooking windows. */
export function windowMult(cfg: StallsConfig, s: Pick<StallState, 'upgrades'>): number {
  return 1 + upgradeLevel(s, 'equipment') * cfg.upgrades.equipment!.perLevel;
}

/** Ms a cook takes per dish (training + equipment + Speed Tonic). */
export function staffCookMs(cfg: StallsConfig, s: Pick<StallState, 'upgrades'>, b: StallBonuses = NO_BONUS): number {
  const speed = (1 + upgradeLevel(s, 'training') * cfg.upgrades.training!.perLevel) * (1 + (upgradeLevel(s, 'equipment') * cfg.upgrades.equipment!.perLevel) / 2) * b.staffSpeedBuff;
  return (cfg.staff.cookSec * 1000) / speed;
}

/** One cook's wage for one in-game hour. */
export function wagePerHourSen(cfg: StallsConfig, tier: number, b: StallBonuses = NO_BONUS): number {
  return Math.round((tierDef(cfg, tier).wagePerDaySen / 24) * Math.max(0.2, 1 - b.wages));
}

/** What a cooked dish pays. */
export function dishPay(
  cfg: StallsConfig,
  base: number,
  qualityMult: number,
  quality: string,
  combo: number,
  patienceLeft: number,
  blogger: boolean,
): { paySen: number; tipSen: number } {
  const pay = Math.round(base * qualityMult * (1 + combo) * (blogger ? cfg.blogger.payMult : 1));
  const order = ['burnt', 'ok', 'good', 'great', 'perfect'];
  const tip = order.indexOf(quality) >= order.indexOf(cfg.tips.minQuality) ? Math.round(pay * cfg.tips.max * Math.max(0, Math.min(1, patienceLeft))) : 0;
  return { paySen: pay, tipSen: tip };
}

export function stallAssetSen(cfg: StallsConfig, s: Pick<StallState, 'investedSen'> | null | undefined): number {
  return s ? Math.floor(s.investedSen * cfg.assetValueRate) : 0;
}

/** Takes `n` portions from the oldest batches first. Returns false if there isn't enough. */
export function takeStock(s: Pick<StallState, 'stock'>, recipe: string, n = 1): boolean {
  const batches = s.stock[recipe] ?? [];
  if (batches.reduce((a, b) => a + b.qty, 0) < n) return false;
  let need = n;
  for (const b of batches) {
    const take = Math.min(b.qty, need);
    b.qty -= take;
    need -= take;
    if (!need) break;
  }
  s.stock[recipe] = batches.filter((b) => b.qty > 0);
  return true;
}

/** Ages stock by `gameMinutes` and throws away what's gone off. Returns portions spoiled. */
export function ageStock(cfg: StallsConfig, s: Pick<StallState, 'stock'>, gameMinutes: number): number {
  let spoiled = 0;
  const life = cfg.stock.shelfLifeGameHours * 60;
  for (const [id, batches] of Object.entries(s.stock)) {
    for (const b of batches) b.age += gameMinutes;
    spoiled += batches.filter((b) => b.age >= life).reduce((a, b) => a + b.qty, 0);
    s.stock[id] = batches.filter((b) => b.age < life && b.qty > 0);
  }
  return spoiled;
}
