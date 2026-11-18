// Equipping cosmetics, the pawn shop (sell for RM / scrap for shards) and the Shard Shop.
import { bestVariant, EQUIP_SLOTS, gradeDef, gradeMult, isCollectible, nextGrade, pawnPriceSen, rerollGrade, scrapShards, type EquipSlot, type InventoryItem } from '@kh/shared';
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
  private pick(p: OnlinePlayer, itemId: string, variant: string, count: number, grade?: string): InventoryItem[] {
    const equipped = new Set(Object.values(p.equipped));
    const locked = this.lockedIids(p);
    const stack = p.inventory
      .filter((i) => i.itemId === itemId && i.variant === variant && (!grade || i.grade === grade) && i.serial === null && !locked.has(i.iid))
      .sort((a, b) => Number(equipped.has(a.iid)) - Number(equipped.has(b.iid)) || b.iid - a.iid);
    if (stack.length < count) throw new GameError(stack.length ? `You only have ${stack.length}.` : 'You don\'t have that item (limited items can\'t be pawned).');
    return stack.slice(0, count);
  }

  sell(p: OnlinePlayer, itemId: string, variant: string, count: number, grade?: string) {
    const def = this.cfg.itemById.get(itemId);
    const crate = this.cfg.crateOfItem.get(itemId);
    if (!def || (!crate && !def.valueSen)) throw new GameError('Unknown item.');
    const picked = this.pick(p, itemId, variant, count, grade);
    // Each item's tier multiplies what it's worth.
    const total = picked.reduce((a, i) => a + pawnPriceSen(this.cfg.rarities, def, crate, variant, this.cfg.economy.pawnRate, gradeMult(this.cfg.prog.grades, i.grade)), 0);
    return this.econ.run(p, () => {
      for (const i of picked) this.econ.remove(p, i.iid);
      this.econ.change(p, total, 0, 'pawn-sell', `${itemId}:${variant}${grade ? `:${grade}` : ''}x${picked.length}`);
      const cosmeticsChanged = this.econ.refreshCosmetics(p);
      this.econ.saveState(p);
      return { removed: picked.map((i) => i.iid), gainedSen: total, cosmeticsChanged };
    });
  }

  /**
   * Merge: `mergeCount` copies of an item at one tier (not worn, not limited) become one copy at
   * the next tier, keeping the best variant among them.
   */
  merge(p: OnlinePlayer, itemId: string, grade: string) {
    const g = this.cfg.prog.grades;
    const next = nextGrade(g, grade);
    if (!next) throw new GameError("That's already the top tier.");
    const equipped = new Set(Object.values(p.equipped));
    const locked = this.lockedIids(p);
    const pool = p.inventory.filter((i) => i.itemId === itemId && (i.grade ?? 'D') === grade && i.serial === null && !equipped.has(i.iid) && !locked.has(i.iid));
    if (pool.length < g.mergeCount) throw new GameError(`You need ${g.mergeCount} of them at ${gradeDef(g, grade).name} (not worn).`);
    const order = this.cfg.rarities.variants.map((v) => v.id);
    // Use the plainest copies first, but the result takes the best variant among the ones used.
    const used = [...pool].sort((a, b) => order.indexOf(a.variant) - order.indexOf(b.variant)).slice(0, g.mergeCount);
    const variant = bestVariant(order, used.map((i) => i.variant));
    return this.econ.run(p, () => {
      for (const i of used) this.econ.remove(p, i.iid);
      const { item } = this.econ.grant(p, itemId, variant, null, next);
      this.econ.change(p, 0, 0, 'merge', `${itemId}:${grade}->${next}`);
      this.econ.saveState(p);
      return { removed: used.map((i) => i.iid), item };
    });
  }

  /** Spend shards for a chance at a better tier or variant (never worse). */
  reroll(p: OnlinePlayer, iid: number, what: 'grade' | 'variant', rand: (max: number) => number) {
    const it = p.inventory.find((i) => i.iid === iid);
    if (!it) throw new GameError('You no longer have that item.');
    if (it.serial !== null) throw new GameError('Limited items keep their looks.');
    const def = this.cfg.itemById.get(it.itemId);
    if (!def || !this.cfg.crateOfItem.get(it.itemId)) throw new GameError("That item can't be rerolled.");
    const g = this.cfg.prog.grades;
    const cost = (what === 'grade' ? g.shards.rerollGrade : g.shards.rerollVariant)[def.rarity] ?? 100;
    if (p.shards < cost) throw new GameError(`That takes ${cost} 💎 shards.`);
    let grade = it.grade ?? 'D', variant = it.variant;
    if (what === 'grade') grade = rerollGrade(g, grade, rand);
    else {
      // Roll a variant the usual way (1 in N); keep yours if the new one isn't rarer.
      const vs = this.cfg.rarities.variants;
      let rolled = vs[0].id;
      for (const v of [...vs].reverse()) if (v.oneIn > 1 && rand(v.oneIn) === 0) {
        rolled = v.id;
        break;
      }
      const order = vs.map((v) => v.id);
      if (order.indexOf(rolled) > order.indexOf(variant)) variant = rolled;
    }
    const improved = grade !== (it.grade ?? 'D') || variant !== it.variant;
    return this.econ.run(p, () => {
      this.econ.change(p, 0, -cost, `reroll-${what}`, `${it.itemId}#${iid}`);
      if (improved) {
        this.econ.setLook(p, iid, grade, variant);
        it.grade = grade;
        it.variant = variant;
      }
      const cosmeticsChanged = improved && this.econ.refreshCosmetics(p);
      return { item: { ...it }, improved, cosmeticsChanged };
    });
  }

  scrap(p: OnlinePlayer, itemId: string, variant: string, count: number, grade?: string) {
    const def = this.cfg.itemById.get(itemId);
    if (!def) throw new GameError('Unknown item.');
    const each = Math.round(scrapShards(this.cfg.rarities, def, variant) * gradeMult(this.cfg.prog.grades, grade));
    const picked = this.pick(p, itemId, variant, count, grade);
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
