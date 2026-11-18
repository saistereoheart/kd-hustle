// The player-item boutique (Phase 6, spec §8.5): open a butik, put gacha items on display at
// your own prices, and other players buy them, even while you're offline (consignment).
//
// Listing takes the item out of your inventory (it's on display); cancelling puts it back. A
// sale moves it to the buyer and owes the seller the price minus a consignment fee. The buyer's
// transaction also writes that payout to the seller's pending balance, so it can't be lost; it's
// paid straight away if the seller is online, otherwise at their next login.
import { formatMoney, type BoutiqueSelf, type InventoryItem, type Listing } from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { Repos } from '../../db/repos';
import type { OnlinePlayer, World } from '../../game/world';
import { GameError, type Economy } from '../economy/economy';

export interface BoutiqueHooks {
  wallet: (p: OnlinePlayer, delta: number, reason: string) => void;
  /** Items arrived in a player's bag. */
  items: (p: OnlinePlayer, items: InventoryItem[]) => void;
  /** Items left a player's bag (listed). */
  removed: (p: OnlinePlayer, iids: number[]) => void;
  /** The listings changed (tell everyone). */
  listingsChanged: () => void;
  /** A player's own boutique changed. */
  selfChanged: (p: OnlinePlayer) => void;
  event: (p: OnlinePlayer, text: string) => void;
  /** Furniture placed in a home can't be sold. */
  lockedIids: (p: OnlinePlayer) => Set<number>;
  check: (p: OnlinePlayer) => void;
}

const empty = (): BoutiqueSelf => ({ open: false, pendingSen: 0, pendingSales: [], soldCount: 0, earnedSen: 0 });

export class BoutiqueSystem {
  private listings: Listing[];

  constructor(
    private cfg: ServerConfig,
    private repos: Repos,
    private econ: Economy,
    private world: World,
    private hooks: BoutiqueHooks,
    private clock: () => number = Date.now,
  ) {
    this.listings = repos.boutique.all().filter((l) => cfg.itemById.has(l.itemId));
  }

  private get bc() {
    return this.cfg.businesses.boutique;
  }

  all(): Listing[] {
    return this.listings;
  }

  selfOf(id: number): BoutiqueSelf {
    return { ...empty(), ...(this.repos.playerData.load<Partial<BoutiqueSelf>>(id, 'boutique') ?? {}) };
  }

  private saveSelf(id: number, s: BoutiqueSelf) {
    this.repos.playerData.save(id, 'boutique', s);
  }

  open(p: OnlinePlayer) {
    const b = this.bc;
    if (b.requires.stage && p.prog.stage < b.requires.stage) throw new GameError(`A ${b.name} needs wealth stage ${b.requires.stage}.`);
    const s = this.selfOf(p.id);
    if (s.open) throw new GameError('You already have one.');
    if (p.walletSen < b.openSen) throw new GameError('Not enough money.');
    this.econ.run(p, () => {
      this.econ.change(p, -b.openSen, 0, 'boutique-open', null);
      s.open = true;
      this.saveSelf(p.id, s);
    });
    this.hooks.wallet(p, -b.openSen, 'boutique');
    this.hooks.selfChanged(p);
  }

  /** Put an item on display. */
  list(p: OnlinePlayer, iid: number, priceSen: number) {
    const b = this.bc;
    if (!this.selfOf(p.id).open) throw new GameError(`Open a ${b.name} first.`);
    if (this.listings.filter((l) => l.seller === p.id).length >= b.slots) throw new GameError(`Your ${b.name} has ${b.slots} display slots: all full.`);
    priceSen = Math.round(priceSen);
    if (!(priceSen >= 100 && priceSen <= b.maxPriceSen)) throw new GameError(`Price it between RM 1 and ${formatMoney(b.maxPriceSen)}.`);
    const inst = p.inventory.find((i) => i.iid === iid);
    if (!inst) throw new GameError('You no longer have that item.');
    if (Object.values(p.equipped).includes(iid)) throw new GameError('Take it off first.');
    if (this.hooks.lockedIids(p).has(iid)) throw new GameError("It's placed in one of your homes: put it away first.");
    let listing!: Listing;
    this.econ.run(p, () => {
      this.econ.remove(p, iid);
      const at = this.clock();
      const id = this.repos.boutique.insert(p.id, inst.itemId, inst.variant, inst.grade ?? 'D', inst.serial, priceSen, at);
      listing = { id, seller: p.id, sellerName: p.name, itemId: inst.itemId, variant: inst.variant, grade: inst.grade ?? 'D', serial: inst.serial, priceSen, listedAt: at };
    });
    this.listings.push(listing);
    p.prog.stats.boutiqueListed = (p.prog.stats.boutiqueListed ?? 0) + 1;
    this.hooks.removed(p, [iid]);
    this.hooks.listingsChanged();
    return { listing };
  }

