// Server-side crate rolls. The client only says "roll crate X, N times"; everything else (odds,
// luck, pity, variants, limited serials, payment) happens here with crypto-grade randomness.
import crypto from 'node:crypto';
import { formatOneIn, nextPity, rollCrate, rollGrade, type RandInt, type RollResult, type CrateDef } from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { Repos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { log } from '../../log';
import { GameError, type Economy } from '../economy/economy';

export const cryptoRand: RandInt = (max) => (max <= 1 ? 0 : crypto.randomInt(max));

export interface RollMods {
  luck?: number;
  variantChance?: number;
  /** Effective pity thresholds (after Pity Pact). */
  pity?: { epic: number; legendary: number };
  free?: boolean;
}

export interface RollBatch {
  results: RollResult[];
  /** Results that deserve a server-wide announcement (Legendary+). */
  announce: RollResult[];
  pageReward?: { crateId: string; sen: number };
}

export class Gacha {
  /** How many of each limited item have ever been rolled (for serial numbers). */
  private limitedCount = new Map<string, number>();

  constructor(
    private readonly repos: Repos,
    private readonly cfg: ServerConfig,
    private readonly econ: Economy,
    private readonly rand: RandInt = cryptoRand,
  ) {
    for (const item of cfg.items.items) if (item.limit) this.limitedCount.set(item.id, repos.rolls.countItem(item.id));
  }

  /**
   * Rolls a crate `count` times. `mods` come from the player's progression: luck (skills, potions,
   * title), variant chance (Shiny Sense) and the crate's pity thresholds (Pity Pact).
   * `free` rolls (the login streak's free crate) don't charge anything.
   */
  /** 🧪 The crate's bonus potion for one roll, or nothing (call inside econ.run). */
  private bonusPotion(p: OnlinePlayer, crate: CrateDef): RollResult['bonus'] {
    const bp = crate.potions;
    if (!bp || this.rand(1_000_000) >= Math.round(bp.chance * 1_000_000)) return undefined;
    const list = Object.entries(bp.items);
    const total = list.reduce((a, [, w]) => a + w, 0);
    let r = (this.rand(1_000_000) / 1_000_000) * total;
    let id = list[list.length - 1][0];
    for (const [k, w] of list) {
      if (r < w) {
        id = k;
        break;
      }
      r -= w;
    }
    const grade = rollGrade(this.cfg.prog.grades, this.rand);
    const { item } = this.econ.grant(p, id, 'normal', null, grade);
    return { iid: item.iid, itemId: id, grade, variant: 'normal' };
  }

  roll(p: OnlinePlayer, crateId: string, count: number, mods: RollMods = {}): RollBatch {
    const base = this.cfg.crateById.get(crateId);
    if (!base) throw new GameError('Unknown crate.');
    const crate = mods.pity ? { ...base, pity: mods.pity } : base;
    // Most crates cost RM; the Chef Search costs shards.
    const shardCost = mods.free || !crate.priceShards ? 0 : crate.priceShards * count;
    const total = mods.free || crate.priceShards ? 0 : crate.priceSen * count;
    if (p.walletSen < total) throw new GameError(`You need RM ${(total / 100).toLocaleString('en-US')} for ${count}× ${crate.name}.`);
    if (p.shards < shardCost) throw new GameError(`You need ${shardCost} 💎 shards for ${count}× ${crate.name}.`);
    const luck = mods.luck ?? 1;
    const counts = new Map(this.limitedCount);
    const batch = this.econ.run(p, () => {
      if (total > 0 || shardCost > 0) this.econ.change(p, -total, -shardCost, 'crate', `${crate.id}x${count}`);
      const results: RollResult[] = [];
      let pity = p.pity[crate.id] ?? { sinceEpic: 0, sinceLegendary: 0 };
      for (let i = 0; i < count; i++) {
        const soldOut = new Set<string>();
        for (const id of crate.pool) {
          const lim = this.cfg.itemById.get(id)?.limit;
          if (lim && (counts.get(id) ?? 0) >= lim) soldOut.add(id);
        }
        const o = rollCrate(this.cfg.rarities, crate, this.cfg.itemById, luck, pity, this.rand, soldOut, mods.variantChance ?? 1);
        const def = this.cfg.itemById.get(o.itemId)!;
        let serial: number | null = null;
        if (def.limit) {
          serial = (counts.get(def.id) ?? 0) + 1;
          counts.set(def.id, serial);
        }
        // Every rolled item also rolls a tier (mostly D); limited items stay D (they can't merge).
        const grade = def.limit ? 'D' : rollGrade(this.cfg.prog.grades, this.rand);
        const { item, isNew } = this.econ.grant(p, o.itemId, o.variant, serial, grade);
        this.repos.rolls.log(p.id, crate.id, o.itemId, o.tier, o.variant, serial);
        pity = nextPity(this.cfg.rarities, pity, o.tierIndex);
        // 🧪 Now and then a bonus potion comes with it (the item odds above don't change).
        const bonus = this.bonusPotion(p, crate);
        results.push({ iid: item.iid, itemId: o.itemId, tier: o.tier, variant: o.variant, grade, serial, oneIn: o.oneIn, pity: o.pity, isNew, ...(bonus ? { bonus } : {}) });
      }
      p.pity = { ...p.pity, [crate.id]: pity };

      // Item Index page reward: found every item in this crate for the first time.
      let pageReward: RollBatch['pageReward'];
      if (!p.pages.has(crate.id) && crate.pool.every((id) => p.index.has(id))) {
        const sen = Math.round(crate.priceSen * this.cfg.economy.indexPageRewardMultiplier);
        this.econ.change(p, sen, 0, 'index-page', crate.id);
        p.pages.add(crate.id);
        pageReward = { crateId: crate.id, sen };
      }
      this.econ.saveState(p);
      return { results, pageReward };
    });
    this.limitedCount = counts;

    const announceTiers = new Set(this.cfg.rarities.tiers.filter((t) => t.announce).map((t) => t.id));
    const announce = batch.results.filter((r) => announceTiers.has(r.tier));
    for (const r of announce) {
      log.info(`RARE ROLL: ${p.name} got [${r.tier.toUpperCase()}] ${r.itemId} (${r.variant}${r.serial ? ` #${r.serial}` : ''}) from ${crate.id}, ${formatOneIn(r.oneIn)}`);
    }
    return { ...batch, announce };
  }
}
