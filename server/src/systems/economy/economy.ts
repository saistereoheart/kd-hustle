// The only place money, shards and items change. Every change runs inside a SQLite
// transaction (all-or-nothing) and is logged to the `transactions` table. If anything throws
// mid-way, the DB rolls back AND the in-memory player is restored, so they can never drift.
import { EQUIP_SLOTS, isCollectible, type Cosmetics, type InventoryItem } from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { Repos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';

/** A player-facing failure (shown as a toast), as opposed to a bug. */
export class GameError extends Error {}

export class Economy {
  constructor(
    private readonly repos: Repos,
    private readonly cfg: ServerConfig,
  ) {}

  /** Runs `fn` atomically. On error the DB and the in-memory player are both rolled back. */
  run<T>(p: OnlinePlayer, fn: () => T): T {
    const snap = {
      walletSen: p.walletSen,
      shards: p.shards,
      inventory: [...p.inventory],
      equipped: { ...p.equipped },
      cosmetics: { ...p.cosmetics },
      index: new Set(p.index),
      pages: new Set(p.pages),
      pity: JSON.parse(JSON.stringify(p.pity)),
      jobs: JSON.parse(JSON.stringify(p.jobs)),
      skills: { ...p.skills },
      prog: p.prog ? structuredClone(p.prog) : p.prog,
    };
    try {
      return this.repos.tx(fn);
    } catch (err) {
      Object.assign(p, snap);
      throw err;
    }
  }

  /** Changes wallet/shards (call inside run()). Throws GameError if a balance would go negative. */
  change(p: OnlinePlayer, deltaSen: number, deltaShards: number, reason: string, ref: string | null = null) {
    if (!Number.isSafeInteger(deltaSen) || !Number.isSafeInteger(deltaShards)) throw new Error(`non-integer money change: ${deltaSen}/${deltaShards}`);
    const wallet = p.walletSen + deltaSen;
    const shards = p.shards + deltaShards;
    if (wallet < 0) throw new GameError('Not enough money.');
    if (shards < 0) throw new GameError('Not enough shards.');
    if (!Number.isSafeInteger(wallet)) throw new Error('wallet overflow');
    this.repos.econ.setMoney(p.id, wallet, shards);
    this.repos.econ.logTx(p.id, deltaSen, wallet, deltaShards, reason, ref);
    p.walletSen = wallet;
    p.shards = shards;
  }

  /** Adds an item to the inventory and (collectibles only, not potions) the Item Index. Call inside run(). */
  grant(p: OnlinePlayer, itemId: string, variant: string, serial: number | null, grade = 'D'): { item: InventoryItem; isNew: boolean } {
    const item = this.repos.inventory.insert(p.id, itemId, variant, serial, grade);
    p.inventory.push(item);
    const def = this.cfg.itemById.get(itemId);
    if (def && !isCollectible(def)) return { item, isNew: false };
    const isNew = this.repos.collection.add(p.id, itemId);
    p.index.add(itemId);
    return { item, isNew };
  }

  /** Changes an item's tier/variant (call inside run()). */
  setLook(p: OnlinePlayer, iid: number, grade: string, variant: string) {
    if (!this.repos.inventory.setLook(p.id, iid, grade, variant)) throw new GameError('You no longer have that item.');
  }

  /** Removes an item instance (call inside run()). Unequips it if needed. */
  remove(p: OnlinePlayer, iid: number) {
    if (!this.repos.inventory.delete(p.id, iid)) throw new GameError('You no longer have that item.');
    p.inventory = p.inventory.filter((i) => i.iid !== iid);
    for (const slot of EQUIP_SLOTS) if (p.equipped[slot] === iid) delete p.equipped[slot];
  }

  /** Persist equipped/pity/jobs/index-page state (call inside run()). */
  saveState(p: OnlinePlayer) {
    this.repos.econ.setState(p.id, { equipped: p.equipped, pity: p.pity, jobs: p.jobs, pages: [...p.pages], skills: p.skills });
  }

  /** Rebuilds what other players see equipped. Returns true if it changed. */
  refreshCosmetics(p: OnlinePlayer): boolean {
    const next: Cosmetics = {};
    for (const slot of EQUIP_SLOTS) {
      const iid = p.equipped[slot];
      const inst = iid !== undefined ? p.inventory.find((i) => i.iid === iid) : undefined;
      const def = inst ? this.cfg.itemById.get(inst.itemId) : undefined;
      if (inst && def && def.type === slot) next[slot] = { itemId: inst.itemId, variant: inst.variant };
      else delete p.equipped[slot];
    }
    const changed = JSON.stringify(next) !== JSON.stringify(p.cosmetics);
    p.cosmetics = next;
    return changed;
  }
}
