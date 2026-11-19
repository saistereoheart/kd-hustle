// Pasar Online, the marketplace (Phase 7, spec §14).
//
// List an item (it leaves your bag) at a fixed price, or as an auction for a number of in-game
// hours. Buying pays the seller the price minus the fee (a money sink). Bidding takes your bid
// now (held); being outbid refunds it. A bid in the last moments extends the auction. When it
// closes the top bidder gets the item and the seller the money; with no bids the item goes back.
// Anyone offline is owed what's theirs (money and items) and gets it at their next login.
// Every sale goes into the price history.
import { formatMoney, minNextBid, type InventoryItem, type MarketConfig, type MarketListing, type MarketSale } from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { Repos } from '../../db/repos';
import type { OnlinePlayer, World } from '../../game/world';
import { GameError, type Economy } from '../economy/economy';

export interface MarketHooks {
  wallet: (p: OnlinePlayer, delta: number, reason: string) => void;
  items: (p: OnlinePlayer, items: InventoryItem[]) => void;
  changed: () => void;
  notice: (p: OnlinePlayer, text: string, kind: 'good' | 'bad' | 'info') => void;
  lockedIids: (p: OnlinePlayer) => Set<number>;
  check: (p: OnlinePlayer) => void;
}

/** What someone is owed while offline (paid at their next login). */
interface Owed {
  sen: number;
  items: Array<{ itemId: string; variant: string; grade: string; serial: number | null }>;
  notes: string[];
}

export class MarketSystem {
  private mc: MarketConfig;
  private listings: MarketListing[];

  constructor(
    private cfg: ServerConfig,
    private repos: Repos,
    private econ: Economy,
    private world: World,
    private hooks: MarketHooks,
    private clock: () => number = Date.now,
  ) {
    this.mc = cfg.market;
    this.listings = repos.market.all().filter((l) => cfg.itemById.has(l.itemId));
  }

  all(): MarketListing[] {
    return this.listings;
  }

  history(itemId: string): { sales: MarketSale[]; avgSen: number | null } {
    const sales = this.repos.market.history(itemId, this.mc.historySize);
    return { sales, avgSen: sales.length ? Math.round(sales.reduce((a, s) => a + s.priceSen, 0) / sales.length) : null };
  }

  private nameOf(itemId: string) {
    return this.cfg.itemById.get(itemId)?.name ?? itemId;
  }

  // ---------------------------------------------------------------- owed (offline) deliveries
  private owed(id: number): Owed {
    return { sen: 0, items: [], notes: [], ...(this.repos.playerData.load<Partial<Owed>>(id, 'market') ?? {}) };
  }

  /** Pay money to a player: now if online, else at their next login. Call inside a transaction. */
  private payTo(id: number, sen: number, reason: string, note: string) {
    if (sen <= 0) return;
    const p = this.world.get(id);
    if (p?.prog) {
      this.econ.change(p, sen, 0, reason, null);
      this.hooks.wallet(p, sen, 'market');
      this.hooks.notice(p, note, 'good');
    } else {
      const o = this.owed(id);
      o.sen += sen;
      o.notes.push(note);
      this.repos.playerData.save(id, 'market', o);
    }
  }

  /** Give an item to a player: now if online, else at their next login. Call inside a transaction. */
  private giveTo(id: number, l: MarketListing, note: string) {
    const p = this.world.get(id);
    if (p?.prog) {
      this.hooks.items(p, [this.econ.grant(p, l.itemId, l.variant, l.serial, l.grade).item]);
      this.hooks.notice(p, note, 'good');
    } else {
      const o = this.owed(id);
      o.items.push({ itemId: l.itemId, variant: l.variant, grade: l.grade, serial: l.serial });
      o.notes.push(note);
      this.repos.playerData.save(id, 'market', o);
    }
  }

