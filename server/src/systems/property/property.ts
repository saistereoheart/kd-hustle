// Property (Phase 5, spec §8.3, §8.7, §9): buying homes, long-term rent (tenants, happiness,
// maintenance), Airbnb (decorating, the star rating, nightly bookings, reviews, cleaning) and
// offline income with the welcome-back screen. Everything is decided here; clients send intents.
//
// Time: rent and bookings run per IN-GAME day (24 real minutes); tenants apply per in-game hour.
// Owners who are online are processed live; an owner who was away is caught up on login (up to
// the offline cap, at the offline efficiency) and gets a "while you were away" summary.
import {
  shopFrontTop,
  bookingChance, buildListings, planForType, starterShopSets, STARTER_CHAIR, STARTER_TABLE, fairNightSen, fairRentSen, formatMoney, gameTime, layoutProblem, rateUnit, suggestions, tenantHappiness,
  type Placed, type PropertyMode, type PropPublic, type RandInt, type Rating, type RatingCfg, type Unit, type ShopView } from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { Repos } from '../../db/repos';
import type { OnlinePlayer, World } from '../../game/world';
import { GameError, type Economy } from '../economy/economy';

/** A business's shop floor: `<building>#shop`. */
export const SHOP_SUFFIX = '#shop';

export interface PropState {
  unit: string;
  owner: number;
  ownerName: string;
  type: string;
  boughtSen: number;
  mode: PropertyMode;
  // long-term rent
  rentSen: number;
  tenant: { kind: string; since: number; owed: number } | null;
  condition: number;
  requests: Array<{ id: number; text: string; day: number }>;
  // Airbnb
  nightSen: number;
  cleanliness: number;
  layout: Placed[];
  guest: { until: number; paySen: number; vip: boolean } | null;
  reviews: Array<{ stars: number; text: string; day: number }>;
  fiveStars: number;
  superhost: boolean;
  // staff
  manager: boolean;
  cleaner: boolean;
  // bookkeeping
  earnedSen: number;
  lastDay: number;
  lastHour: number;
  /** A DIY repair or cleaning in progress (started at, server ms). */
  work: { kind: 'diy' | 'clean'; req?: number; at: number } | null;
  nextReq: number;
}

export interface PropEvent {
  unit: string;
  text: string;
  kind: 'good' | 'bad' | 'info';
}

export interface PropertyHooks {
  /** The public ownership map changed. */
  publicChanged: () => void;
  /** An owner's own properties changed (send them the details). */
  selfChanged: (p: OnlinePlayer) => void;
  wallet: (p: OnlinePlayer, delta: number, reason: string) => void;
  event: (p: OnlinePlayer, ev: PropEvent) => void;
  /** The owner's Property skills (multipliers); none if left out. */
  mods?: (p: OnlinePlayer) => PropMods;
  /** Pledged as loan collateral (can't be sold). */
  isPledged?: (p: OnlinePlayer, unit: string) => boolean;
}

export interface PropMods {
  rent: number;
  airbnb: number;
  cleanLoss: number;
  appeal: number;
}
const NO_MODS: PropMods = { rent: 1, airbnb: 1, cleanLoss: 1, appeal: 1 };


/** "While you were away" totals. */
export interface AwaySummary {
  awayMs: number;
  earnedSen: number;
  lines: Array<{ label: string; sen: number; detail?: string }>;
}

export class PropertySystem {
  readonly units: Unit[];
  private byUnit = new Map<string, Unit>();
  private props = new Map<string, PropState>();
  private rating: RatingCfg;
  /** Pending welcome-back bonus per player (doubled by the Lucky Spin). */
  private welcome = new Map<number, { sen: number; at: number; spun: boolean }>();

  constructor(
    private cfg: ServerConfig,
    private repos: Repos,
    private econ: Economy,
    private world: World,
    private rand: RandInt,
    private hooks: PropertyHooks,
    private clock: () => number = Date.now,
  ) {
    this.units = buildListings(cfg.map, cfg.properties);
    for (const u of this.units) this.byUnit.set(u.id, u);
    const tiers = cfg.rarities.tiers.map((t) => t.id);
    this.rating = { furniture: cfg.furniture, properties: cfg.properties, rarityIndex: (id) => Math.max(0, tiers.indexOf(cfg.itemById.get(id)?.rarity ?? 'common')) };
    for (const r of repos.properties.all()) {
      if (r.unit.endsWith(SHOP_SUFFIX)) this.shopListing(r.unit, r.type); // a shop floor (not a home for sale)
      if (!this.byUnit.has(r.unit)) continue; // the map changed and the building is gone
      this.props.set(r.unit, this.hydrate(r.unit, r.owner, r.ownerName, r.type, r.data));
    }
  }

