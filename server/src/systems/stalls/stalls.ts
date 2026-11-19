// Food stalls on the server (spec §8.2). Everything that decides money happens here:
//  - customers arrive (a Poisson process: rate depends on tier, reputation, signage, meal-time
//    rush, the food blogger's buzz, skills and potions), queue, and leave when out of patience;
//  - the owner cooks a dish: the server builds the steps, the client plays them and sends raw
//    inputs, the server grades them (shared/cooking) and pays: base × quality × combo + tip;
//  - cooks (staff) serve the queue on their own at a share of the "Good" price (stalls.json →
//    staff.passiveRate), for an hourly wage;
//  - orders can come with paid add-ons (ayam goreng, telur mata...) that have their own stock;
//  - ingredients are bought as stock and go off after a few in-game days of play time.
// A stall runs live while its owner is online. Left open with cooks, it stays open while they're
// away, and the cooks' takings are worked out (real time, capped) when they log back in.
import {
  ageStock, customerRate, dayKey, dishPay, orderBaseSen, stockItems, dishQuality, gameTime, gradeStep, makeDish, masteryLevel, menuRecipes,
  queueCapacity, rushHour, staffPayRate, stallAssetSen, stallOpenNow, stockCount, stockPriceSen, takeStock, tierDef, upgradeCostSen, upgradeLevel,
  cashierBonus, validateDishInputs, wagePerHourSen, windowMult, staffCookMs, formatMoney, STALL_UPGRADES, restockNeeds, wholesalePackQty, wholesalePriceSen,
  type DishState, type RandInt, type ServeResult, type StallCustomer, type StallPublic, type StallSelf, type StallState, type StallUpgrade,
  type StepInput,
} from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { Repos } from '../../db/repos';
import type { OnlinePlayer, World } from '../../game/world';
import { GameError, type Economy } from '../economy/economy';
import type { ProgressionSystem } from '../progression/progression';

interface Dish {
  state: DishState;
  startedAt: number;
  deadline: number;
  customer: StallCustomer;
}

interface Live {
  owner: number;
  ownerName: string;
  s: StallState;
  queue: StallCustomer[];
  /** One entry per cook: who they're cooking for and when it's done. */
  cooks: Array<{ customer: StallCustomer; doneAt: number } | null>;
  dish: Dish | null;
  /** Stall open for business right now (owner online + switched on + within hours). */
  live: boolean;
  /** Cooks wait for their wages if the owner couldn't pay. */
  unpaid: boolean;
  lastTick: number;
  wageAcc: number;
  earned: { day: string; sen: number };
  dirtyPublic: boolean;
  dirtySelf: boolean;
  dirtySave: boolean;
  outOfStockWarned: boolean;
  /** Items we've already warned are running low (cleared when restocked). */
  lowWarned: Set<string>;
  /** Server ms the closing-up grace ends (0 = not closing). */
  closingUntil: number;
  /** Just moved to a bigger stall: until this server ms, lost customers don't cost reputation. */
  repGraceUntil: number;
}

export interface StallHooks {
  publicChanged: (stalls: StallPublic[]) => void;
  selfChanged: (p: OnlinePlayer, stall: StallSelf | null) => void;
  event: (p: OnlinePlayer, ev: { kind: 'staffServed' | 'staffSale' | 'lowStock' | 'lost' | 'blogger' | 'closed' | 'spoiled' | 'wagesUnpaid' | 'restocked'; text: string; sen?: number }) => void;
  wallet: (p: OnlinePlayer, delta: number, reason: string) => void;
  /** A stall is gone from its plot (rebirth). */
  removed?: (plot: string) => void;
}

const nextId = (() => {
  let n = 1;
  return () => n++;
})();

export class StallSystem {
  private stalls = new Map<number, Live>();
  /** Auto restock: when each stall last checked its stock. */
  private restockAt = new Map<number, number>();

  constructor(
    private readonly cfg: ServerConfig,
    private readonly repos: Repos,
    private readonly econ: Economy,
    private readonly prog: ProgressionSystem,
    private readonly world: World,
    private readonly rand: RandInt,
    private readonly hooks: StallHooks,
    private readonly clock: () => number = Date.now,
  ) {
    for (const r of repos.stalls.all()) this.stalls.set(r.owner, this.wrap(r.owner, r.ownerName, this.fromData(r.tier, r.plot, r.data)));
  }

  // ---------------------------------------------------------------- state helpers
  private fromData(tier: number, plot: string, d: Record<string, unknown>): StallState {
    const st = this.cfg.stalls;
    return {
      tier, plot,
      open: d.open !== false,
      rep: typeof d.rep === 'number' ? d.rep : st.reputation.start,
      upgrades: (d.upgrades as StallState['upgrades']) ?? {},
      staff: typeof d.staff === 'number' ? d.staff : 0,
      stock: (d.stock as StallState['stock']) ?? {},
      mastery: (d.mastery as StallState['mastery']) ?? {},
      combo: typeof d.combo === 'number' ? d.combo : 0,
      perfectTokens: typeof d.perfectTokens === 'number' ? d.perfectTokens : 0,
      investedSen: typeof d.investedSen === 'number' ? d.investedSen : 0,
      buzzUntil: 0,
    };
  }

  private wrap(owner: number, ownerName: string, s: StallState): Live {
    return {
      owner, ownerName, s, queue: [], cooks: [], dish: null, live: false, unpaid: false, lastTick: this.clock(), wageAcc: 0,
      earned: { day: '', sen: 0 }, dirtyPublic: true, dirtySelf: true, dirtySave: false, outOfStockWarned: false, lowWarned: new Set(), closingUntil: 0, repGraceUntil: 0,
    };
  }

  private save(l: Live) {
    const { tier, plot, buzzUntil: _b, ...rest } = l.s;
    this.repos.stalls.save(l.owner, tier, plot, rest);
    l.dirtySave = false;
  }

