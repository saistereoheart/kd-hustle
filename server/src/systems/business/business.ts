// Businesses (Phase 6, spec §8.5–8.6), server side.
//
// Idle businesses (car wash, dobi, bubble tea… the mall): buy levels, each production cycle pays
// revenue × level (minus a 5% business tax). Milestones double the speed. Without a manager a
// finished cycle waits for you to collect it (📱 → Business); with a manager it pays by itself,
// also while you're offline (at the offline rate). "Rush" is the small active interaction: tap
// fast enough and output is tripled for 20 s.
//
// Retail (Kedai Runcit): buy stock wholesale, set your prices (customers react to price vs market
// value), and either hire a cashier (sells by itself while you're online) or be the cashier: the
// checkout mini-game (scan the basket, give the right change) pays a bonus.
import {
  cycleMs, levelCostSen, managerCostSen, retailDemand, revenuePerCycleSen,
  type BusinessesConfig, type BusinessTypeDef, type RandInt, type BizState, type Checkout, type RetailState, type Ventures,
} from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { Repos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { GameError, type Economy } from '../economy/economy';

export interface BusinessHooks {
  wallet: (p: OnlinePlayer, delta: number, reason: string) => void;
  changed: (p: OnlinePlayer) => void;
  /** Income multiplier right now (e.g. 0.5 while you owe the Ah Long). */
  incomeMult: (p: OnlinePlayer) => number;
}

export class BusinessSystem {
  private bc: BusinessesConfig;
  private state = new Map<number, Ventures>();
  private checkouts = new Map<number, Checkout>();
  private nextCheckout = 1;

  constructor(
    private cfg: ServerConfig,
    private repos: Repos,
    private econ: Economy,
    private rand: RandInt,
    private hooks: BusinessHooks,
    private clock: () => number = Date.now,
  ) {
    this.bc = cfg.businesses;
  }

  private type(id: string): BusinessTypeDef {
    const t = this.bc.types.find((x) => x.id === id);
    if (!t) throw new GameError('No such business.');
    return t;
  }

  /** Load a player's ventures (on login). */
  load(p: OnlinePlayer): Ventures {
    const raw = this.repos.playerData.load<Partial<Ventures>>(p.id, 'ventures');
    const v: Ventures = { businesses: raw?.businesses ?? {}, retail: raw?.retail ?? null };
    this.state.set(p.id, v);
    return v;
  }

  of(p: OnlinePlayer): Ventures {
    return this.state.get(p.id) ?? this.load(p);
  }

  save(p: OnlinePlayer) {
    const v = this.state.get(p.id);
    if (v) this.repos.playerData.save(p.id, 'ventures', v);
  }

  /** Forget an offline player (after saving). */
  unload(p: OnlinePlayer) {
    this.save(p);
    this.state.delete(p.id);
  }

  /** What the businesses count towards net worth: 50% of what was spent on levels and managers. */
  assetsOf(p: OnlinePlayer): number {
    const v = this.of(p);
    let sum = 0;
    for (const [id, b] of Object.entries(v.businesses)) {
      const t = this.bc.types.find((x) => x.id === id);
      if (!t) continue;
      sum += levelCostSen(this.bc, t, 0, b.level) * 0.5 + (b.manager ? managerCostSen(this.bc, t) * 0.5 : 0);
    }
    if (v.retail) sum += this.bc.retail.openSen * 0.5;
    return Math.round(sum);
  }

  /** What the bank values a business at (half of what was spent on it), or null if you don't own it. */
  valueOf(p: OnlinePlayer, typeId: string): number | null {
    const b = this.of(p).businesses[typeId];
    const t = this.bc.types.find((x) => x.id === typeId);
    if (!b?.level || !t) return null;
    return Math.round(levelCostSen(this.bc, t, 0, b.level) * 0.5 + (b.manager ? managerCostSen(this.bc, t) * 0.5 : 0));
  }

  /** Your businesses, for pledging as collateral. */
  owned(p: OnlinePlayer): Array<{ id: string; name: string; valueSen: number }> {
    return this.bc.types.filter((t) => this.of(p).businesses[t.id]?.level).map((t) => ({ id: t.id, name: `${t.icon} ${t.name}`, valueSen: this.valueOf(p, t.id) ?? 0 }));
  }

  /** The bank takes it (a defaulted business loan). Returns its value; the caller auctions it. */
  repossess(p: OnlinePlayer, typeId: string): number {
    const value = this.valueOf(p, typeId) ?? 0;
    delete this.of(p).businesses[typeId];
    this.save(p);
    this.hooks.changed(p);
    return value;
  }

  /** Rebirth: every business and the shop are gone. */
  resetAll(p: OnlinePlayer) {
    const v = this.of(p);
    v.businesses = {};
    v.retail = null;
    this.save(p);
    this.hooks.changed(p);
  }

  private requireUnlocked(p: OnlinePlayer, req: { stage?: number; level?: number }, name: string) {
    if (req.stage && p.prog.stage < req.stage) throw new GameError(`${name} needs wealth stage ${req.stage}.`);
    if (req.level && p.prog.level < req.level) throw new GameError(`${name} needs level ${req.level}.`);
  }

  // ---------------------------------------------------------------- idle businesses
  buyLevels(p: OnlinePlayer, typeId: string, n: number) {
    const t = this.type(typeId);
    this.requireUnlocked(p, t.requires, t.name);
    const v = this.of(p);
    const b = v.businesses[typeId] ?? { level: 0, manager: false, cycleAt: this.clock(), stored: 0, rushUntil: 0, rushReadyAt: 0, earnedSen: 0 };
    const cost = levelCostSen(this.bc, t, b.level, n);
    if (p.walletSen < cost) throw new GameError('Not enough money.');
    this.settle(p, typeId, b); // pay out finished cycles at the old level first
    this.econ.run(p, () => {
      this.econ.change(p, -cost, 0, 'business-level', `${typeId}x${n}`);
      b.level += n;
      v.businesses[typeId] = b;
      this.save(p);
    });
    p.prog.stats.businessLevels = (p.prog.stats.businessLevels ?? 0) + n;
    this.hooks.wallet(p, -cost, 'business');
    this.hooks.changed(p);
    return { level: b.level, costSen: cost };
  }

  hireManager(p: OnlinePlayer, typeId: string) {
    const t = this.type(typeId);
    const b = this.of(p).businesses[typeId];
    if (!b?.level) throw new GameError('Buy the business first.');
    if (b.manager) throw new GameError('Already has a manager.');
    const cost = managerCostSen(this.bc, t);
    if (p.walletSen < cost) throw new GameError('Not enough money.');
    this.econ.run(p, () => {
      this.econ.change(p, -cost, 0, 'business-manager', typeId);
      b.manager = true;
      b.cycleAt = this.clock();
      this.save(p);
    });
    p.prog.stats.managers = (p.prog.stats.managers ?? 0) + 1;
    this.hooks.wallet(p, -cost, 'business');
    this.hooks.changed(p);
  }

  /** Collect finished cycles (no manager) and start the next one. */
  collect(p: OnlinePlayer, typeId?: string) {
    const v = this.of(p);
    let paid = 0;
    for (const [id, b] of Object.entries(v.businesses)) {
      if (typeId && id !== typeId) continue;
      if (!b.level) continue;
      this.advance(p, id, b);
      if (b.manager || !b.stored) continue;
      paid += this.pay(p, id, b, b.stored, false);
      b.stored = 0;
      b.cycleAt = this.clock();
    }
    if (paid) {
      this.save(p);
      this.hooks.wallet(p, paid, 'business');
      this.hooks.changed(p);
    }
    return { paidSen: paid };
  }

  /** Rush: tap `taps` times within the window (the client sends the tap times) → ×3 for a while. */
  rush(p: OnlinePlayer, typeId: string, tapsMs: number[]) {
    const t = this.type(typeId);
    const b = this.of(p).businesses[typeId];
    if (!b?.level) throw new GameError('Buy the business first.');
    const now = this.clock();
    if (now < b.rushReadyAt) throw new GameError(`${t.rushName} is cooling down.`);
    const r = this.bc.rush;
    const sorted = [...tapsMs].sort((a, c) => a - c);
    if (sorted.length < r.taps || sorted[r.taps - 1] - sorted[0] > r.windowMs) throw new GameError('Too slow! Tap faster.');
    this.settle(p, typeId, b);
    b.rushUntil = now + r.durationMs;
    b.rushReadyAt = now + r.cooldownMs;
    this.save(p);
    this.hooks.changed(p);
    return { rushUntil: b.rushUntil };
  }

  /** Counts finished cycles since cycleAt (manager: pays them; else: stores up to the cap). */
  private advance(p: OnlinePlayer, id: string, b: BizState, efficiency = 1): number {
    const t = this.type(id);
    const now = this.clock();
    const len = cycleMs(this.bc, t, b.level);
    const n = Math.floor((now - b.cycleAt) / len);
    if (n <= 0) return 0;
    if (b.manager) {
      const paid = this.pay(p, id, b, n, true, efficiency);
      b.cycleAt += n * len;
      return paid;
    }
    b.stored = Math.min(this.bc.storedCyclesWithoutManager, b.stored + n);
    b.cycleAt = now; // the next cycle only starts when you collect
    return 0;
  }

  /** Pays `n` cycles (rush-boosted ones get the multiplier), minus tax. */
  private pay(p: OnlinePlayer, id: string, b: BizState, n: number, auto: boolean, efficiency = 1): number {
    const t = this.type(id);
    const now = this.clock();
    const per = revenuePerCycleSen(t, b.level);
    const rushed = auto && b.rushUntil > b.cycleAt ? Math.min(n, Math.ceil((Math.min(now, b.rushUntil) - b.cycleAt) / cycleMs(this.bc, t, b.level))) : !auto && b.rushUntil > now ? n : 0;
    const gross = per * (n + rushed * (this.bc.rush.mult - 1)) * efficiency * this.hooks.incomeMult(p);
    const net = Math.round(gross * (1 - this.bc.taxRate));
    if (net <= 0) return 0;
    this.econ.run(p, () => this.econ.change(p, net, 0, 'business', id));
    b.earnedSen += net;
    p.prog.stats.businessEarnSen = (p.prog.stats.businessEarnSen ?? 0) + net;
    return net;
  }

  private settle(p: OnlinePlayer, id: string, b: BizState) {
    if (b.level) this.advance(p, id, b);
  }

  /** Every second for online players: managers pay out; retail sells. */
  tick(p: OnlinePlayer) {
    const v = this.of(p);
    let paid = 0;
    for (const [id, b] of Object.entries(v.businesses)) if (b.level) paid += this.advance(p, id, b);
    paid += this.retailTick(p, v);
    if (paid) {
      this.save(p);
      this.hooks.wallet(p, paid, 'business');
    }
  }

  /** Offline catch-up (managed businesses only, capped, at the offline rate). Returns what each
   *  business made, by type id. */
  offline(p: OnlinePlayer, awayMs: number, capHours: number, efficiency: number): Record<string, number> {
    const v = this.of(p);
    const now = this.clock();
    const from = now - Math.min(awayMs, capHours * 3_600_000);
    const paid: Record<string, number> = {};
    for (const [id, b] of Object.entries(v.businesses)) {
      if (!b.level) continue;
      if (!b.manager) {
        // A finished cycle was waiting.
        b.stored = Math.min(this.bc.storedCyclesWithoutManager, b.stored + 1);
        b.cycleAt = now;
        continue;
      }
      b.cycleAt = Math.max(b.cycleAt, from);
      const sen = this.advance(p, id, b, efficiency);
      if (sen) paid[id] = sen;
    }
    if (v.retail) v.retail.carry = 0;
    if (Object.keys(paid).length) this.save(p);
    return paid;
  }

  // ---------------------------------------------------------------- retail
  openShop(p: OnlinePlayer) {
    const r = this.bc.retail;
    this.requireUnlocked(p, r.requires, r.name);
    const v = this.of(p);
    if (v.retail) throw new GameError('You already have a shop.');
    if (p.walletSen < r.openSen) throw new GameError('Not enough money.');
    this.econ.run(p, () => {
      this.econ.change(p, -r.openSen, 0, 'retail-open', null);
      v.retail = {
        open: true, stock: {}, prices: Object.fromEntries(r.products.map((x) => [x.id, x.marketSen])), cashier: false, carry: 0, earnedSen: 0, soldToday: 0, lastWageDay: 0,
      };
      this.save(p);
    });
    this.hooks.wallet(p, -r.openSen, 'retail');
    this.hooks.changed(p);
  }

  private shop(p: OnlinePlayer): RetailState {
    const s = this.of(p).retail;
    if (!s) throw new GameError('Open a shop first.');
    return s;
  }

  buyStock(p: OnlinePlayer, product: string, qty: number) {
    const s = this.shop(p);
    const def = this.bc.retail.products.find((x) => x.id === product);
    if (!def) throw new GameError('Unknown product.');
    if ((s.stock[product] ?? 0) + qty > this.bc.retail.maxStockPerProduct) throw new GameError(`You can keep up to ${this.bc.retail.maxStockPerProduct} of each.`);
    const cost = def.costSen * qty;
    if (p.walletSen < cost) throw new GameError('Not enough money.');
    this.econ.run(p, () => {
      this.econ.change(p, -cost, 0, 'retail-stock', `${product}x${qty}`);
      s.stock[product] = (s.stock[product] ?? 0) + qty;
      this.save(p);
    });
    this.hooks.wallet(p, -cost, 'retail');
    this.hooks.changed(p);
  }

  setPrice(p: OnlinePlayer, product: string, priceSen: number) {
    const s = this.shop(p);
    const def = this.bc.retail.products.find((x) => x.id === product);
    if (!def) throw new GameError('Unknown product.');
    s.prices[product] = Math.max(1, Math.min(def.marketSen * 5, Math.round(priceSen)));
    this.save(p);
    this.hooks.changed(p);
  }

  setCashier(p: OnlinePlayer, on: boolean) {
    this.shop(p).cashier = on;
    this.save(p);
    this.hooks.changed(p);
  }

  /** Auto sales (with a hired cashier): customers arrive, buy what's in stock at your prices. */
  private retailTick(p: OnlinePlayer, v: Ventures): number {
    const s = v.retail;
    if (!s?.open || !s.cashier) return 0;
    const r = this.bc.retail;
    // Wages: once per real 24 minutes (an in-game day), charged in advance.
    const day = Math.floor(this.clock() / (1440 * this.cfg.time.realMsPerGameMinute));
    let wage = 0;
    if (s.lastWageDay !== day) {
      s.lastWageDay = day;
      wage = Math.min(p.walletSen, r.cashierWagePerDaySen);
      if (wage) this.econ.run(p, () => this.econ.change(p, -wage, 0, 'retail-wage', null));
    }
    s.carry += r.customersPerMin / 60;
    let earned = 0;
    while (s.carry >= 1) {
      s.carry -= 1;
      const basket = this.basket(s);
      for (const it of basket) {
        s.stock[it.product]--;
        earned += it.priceSen;
      }
      s.soldToday += basket.length;
    }
    if (earned) {
      earned = Math.round(earned * this.hooks.incomeMult(p));
      this.econ.run(p, () => this.econ.change(p, earned, 0, 'retail-sales', null));
      s.earnedSen += earned;
      p.prog.stats.retailEarnSen = (p.prog.stats.retailEarnSen ?? 0) + earned;
    }
    return earned - wage;
  }

  /** What a customer picks: 1–4 products, each bought with a chance that falls as your price rises. */
  private basket(s: RetailState) {
    const r = this.bc.retail;
    const [lo, hi] = r.itemsPerCustomer;
    const want = lo + this.rand(hi - lo + 1);
    const out: Array<{ product: string; priceSen: number }> = [];
    for (let k = 0; k < want; k++) {
      const def = r.products[this.rand(r.products.length)];
      const price = s.prices[def.id] ?? def.marketSen;
      if ((s.stock[def.id] ?? 0) - out.filter((x) => x.product === def.id).length <= 0) continue;
      if (this.rand(1000) < 500 * retailDemand(this.bc, price, def.marketSen)) out.push({ product: def.id, priceSen: price });
    }
    return out;
  }

  /** Be the cashier: the next customer's basket and the money they hand over. */
  checkoutStart(p: OnlinePlayer): Omit<Checkout, 'at' | 'totalSen'> {
    const s = this.shop(p);
    let items = this.basket(s);
    for (let k = 0; k < 4 && !items.length; k++) items = this.basket(s);
    if (!items.length) throw new GameError('No customers want anything right now (check your stock and prices).');
    const total = items.reduce((a, i) => a + i.priceSen, 0);
    // They pay with the next round note amount: RM 10, 50 or 100.
    const notes = [1000, 5000, 10000, 50000];
    const note = notes.find((n) => n >= total) ?? Math.ceil(total / 10000) * 10000;
    const paid = note === total ? total + 1000 : note;
    const change = paid - total;
    const wrong = [change + 100 * (1 + this.rand(5)), Math.max(0, change - 100 * (1 + this.rand(5)))].filter((x) => x !== change);
    const options = [change, ...wrong].sort(() => this.rand(3) - 1);
    const co: Checkout = { id: this.nextCheckout++, items, totalSen: total, paidSen: paid, options, at: this.clock() };
    this.checkouts.set(p.id, co);
    return { id: co.id, items, paidSen: paid, options };
  }

  /** The change you gave: right and in time → the sale plus the cashier bonus. */
  checkoutFinish(p: OnlinePlayer, id: number, changeSen: number) {
    const co = this.checkouts.get(p.id);
    if (!co || co.id !== id) throw new GameError('That customer left.');
    this.checkouts.delete(p.id);
    const s = this.shop(p);
    const r = this.bc.retail;
    const ms = this.clock() - co.at;
    if (ms < r.cashierMinMs) throw new GameError('Too fast: scan every item!');
    for (const it of co.items) {
      if ((s.stock[it.product] ?? 0) <= 0) throw new GameError('Out of stock.');
    }
    for (const it of co.items) s.stock[it.product]--;
    const correct = changeSen === co.paidSen - co.totalSen;
    const onTime = ms <= r.cashierMaxMs;
    const bonus = correct && onTime ? Math.round(co.totalSen * r.cashierBonus) : 0;
    const gain = Math.round((co.totalSen + bonus) * this.hooks.incomeMult(p)) - (correct ? 0 : Math.abs(changeSen - (co.paidSen - co.totalSen)));
    this.econ.run(p, () => this.econ.change(p, gain, 0, 'retail-checkout', null));
    s.earnedSen += gain;
    s.soldToday += co.items.length;
    p.prog.stats.checkouts = (p.prog.stats.checkouts ?? 0) + 1;
    if (correct && onTime) p.prog.stats.perfectCheckouts = (p.prog.stats.perfectCheckouts ?? 0) + 1;
    this.save(p);
    this.hooks.wallet(p, gain, 'retail');
    this.hooks.changed(p);
    return { correct, onTime, gainSen: gain, bonusSen: bonus };
  }
}