  private hydrate(unit: string, owner: number, ownerName: string, type: string, d: Record<string, unknown>): PropState {
    const day = this.today();
    const s = d as Partial<PropState>;
    return {
      unit, owner, ownerName, type,
      boughtSen: s.boughtSen ?? 0, mode: s.mode ?? 'none',
      rentSen: s.rentSen ?? this.cfg.properties.types[type]?.rentPerDaySen ?? 0, tenant: s.tenant ?? null,
      condition: s.condition ?? 100, requests: s.requests ?? [],
      nightSen: s.nightSen ?? this.cfg.properties.types[type]?.nightBaseSen ?? 0, cleanliness: s.cleanliness ?? 100,
      layout: s.layout ?? [], guest: s.guest ?? null, reviews: s.reviews ?? [], fiveStars: s.fiveStars ?? 0, superhost: s.superhost ?? false,
      manager: s.manager ?? false, cleaner: s.cleaner ?? false,
      earnedSen: s.earnedSen ?? 0, lastDay: s.lastDay ?? day, lastHour: s.lastHour ?? Math.floor(gameTime(this.cfg.time, this.clock()).total / 60),
      work: null, nextReq: s.nextReq ?? 1,
    };
  }

  private save(s: PropState) {
    const { unit, owner, type, ownerName: _n, work: _w, ...data } = s;
    this.repos.properties.save(unit, owner, type, data);
  }

  private today() {
    return gameTime(this.cfg.time, this.clock()).day;
  }

  // ---------------------------------------------------------------- views
  unitOf(id: string) {
    return this.byUnit.get(id);
  }

  // ---------------------------------------------------------------- 🏪 shop floors
  // A Venture's or a kopitiam's shoplot is also a "unit" of its owner (type shop_floor /
  // kopitiam_floor): furnished in the home decorator, rated like an Airbnb (with a shop's own
  // must-haves), cleaned. Its stars bring customers / income; customers make it dirty.

  /** The listing a shop floor needs (it isn't one of the homes for sale). */
  private shopListing(unitId: string, type: string) {
    if (this.byUnit.has(unitId)) return;
    const bld = this.cfg.map.buildings.find((b) => b.id === unitId.slice(0, -SHOP_SUFFIX.length));
    if (!bld?.door) return;
    const u = { id: unitId, building: bld.id, n: 0, type, priceSen: 0, loc: 1, x: bld.door.frontX + 0.5, y: bld.door.frontY + 0.5 };
    this.units.push(u);
    this.byUnit.set(unitId, u);
  }

  /** A shop floor whose door is in its top wall (its building's main door faces up). */
  private frontTop(unitId: string): boolean {
    if (!unitId.endsWith(SHOP_SUFFIX)) return false;
    let v = this.frontTops.get(unitId);
    if (v === undefined) {
      const id = unitId.slice(0, -SHOP_SUFFIX.length);
      const b = this.cfg.map.buildings.find((x) => x.id === id);
      v = !!b && shopFrontTop(b);
      this.frontTops.set(unitId, v);
    }
    return v;
  }
  private frontTops = new Map<string, boolean>();

  isShop(unitId: string): boolean {
    const s = this.props.get(unitId);
    return !!s && !!this.cfg.properties.types[s.type]?.shop;
  }

  /**
   * Makes sure exactly these shop floors exist: `want` = building → (owner, kind). Others are
   * closed (their furniture goes back to the bag); one that changed kind or owner starts over.
   * Returns true if anything changed.
   */
  syncShops(want: Map<string, { owner: number; ownerName: string; kind: 'venture' | 'kopitiam' }>): boolean {
    let changed = false;
    for (const s of [...this.props.values()]) {
      if (!s.unit.endsWith(SHOP_SUFFIX)) continue;
      const w = want.get(s.unit.slice(0, -SHOP_SUFFIX.length));
      const type = w?.kind === 'kopitiam' ? 'kopitiam_floor' : 'shop_floor';
      if (w && w.owner === s.owner && s.type === type) continue;
      this.props.delete(s.unit);
      this.repos.properties.delete(s.unit);
      changed = true;
    }
    for (const [building, w] of want) {
      const unit = building + SHOP_SUFFIX;
      if (this.props.has(unit)) continue;
      const type = w.kind === 'kopitiam' ? 'kopitiam_floor' : 'shop_floor';
      this.shopListing(unit, type);
      if (!this.byUnit.has(unit)) continue;
      const s = this.hydrate(unit, w.owner, w.ownerName, type, { mode: 'shop', cleanliness: 100 });
      this.props.set(unit, s);
      this.save(s);
      changed = true;
    }
    if (changed) this.hooks.publicChanged();
    return changed;
  }

  /** 🪑 Your shop's starter tables and chairs (where they stand now), to hand over as furniture. */
  starterFor(p: OnlinePlayer, unit: string): Placed[] {
    const s = this.mine(p, unit);
    if (s.mode !== 'shop') throw new GameError('Only a shop floor has starter tables.');
    const t = this.cfg.properties.types[s.type];
    const plan = planForType(t, s.type);
    const sets = starterShopSets({ W: t.w, H: t.h, front: plan.front, max: s.type === 'kopitiam_floor' ? 6 : 4, layout: s.layout, piece: (id) => this.cfg.furniture.pieces[id] });
    if (!sets.length) throw new GameError('Your own tables are already in.');
    for (const id of [STARTER_TABLE, STARTER_CHAIR]) if (!this.cfg.furniture.pieces[id]) throw new GameError('Those tables are not furniture here.');
    return sets;
  }

  /** …and put them in the layout, now as real pieces (`placed`: with the new items' iids). */
  addStarter(p: OnlinePlayer, unit: string, placed: Placed[]) {
    const s = this.mine(p, unit);
    s.layout = [...s.layout, ...placed.map((pl) => ({ iid: pl.iid, item: pl.item, x: pl.x, y: pl.y, rot: pl.rot }))];
    this.save(s);
    this.hooks.publicChanged();
    this.hooks.selfChanged(p);
    return s.layout.map((pl) => ({ ...pl }));
  }