  private mine(p: OnlinePlayer): Live {
    const l = this.stalls.get(p.id);
    if (!l) throw new GameError("You don't have a stall yet. 📱 → Business to buy one.");
    return l;
  }

  get(ownerId: number) {
    return this.stalls.get(ownerId);
  }

  publicOf(l: Live): StallPublic {
    return { owner: l.owner, ownerName: l.ownerName, plot: l.s.plot, tier: l.s.tier, open: l.live || this.runsWhileAway(l), rep: Math.round(l.s.rep), staff: l.s.staff, queue: l.queue };
  }

  /** Left open with cooks when the owner logged off: it stays open (their cooks keep selling;
   *  the takings are worked out when they log back in, see offline()). */
  private runsWhileAway(l: Live): boolean {
    const p = this.world.get(l.owner);
    return (!p || !p.hasCharacter) && l.s.open && l.s.staff > 0 && Object.values(l.s.stock).some((b) => b.some((x) => x.qty > 0));
  }

  /**
   * Offline income (spec §8.7): the owner logs in after `awayMs` of real time (also counting time
   * the server was down). If they left the stall open with cooks, replay that time an in-game
   * hour at a time: customers come at the usual rate for that hour (rush, quiet hours…), the
   * cooks serve as many as they can and stock allows, at the offline rate, minus their wages.
   * Stock is used up but doesn't go off (it only ages during play time).
   * Capped at `capHours`. Returns null if the stall was closed or had no cooks.
   */
  offline(p: OnlinePlayer, awayMs: number, capHours: number, efficiency: number): { sen: number; dishes: number; wagesSen: number; soldOut: boolean; restockSen: number } | null {
    const l = this.stalls.get(p.id);
    if (!l || !l.s.open || l.s.staff <= 0 || awayMs < 60_000) return null;
    const st = this.cfg.stalls;
    const b = this.bonuses(p);
    const now = this.clock();
    const span = Math.min(awayMs, capHours * 3_600_000);
    const stepMs = 60 * this.cfg.time.realMsPerGameMinute; // one in-game hour
    const cookMs = staffCookMs(st, l.s, b);
    let pay = 0, wages = 0, dishes = 0, carry = 0, rr = 0, restockSen = 0;
    for (let t = now - span; t < now; t += stepMs) {
      const len = Math.min(stepMs, now - t);
      // Auto restock keeps going while you're away (paid from what you have plus what's earned).
      for (const n of restockNeeds(st, this.cfg.recipes.recipes, l.s)) {
        if (p.walletSen + Math.round((pay - wages) * efficiency) - restockSen < n.priceSen) continue;
        restockSen += n.priceSen;
        l.s.stock = { ...l.s.stock, [n.id]: [...(l.s.stock[n.id] ?? []), { qty: n.qty, age: 0 }] };
      }
      const menu = menuRecipes(st, this.cfg.recipes.recipes, l.s).filter((r) => stockCount(l.s, r.id) > 0);
      if (!menu.length) break; // sold out: the cooks go home
      const hourF = this.hourF(t);
      const rush = rushHour(this.cfg.time, hourF) !== null;
      const arrivals = (customerRate(st, l.s, rush, t, b, !stallOpenNow(st, l.s.tier, hourF)) / 60_000) * len;
      const capacity = (l.s.staff * len) / cookMs;
      carry += Math.min(arrivals, capacity);
      let n = Math.floor(carry);
      carry -= n;
      let served = 0;
      while (n-- > 0) {
        const left = menu.filter((r) => stockCount(l.s, r.id) > 0);
        if (!left.length) break;
        const r = left[rr++ % left.length];
        takeStock(l.s, r.id);
        l.s.mastery = { ...l.s.mastery, [r.id]: (l.s.mastery[r.id] ?? 0) + 1 }; // cooks build mastery offline too
        pay += Math.round(orderBaseSen(st, r, l.s, rush, [], b) * staffPayRate(st, l.s) * (1 + cashierBonus(st, l.s, b).tips * st.tips.max));
        served++;
      }
      dishes += served;
      if (l.s.rep < st.reputation.staffRepCap) l.s.rep = Math.min(st.reputation.staffRepCap, l.s.rep + st.reputation.perStaffDish * served);
      wages += (wagePerHourSen(st, l.s.tier, b) * l.s.staff * len) / stepMs;
      // Stock doesn't age while you're away (like online, it only ages during play time).
    }
    const income = Math.round(pay * efficiency);
    const wagesSen = Math.round(wages * efficiency);
    let net = income - wagesSen - restockSen; // auto restock is paid out of it too
    if (net < 0) net = -Math.min(-net, p.walletSen); // wages never push the wallet below zero
    if (net) {
      this.econ.run(p, () => this.econ.change(p, net, 0, 'stall-offline', `${dishes} dishes`));
      this.earn(l, Math.max(0, net));
    }
    this.prog.bump(p, 'staffDishes', dishes);
    if (income > 0) this.prog.bump(p, 'stallEarnSen', income);
    this.save(l);
    this.touch(l);
    const soldOut = !menuRecipes(st, this.cfg.recipes.recipes, l.s).some((r) => stockCount(l.s, r.id) > 0);
    return { sen: net, dishes, wagesSen, soldOut, restockSen };
  }

  all(): StallPublic[] {
    return [...this.stalls.values()].map((l) => this.publicOf(l));
  }

  selfOf(p: OnlinePlayer): StallSelf | null {
    const l = this.stalls.get(p.id);
    if (!l) return null;
    const today = dayKey(this.clock());
    return { ...l.s, stock: structuredClone(l.s.stock), earnedToday: l.earned.day === today ? l.earned.sen : 0 };
  }