  /** Take an item off display (back into your bag). */
  cancel(p: OnlinePlayer, id: number) {
    const l = this.listings.find((x) => x.id === id);
    if (!l || l.seller !== p.id) throw new GameError("That isn't on display in your shop.");
    const item = this.econ.run(p, () => {
      if (!this.repos.boutique.delete(id)) throw new GameError('It just sold!');
      return this.econ.grant(p, l.itemId, l.variant, l.serial, l.grade).item;
    });
    this.listings = this.listings.filter((x) => x.id !== id);
    this.hooks.items(p, [item]);
    this.hooks.listingsChanged();
    return { item };
  }

  /** Buy an item from someone's boutique. */
  buy(p: OnlinePlayer, id: number) {
    const l = this.listings.find((x) => x.id === id);
    if (!l) throw new GameError('Somebody already bought it.');
    if (l.seller === p.id) throw new GameError("That's your own listing (cancel it to get it back).");
    if (p.walletSen < l.priceSen) throw new GameError('Not enough money.');
    const net = Math.floor(l.priceSen * (1 - this.bc.feeRate));
    const item = this.econ.run(p, () => {
      if (!this.repos.boutique.delete(id)) throw new GameError('Somebody already bought it.');
      this.econ.change(p, -l.priceSen, 0, 'boutique-buy', `${l.itemId}#${l.id}`);
      const got = this.econ.grant(p, l.itemId, l.variant, l.serial, l.grade).item;
      // The seller's money is owed in the same transaction (paid out below or at their login).
      const s = this.selfOf(l.seller);
      s.pendingSen += net;
      s.pendingSales.push({ itemId: l.itemId, priceSen: l.priceSen, buyer: p.name });
      s.soldCount++;
      s.earnedSen += net;
      this.saveSelf(l.seller, s);
      return got;
    });
    this.listings = this.listings.filter((x) => x.id !== id);
    p.prog.stats.boutiqueBought = (p.prog.stats.boutiqueBought ?? 0) + 1;
    this.hooks.wallet(p, -l.priceSen, 'boutique');
    this.hooks.items(p, [item]);
    this.hooks.listingsChanged();
    this.hooks.check(p);
    const seller = this.world.get(l.seller);
    if (seller?.hasCharacter && seller.prog) {
      const name = this.cfg.itemById.get(l.itemId)?.name ?? l.itemId;
      this.hooks.event(seller, `👜 ${p.name} bought your ${name} for ${formatMoney(l.priceSen)}!`);
      this.collect(seller);
    }
    return { item };
  }

  /** Pay out sales made while the seller was away. Returns what was paid (and the sales). */
  collect(p: OnlinePlayer): { sen: number; sales: BoutiqueSelf['pendingSales'] } {
    const s = this.selfOf(p.id);
    if (!s.pendingSen) return { sen: 0, sales: [] };
    const sen = s.pendingSen;
    const sales = s.pendingSales;
    this.econ.run(p, () => {
      this.econ.change(p, sen, 0, 'boutique-sales', `${sales.length} sold`);
      s.pendingSen = 0;
      s.pendingSales = [];
      this.saveSelf(p.id, s);
    });
    p.prog.stats.boutiqueSold = (p.prog.stats.boutiqueSold ?? 0) + sales.length;
    p.prog.stats.boutiqueEarnSen = (p.prog.stats.boutiqueEarnSen ?? 0) + sen;
    this.hooks.wallet(p, sen, 'boutique');
    this.hooks.selfChanged(p);
    this.hooks.check(p);
    return { sen, sales };
  }

  /** What your items on display are listed for (they still count as yours for net worth). */
  listedOf(p: OnlinePlayer): Listing[] {
    return this.listings.filter((l) => l.seller === p.id);
  }
}