  /** 🏠 A player's places (homes, lofts, Airbnbs, shop floors) for visitors. */
  placesOf(owner: number): Array<{ unit: string; type: string; mode: PropertyMode }> {
    const out: Array<{ unit: string; type: string; mode: PropertyMode }> = [];
    for (const s of this.props.values()) if (s.owner === owner) out.push({ unit: s.unit, type: s.type, mode: s.mode });
    return out;
  }

  /** 🏠 A place as a visitor sees it (its furniture and stars), or null. */
  placeView(unit: string): ShopView | null {
    const s = this.props.get(unit);
    if (!s) return null;
    return { unit: s.unit, type: s.type, owner: s.owner, ownerName: s.ownerName, layout: s.layout.map((p) => ({ ...p })), stars: this.ratingOf(s).stars, cleanliness: s.cleanliness };
  }

  /** 🏪 A building's shop floor as visitors see it (its furniture, stars), or null. */
  shopView(building: string): ShopView | null {
    const s = this.props.get(building + SHOP_SUFFIX);
    if (!s || s.mode !== 'shop') return null;
    return { unit: s.unit, type: s.type, owner: s.owner, ownerName: s.ownerName, layout: s.layout.map((p) => ({ ...p })), stars: this.ratingOf(s).stars, cleanliness: s.cleanliness };
  }

  /** Stars → business: customers / income × this (1 around 3.3★). */
  shopMult(building: string): number {
    const s = this.props.get(building + SHOP_SUFFIX);
    if (!s) return 1;
    const c = this.cfg.properties.shop;
    return c.multBase + c.multPerStar * this.ratingOf(s).stars;
  }

  /** Customers came through: the floor gets dirtier, and now and then one leaves a review. */
  shopVisit(building: string, n: number) {
    const s = this.props.get(building + SHOP_SUFFIX);
    if (!s || n <= 0) return;
    const c = this.cfg.properties.shop;
    const before = Math.floor(s.earnedSen / c.reviewEvery); // (earnedSen counts customers for a shop)
    s.earnedSen += n;
    s.cleanliness = Math.max(0, s.cleanliness - c.dirtPerCustomer * n);
    if (Math.floor(s.earnedSen / c.reviewEvery) > before) s.reviews = [...s.reviews, this.shopReview(this.ratingOf(s))].slice(-12);
    this.dirtyShops.add(s.unit);
  }
  private dirtyShops = new Set<string>();
  /** A customer's review of a shop (its own texts: tables and toilets, not beds and sheets). */
  private shopReview(r: Rating) {
    const rv = this.cfg.properties.shop.reviews;
    const pick = (k: string) => {
      const list = rv[k] ?? rv.meh ?? ['OK.'];
      return list[this.rand(list.length)];
    };
    const stars = Math.max(1, Math.min(5, Math.round(r.stars + (this.rand(3) - 1) * 0.5)));
    let text: string;
    if (r.missing.includes('aircond')) text = pick('noAircond');
    else if (r.missing.includes('wifi')) text = pick('noWifi');
    else if (r.missing.includes('toilet')) text = pick('noToilet');
    else text = pick(stars >= 5 ? 'great' : stars >= 4 ? 'good' : stars >= 3 ? 'meh' : 'bad');
    const theme = Object.entries(r.themes).sort((a, b) => b[1] - a[1])[0]?.[0];
    text = text.replace('{theme}', this.cfg.furniture.themes[theme ?? '']?.name ?? 'cosy');
    return { stars: r.missing.length ? Math.min(stars, 1) : stars, text, day: this.today() };
  }
  /** Saves shops customers visited (called now and then, not per customer). */
  flushShops() {
    for (const u of this.dirtyShops) {
      const s = this.props.get(u);
      if (s) this.save(s);
    }
    this.dirtyShops.clear();
  }

  ratingOf(s: PropState): Rating {
    const t = this.cfg.properties.types[s.type];
    return rateUnit(this.rating, { w: t.w, h: t.h, type: s.type, frontTop: this.frontTop(s.unit) }, s.layout, s.cleanliness);
  }

  all(): PropPublic[] {
    return [...this.props.values()].map((s) => ({ unit: s.unit, owner: s.owner, ownerName: s.ownerName, mode: s.mode, stars: s.mode === 'airbnb' || s.mode === 'shop' ? this.ratingOf(s).stars : 0 }));
  }

  ownedBy(p: OnlinePlayer): PropState[] {
    return [...this.props.values()].filter((s) => s.owner === p.id);
  }

  /** The owner's view: state + live rating, fair prices and the top suggestions. */
  selfOf(p: OnlinePlayer) {
    return this.ownedBy(p).map((s) => {
      const u = this.byUnit.get(s.unit)!;
      const t = this.cfg.properties.types[s.type];
      const r = this.ratingOf(s);
      const placedIids = new Set(this.lockedIids(p));
      const ownedFree = p.inventory.filter((i) => this.cfg.furniture.pieces[i.itemId] && !placedIids.has(i.iid)).map((i) => i.itemId);
      return {
        ...s,
        work: s.work,
        rating: r,
        fairNightSen: this.fairNight(p, s, r.stars),
        fairRentSen: this.fairRent(p, s, r.stars),
        happiness: s.tenant ? tenantHappiness(s.condition, r.stars, s.rentSen, this.fairRent(p, s, r.stars), this.tenantDef(s.tenant.kind).rentTolerance) : null,
        suggestions: suggestions(this.rating, { w: t.w, h: t.h, type: s.type, loc: u.loc, frontTop: this.frontTop(s.unit) }, s.layout, s.cleanliness, ownedFree),
        loc: u.loc,
      };
    });
  }