  assetsOf(p: OnlinePlayer): number {
    return stallAssetSen(this.cfg.stalls, this.stalls.get(p.id)?.s);
  }

  private bonuses(p: OnlinePlayer) {
    return this.prog.mods(p).stall;
  }

  private hourF(now = this.clock()) {
    return gameTime(this.cfg.time, now).hourF;
  }

  private plotDef(id: string) {
    return this.cfg.map.stallPlots.find((x) => x.id === id);
  }

  /** Is the player standing at their stall? */
  private atStall(p: OnlinePlayer, l: Live) {
    const plot = this.plotDef(l.s.plot);
    const T = this.cfg.map.tileSize;
    return !!plot && Math.hypot(p.x / T - plot.x, p.y / T - plot.y) <= this.cfg.stalls.cookRadiusTiles;
  }

  private touch(l: Live, save = true) {
    l.dirtyPublic = true;
    l.dirtySelf = true;
    if (save) l.dirtySave = true;
  }

  private earn(l: Live, sen: number) {
    const today = dayKey(this.clock());
    if (l.earned.day !== today) l.earned = { day: today, sen: 0 };
    l.earned.sen += sen;
  }

  // ---------------------------------------------------------------- buying + managing
  /** Buy your first stall (tier 1) or move up to the next tier. */
  buy(p: OnlinePlayer, tier: number, plotId?: string) {
    const cur = this.stalls.get(p.id);
    const want = cur ? cur.s.tier + 1 : 1;
    if (tier !== want) throw new GameError(cur ? `Your next upgrade is the ${tierDef(this.cfg.stalls, want).name}.` : 'Start with a pasar malam stall.');
    const def = this.cfg.stalls.tiers.find((t) => t.tier === tier);
    if (!def) throw new GameError("That's the best there is!");
    if (def.requires.stage && p.prog.stage < def.requires.stage) throw new GameError(`${def.name} needs wealth stage ${def.requires.stage}.`);
    if (def.requires.level && p.prog.level < def.requires.level) throw new GameError(`${def.name} needs Level ${def.requires.level}.`);
    if (p.walletSen < def.priceSen) throw new GameError(`${def.name} costs ${formatMoney(def.priceSen)}.`);
    const plot = this.pickPlot(tier, plotId);
    if (cur?.dish) throw new GameError('Finish the dish you are cooking first.');
    const l = cur ?? this.wrap(p.id, p.name, this.fromData(tier, plot.id, {}));
    this.econ.run(p, () => {
      this.econ.change(p, -def.priceSen, 0, 'stall-buy', `${def.id}:${plot.id}`);
      l.s.tier = tier;
      l.s.plot = plot.id;
      l.s.investedSen += def.priceSen;
      // A brand-new stall comes with a few portions to get going.
      if (!cur) {
        const first = this.cfg.recipes.recipes[0];
        l.s.stock = { [first.id]: [{ qty: 10, age: 0 }] };
        for (const a of first.addons.slice(0, 2)) l.s.stock[a.id] = [{ qty: 4, age: 0 }];
      }
      this.save(l);
    });
    if (cur) {
      // Moving: the old queue stays behind, and a short grace while you settle in (cooks to
      // re-hire, a bigger crowd) so lost customers don't wreck your reputation.
      cur.queue = [];
      cur.cooks = [];
      cur.repGraceUntil = this.clock() + this.cfg.stalls.reputation.moveGraceSec * 1000;
    }
    this.stalls.set(p.id, l);
    this.hooks.wallet(p, -def.priceSen, 'stall');
    this.prog.max(p, 'stallTier', tier);
    this.touch(l);
    this.flush();
    this.prog.check(p);
  }

  /** A free spot of this tier: the one asked for, or a random one. */
  private pickPlot(tier: number, plotId?: string) {
    const def = tierDef(this.cfg.stalls, tier);
    const taken = new Set([...this.stalls.values()].map((x) => x.s.plot));
    if (plotId) {
      const plot = this.cfg.map.stallPlots.find((x) => x.id === plotId);
      if (!plot || plot.tier !== tier) throw new GameError(`That isn't a ${def.name} spot.`);
      if (taken.has(plot.id)) throw new GameError('Someone already has that spot.');
      return plot;
    }
    const free = this.cfg.map.stallPlots.filter((x) => x.tier === tier && !taken.has(x.id));
    if (!free.length) throw new GameError(`All the ${def.name} spots are taken.`);
    return free[this.rand(free.length)];
  }

  /** Move your stall to another free spot of the same tier: only the moving fee (you keep
   *  everything: stock, staff, upgrades, reputation; the queue stays behind). */
  move(p: OnlinePlayer, plotId?: string): { plot: string; feeSen: number } {
    const l = this.mine(p);
    if (l.dish) throw new GameError('Finish the dish you are cooking first.');
    if (plotId === l.s.plot) throw new GameError("You're already there.");
    const def = tierDef(this.cfg.stalls, l.s.tier);
    const plot = this.pickPlot(l.s.tier, plotId);
    const fee = def.moveFeeSen;
    if (p.walletSen < fee) throw new GameError(`Moving costs ${formatMoney(fee)}.`);
    const from = l.s.plot;
    this.econ.run(p, () => {
      if (fee) this.econ.change(p, -fee, 0, 'stall-move', `${from}>${plot.id}`);
      l.s.plot = plot.id;
      this.save(l);
    });
    l.queue = [];
    l.cooks = l.cooks.map(() => null);
    l.repGraceUntil = this.clock() + this.cfg.stalls.reputation.moveGraceSec * 1000;
    this.hooks.removed?.(from);
    if (fee) this.hooks.wallet(p, -fee, 'stall');
    this.touch(l);
    this.flush();
    return { plot: plot.id, feeSen: fee };
  }

