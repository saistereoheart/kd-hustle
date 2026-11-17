// Server-side crate rolls. The client only says "roll crate X, N times"; everything else (odds,
// luck, pity, variants, limited serials, payment) happens here with crypto-grade randomness.
import crypto from 'node:crypto';
import { formatOneIn, nextPity, rollCrate, type RandInt, type RollResult } from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { Repos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { log } from '../../log';
import { GameError, type Economy } from '../economy/economy';

export const cryptoRand: RandInt = (max) => (max <= 1 ? 0 : crypto.randomInt(max));

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

  /** Current luck. Phase 3 adds potions, upgrades, titles and events as luck sources. */
  luckFor(_p: OnlinePlayer): number {
    return 1;
  }

  roll(p: OnlinePlayer, crateId: string, count: number): RollBatch {
    const crate = this.cfg.crateById.get(crateId);
    if (!crate) throw new GameError('Unknown crate.');
    const total = crate.priceSen * count;
    if (p.walletSen < total) throw new GameError(`You need RM ${(total / 100).toLocaleString('en-US')} for ${count}× ${crate.name}.`);
    const luck = this.luckFor(p);
    const counts = new Map(this.limitedCount);
    const batch = this.econ.run(p, () => {
      this.econ.change(p, -total, 0, 'crate', `${crate.id}x${count}`);
      const results: RollResult[] = [];
      let pity = p.pity[crate.id] ?? { sinceEpic: 0, sinceLegendary: 0 };
      for (let i = 0; i < count; i++) {
        const soldOut = new Set<string>();
        for (const id of crate.pool) {
          const lim = this.cfg.itemById.get(id)?.limit;
          if (lim && (counts.get(id) ?? 0) >= lim) soldOut.add(id);
        }
        const o = rollCrate(this.cfg.rarities, crate, this.cfg.itemById, luck, pity, this.rand, soldOut);
        const def = this.cfg.itemById.get(o.itemId)!;
        let serial: number | null = null;
        if (def.limit) {
          serial = (counts.get(def.id) ?? 0) + 1;
          counts.set(def.id, serial);
        }
        const { item, isNew } = this.econ.grant(p, o.itemId, o.variant, serial);
        this.repos.rolls.log(p.id, crate.id, o.itemId, o.tier, o.variant, serial);
        pity = nextPity(this.cfg.rarities, pity, o.tierIndex);
        results.push({ iid: item.iid, itemId: o.itemId, tier: o.tier, variant: o.variant, serial, oneIn: o.oneIn, pity: o.pity, isNew });
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