  /** Furniture instances placed in any of the player's homes (can't be sold or traded). */
  lockedIids(p: OnlinePlayer): Set<number> {
    const out = new Set<number>();
    for (const s of this.props.values()) if (s.owner === p.id) for (const pl of s.layout) out.add(pl.iid);
    return out;
  }

  /** What the player's homes count towards net worth. */
  assetsOf(p: OnlinePlayer): number {
    let sum = 0;
    for (const s of this.props.values()) if (s.owner === p.id) sum += Math.floor(s.boughtSen * this.cfg.properties.assetValueRate);
    return sum;
  }

  private pmods(p: OnlinePlayer): PropMods {
    return this.hooks.mods?.(p) ?? NO_MODS;
  }

  /** Fair daily rent / nightly rate for a unit: type, location, rating, and Kerb Appeal. */
  private fairRent(p: OnlinePlayer, s: PropState, stars: number) {
    return Math.round(fairRentSen(this.cfg.properties, s.type, this.byUnit.get(s.unit)!.loc, stars) * this.pmods(p).appeal);
  }
  private fairNight(p: OnlinePlayer, s: PropState, stars: number) {
    return Math.round(fairNightSen(this.cfg.properties, s.type, stars, this.byUnit.get(s.unit)!.loc) * this.pmods(p).appeal);
  }

  private tenantDef(kind: string) {
    return this.cfg.properties.rent.tenants.find((t) => t.id === kind) ?? this.cfg.properties.rent.tenants[0];
  }

  private mine(p: OnlinePlayer, unit: string): PropState {
    const s = this.props.get(unit);
    if (!s || s.owner !== p.id) throw new GameError("That isn't your property.");
    return s;
  }

  private atDoor(p: OnlinePlayer, u: Unit) {
    const T = this.cfg.map.tileSize;
    const b = this.cfg.map.buildings.find((x) => x.id === u.building);
    const doors = b?.doors.map((d) => [d.frontX + 0.5, d.frontY + 0.5]) ?? [[u.x, u.y]];
    return doors.some(([x, y]) => Math.hypot(p.x / T - x, (p.y - 4) / T - y) <= this.cfg.economy.interactRadiusTiles + 1);
  }

  // ---------------------------------------------------------------- buying and selling
  buy(p: OnlinePlayer, unitId: string) {
    const u = this.byUnit.get(unitId);
    if (!u) throw new GameError('No such unit.');
    if (this.props.has(unitId)) throw new GameError('Somebody already owns it.');
    if (!this.atDoor(p, u)) throw new GameError('Go to the building to buy it.');
    const t = this.cfg.properties.types[u.type];
    if (t.requires.stage && p.prog.stage < t.requires.stage) throw new GameError(`A ${t.name} needs wealth stage ${t.requires.stage}.`);
    if (t.requires.level && p.prog.level < t.requires.level) throw new GameError(`A ${t.name} needs level ${t.requires.level}.`);
    // Your first home is free (up to a price cap); there's a limit on how many you can have.
    // (Shop floors are businesses, not homes: they don't count.)
    const owned = [...this.props.values()].filter((x) => x.owner === p.id && !this.isShop(x.unit)).length;
    const cl = this.cfg.properties.claim;
    if (owned >= cl.maxHomes) throw new GameError(`You can have up to ${cl.maxHomes} homes. Sell one first.`);
    const price = owned === 0 && u.priceSen <= cl.firstFreeMaxSen ? 0 : u.priceSen;
    if (p.walletSen < price) throw new GameError('Not enough money.');
    const s = this.hydrate(unitId, p.id, p.name, u.type, { boughtSen: price });
    this.econ.run(p, () => {
      this.econ.change(p, -price, 0, price ? 'property-buy' : 'property-claim', unitId);
      this.props.set(unitId, s);
      this.save(s);
    });
    this.bump(p, 'propertiesBought');
    this.hooks.wallet(p, -price, 'property');
    this.hooks.publicChanged();
    this.hooks.selfChanged(p);
    return s;
  }

  sell(p: OnlinePlayer, unitId: string) {
    const s = this.mine(p, unitId);
    if (this.isShop(unitId)) throw new GameError("That's your business's shop: move or close the business instead.");
    if (this.hooks.isPledged?.(p, unitId)) throw new GameError('It is collateral for a bank loan: pay the loan off first.');
    const back = Math.floor(s.boughtSen * this.cfg.properties.sellBackRate);
    this.econ.run(p, () => {
      this.econ.change(p, back, 0, 'property-sell', unitId);
      this.props.delete(unitId);
      this.repos.properties.delete(unitId);
    });
    this.hooks.wallet(p, back, 'property');
    this.hooks.publicChanged();
    this.hooks.selfChanged(p);
    return { gainedSen: back };
  }

