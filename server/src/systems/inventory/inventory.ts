// Equipping cosmetics, the pawn shop (sell for RM / scrap for shards) and the Shard Shop.
import { EQUIP_SLOTS, isCollectible, pawnPriceSen, scrapShards, type EquipSlot, type InventoryItem } from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { OnlinePlayer } from '../../game/world';
import { GameError, type Economy } from '../economy/economy';

export class InventorySystem {
  /** Instances that can't be given up right now (furniture placed in a property). */
  lockedIids: (p: OnlinePlayer) => Set<number> = () => new Set();

  constructor(
    private readonly cfg: ServerConfig,
    private readonly econ: Economy,
  ) {}

  /** Equip an item instance. Returns true if what others see changed. */
  equip(p: OnlinePlayer, iid: number): boolean {
    const inst = p.inventory.find((i) => i.iid === iid);
    if (!inst) throw new GameError('You no longer have that item.');
    const def = this.cfg.itemById.get(inst.itemId);
    if (!def || !(EQUIP_SLOTS as readonly string[]).includes(def.type)) throw new GameError(`${def?.name ?? 'That item'} can't be worn.`);
    return this.econ.run(p, () => {
      p.equipped = { ...p.equipped, [def.type as EquipSlot]: iid };
      const changed = this.econ.refreshCosmetics(p);
      this.econ.saveState(p);
      return changed;
    });
  }

  unequip(p: OnlinePlayer, slot: EquipSlot): boolean {
    return this.econ.run(p, () => {
      const next = { ...p.equipped };
      delete next[slot];
      p.equipped = next;
      const changed = this.econ.refreshCosmetics(p);
      this.econ.saveState(p);
      return changed;
    });
  }

  /** Pick `count` instances of an item+variant to give up. Equipped items go last; limited serials are protected. */
  private pick(p: OnlinePlayer, itemId: string, variant: string, count: number): InventoryItem[] {
    const equipped = new Set(Object.values(p.equipped));
    const locked = this.lockedIids(p);
    const stack = p.inventory
      .filter((i) => i.itemId === itemId && i.variant === variant && i.serial === null && !locked.has(i.iid))
      .sort((a, b) => Number(equipped.has(a.iid)) - Number(equipped.has(b.iid)) || b.iid - a.iid);
    if (stack.length < count) throw new GameError(stack.length ? `You only have ${stack.length}.` : 'You don\'t have that item (limited items can\'t be pawned).');
    return stack.slice(0, count);
  }

  sell(p: OnlinePlayer, itemId: string, variant: string, count: number) {
    const def = this.cfg.itemById.get(itemId);
    const crate = this.cfg.crateOfItem.get(itemId);
    if (!def || (!crate && !def.valueSen)) throw new GameError('Unknown item.');
    const each = pawnPriceSen(this.cfg.rarities, def, crate, variant, this.cfg.economy.pawnRate);
    const picked = this.pick(p, itemId, variant, count);
    return this.econ.run(p, () => {
      for (const i of picked) this.econ.remove(p, i.iid);
      this.econ.change(p, each * picked.length, 0, 'pawn-sell', `${itemId}:${variant}x${picked.length}`);
      const cosmeticsChanged = this.econ.refreshCosmetics(p);
      this.econ.saveState(p);
      return { removed: picked.map((i) => i.iid), gainedSen: each * picked.length, cosmeticsChanged };
    });
  }

  scrap(p: OnlinePlayer, itemId: string, variant: string, count: number) {
    const def = this.cfg.itemById.get(itemId);
    if (!def) throw new GameError('Unknown item.');
    const each = scrapShards(this.cfg.rarities, def, variant);
    const picked = this.pick(p, itemId, variant, count);
    return this.econ.run(p, () => {
      for (const i of picked) this.econ.remove(p, i.iid);
      this.econ.change(p, 0, each * picked.length, 'scrap', `${itemId}:${variant}x${picked.length}`);
      const cosmeticsChanged = this.econ.refreshCosmetics(p);
      this.econ.saveState(p);
      return { removed: picked.map((i) => i.iid), gainedShards: each * picked.length, cosmeticsChanged };
    });
  }

  /** Shard Shop: buy a specific (non-limited, Epic or lower) item you've already discovered, or a potion. */
  shardBuy(p: OnlinePlayer, itemId: string) {
    const def = this.cfg.itemById.get(itemId);
    if (!def) throw new GameError('Unknown item.');
    const price = def.shardPrice ?? this.cfg.economy.shardShopPrices[def.rarity];
    if (!price || def.limit) throw new GameError(`${def.name} isn't sold in the Shard Shop.`);
    if (isCollectible(def) && !p.index.has(itemId)) throw new GameError('Discover this item in a crate first.');
    return this.econ.run(p, () => {
      this.econ.change(p, 0, -price, 'shard-shop', itemId);
      return this.econ.grant(p, itemId, 'normal', null);
    });
  }
}
