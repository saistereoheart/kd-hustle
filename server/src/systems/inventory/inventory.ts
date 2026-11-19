// Equipping cosmetics, the pawn shop (sell for RM / scrap for shards) and the Shard Shop.
import { EQUIP_SLOTS, gradeMult, isCollectible, mergeOutcome, nextGrade, pawnPriceSen, rerollGradeOutcome, rerollVariantOutcome, scrapShards, variantParts, type EquipSlot, type InventoryItem } from '@kh/shared';
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
   * Merge: `mergeCount` copies of the same item, picked by the player (any tiers and variants;
   * not worn, not placed, not limited) become one: a tier up (see mergeOutcome), with every
   * variant of the inputs and a chance of one more.
   */
  merge(p: OnlinePlayer, iids: number[], rand: (max: number) => number) {
    const g = this.cfg.prog.grades;
    if (new Set(iids).size !== iids.length || iids.length !== g.mergeCount) throw new GameError(`Pick ${g.mergeCount} different copies.`);
    const equipped = new Set(Object.values(p.equipped));
    const locked = this.lockedIids(p);
    const used = iids.map((iid) => p.inventory.find((i) => i.iid === iid));
    if (used.some((i) => !i)) throw new GameError('You no longer have one of those.');
    const items = used as InventoryItem[];
    const itemId = items[0].itemId;
    if (items.some((i) => i.itemId !== itemId)) throw new GameError('Merge copies of the same item.');
    if (!this.cfg.crateOfItem.get(itemId)) throw new GameError("That item can't be merged.");
    if (items.some((i) => i.serial !== null)) throw new GameError("Limited items can't be merged.");
    if (items.some((i) => equipped.has(i.iid) || locked.has(i.iid))) throw new GameError('Take it off (or out of your home) first.');
    const out = mergeOutcome(g, this.cfg.rarities.variants, items.map((i) => ({ grade: i.grade, variant: i.variant })), rand);
    return this.econ.run(p, () => {
      for (const i of items) this.econ.remove(p, i.iid);
      const { item } = this.econ.grant(p, itemId, out.variant, null, out.grade);
      this.econ.change(p, 0, 0, 'merge', `${itemId}->${out.grade}:${out.variant}`);
      this.econ.saveState(p);
      return { removed: items.map((i) => i.iid), item, bonus: out.bonus };
    });
  }

  /** Spend shards for a chance at a better tier, or another variant (never worse). Luck makes
   *  better rolls likelier; `fails` (misses in a row) drives the soft / hard pity. */
  reroll(p: OnlinePlayer, iid: number, what: 'grade' | 'variant', rand: (max: number) => number, luck = 1, fails = 0) {
    const it = p.inventory.find((i) => i.iid === iid);
    if (!it) throw new GameError('You no longer have that item.');
    if (it.serial !== null) throw new GameError('Limited items keep their looks.');
    const def = this.cfg.itemById.get(it.itemId);
    if (!def || !this.cfg.crateOfItem.get(it.itemId)) throw new GameError("That item can't be rerolled.");
    const g = this.cfg.prog.grades;
    if (what === 'grade' && !nextGrade(g, it.grade)) throw new GameError("It's already the top tier.");
    if (what === 'variant' && this.cfg.rarities.variants.every((v) => v.oneIn <= 1 || variantParts(it.variant).includes(v.id))) throw new GameError('It already has every variant.');
    const cost = (what === 'grade' ? g.shards.rerollGrade : g.shards.rerollVariant)[def.rarity] ?? 100;
    if (p.shards < cost) throw new GameError(`That takes ${cost} 💎 shards.`);
    const o = what === 'grade'
      ? rerollGradeOutcome(g, it.grade, rand, luck, fails)
      : rerollVariantOutcome(g, this.cfg.rarities.variants, it.variant, rand, luck, fails);
    const grade = what === 'grade' ? o.result : (it.grade ?? 'D');
    const variant = what === 'variant' ? o.result : it.variant;
    return this.econ.run(p, () => {
      this.econ.change(p, 0, -cost, `reroll-${what}`, `${it.itemId}#${iid}`);
      if (o.improved) {
        this.econ.setLook(p, iid, grade, variant);
        it.grade = grade;
        it.variant = variant;
      }
      const cosmeticsChanged = o.improved && this.econ.refreshCosmetics(p);
      return { item: { ...it }, improved: o.improved, rolled: o.rolled, forced: o.forced, cosmeticsChanged };
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