  /** What the bank values one of your homes at (its market price), or null if it isn't yours. */
  valueOf(p: OnlinePlayer, unitId: string): number | null {
    const s = this.props.get(unitId);
    return s && s.owner === p.id ? (this.byUnit.get(unitId)?.priceSen ?? 0) : null;
  }

  /** The bank takes it (a defaulted property loan). Returns its value; the caller auctions it. */
  repossess(p: OnlinePlayer, unitId: string): number {
    const value = this.valueOf(p, unitId) ?? 0;
    this.props.delete(unitId);
    this.repos.properties.delete(unitId);
    this.hooks.publicChanged();
    this.hooks.selfChanged(p);
    return value;
  }

  // ---------------------------------------------------------------- settings
  setMode(p: OnlinePlayer, unitId: string, mode: PropertyMode) {
    const s = this.mine(p, unitId);
    if (this.isShop(unitId) || mode === 'shop') throw new GameError('A shop stays a shop.');
    if (s.mode === mode) return;
    if (s.tenant && mode !== 'rent') throw new GameError('Your tenant has to move out first: 🚪 Ask them to leave (📱 → Properties).');
    if (s.guest && mode !== 'airbnb') throw new GameError('Wait for your guest to check out first.');
    s.mode = mode;
    this.save(s);
    this.hooks.publicChanged();
    this.hooks.selfChanged(p);
  }

  /** Ask your tenant to move out: you pay them `evictFeeDays` of rent to go, and anything they
   *  still owe is written off. The home goes back to looking for a tenant (or switch it to
   *  Airbnb / living in it). */
  evict(p: OnlinePlayer, unitId: string): { feeSen: number } {
    const s = this.mine(p, unitId);
    if (!s.tenant) throw new GameError("There's no tenant to ask to leave.");
    const fee = Math.round(s.rentSen * this.cfg.properties.rent.evictFeeDays);
    if (p.walletSen < fee) throw new GameError(`You need ${formatMoney(fee)} to pay the tenant to move out.`);
    const def = this.tenantDef(s.tenant.kind);
    this.econ.run(p, () => {
      if (fee) this.econ.change(p, -fee, 0, 'property-evict', unitId);
      s.tenant = null; // repairs they reported still need fixing
      this.save(s);
    });
    if (fee) this.hooks.wallet(p, -fee, 'property');
    this.hooks.event(p, { unit: s.unit, kind: 'info', text: `🚪 Your ${def.name.toLowerCase()} tenant moved out${fee ? ` (you paid ${formatMoney(fee)})` : ''}.` });
    this.hooks.publicChanged();
    this.hooks.selfChanged(p);
    return { feeSen: fee };
  }

  setPrices(p: OnlinePlayer, unitId: string, rentSen?: number, nightSen?: number) {
    const s = this.mine(p, unitId);
    const t = this.cfg.properties.types[s.type];
    // Up to 3× the fair price (never below 5× the type's base): a typo can't scare every tenant
    // away for good, and anything out of range is refused (not quietly changed).
    const stars = this.ratingOf(s).stars;
    const check = (v: number, fair: number, base: number, what: string) => {
      const max = Math.max(base * 5, fair * 3);
      if (!Number.isFinite(v) || v < 100 || v > max) throw new GameError(`${what} has to be between ${formatMoney(100)} and ${formatMoney(max)}.`);
      return Math.round(v);
    };
    if (rentSen !== undefined) s.rentSen = check(rentSen, this.fairRent(p, s, stars), t.rentPerDaySen, 'Rent');
    if (nightSen !== undefined) s.nightSen = check(nightSen, this.fairNight(p, s, stars), t.nightBaseSen, 'The nightly price');
    this.save(s);
    this.hooks.selfChanged(p);
  }

  setStaff(p: OnlinePlayer, unitId: string, role: 'manager' | 'cleaner', on: boolean) {
    const s = this.mine(p, unitId);
    s[role] = on;
    this.save(s);
    this.hooks.selfChanged(p);
  }

  /** Save a decorated layout: every piece must be furniture you own and not placed elsewhere. */
  setLayout(p: OnlinePlayer, unitId: string, layout: Placed[]) {
    const s = this.mine(p, unitId);
    const t = this.cfg.properties.types[s.type];
    const elsewhere = new Set<number>();
    for (const o of this.props.values()) if (o.owner === p.id && o.unit !== unitId) for (const pl of o.layout) elsewhere.add(pl.iid);
    for (const pl of layout) {
      const inst = p.inventory.find((i) => i.iid === pl.iid);
      if (!inst || inst.itemId !== pl.item) throw new GameError("You don't own one of those pieces any more.");
      if (elsewhere.has(pl.iid)) throw new GameError('That piece is already in another of your homes.');
    }
    const problem = layoutProblem(this.rating, { w: t.w, h: t.h, type: s.type, frontTop: this.frontTop(s.unit) }, layout);
    if (problem) throw new GameError(problem);
    s.layout = layout.map((pl) => ({ iid: pl.iid, item: pl.item, x: pl.x, y: pl.y, rot: ((pl.rot % 4) + 4) % 4 }));
    this.save(s);
    this.hooks.publicChanged();
    this.hooks.selfChanged(p);
    return this.ratingOf(s);
  }