  setOpen(p: OnlinePlayer, open: boolean) {
    const l = this.mine(p);
    l.s.open = open;
    // Switching off starts the closing grace in the next tick (the queue is served, then it closes).
    this.touch(l);
    this.flush();
  }

  upgrade(p: OnlinePlayer, key: StallUpgrade) {
    const l = this.mine(p);
    const def = this.cfg.stalls.upgrades[key];
    if (!def) throw new GameError('Unknown upgrade.');
    const lv = upgradeLevel(l.s, key);
    if (lv >= def.maxLevel) throw new GameError(`${def.name} is maxed out.`);
    const cost = upgradeCostSen(this.cfg.stalls, l.s.tier, key, lv);
    if (p.walletSen < cost) throw new GameError(`${def.name} Lv ${lv + 1} costs ${formatMoney(cost)}.`);
    this.econ.run(p, () => {
      this.econ.change(p, -cost, 0, 'stall-upgrade', `${key}:${lv + 1}`);
      l.s.upgrades = { ...l.s.upgrades, [key]: lv + 1 };
      l.s.investedSen += cost;
      this.save(l);
    });
    this.hooks.wallet(p, -cost, 'stall');
    this.touch(l);
    this.flush();
    this.prog.check(p); // net worth includes the stall
  }

  hire(p: OnlinePlayer) {
    const l = this.mine(p);
    const t = tierDef(this.cfg.stalls, l.s.tier);
    if (l.s.staff >= t.staffMax) throw new GameError(`A ${t.name} has room for ${t.staffMax} cook${t.staffMax === 1 ? '' : 's'}.`);
    if (p.walletSen < t.hireSen) throw new GameError(`Hiring a cook costs ${formatMoney(t.hireSen)}.`);
    this.econ.run(p, () => {
      this.econ.change(p, -t.hireSen, 0, 'stall-hire', String(l.s.staff + 1));
      l.s.staff++;
      this.save(l);
    });
    this.hooks.wallet(p, -t.hireSen, 'stall');
    this.prog.bump(p, 'staffHired');
    l.unpaid = false;
    this.touch(l);
    this.flush();
    this.prog.check(p);
  }

  fire(p: OnlinePlayer) {
    const l = this.mine(p);
    if (l.s.staff <= 0) throw new GameError('You have no cooks.');
    l.s.staff--;
    const busy = l.cooks.pop();
    if (busy) busy.customer.serving = null;
    this.touch(l);
    this.save(l);
    this.flush();
  }

  /** Buy a pack of ingredients: in person at the hypermarket, or delivered (costs extra). */
  buyStock(p: OnlinePlayer, recipeId: string, qty: number, delivery: boolean) {
    const l = this.mine(p);
    // A dish's ingredients, or one of its add-ons.
    const all = this.cfg.recipes.recipes.flatMap((r) => [{ id: r.id, name: r.name, ingredientCostSen: r.ingredientCostSen }, ...r.addons]);
    const recipe = all.find((x) => x.id === recipeId);
    if (!recipe) throw new GameError('Unknown recipe.');
    if (!stockItems(this.cfg.stalls, this.cfg.recipes.recipes, l.s).some((r) => r.id === recipeId)) throw new GameError(`${recipe.name} isn't on your menu yet.`);
    const price = stockPriceSen(this.cfg.stalls, recipe, l.s, qty, delivery);
    if (!Number.isFinite(price)) throw new GameError('Pick a pack size.');
    if (stockCount(l.s, recipeId) + qty > this.cfg.stalls.stock.maxPerRecipe) throw new GameError(`You can keep up to ${this.cfg.stalls.stock.maxPerRecipe} portions of each dish.`);
    if (p.walletSen < price) throw new GameError(`That's ${formatMoney(price)}.`);
    this.econ.run(p, () => {
      this.econ.change(p, -price, 0, 'stall-stock', `${recipeId}x${qty}${delivery ? ':delivery' : ''}`);
      l.s.stock = { ...l.s.stock, [recipeId]: [...(l.s.stock[recipeId] ?? []), { qty, age: 0 }] };
      this.save(l);
    });
    l.outOfStockWarned = false;
    this.hooks.wallet(p, -price, 'stock');
    this.prog.bump(p, 'stockBought', qty);
    this.touch(l);
    this.flush();
    this.prog.check(p);
  }

  /** Buy all (in person at the hypermarket): a wholesale pack of every dish and add-on on the
   *  menu, at the biggest pack's discount, up to the stock limit. Buys what you can afford. */
  buyStockAll(p: OnlinePlayer): { portions: number; spentSen: number; skipped: number } {
    const l = this.mine(p);
    const st = this.cfg.stalls;
    let portions = 0, spentSen = 0, skipped = 0;
    this.econ.run(p, () => {
      for (const it of stockItems(st, this.cfg.recipes.recipes, l.s)) {
        const qty = Math.min(wholesalePackQty(st), st.stock.maxPerRecipe - stockCount(l.s, it.id));
        if (qty <= 0) continue;
        const price = wholesalePriceSen(st, it, l.s, qty);
        if (p.walletSen < price) {
          skipped++;
          continue;
        }
        this.econ.change(p, -price, 0, 'stall-stock', `${it.id}x${qty}:all`);
        l.s.stock = { ...l.s.stock, [it.id]: [...(l.s.stock[it.id] ?? []), { qty, age: 0 }] };
        portions += qty;
        spentSen += price;
      }
      this.save(l);
    });
    if (!portions) throw new GameError(skipped ? "You can't afford any wholesale packs right now." : 'Your shelves are full.');
    l.outOfStockWarned = false;
    this.hooks.wallet(p, -spentSen, 'stock');
    this.prog.bump(p, 'stockBought', portions);
    this.touch(l);
    this.flush();
    this.prog.check(p);
    return { portions, spentSen, skipped };
  }

