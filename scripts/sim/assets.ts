// The balance simulator's model of everything beyond jobs: the food stall (cooking yourself and
// hired cooks), homes (rent) and Ventures (idle businesses), with offline income between
// sessions. It uses the REAL shared formulas (prices, customer rates, cook speed, wages, fair
// rent, business income and costs) but not the full server systems (those need a map, a clock
// and sockets), so it's an estimate of a sensible player, not a replay.
import {
  customerRate, dishBaseSen, fairRentSen, incomePerHourSen, levelCostSen, managerCostSen, masteryLevel, menuRecipes, staffCookMs, staffPayRate,
  tierDef, upgradeCostSen, wagePerHourSen, type StallState, type StallUpgrade,
} from '@kh/shared';
import type { ServerConfig } from '../../server/src/config/loadConfig';
import type { OnlinePlayer } from '../../server/src/game/world';
import type { Economy } from '../../server/src/systems/economy/economy';
import type { ProgressionSystem } from '../../server/src/systems/progression/progression';

/** Assumptions about how a decent player runs their assets. */
export const ASSET_HANDS = {
  /** Seconds per dish when you cook yourself (all the mini-game steps + serving). */
  cookSec: 13,
  /** Quality mix when you cook: Perfect / Great / Good (the rest of the multiplier table). */
  quality: { perfect: 0.3, great: 0.45, good: 0.25 },
  /** Average combo bonus and the tip share on Great+ dishes (paid on patience left). */
  combo: 0.08,
  tipShare: 0.5,
  /** Ingredients are bought in 50-packs (10% off) in person. */
  stockDiscount: 0.1,
  /** Share of a home's days with a paying tenant (finding one, the odd late payment). */
  occupancy: 0.85,
  /** Airbnb-ish furnishing: the rating used for fair rent. */
  homeStars: 2.5,
  /** Spend at most this share of the wallet on one purchase of each kind. */
  spend: { stallTier: 0.8, staff: 0.4, upgrade: 0.15, home: 0.7, venture: 0.35, manager: 0.3 },
  /** Stall upgrades the player buys, in order of preference. */
  upgrades: ['level', 'signage', 'training', 'supplier', 'equipment', 'restock'] as StallUpgrade[],
};

export type Book = (src: string, sen: number) => void;

export class AssetModel {
  stall: (Pick<StallState, 'tier' | 'rep' | 'upgrades' | 'buzzUntil' | 'mastery' | 'staff' | 'investedSen'>) | null = null;
  homes: Array<{ type: string; paidSen: number; valueSen: number }> = [];
  ventures: Record<string, { level: number; manager: boolean }> = {};
  /** Fractional sen carried between ticks. */
  private carry: Record<string, number> = {};

  constructor(
    private cfg: ServerConfig,
    private p: OnlinePlayer,
    private econ: Economy,
    private prog: ProgressionSystem,
    private book: Book,
  ) {}

  /** Net worth from assets (same rates as the server). */
  value(): number {
    const st = this.stall ? Math.floor(this.stall.investedSen * this.cfg.stalls.assetValueRate) : 0;
    const homes = this.homes.reduce((a, h) => a + Math.floor(h.valueSen * this.cfg.properties.assetValueRate), 0);
    let biz = 0;
    for (const [id, b] of Object.entries(this.ventures)) {
      const t = this.cfg.businesses.types.find((x) => x.id === id)!;
      biz += levelCostSen(this.cfg.businesses, t, 0, b.level) * 0.5 + (b.manager ? managerCostSen(this.cfg.businesses, t) * 0.5 : 0);
    }
    return st + homes + Math.round(biz);
  }

  private pay(src: string, reason: string, sen: number) {
    this.carry[src] = (this.carry[src] ?? 0) + sen;
    const whole = Math.trunc(this.carry[src]);
    if (!whole) return;
    if (whole < 0 && this.p.walletSen + whole < 0) return; // never below zero (like wages)
    this.carry[src] -= whole;
    this.econ.run(this.p, () => this.econ.change(this.p, whole, 0, reason));
    this.book(src, whole);
  }

  private spend(src: string, reason: string, sen: number): boolean {
    if (sen <= 0 || this.p.walletSen < sen) return false;
    this.econ.run(this.p, () => this.econ.change(this.p, -sen, 0, reason));
    this.book(src, -sen);
    return true;
  }