  /** At login: hand over what came in while you were away. Returns notes for the welcome screen. */
  collect(p: OnlinePlayer): { sen: number; notes: string[] } {
    const o = this.owed(p.id);
    if (!o.sen && !o.items.length) return { sen: 0, notes: [] };
    const got: InventoryItem[] = [];
    this.econ.run(p, () => {
      if (o.sen) this.econ.change(p, o.sen, 0, 'market-owed', `${o.notes.length} sales`);
      for (const it of o.items) got.push(this.econ.grant(p, it.itemId, it.variant, it.serial, it.grade).item);
      this.repos.playerData.save(p.id, 'market', { sen: 0, items: [], notes: [] });
    });
    if (o.sen) this.hooks.wallet(p, o.sen, 'market');
    if (got.length) this.hooks.items(p, got);
    return { sen: o.sen, notes: o.notes };
  }

  // ---------------------------------------------------------------- selling
  list(p: OnlinePlayer, iid: number, kind: 'fixed' | 'auction', priceSen: number, hours?: number) {
    const mc = this.mc;
    if (mc.requires.stage && p.prog.stage < mc.requires.stage) throw new GameError(`${mc.name} opens at wealth stage ${mc.requires.stage}.`);
    if (this.listings.filter((l) => l.seller === p.id).length >= mc.maxListings) throw new GameError(`Up to ${mc.maxListings} listings at a time.`);
    priceSen = Math.round(priceSen / 100) * 100;
    if (!(priceSen >= 100 && priceSen <= mc.maxPriceSen)) throw new GameError(`Price it between RM 1 and ${formatMoney(mc.maxPriceSen)}.`);
    const inst = p.inventory.find((i) => i.iid === iid);
    if (!inst) throw new GameError('You no longer have that item.');
    if (Object.values(p.equipped).includes(iid)) throw new GameError('Take it off first.');
    if (this.hooks.lockedIids(p).has(iid)) throw new GameError("It's in use (placed in a home, or in your 🐾 Teman team / on a Teman).");
    let endsAt: number | null = null;
    if (kind === 'auction') {
      if (!hours || !mc.auctionHours.includes(hours)) throw new GameError(`Auctions run ${mc.auctionHours.join(', ')} in-game hours.`);
      endsAt = this.clock() + hours * 60 * this.cfg.time.realMsPerGameMinute;
    }
    const at = this.clock();
    let listing!: MarketListing;
    this.econ.run(p, () => {
      this.econ.remove(p, iid);
      const id = this.repos.market.insert(p.id, inst.itemId, inst.variant, inst.grade ?? 'D', inst.serial, kind, priceSen, endsAt, at);
      listing = { id, seller: p.id, sellerName: p.name, itemId: inst.itemId, variant: inst.variant, grade: inst.grade ?? 'D', serial: inst.serial, kind, priceSen, topBidSen: 0, topBidder: null, topBidderName: null, endsAt, listedAt: at };
    });
    this.listings.push(listing);
    p.prog.stats.marketListed = (p.prog.stats.marketListed ?? 0) + 1;
    this.hooks.changed();
    return { listing, removed: iid };
  }

  cancel(p: OnlinePlayer, id: number) {
    const l = this.listings.find((x) => x.id === id);
    if (!l || l.seller !== p.id) throw new GameError("That isn't your listing.");
    if (l.topBidder !== null) throw new GameError("Somebody already bid: the auction has to run its course.");
    this.econ.run(p, () => {
      if (!this.repos.market.delete(id)) throw new GameError('It just sold!');
      this.giveTo(p.id, l, `${this.nameOf(l.itemId)} is back in your bag.`);
    });
    this.listings = this.listings.filter((x) => x.id !== id);
    this.hooks.changed();
  }

  // ---------------------------------------------------------------- buying
  buy(p: OnlinePlayer, id: number) {
    const l = this.listings.find((x) => x.id === id);
    if (!l || l.kind !== 'fixed') throw new GameError('That is gone.');
    if (l.seller === p.id) throw new GameError("That's your own listing.");
    if (p.walletSen < l.priceSen) throw new GameError('Not enough money.');
    const net = Math.floor(l.priceSen * (1 - this.mc.feeRate));
    this.econ.run(p, () => {
      if (!this.repos.market.delete(id)) throw new GameError('Somebody bought it first.');
      this.econ.change(p, -l.priceSen, 0, 'market-buy', `${l.itemId}#${l.id}`);
      this.giveTo(p.id, l, `🛒 ${this.nameOf(l.itemId)} is yours!`);
      this.repos.market.sale(l.itemId, l.variant, l.grade, l.priceSen, 'fixed', this.clock());
      this.payTo(l.seller, net, 'market-sale', `🛒 ${p.name} bought your ${this.nameOf(l.itemId)}: +${formatMoney(net)} (after the ${Math.round(this.mc.feeRate * 100)}% fee)`);
    });
    this.hooks.wallet(p, -l.priceSen, 'market');
    this.listings = this.listings.filter((x) => x.id !== id);
    p.prog.stats.marketBought = (p.prog.stats.marketBought ?? 0) + 1;
    this.hooks.changed();
    this.hooks.check(p);
  }