  /** Auto restock (upgrade): the supplier tops up anything at a quarter of the target or less. */
  private autoRestock(p: OnlinePlayer, l: Live) {
    const needs = restockNeeds(this.cfg.stalls, this.cfg.recipes.recipes, l.s);
    let spent = 0;
    const names: string[] = [];
    for (const n of needs) {
      if (p.walletSen < n.priceSen) continue;
      try {
        this.econ.run(p, () => {
          this.econ.change(p, -n.priceSen, 0, 'stall-restock', `${n.id}x${n.qty}`);
          l.s.stock = { ...l.s.stock, [n.id]: [...(l.s.stock[n.id] ?? []), { qty: n.qty, age: 0 }] };
        });
        spent += n.priceSen;
        names.push(`${n.qty} ${n.name}`);
      } catch {
        /* can't afford: try again later */
      }
    }
    if (!spent) return;
    l.outOfStockWarned = false;
    this.save(l);
    this.hooks.wallet(p, -spent, 'stock');
    this.hooks.event(p, { kind: 'restocked', text: `🔄 Auto restock: ${names.join(', ')} (${formatMoney(spent)})`, sen: -spent });
    this.touch(l);
  }

  /** Mastery from a cook's dish (with the level-up note). */
  private addMastery(p: OnlinePlayer, l: Live, recipeId: string, n: number) {
    const st = this.cfg.stalls;
    const before = masteryLevel(st, l.s.mastery[recipeId] ?? 0);
    l.s.mastery = { ...l.s.mastery, [recipeId]: (l.s.mastery[recipeId] ?? 0) + n };
    const after = masteryLevel(st, l.s.mastery[recipeId]);
    if (after > before) {
      const name = this.cfg.recipeById.get(recipeId)?.name ?? recipeId;
      this.hooks.event(p, { kind: 'staffServed', text: `⭐ ${name} mastery ${after}! Prices up.` });
      this.prog.check(p);
    }
  }

  /** Perfect Cook Token: the next N dishes are auto-Perfect. */
  addPerfectTokens(p: OnlinePlayer, n: number) {
    const l = this.mine(p);
    l.s.perfectTokens += n;
    this.touch(l);
    this.save(l);
    this.flush();
  }

  // ---------------------------------------------------------------- cooking (active mode)
  cook(p: OnlinePlayer, customerId: number | undefined, useToken: boolean): { dish: DishState | null; served?: ServeResult } {
    const l = this.mine(p);
    if (!l.live) throw new GameError(this.closedReason(l));
    if (!this.atStall(p, l)) throw new GameError('Walk to your stall to cook.');
    if (l.dish) throw new GameError("You're already cooking!");
    const waiting = l.queue.filter((c) => !c.serving);
    const customer = customerId !== undefined ? waiting.find((c) => c.id === customerId) : waiting[0];
    if (!customer) throw new GameError('No one is waiting. Customers come when the stall is open and has stock.');
    const recipe = this.cfg.recipeById.get(customer.recipe)!;
    if (useToken && l.s.perfectTokens <= 0) throw new GameError('You have no Perfect Cook Tokens.');
    if (!takeStock(l.s, recipe.id)) throw new GameError(`Out of ${recipe.name} ingredients! 📱 → Business → Stock.`);
    this.takeAddons(l, customer);
    customer.serving = 'owner';
    if (useToken) {
      l.s.perfectTokens--;
      const served = this.finish(p, l, customer, recipe.id, recipe.steps.map(() => 'perfect'));
      return { dish: null, served };
    }
    const steps = makeDish(recipe, this.rand, customer.addons ?? []);
    const now = this.clock();
    const state: DishState = {
      dishId: `dish-${now.toString(36)}-${this.rand(1e6).toString(36)}`, recipe: recipe.id, customerId: customer.id, steps,
      windowMult: windowMult(this.cfg.stalls, l.s), blogger: customer.blogger,
    };
    const budget = steps.reduce((a, s) => a + s.maxMs, 0);
    l.dish = { state, startedAt: now, deadline: now + budget + this.cfg.stalls.dishTimeoutSlackSec * 1000, customer };
    this.touch(l);
    this.flush();
    return { dish: state };
  }

  serve(p: OnlinePlayer, dishId: string, inputs: StepInput[]): ServeResult {
    const l = this.mine(p);
    const d = l.dish;
    if (!d || d.state.dishId !== dishId) throw new GameError('That dish is gone (it took too long?).');
    const elapsed = this.clock() - d.startedAt;
    const bad = validateDishInputs(d.state.steps, inputs, elapsed);
    const grades = bad
      ? d.state.steps.map(() => 'miss' as const)
      : d.state.steps.map((s, i) => gradeStep(this.cfg.recipes, s, inputs[i].ev, d.state.windowMult).grade);
    l.dish = null;
    return this.finish(p, l, d.customer, d.state.recipe, grades);
  }

  /** Start the dish over: a fresh set of steps for the same customer. Free: the ingredients
   *  are reused, the combo is kept, the clock restarts. */
  redo(p: OnlinePlayer): DishState {
    const l = this.mine(p);
    const d = l.dish;
    if (!d) throw new GameError("You're not cooking anything.");
    const recipe = this.cfg.recipeById.get(d.state.recipe)!;
    const now = this.clock();
    const steps = makeDish(recipe, this.rand, d.customer.addons ?? []);
    const state: DishState = { ...d.state, dishId: `dish-${now.toString(36)}-${this.rand(1e6).toString(36)}`, steps };
    const budget = steps.reduce((a, s) => a + s.maxMs, 0);
    l.dish = { state, startedAt: now, deadline: now + budget + this.cfg.stalls.dishTimeoutSlackSec * 1000, customer: d.customer };
    return state;
  }