  // ---------------------------------------------------------------- buying
  /** Buy whatever the player sensibly can right now. */
  invest() {
    const pr = this.p.prog;
    const w = () => this.p.walletSen;
    const H = ASSET_HANDS.spend;
    const st = this.cfg.stalls;
    // Stall: the first one at stage 2, then the next tier when allowed and affordable.
    const next = st.tiers.find((t) => t.tier === (this.stall?.tier ?? 0) + 1);
    if (next && (!next.requires.stage || pr.stage >= next.requires.stage) && (!next.requires.level || pr.level >= next.requires.level) && next.priceSen <= w() * H.stallTier) {
      if (this.spend('stall (buy/upgrade)', 'stall-buy', next.priceSen)) {
        if (!this.stall) this.stall = { tier: 1, rep: st.reputation.start, upgrades: {}, buzzUntil: 0, mastery: {}, staff: 0, investedSen: 0 };
        this.stall.tier = next.tier;
        this.stall.investedSen += next.priceSen;
      }
    }
    if (this.stall) {
      const t = tierDef(st, this.stall.tier);
      if (this.stall.staff < t.staffMax && t.hireSen <= w() * H.staff && this.spend('stall (buy/upgrade)', 'stall-hire', t.hireSen)) this.stall.staff++;
      for (const key of ASSET_HANDS.upgrades) {
        const u = st.upgrades[key];
        const lv = this.stall.upgrades[key] ?? 0;
        if (!u || lv >= u.maxLevel) continue;
        const cost = upgradeCostSen(st, this.stall.tier, key, lv);
        if (cost <= w() * H.upgrade && this.spend('stall (buy/upgrade)', 'stall-upgrade', cost)) {
          this.stall.upgrades = { ...this.stall.upgrades, [key]: lv + 1 };
          this.stall.investedSen += cost;
        }
      }
    }
    // Homes: the free first home (best one under the cap), then the best rent per RM.
    const pc = this.cfg.properties;
    const types = Object.entries(pc.types).filter(([, t]) => !t.requires.stage || pr.stage >= t.requires.stage);
    if (!this.homes.length) {
      const free = types.filter(([, t]) => t.priceSen <= pc.claim.firstFreeMaxSen).sort((a, b) => b[1].rentPerDaySen - a[1].rentPerDaySen)[0];
      if (free && pr.stage >= 2) this.homes.push({ type: free[0], paidSen: 0, valueSen: 0 });
    } else if (this.homes.length < pc.claim.maxHomes) {
      const best = types.filter(([, t]) => t.priceSen <= w() * H.home).sort((a, b) => b[1].rentPerDaySen - a[1].rentPerDaySen)[0];
      if (best && this.spend('homes (buying)', 'property-buy', best[1].priceSen)) this.homes.push({ type: best[0], paidSen: best[1].priceSen, valueSen: best[1].priceSen });
    } else {
      // Full: swap the worst home for a better one (sell back, buy up).
      const worst = [...this.homes].sort((a, b) => pc.types[a.type].rentPerDaySen - pc.types[b.type].rentPerDaySen)[0];
      const back = Math.floor(worst.paidSen * pc.sellBackRate);
      const best = types.filter(([, t]) => t.priceSen <= (w() + back) * H.home && t.rentPerDaySen > pc.types[worst.type].rentPerDaySen * 2).sort((a, b) => b[1].rentPerDaySen - a[1].rentPerDaySen)[0];
      if (best && w() + back >= best[1].priceSen) {
        if (back) this.pay('homes (selling)', 'property-sell', back);
        this.homes.splice(this.homes.indexOf(worst), 1);
        if (this.spend('homes (buying)', 'property-buy', best[1].priceSen)) this.homes.push({ type: best[0], paidSen: best[1].priceSen, valueSen: best[1].priceSen });
      }
    }
    // Ventures: the level-up with the best income per RM, a few times; a manager when cheap.
    const bc = this.cfg.businesses;
    for (let guard = 0; guard < 8; guard++) {
      let pick: { id: string; cost: number; gain: number } | null = null;
      for (const t of bc.types) {
        if ((t.requires.stage && pr.stage < t.requires.stage) || (t.requires.level && pr.level < t.requires.level)) continue;
        const lv = this.ventures[t.id]?.level ?? 0;
        const cost = levelCostSen(bc, t, lv, 1);
        if (cost > w() * H.venture) continue;
        const gain = incomePerHourSen(bc, t, lv + 1) - incomePerHourSen(bc, t, lv);
        if (!pick || gain / cost > pick.gain / pick.cost) pick = { id: t.id, cost, gain };
      }
      if (!pick || !this.spend('ventures (levels)', 'business-level', pick.cost)) break;
      const v = (this.ventures[pick.id] ??= { level: 0, manager: false });
      v.level++;
    }
    for (const t of bc.types) {
      const v = this.ventures[t.id];
      if (v?.level && !v.manager && managerCostSen(bc, t) <= w() * H.manager && this.spend('ventures (managers)', 'business-manager', managerCostSen(bc, t))) v.manager = true;
    }
  }

  // ---------------------------------------------------------------- earning
  /** The best dish on the menu right now, and what one portion's ingredients cost. */
  private dish() {
    const s = this.stall!;
    const b = this.prog.mods(this.p).stall;
    const st = this.cfg.stalls;
    const menu = menuRecipes(st, this.cfg.recipes.recipes, s);
    const best = menu.map((r) => ({ r, price: dishBaseSen(st, r, s, false, b) })).sort((a, b2) => b2.price - a.price)[0];
    const supplier = Math.max(0.3, 1 - (s.upgrades.supplier ?? 0) * (st.upgrades.supplier?.perLevel ?? 0));
    return { ...best, cost: best.r.ingredientCostSen * (1 - ASSET_HANDS.stockDiscount) * supplier, b };
  }