  /** Furniture that left the inventory (sold elsewhere, traded) leaves the layout too. */
  prune(p: OnlinePlayer) {
    const have = new Set(p.inventory.map((i) => i.iid));
    for (const s of this.props.values()) {
      if (s.owner !== p.id) continue;
      const kept = s.layout.filter((pl) => have.has(pl.iid));
      if (kept.length !== s.layout.length) {
        s.layout = kept;
        this.save(s);
      }
    }
  }

  // ---------------------------------------------------------------- hands-on work
  /** Fix a maintenance request: pay a contractor now, or DIY (start, then finish after a while). */
  fix(p: OnlinePlayer, unitId: string, req: number, how: 'contractor' | 'diy-start' | 'diy-finish') {
    const s = this.mine(p, unitId);
    const r = s.requests.find((x) => x.id === req);
    if (!r) throw new GameError('Already fixed.');
    const u = this.byUnit.get(unitId)!;
    if (how === 'contractor') {
      const cost = Math.round(s.boughtSen * this.cfg.properties.costs.contractorRate);
      if (p.walletSen < cost) throw new GameError('Not enough money for the contractor.');
      this.econ.run(p, () => this.econ.change(p, -cost, 0, 'property-repair', unitId));
      this.hooks.wallet(p, -cost, 'repair');
    } else {
      if (!this.atDoor(p, u)) throw new GameError('Go to the unit to fix it yourself.');
      if (how === 'diy-start') {
        s.work = { kind: 'diy', req, at: this.clock() };
        this.hooks.selfChanged(p);
        return { doneAt: this.clock() + this.cfg.properties.rent.diyMs };
      }
      if (s.work?.kind !== 'diy' || s.work.req !== req || this.clock() - s.work.at < this.cfg.properties.rent.diyMs - 300) throw new GameError("You're not done fixing it yet.");
      s.work = null;
      this.bump(p, 'diyFixes');
    }
    s.requests = s.requests.filter((x) => x.id !== req);
    s.condition = Math.min(100, s.condition + 10);
    this.save(s);
    this.hooks.selfChanged(p);
    return {};
  }

  /** Clean an Airbnb unit yourself: start, then finish once the cleaning time has passed. */
  clean(p: OnlinePlayer, unitId: string, phase: 'start' | 'finish') {
    const s = this.mine(p, unitId);
    if (!this.atDoor(p, this.byUnit.get(unitId)!)) throw new GameError('Go to the unit to clean it.');
    if (phase === 'start') {
      s.work = { kind: 'clean', at: this.clock() };
      this.hooks.selfChanged(p);
      return { doneAt: this.clock() + this.cfg.properties.airbnb.cleanMs };
    }
    if (s.work?.kind !== 'clean' || this.clock() - s.work.at < this.cfg.properties.airbnb.cleanMs - 300) throw new GameError('Keep cleaning!');
    s.work = null;
    s.cleanliness = 100;
    this.bump(p, 'cleans');
    this.save(s);
    this.hooks.selfChanged(p);
    return {};
  }

  // ---------------------------------------------------------------- time
  /** Every second: process online owners' properties up to the current in-game hour/day. */
  tick() {
    const owners = new Set<number>();
    for (const s of this.props.values()) owners.add(s.owner);
    for (const id of owners) {
      const p = this.world.get(id);
      if (p && p.socketId) this.catchUp(p, 1, Infinity);
    }
  }

  /**
   * Runs every in-game hour/day that passed for this owner's units. `efficiency` scales income
   * (offline: 50%); `maxDays` caps how far back we go. Returns the money made, by kind.
   */
  catchUp(p: OnlinePlayer, efficiency: number, maxDays: number, perUnit?: Map<string, Record<string, number>>): Record<string, number> {
    const now = gameTime(this.cfg.time, this.clock());
    const hourNow = Math.floor(now.total / 60);
    const earned: Record<string, number> = {};
    let changed = false;
    for (const s of this.props.values()) {
      if (s.owner !== p.id) continue;
      const fromDay = Math.max(s.lastDay, now.day - maxDays);
      // Hours (tenant applications) only for the last day: older empty hours just don't matter.
      if (s.mode === 'rent' && !s.tenant) {
        for (let h = Math.max(s.lastHour + 1, hourNow - 24); h <= hourNow && !s.tenant; h++) this.hour(p, s);
      }
      s.lastHour = hourNow;
      for (let d = fromDay + 1; d <= now.day; d++) {
        const r = this.day(p, s, d, efficiency);
        for (const [k, v] of Object.entries(r)) earned[k] = (earned[k] ?? 0) + v;
        if (perUnit) {
          const u = perUnit.get(s.unit) ?? {};
          for (const [k, v] of Object.entries(r)) u[k] = (u[k] ?? 0) + v;
          perUnit.set(s.unit, u);
        }
        changed = true;
      }
      if (now.day > s.lastDay) {
        s.lastDay = now.day;
        this.save(s);
      }
    }
    if (changed) this.hooks.selfChanged(p);
    return earned;
  }

  private chance(x: number) {
    return this.rand(1_000_000) < x * 1_000_000;
  }