  cancel(p: OnlinePlayer) {
    const l = this.mine(p);
    if (!l.dish) return;
    // The ingredients are used up; the customer goes back to waiting.
    l.dish.customer.serving = null;
    l.dish = null;
    l.s.combo = 0;
    this.touch(l);
    this.flush();
  }

  /** Pay for a dish the owner cooked (graded steps → quality → money, reputation, mastery). */
  private finish(p: OnlinePlayer, l: Live, customer: StallCustomer, recipeId: string, grades: Array<'perfect' | 'great' | 'good' | 'miss'>): ServeResult {
    const st = this.cfg.stalls;
    const recipe = this.cfg.recipeById.get(recipeId)!;
    const q = dishQuality(this.cfg.recipes, grades);
    const now = this.clock();
    const rush = rushHour(this.cfg.time, this.hourF(now)) !== null;
    const b = this.bonuses(p);
    const base = orderBaseSen(st, recipe, l.s, rush, customer.addons ?? [], b);
    // Combo: each Perfect in a row adds a bit (applies from the next dish).
    const combo = l.s.combo;
    const patienceLeft = 1 - (now - customer.arrivedAt) / customer.patienceMs;
    const dp = dishPay(st, base, q.mult, q.quality, combo, patienceLeft, customer.blogger);
    const paySen = dp.paySen;
    const tipSen = Math.round(dp.tipSen * (1 + cashierBonus(st, l.s, b).tips)); // a good cashier gets bigger tips
    l.s.combo = q.quality === 'perfect' ? Math.min(st.combo.max, combo + st.combo.perPerfect) : 0;
    const repDelta = st.reputation.perQuality[q.quality as keyof typeof st.reputation.perQuality] ?? 0;
    l.s.rep = Math.max(0, Math.min(st.reputation.max, l.s.rep + repDelta));
    if (customer.blogger) {
      const happy = q.quality === 'perfect' || q.quality === 'great';
      l.s.rep = Math.max(0, Math.min(st.reputation.max, l.s.rep + (happy ? st.blogger.repBonus : -st.blogger.repPenalty)));
      if (happy) {
        l.s.buzzUntil = now + st.blogger.boostGameHours * 60 * this.cfg.time.realMsPerGameMinute;
        this.prog.bump(p, 'bloggers');
      }
    }
    const before = masteryLevel(st, l.s.mastery[recipeId] ?? 0);
    l.s.mastery = { ...l.s.mastery, [recipeId]: (l.s.mastery[recipeId] ?? 0) + 1 };
    l.queue = l.queue.filter((c) => c.id !== customer.id);
    const total = paySen + tipSen;
    this.econ.run(p, () => {
      this.econ.change(p, total, 0, 'stall-dish', `${recipeId}:${q.quality}${customer.blogger ? ':blogger' : ''}`);
      this.save(l);
    });
    this.earn(l, total);
    this.hooks.wallet(p, total, 'stall');
    this.prog.bump(p, 'dishes');
    this.prog.bump(p, `dishes_${recipeId}`);
    if (q.quality === 'perfect') this.prog.bump(p, 'perfectDishes');
    this.prog.bump(p, 'stallEarnSen', total);
    this.prog.addXp(p, this.cfg.levels.xp.dish + (q.quality === 'perfect' ? this.cfg.levels.xp.dishPerfectBonus : 0));
    if (masteryLevel(st, l.s.mastery[recipeId]) > before) this.hooks.event(p, { kind: 'staffServed', text: `⭐ ${recipe.name} mastery ${masteryLevel(st, l.s.mastery[recipeId])}! Prices up.` });
    this.touch(l);
    this.flush();
    this.prog.check(p);
    return { quality: q.quality, grades, paidSen: paySen, tipSen, combo: l.s.combo, rep: Math.round(l.s.rep) };
  }

  /** Add-ons a new customer asks for: each one in stock (not already promised to someone in
   *  the queue) with the recipe's chance, up to its max per order. */
  private pickAddons(l: Live, recipeId: string): string[] {
    const recipe = this.cfg.recipeById.get(recipeId);
    if (!recipe?.addons.length || recipe.maxAddons <= 0) return [];
    const promised = new Map<string, number>();
    for (const c of l.queue) if (!c.serving) for (const a of c.addons ?? []) promised.set(a, (promised.get(a) ?? 0) + 1);
    const pool = recipe.addons.filter((a) => stockCount(l.s, a.id) - (promised.get(a.id) ?? 0) > 0);
    const out: string[] = [];
    while (pool.length && out.length < recipe.maxAddons) {
      const a = pool.splice(this.rand(pool.length), 1)[0];
      if (this.rand(1_000_000) / 1_000_000 < recipe.addonChance) out.push(a.id);
    }
    return out;
  }

  /** Uses up the order's add-ons; ones that ran out are dropped from the order (and the bill). */
  private takeAddons(l: Live, c: StallCustomer) {
    if (!c.addons?.length) return;
    c.addons = c.addons.filter((a) => takeStock(l.s, a));
    if (!c.addons.length) delete c.addons;
  }

  private closedReason(l: Live): string {
    if (!l.s.open) return 'Your stall is closed. Open it first.';
    return 'Your stall is closed right now.';
  }

  // ---------------------------------------------------------------- the simulation tick
  /** Customers clear off and cooks stop (owner left, closed, or hours over). */
  private closeUp(p: OnlinePlayer | undefined, l: Live, announce: boolean) {
    l.queue = [];
    l.cooks = [];
    if (l.dish) {
      l.dish = null;
      l.s.combo = 0;
    }
    if (l.live && announce && p) this.hooks.event(p, { kind: 'closed', text: `🌙 Your ${tierDef(this.cfg.stalls, l.s.tier).name} closed for the night.` });
    l.live = false;
    this.touch(l, false);
  }