  bid(p: OnlinePlayer, id: number, sen: number) {
    const l = this.listings.find((x) => x.id === id);
    const now = this.clock();
    if (!l || l.kind !== 'auction' || (l.endsAt ?? 0) <= now) throw new GameError('That auction is over.');
    if (l.seller === p.id) throw new GameError("You can't bid on your own auction.");
    if (l.topBidder === p.id) throw new GameError("You're already the top bidder.");
    const min = minNextBid(this.mc, l);
    if (sen < min) throw new GameError(`The next bid has to be at least ${formatMoney(min)}.`);
    if (p.walletSen < sen) throw new GameError('Not enough money.');
    const prev = l.topBidder !== null ? { id: l.topBidder, sen: l.topBidSen } : null;
    // A bid right at the end gives everyone a moment to answer.
    const endsAt = Math.max(l.endsAt!, now + this.mc.antiSnipeMs);
    this.econ.run(p, () => {
      this.econ.change(p, -sen, 0, 'market-bid', `#${l.id}`);
      if (!this.repos.market.bid(l.id, sen, p.id, endsAt)) throw new GameError('That auction is over.');
      if (prev) this.payTo(prev.id, prev.sen, 'market-refund', `⚠️ Outbid on ${this.nameOf(l.itemId)}: your ${formatMoney(prev.sen)} came back.`);
    });
    this.hooks.wallet(p, -sen, 'market');
    l.topBidSen = sen;
    l.topBidder = p.id;
    l.topBidderName = p.name;
    l.endsAt = endsAt;
    this.hooks.changed();
  }

  /** Close finished auctions (call every few seconds). */
  tick() {
    const now = this.clock();
    let changed = false;
    for (const l of [...this.listings]) {
      if (l.kind !== 'auction' || (l.endsAt ?? Infinity) > now) continue;
      const seller = this.world.get(l.seller);
      const winner = l.topBidder !== null ? this.world.get(l.topBidder) : undefined;
      // Run inside whichever online player's transaction we have (the DB transaction is what matters).
      const tx = <T>(fn: () => T): T => {
        const p = winner?.prog ? winner : seller?.prog ? seller : undefined;
        return p ? this.econ.run(p, fn) : this.repos.tx(fn);
      };
      tx(() => {
        if (!this.repos.market.delete(l.id)) return;
        if (l.topBidder === null) {
          this.giveTo(l.seller, l, `⌛ No bids on ${this.nameOf(l.itemId)}: it's back in your bag.`);
          return;
        }
        const net = Math.floor(l.topBidSen * (1 - this.mc.feeRate));
        this.giveTo(l.topBidder, l, `🔨 You won the auction for ${this.nameOf(l.itemId)} (${formatMoney(l.topBidSen)})!`);
        this.payTo(l.seller, net, 'market-sale', `🔨 ${l.topBidderName} won your ${this.nameOf(l.itemId)}: +${formatMoney(net)} (after the ${Math.round(this.mc.feeRate * 100)}% fee)`);
        this.repos.market.sale(l.itemId, l.variant, l.grade, l.topBidSen, 'auction', now);
      });
      this.listings = this.listings.filter((x) => x.id !== l.id);
      changed = true;
    }
    if (changed) this.hooks.changed();
  }

  /** Listed items and held bids are still yours (net worth). */
  heldOf(p: OnlinePlayer): { items: MarketListing[]; bidsSen: number } {
    return { items: this.listings.filter((l) => l.seller === p.id), bidsSen: this.listings.filter((l) => l.topBidder === p.id).reduce((a, l) => a + l.topBidSen, 0) };
  }
}