  private hour(p: OnlinePlayer, s: PropState) {
    const fair = this.fairRent(p, s, this.ratingOf(s).stars);
    const ratio = s.rentSen / Math.max(1, fair);
    const appeal = ratio <= 1 ? 1 : Math.max(0.05, 1 - (ratio - 1) * 1.8);
    if (!this.chance(this.cfg.properties.rent.applyChancePerHour * appeal)) return;
    const tenants = this.cfg.properties.rent.tenants;
    const t = tenants[this.rand(tenants.length)];
    s.tenant = { kind: t.id, since: this.today(), owed: 0 };
    this.hooks.event(p, { unit: s.unit, kind: 'good', text: `${t.icon} A ${t.name.toLowerCase()} moved into your ${this.cfg.properties.types[s.type].name}!` });
  }

  /** One in-game day for one unit. Returns income by kind (after costs). */
  private day(p: OnlinePlayer, s: PropState, day: number, eff: number): Record<string, number> {
    const pc = this.cfg.properties;
    const u = this.byUnit.get(s.unit)!;
    const out: Record<string, number> = {};
    const pay = (kind: string, sen: number, reason: string) => {
      sen = Math.round(sen);
      if (!sen) return;
      // Costs never push the wallet below zero (they're written off).
      if (sen < 0) sen = -Math.min(-sen, Math.max(0, p.walletSen));
      if (!sen) return;
      this.econ.run(p, () => this.econ.change(p, sen, 0, reason, s.unit));
      s.earnedSen += sen;
      out[kind] = (out[kind] ?? 0) + sen;
    };
    // Running costs: assessment tax + maintenance fees.
    pay('costs', -s.boughtSen * (pc.costs.taxPerDayRate + pc.costs.maintenancePerDayRate), 'property-costs');
    // A shop: the cleaner (if hired) makes it spotless each day.
    if (s.mode === 'shop') {
      if (s.cleaner && s.cleanliness < 100) {
        pay('cleaner', -pc.shop.cleanerPerDaySen, 'shop-cleaner');
        s.cleanliness = 100;
      }
      return out;
    }
    const rating = this.ratingOf(s);
    const pm = this.pmods(p);
    if (s.mode === 'rent' && s.tenant) {
      const t = this.tenantDef(s.tenant.kind);
      const fair = this.fairRent(p, s, rating.stars);
      // Maintenance: new requests; open ones wear the place down. A manager handles them.
      if (this.chance(pc.rent.maintenanceChancePerDay)) {
        const text = pc.rent.requests[this.rand(pc.rent.requests.length)];
        s.requests.push({ id: s.nextReq++, text, day });
        if (!s.manager) this.hooks.event(p, { unit: s.unit, kind: 'bad', text: `🔧 Your tenant reports: ${text}. Fix it in 📱 → Properties.` });
      }
      if (s.manager && s.requests.length) {
        pay('costs', -s.boughtSen * pc.costs.contractorRate * s.requests.length, 'property-repair');
        s.condition = Math.min(100, s.condition + 10 * s.requests.length);
        s.requests = [];
      }
      s.condition = Math.max(0, s.condition - pc.rent.conditionLossPerOpenRequest * s.requests.length);
      const happy = tenantHappiness(s.condition, rating.stars, s.rentSen, fair, t.rentTolerance);
      // Rent: overpriced rent is paid late more often.
      const lateChance = Math.min(0.9, Math.max(0, (s.rentSen / (fair * t.rentTolerance) - 1)) * pc.rent.latePayChanceAtDouble);
      const dueSen = s.rentSen + s.tenant.owed;
      if (this.chance(lateChance)) s.tenant.owed = dueSen;
      else {
        const cut = s.manager ? 1 - pc.costs.managerCut : 1;
        pay('rent', dueSen * cut * eff * pm.rent, 'property-rent'); // + Prime Landlord, Passive Income
        s.tenant.owed = 0;
      }
      if (happy < pc.rent.moveOutBelowHappiness && this.chance(pc.rent.moveOutChancePerDay)) {
        this.hooks.event(p, { unit: s.unit, kind: 'bad', text: `📦 Your tenant moved out (happiness ${happy}%). Lower the rent or fix things up.` });
        s.tenant = null;
      }
    } else if (s.mode === 'airbnb') {
      const a = pc.airbnb;
      // Checkout: get paid, a review, a dirtier unit.
      if (s.guest && day >= s.guest.until) {
        const g = s.guest;
        s.guest = null;
        let paid = g.paySen * eff * pm.airbnb; // + Five-Star Host, Passive Income
        if (s.superhost) paid *= 1 + a.superhostBonus;
        if (this.chance(a.tipChance)) paid *= 1.15;
        pay('airbnb', paid, 'property-airbnb');
        const lo = a.cleanLossPerStay[0], hi = a.cleanLossPerStay[1];
        s.cleanliness = Math.max(0, s.cleanliness - Math.round((lo + this.rand(hi - lo + 1)) * pm.cleanLoss)); // Spotless
        if (this.chance(a.damageChance)) s.condition = Math.max(0, s.condition - 15);
        const review = this.review(s, rating);
        s.reviews = [review, ...s.reviews].slice(0, 12);
        if (review.stars >= 5) s.fiveStars++;
        if (!s.superhost && s.fiveStars >= a.superhostAfter) {
          s.superhost = true;
          this.hooks.event(p, { unit: s.unit, kind: 'good', text: '🏅 You are now a Superhost! +10% on every booking.' });
        }
        if (s.cleaner) {
          pay('costs', -s.nightSen * pc.costs.cleanerPerStaySen, 'property-cleaner');
          s.cleanliness = 100;
        }
        this.bump(p, 'airbnbStays');
      }
      // A new booking (weekends and events are busier; VIPs pay 3× for 5★ only).
      if (!s.guest && rating.stars > a.minStars) {
        const fair = this.fairNight(p, s, rating.stars);
        const weekend = day % 7 === 5 || day % 7 === 6;
        const event = this.chance(a.eventChancePerDay);
        if (this.chance(bookingChance(pc, rating.stars, s.nightSen, fair, u.loc, weekend, event))) {
          const nights = 1 + this.rand(3);
          const vip = rating.stars >= 4.9 && this.chance(a.vipChance);
          s.guest = { until: day + nights, paySen: s.nightSen * nights * (vip ? a.vipMult : 1), vip };
        }
      }
    }
    this.save(s);
    return out;
  }