  /** Runs every stall (call ~4×/s). */
  tick(now = this.clock()) {
    const hourF = this.hourF(now);
    const rush = rushHour(this.cfg.time, hourF) !== null;
    for (const l of this.stalls.values()) {
      const p = this.world.get(l.owner);
      const dt = Math.min(5000, Math.max(0, now - l.lastTick));
      l.lastTick = now;
      // Open whenever the owner switches it on; outside the usual hours it's just quieter.
      const shouldBeLive = !!p && p.hasCharacter && l.s.open;
      const offHours = !stallOpenNow(this.cfg.stalls, l.s.tier, hourF);
      // Switching off doesn't slam the shutters: for a short grace no one new comes, waiting
      // customers can still be served, and anything already cooking is finished.
      let closing = false;
      if (!shouldBeLive) {
        if (!l.live && !l.queue.length) continue;
        if (!p || !p.hasCharacter) {
          this.closeUp(p, l, false);
          continue;
        }
        if (!l.closingUntil) {
          l.closingUntil = now + this.cfg.stalls.closingGraceSec * 1000;
          this.hooks.event(p, { kind: 'closed', text: `🌙 Closing up: ${this.cfg.stalls.closingGraceSec} s to finish the orders in your queue.` });
        }
        const busy = !!l.dish || l.cooks.some((c) => !!c);
        if (now >= l.closingUntil) {
          if (!busy) {
            l.closingUntil = 0;
            this.closeUp(p, l, true);
            continue;
          }
          // Time's up: whoever's still waiting goes home (no hard feelings); orders in progress finish.
          const before = l.queue.length;
          l.queue = l.queue.filter((c) => c.serving);
          if (l.queue.length !== before) this.touch(l);
        }
        closing = true;
      } else l.closingUntil = 0;
      if (!l.live) {
        l.live = true;
        this.touch(l, false);
      }
      const owner = p!;
      const st = this.cfg.stalls;
      const b = this.bonuses(owner);

      // Stock ages (play time only); spoiled stock is thrown away.
      const gameMin = dt / this.cfg.time.realMsPerGameMinute;
      const spoiled = ageStock(st, l.s, gameMin);
      if (spoiled > 0) {
        this.hooks.event(owner, { kind: 'spoiled', text: `🗑️ ${spoiled} portions of ingredients went off.` });
        this.touch(l);
      }
      // Auto restock (upgrade): every few seconds, top up what's running low.
      if (now - (this.restockAt.get(l.owner) ?? 0) >= 5000) {
        this.restockAt.set(l.owner, now);
        this.autoRestock(owner, l);
      }

      // A dish left too long is thrown away; the customer leaves unhappy.
      if (l.dish && now > l.dish.deadline) {
        const c = l.dish.customer;
        l.dish = null;
        l.s.combo = 0;
        l.queue = l.queue.filter((x) => x.id !== c.id);
        if (now >= l.repGraceUntil) l.s.rep = Math.max(0, l.s.rep + st.reputation.lostCustomer);
        this.touch(l);
      }

      // Customers who run out of patience leave (not the ones being served).
      const before = l.queue.length;
      const lost = l.queue.filter((c) => !c.serving && now > c.arrivedAt + c.patienceMs);
      if (lost.length) {
        l.queue = l.queue.filter((c) => !lost.includes(c));
        if (now >= l.repGraceUntil) l.s.rep = Math.max(0, l.s.rep + st.reputation.lostCustomer * lost.length);
        this.prog.bump(owner, 'customersLost', lost.length);
        this.hooks.event(owner, { kind: 'lost', text: `😤 ${lost.length === 1 ? 'A customer' : `${lost.length} customers`} gave up waiting.` });
      }

      // Heads-up when something on the menu is running low (once, until you restock it).
      for (const it of stockItems(st, this.cfg.recipes.recipes, l.s)) {
        const n = stockCount(l.s, it.id);
        if (n > st.stock.lowWarn) l.lowWarned.delete(it.id);
        else if (n > 0 && !l.lowWarned.has(it.id)) {
          l.lowWarned.add(it.id);
          this.hooks.event(owner, { kind: 'lowStock', text: `📦 Running low: ${it.icon} ${it.name} (${n} left). 📱 → Business → Stock.` });
        }
      }

      // New customers: they only come for dishes you have ingredients for.
      const menu = menuRecipes(st, this.cfg.recipes.recipes, l.s).filter((r) => stockCount(l.s, r.id) > 0);
      if (!menu.length) {
        if (!l.outOfStockWarned) {
          l.outOfStockWarned = true;
          this.hooks.event(owner, { kind: 'lost', text: '📦 Out of ingredients: no one can order. 📱 → Business → Stock.' });
        }
      } else if (!closing && l.queue.length < queueCapacity(st, l.s, rush)) {
        const perMs = customerRate(st, l.s, rush, now, b, offHours) / 60_000;
        if (this.rand(1_000_000) / 1_000_000 < perMs * dt) {
          const tier = tierDef(st, l.s.tier);
          const blogger = l.s.rep >= st.blogger.minReputation && this.rand(1_000_000) / 1_000_000 < st.blogger.chance;
          const [p0, p1] = tier.patienceSec;
          const recipe = menu[this.rand(menu.length)];
          const addons = this.pickAddons(l, recipe.id);
          l.queue.push({
            id: nextId(), seed: this.rand(1 << 30), recipe: recipe.id, ...(addons.length ? { addons } : {}), arrivedAt: now,
            patienceMs: Math.round((p0 + (p1 - p0) * (this.rand(1000) / 1000)) * 1000 * (1 + cashierBonus(st, l.s, b).patience)), blogger, serving: null,
          });
          if (blogger) this.hooks.event(owner, { kind: 'blogger', text: `📸 A food blogger is in your queue! Cook them something Great (${st.blogger.payMult}× pay)${l.s.staff ? ', or your cooks will serve them in a bit' : ''}.` });
        }
      }

      // Cooks: each free cook takes the next waiting customer; finished dishes pay out.
      while (l.cooks.length < l.s.staff) l.cooks.push(null);
      l.cooks.length = l.s.staff;
      let staffSen = 0;
      let staffDishes = 0;
      let staffBloggers = 0;
      for (let i = 0; i < l.cooks.length; i++) {
        const c = l.cooks[i];
        if (c && now >= c.doneAt) {
          const recipe = this.cfg.recipeById.get(c.customer.recipe)!;
          // Cooks make "Good" food at the passive rate: no combo, no tips. A food blogger they
          // serve pays a little extra (not the boss's 5×) and leaves reputation as it is.
          const blog = c.customer.blogger ? st.blogger.staffPayMult : 1;
          if (c.customer.blogger) staffBloggers++;
          const sale = orderBaseSen(st, recipe, l.s, rush, c.customer.addons ?? [], b) * staffPayRate(st, l.s) * blog;
          // The cashier collects tips on your cooks' sales too.
          staffSen += Math.round(sale * (1 + cashierBonus(st, l.s, b).tips * st.tips.max));
          staffDishes++;
          // Your cooks' dishes count towards recipe mastery too (you don't have to cook by hand).
          this.addMastery(owner, l, recipe.id, 1);
          l.queue = l.queue.filter((x) => x.id !== c.customer.id);
          l.cooks[i] = null;
        }
        if (!l.cooks[i] && !l.unpaid && !(closing && now >= l.closingUntil)) {
          // Food bloggers: the boss gets first go; once one has waited a while, a cook serves
          // them (so they don't walk off and hurt your reputation).
          const next = l.queue.find((x) => !x.serving && (!x.blogger || now - x.arrivedAt >= x.patienceMs * st.blogger.staffWaitShare) && stockCount(l.s, x.recipe) > 0);
          if (next && takeStock(l.s, next.recipe)) {
            this.takeAddons(l, next);
            next.serving = 'staff';
            l.cooks[i] = { customer: next, doneAt: now + staffCookMs(st, l.s, b) };
          }
        }
      }
      if (staffSen > 0) {
        try {
          this.econ.run(owner, () => this.econ.change(owner, staffSen, 0, 'stall-staff', `${staffDishes}`));
          this.earn(l, staffSen);
          // Your cooks' steady service slowly rebuilds reputation, but only up to a point:
          // the top stars need the boss's own Great and Perfect dishes.
          const r = st.reputation;
          if (l.s.rep < r.staffRepCap) l.s.rep = Math.min(r.staffRepCap, l.s.rep + r.perStaffDish * staffDishes);
          this.hooks.wallet(owner, staffSen, 'stall-staff');
          this.hooks.event(owner, { kind: 'staffSale', text: staffBloggers ? `📸 Your cook served the food blogger (no bad review)${staffDishes > staffBloggers ? ` and ${staffDishes - staffBloggers} more` : ''}` : `🧑‍🍳 Your cook sold ${staffDishes === 1 ? 'a dish' : `${staffDishes} dishes`}`, sen: staffSen });
          this.prog.bump(owner, 'staffDishes', staffDishes);
          this.prog.bump(owner, 'stallEarnSen', staffSen);
        } catch {
          /* never fails: income */
        }
      }

      // Wages: per cook per in-game hour worked.
      if (l.s.staff > 0) {
        l.wageAcc += gameMin;
        if (l.wageAcc >= 60) {
          l.wageAcc -= 60;
          const wage = wagePerHourSen(st, l.s.tier, b) * l.s.staff;
          try {
            this.econ.run(owner, () => this.econ.change(owner, -wage, 0, 'stall-wages', `${l.s.staff}`));
            this.hooks.wallet(owner, -wage, 'wages');
            l.unpaid = false;
          } catch {
            if (!l.unpaid) this.hooks.event(owner, { kind: 'wagesUnpaid', text: `💸 You can't pay your cooks (${formatMoney(wage)}/hour). They've stopped working.`, sen: wage });
            l.unpaid = true;
          }
        }
      }

      if (lost.length || l.queue.length !== before || staffDishes) this.touch(l);
      if (staffDishes) this.prog.check(owner);
    }
    this.flush();
  }