  /** Customers per second at the stall (average hours, no rush). */
  private customersPerSec() {
    const s = this.stall!;
    return customerRate(this.cfg.stalls, s, false, 0, this.prog.mods(this.p).stall) / 60;
  }

  /** You cook at the stall for `sec` seconds (the hired cooks help). Returns dishes made. */
  cook(sec: number): number {
    if (!this.stall) return 0;
    const s = this.stall;
    const st = this.cfg.stalls;
    const d = this.dish();
    const q = ASSET_HANDS.quality;
    const qm = (k: string) => this.cfg.recipes.quality.find((x) => x.id === k)?.mult ?? 1;
    const quality = q.perfect * qm('perfect') + q.great * qm('great') + q.good * qm('good');
    const custs = this.customersPerSec() * sec;
    const mine = Math.min(custs, sec / ASSET_HANDS.cookSec);
    const pay = d.price * quality * (1 + ASSET_HANDS.combo);
    const tip = pay * st.tips.max * ASSET_HANDS.tipShare * (q.perfect + q.great);
    this.pay('stall (you cooking)', 'stall-dish', mine * (pay + tip - d.cost));
    s.mastery = { ...s.mastery, [d.r.id]: (s.mastery[d.r.id] ?? 0) + mine };
    s.rep = Math.min(st.reputation.max, s.rep + mine * (q.perfect * st.reputation.perQuality.perfect + q.great * st.reputation.perQuality.great + q.good * st.reputation.perQuality.good));
    this.staff(sec, custs - mine);
    this.prog.bump(this.p, 'dishes', Math.floor(mine));
    return mine;
  }

  /** The hired cooks serve `custs` customers' worth (if they can) over `sec` seconds. */
  private staff(sec: number, custs: number, efficiency = 1) {
    const s = this.stall;
    if (!s?.staff) return;
    const st = this.cfg.stalls;
    const d = this.dish();
    const can = (s.staff * sec * 1000) / staffCookMs(st, s, d.b);
    const n = Math.max(0, Math.min(custs, can));
    this.pay('stall (your cooks)', 'stall-staff', n * (d.price * staffPayRate(st, s) - d.cost) * efficiency);
    // Wages: per cook per in-game hour (1 real minute).
    this.pay('stall (wages)', 'stall-wages', -(wagePerHourSen(st, s.tier, d.b) * s.staff * (sec / 60)) * efficiency);
    if (s.rep < st.reputation.staffRepCap) s.rep = Math.min(st.reputation.staffRepCap, s.rep + st.reputation.perStaffDish * n);
  }

  /** Time passes while you do something else (`sec` seconds of play). */
  tick(sec: number, efficiency = 1) {
    if (this.stall) this.staff(sec, this.customersPerSec() * sec, efficiency);
    // Homes: rent per in-game day (24 real minutes) minus running costs.
    const pc = this.cfg.properties;
    const dayFrac = sec / (1440 * (this.cfg.time.realMsPerGameMinute / 1000));
    const m = this.prog.mods(this.p).property;
    for (const h of this.homes) {
      const rent = fairRentSen(pc, h.type, 1, ASSET_HANDS.homeStars) * ASSET_HANDS.occupancy * m.rent;
      const costs = pc.types[h.type].priceSen * (pc.costs.taxPerDayRate + pc.costs.maintenancePerDayRate);
      this.pay('homes (rent)', 'property-rent', rent * dayFrac * efficiency);
      this.pay('homes (running costs)', 'property-costs', -costs * dayFrac * efficiency);
    }
    // Ventures: collected while you play; only managed ones pay while you're away.
    const bc = this.cfg.businesses;
    const mult = this.prog.mods(this.p).passive * (1 - bc.taxRate);
    for (const [id, v] of Object.entries(this.ventures)) {
      if (efficiency < 1 && !v.manager) continue;
      const t = bc.types.find((x) => x.id === id)!;
      this.pay('ventures (income)', 'business', (incomePerHourSen(bc, t, v.level) * mult * sec * efficiency) / 3600);
    }
  }

  /** Offline between sessions: the usual cap and efficiency. */
  offline(awaySec: number) {
    const o = this.cfg.economy.offline;
    const sec = Math.min(awaySec, o.capHours * 3600);
    // In big steps (offline income is linear here).
    for (let left = sec; left > 0; left -= 600) this.tick(Math.min(600, left), o.efficiency);
  }

  /** Stall mastery level of the current best dish (for the report). */
  masteryOfBest(): number {
    if (!this.stall) return 0;
    return masteryLevel(this.cfg.stalls, Math.max(0, ...Object.values(this.stall.mastery)));
  }
}