  private review(s: PropState, r: Rating) {
    const rv = this.cfg.properties.airbnb.reviews;
    const pick = (k: string) => {
      const list = rv[k] ?? rv.meh;
      return list[this.rand(list.length)];
    };
    const stars = Math.max(1, Math.min(5, Math.round(r.stars + (this.rand(3) - 1) * 0.5)));
    let text: string;
    if (r.missing.includes('aircond')) text = pick('noAircond');
    else if (r.missing.includes('wifi')) text = pick('noWifi');
    else if (r.missing.includes('bed')) text = pick('noBed');
    else text = pick(stars >= 5 ? 'great' : stars >= 4 ? 'good' : stars >= 3 ? 'meh' : 'bad');
    const theme = Object.entries(r.themes).sort((a, b) => b[1] - a[1])[0]?.[0];
    text = text.replace('{theme}', this.cfg.furniture.themes[theme ?? '']?.name ?? 'cosy');
    return { stars: r.missing.length ? Math.min(stars, 1) : stars, text, day: this.today() };
  }

  private bump(p: OnlinePlayer, stat: string) {
    p.prog.stats[stat] = (p.prog.stats[stat] ?? 0) + 1;
  }

  // ---------------------------------------------------------------- offline income
  /**
   * On login: catch up everything that happened while away (capped, at offline efficiency) and
   * return the summary for the welcome-back screen (null if nothing happened).
   */
  welcomeBack(p: OnlinePlayer, awayMs: number, offline: { capHours: number; efficiency: number }, extra: AwaySummary['lines'] = []): AwaySummary | null {
    const more = extra.filter((l) => l.sen);
    if (!this.ownedBy(p).length && !more.length) return null;
    const capDays = Math.ceil((Math.min(awayMs, offline.capHours * 3_600_000) / this.cfg.time.realMsPerGameMinute) / 1440);
    // One line per home: what it made (rent / Airbnb) minus its running costs. Other passive
    // income (your stall, managed businesses) was already paid by its own system; it's listed
    // here and counts for the Lucky Spin.
    const perUnit = new Map<string, Record<string, number>>();
    if (this.ownedBy(p).length) this.catchUp(p, offline.efficiency, capDays, perUnit);
    const homeLines: AwaySummary['lines'] = [];
    for (const [unit, r] of perUnit) {
      const s = this.props.get(unit);
      const t = s ? this.cfg.properties.types[s.type] : undefined;
      const sen = Object.values(r).reduce((a, v) => a + v, 0);
      if (!sen) continue;
      const parts = [r.rent ? `rent ${formatMoney(r.rent)}` : '', r.airbnb ? `Airbnb ${formatMoney(r.airbnb)}` : '', r.costs ? `costs ${formatMoney(r.costs)}` : ''].filter(Boolean);
      homeLines.push({ label: `${t?.icon ?? '🏠'} ${t?.name ?? unit}`, sen, detail: parts.join(' · ') });
    }
    const lines = [...homeLines, ...more];
    const total = lines.reduce((a, l) => a + l.sen, 0);
    if (awayMs < 60_000 || !lines.length) return null;
    if (total > 0) this.welcome.set(p.id, { sen: total, at: this.clock(), spun: false });
    return { awayMs, earnedSen: total, lines };
  }

  /** The welcome-back Lucky Spin: the wheel (economy.offline.spin) lands on a multiplier of what
   *  you earned while away; you get the extra on top (×2 pays it once more). */
  luckySpin(p: OnlinePlayer) {
    const w = this.welcome.get(p.id);
    if (!w || w.spun) throw new GameError('No spin waiting.');
    const wheel = this.cfg.economy.offline.spin;
    const total = wheel.reduce((a, x) => a + x.weight, 0);
    let r = (this.rand(1_000_000) / 1_000_000) * total;
    let index = wheel.length - 1;
    for (let i = 0; i < wheel.length; i++) if ((r -= wheel[i].weight) < 0) {
      index = i;
      break;
    }
    const mult = wheel[index].mult;
    const bonusSen = Math.round(w.sen * (mult - 1));
    w.spun = true;
    if (bonusSen > 0) {
      this.econ.run(p, () => this.econ.change(p, bonusSen, 0, 'welcome-spin', `x${mult}`));
      this.hooks.wallet(p, bonusSen, 'spin');
    }
    return { bonusSen, index, mult, totalSen: w.sen + bonusSen };
  }
}