  /** Sends what changed: public stall state to everyone, private state to owners. */
  flush() {
    const changed: StallPublic[] = [];
    for (const l of this.stalls.values()) {
      if (l.dirtyPublic) {
        changed.push(this.publicOf(l));
        l.dirtyPublic = false;
      }
      if (l.dirtySelf) {
        const p = this.world.get(l.owner);
        if (p) this.hooks.selfChanged(p, this.selfOf(p));
        l.dirtySelf = false;
      }
    }
    if (changed.length) this.hooks.publicChanged(changed);
  }

  /** Save stalls with unsaved changes (call every few seconds and on shutdown). */
  saveDirty(force = false) {
    for (const l of this.stalls.values()) if (l.dirtySave || force) this.save(l);
  }

  /** Rebirth: the stall is gone (its plot is free again). */
  remove(p: OnlinePlayer) {
    const l = this.stalls.get(p.id);
    if (!l) return;
    this.closeUp(p, l, false);
    this.stalls.delete(p.id);
    this.repos.stalls.delete(p.id);
    this.hooks.removed?.(l.s.plot);
    this.hooks.selfChanged(p, null);
  }

  /** The owner left: close up and save. */
  leave(p: OnlinePlayer) {
    const l = this.stalls.get(p.id);
    if (!l) return;
    this.closeUp(undefined, l, false);
    this.save(l);
    this.flush();
  }

  /** For the Business app / tests: list of upgrades with costs. */
  static upgradeKeys = STALL_UPGRADES;
}
