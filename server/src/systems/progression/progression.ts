// Phase 3 progression on the server: XP + levels, wealth stages, titles, potions (buffs), the
// Hustle Skills tree, the daily login streak, daily quests and the Hustle Path.
//
// How it fits together:
//  - Other systems report what happened (a roll, a job, a sale...) with on*() calls. Those bump
//    lifetime STATS counters and add XP.
//  - check() then works out everything that follows from the new numbers (level-ups, a new
//    stage, new titles, Hustle Path goals) and pays out their rewards, all in ONE transaction.
//  - Titles, goals and quests are conditions over those stats (see shared/progression), so a quest
//    is just "this stat went up by N since the quest was handed out".
//  - The client gets the whole progress state back after every change (it's small).
import {
  newlyDoneGoals, currentGoalIndex, buildSnapshot, computeMods, conditionProgress, dayKey, effectivePity, levelInfo, levelUpReward,
  gearOf, loginStatus, manifestRateSen, pickQuests, questProgress, skillCostSen, skillLevel, skillLockReason, stageDef,
  stageForNetWorth, formatMoney,
  type ActiveBuff, type BuffKind, type CrateDef, type InventoryItem, type Mods, type ProgressEvent, type ProgressState,
  type RandInt, type Reward, type RollResult, type ItemDef,
} from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { ProgressRecord, Repos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { GameError, type Economy } from '../economy/economy';

/** A buff while the player is online: absolute expiry (ms). */
export interface ServerBuff {
  item: string;
  kind: BuffKind;
  mult: number;
  until: number;
}

export interface ServerProgress {
  xp: number;
  level: number;
  stage: number;
  title: string | null;
  titles: string[];
  stats: Record<string, number>;
  buffs: ServerBuff[];
  login: { lastDay: string | null; streak: number };
  quests: ProgressRecord['quests'];
  goalsDone: string[];
  xpFrac: number;
}

export function emptyProgress(): ServerProgress {
  return { xp: 0, level: 1, stage: 1, title: null, titles: [], stats: {}, buffs: [], login: { lastDay: null, streak: 0 }, quests: { day: null, list: [] }, goalsDone: [], xpFrac: 0 };
}

export interface ProgressionHooks {
  /** Buffs everyone has right now (a server event like Lucky Hour). */
  extraBuffs?: () => ActiveBuff[];
  /** Rebirth: the cash multiplier (×2 per rebirth); luck stays 1. */
  rebirthMods?: (p: OnlinePlayer) => { luck: number; income: number };
  /** Wallet/shards changed by `delta` sen. */
  wallet: (p: OnlinePlayer, delta: number, reason: string) => void;
  items: (p: OnlinePlayer, items: InventoryItem[]) => void;
  progress: (p: OnlinePlayer, events: ProgressEvent[]) => void;
  /** Level or title changed: other players' nameplates need updating. */
  publicChanged: (p: OnlinePlayer, change: { level?: number; title?: string | null }) => void;
  /** A system message in everyone's chat; `banner` also shows a big banner for everyone. */
  announce: (text: string, tier: string, banner: boolean) => void;
  /** One free roll of a crate (login streak day 7). Runs inside the caller's transaction. */
  freeRoll: (p: OnlinePlayer, crateId: string) => { crateId: string; results: RollResult[] };
  /** Items that aren't timed buffs (Perfect Cook Token): apply them, or throw a GameError. */
  useSpecial?: (p: OnlinePlayer, item: ItemDef) => void;
  /** Value of businesses/property for net worth (sen). */
  assetsOf?: (p: OnlinePlayer) => number;
  /** Things that decide which quests can be offered ('stall' = owns a stall). */
  flagsOf?: (p: OnlinePlayer) => Set<string>;
}

/** XP a pre-Phase-3 player earns for what their stats say they already did. */
export function retroXp(cfg: ServerConfig, stats: Record<string, number>): number {
  const x = cfg.levels.xp;
  let xp = 0;
  for (const [crate, per] of Object.entries(x.crateRoll)) xp += (stats[`rolls_${crate}`] ?? 0) * per;
  xp += (stats.jobs ?? 0) * x.jobBase + ((stats.jobEarnSen ?? 0) / 100) * x.jobPerRm;
  xp += ((stats.manifestSecs ?? 0) / 60) * x.manifestPerMinute;
  xp += (stats.skillLevels ?? 0) * x.skillLevel + (stats.sells ?? 0) * x.pawnSellPerItem;
  return Math.floor(xp);
}

export class ProgressionSystem {
  constructor(
    private readonly cfg: ServerConfig,
    private readonly repos: Repos,
    private readonly econ: Economy,
    private readonly rand: RandInt,
    private readonly hooks: ProgressionHooks,
    private readonly clock: () => number = Date.now,
  ) {}

  // ---------------------------------------------------------------- load / save / state
  load(p: OnlinePlayer) {
    const now = this.clock();
    const r = this.repos.progress.load(p.id);
    const kinds = new Set(['luck', 'xp', 'passive', 'jobPay', 'customers', 'staffSpeed']);
    p.prog = {
      xp: r.xp,
      level: r.level,
      stage: r.stage,
      title: r.title,
      titles: r.titles,
      stats: r.stats,
      buffs: r.buffs.filter((b) => b.leftMs > 0 && kinds.has(b.kind)).map((b) => ({ item: b.item, kind: b.kind as BuffKind, mult: b.mult, until: now + b.leftMs })),
      login: r.login,
      quests: r.quests,
      // Before Phase 4 the path was done strictly in order: the first `path` goals are done.
      goalsDone: r.goalsDone.length ? r.goalsDone : this.cfg.goals.goals.slice(0, r.path ?? 0).map((g) => g.id),
      xpFrac: r.xpFrac,
    };
    if (r.retroXp) {
      // Joined before Phase 3: XP for what they'd already done. Levels come without the RM
      // rewards (those are for levelling up from now on).
      p.prog.xp = retroXp(this.cfg, p.prog.stats);
      p.prog.level = levelInfo(this.cfg.levels, p.prog.xp).level;
    }
    if (p.prog.title && !p.prog.titles.includes(p.prog.title)) p.prog.title = null;
  }

  save(p: OnlinePlayer) {
    const now = this.clock();
    const g = p.prog;
    this.repos.progress.save(p.id, {
      xp: g.xp, level: g.level, stage: g.stage, title: g.title, titles: g.titles, stats: g.stats,
      buffs: g.buffs.map((b) => ({ item: b.item, kind: b.kind, mult: b.mult, leftMs: Math.max(0, b.until - now) })).filter((b) => b.leftMs > 0),
      login: g.login, quests: g.quests, goalsDone: g.goalsDone, xpFrac: g.xpFrac,
    });
  }

  activeBuffs(p: OnlinePlayer): ActiveBuff[] {
    const now = this.clock();
    const own = p.prog.buffs.filter((b) => b.until > now).map((b) => ({ item: b.item, kind: b.kind, mult: b.mult, leftMs: b.until - now }));
    return [...own, ...(this.hooks.extraBuffs?.() ?? [])];
  }

  state(p: OnlinePlayer): ProgressState {
    const g = p.prog;
    const st = loginStatus(g.login, dayKey(this.clock()));
    return {
      xp: g.xp, level: g.level, stage: g.stage, title: g.title, titles: [...g.titles], stats: { ...g.stats },
      buffs: this.activeBuffs(p),
      daily: { canClaim: st.canClaim, nextDay: st.nextDay, streak: g.login.streak },
      quests: g.quests.day === dayKey(this.clock()) ? g.quests.list.map((q) => ({ ...q })) : [],
      path: currentGoalIndex(this.cfg.goals, g.goalsDone),
      goalsDone: [...g.goalsDone],
    };
  }

  mods(p: OnlinePlayer): Mods {
    return computeMods(this.cfg.prog, { skills: p.skills, title: p.prog.title, buffs: this.activeBuffs(p), gear: gearOf(this.cfg.prog, p.equipped, p.inventory), rebirth: this.hooks.rebirthMods?.(p) });
  }

  /** The crate with this player's Pity Pact applied. */
  crateFor(p: OnlinePlayer, crate: CrateDef): CrateDef {
    return { ...crate, pity: effectivePity(crate, this.mods(p).pityMult) };
  }

  /** Why this player can't roll a crate yet, or null. */
  crateLock(p: OnlinePlayer, crate: CrateDef): string | null {
    const r = crate.requires;
    if (r.stage && p.prog.stage < r.stage) return `The ${crate.name} opens at wealth stage ${r.stage} (${stageDef(this.cfg.stages, r.stage).name}).`;
    if (r.level && p.prog.level < r.level) return `The ${crate.name} opens at Level ${r.level}.`;
    return null;
  }

  manifestRate(p: OnlinePlayer): number {
    return manifestRateSen(this.cfg.upgrades, p.skills) * this.mods(p).passive;
  }

  // ---------------------------------------------------------------- stats + XP
  bump(p: OnlinePlayer, stat: string, n = 1) {
    if (n) p.prog.stats[stat] = (p.prog.stats[stat] ?? 0) + n;
  }

  /** Raises a stat to at least `v` (e.g. the highest stall tier owned). */
  max(p: OnlinePlayer, stat: string, v: number) {
    if (v > (p.prog.stats[stat] ?? 0)) p.prog.stats[stat] = v;
  }

  /** Adds XP (× the player's XP multiplier). Fractions carry over to the next gain. */
  addXp(p: OnlinePlayer, base: number) {
    if (!(base > 0)) return;
    const total = base * this.mods(p).xp + p.prog.xpFrac;
    const whole = Math.floor(total);
    p.prog.xpFrac = total - whole;
    p.prog.xp += whole;
  }

  // ---------------------------------------------------------------- reports from other systems
  onRolls(p: OnlinePlayer, crate: CrateDef, results: RollResult[], spentSen: number) {
    this.countRolls(p, crate, results, spentSen);
    return this.check(p);
  }

  private countRolls(p: OnlinePlayer, crate: CrateDef, results: RollResult[], spentSen: number) {
    const tiers = this.cfg.rarities.tiers.map((t) => t.id);
    const epicIdx = tiers.indexOf('epic');
    for (const r of results) {
      this.bump(p, 'rolls');
      this.bump(p, `rolls_${crate.id}`);
      const ti = tiers.indexOf(r.tier);
      if (ti >= epicIdx) {
        this.bump(p, 'epicPlusRolls');
        p.prog.stats.noEpicStreak = 0;
      } else {
        this.bump(p, 'noEpicStreak');
        this.max(p, 'bestNoEpicStreak', p.prog.stats.noEpicStreak);
      }
      if (ti > epicIdx) this.bump(p, `${r.tier}Rolls`);
    }
    this.bump(p, 'crateSpendSen', spentSen);
    this.addXp(p, (this.cfg.levels.xp.crateRoll[crate.id] ?? 0) * results.length);
  }

  onJob(p: OnlinePlayer, kind: string, paidSen: number, perfect: boolean) {
    if (paidSen <= 0) return this.check(p);
    this.bump(p, 'jobs');
    this.bump(p, `jobs_${kind}`);
    this.bump(p, 'jobEarnSen', paidSen);
    if (perfect) this.bump(p, 'perfectWashes');
    const x = this.cfg.levels.xp;
    this.addXp(p, x.jobBase + (paidSen / 100) * x.jobPerRm);
    return this.check(p);
  }

  onSell(p: OnlinePlayer, n: number) {
    this.bump(p, 'sells', n);
    this.addXp(p, n * this.cfg.levels.xp.pawnSellPerItem);
    return this.check(p);
  }

  onScrap(p: OnlinePlayer, n: number) {
    this.bump(p, 'scraps', n);
    return this.check(p);
  }

  onManifest(p: OnlinePlayer, secs: number) {
    this.bump(p, 'manifestSecs', secs);
    this.addXp(p, (secs / 60) * this.cfg.levels.xp.manifestPerMinute);
    return this.check(p);
  }

  onEquip(p: OnlinePlayer) {
    this.bump(p, 'equips');
    return this.check(p);
  }

  // ---------------------------------------------------------------- player actions
  upgradeSkill(p: OnlinePlayer, id: string) {
    const def = this.cfg.upgrades.skills[id];
    if (!def) throw new GameError('Unknown skill.');
    const level = skillLevel(this.cfg.upgrades, p.skills, id);
    const lock = skillLockReason(def, level, p.prog.level, p.prog.stage, this.cfg.stages);
    if (lock) throw new GameError(level >= def.maxLevel ? `${def.name} is already maxed out.` : `${def.name}: ${lock}.`);
    const cost = skillCostSen(def, level);
    if (p.walletSen < cost) throw new GameError(`${def.name} Lv ${level + 1} costs ${formatMoney(cost)}.`);
    this.econ.run(p, () => {
      this.econ.change(p, -cost, 0, 'skill', `${id}:${level + 1}`);
      p.skills = { ...p.skills, [id]: level + 1 };
      this.econ.saveState(p);
    });
    this.hooks.wallet(p, -cost, 'skill');
    this.bump(p, 'skillLevels');
    this.addXp(p, this.cfg.levels.xp.skillLevel);
    this.check(p);
    return { level: level + 1, walletSen: p.walletSen, skills: p.skills };
  }

  /** Drink a potion: removes one and starts (or extends) its buff. */
  useItem(p: OnlinePlayer, iid: number) {
    const inst = p.inventory.find((i) => i.iid === iid);
    if (!inst) throw new GameError('You no longer have that item.');
    const def = this.cfg.itemById.get(inst.itemId);
    if (!def?.effect) throw new GameError(`${def?.name ?? 'That item'} can't be used.`);
    if (!def.effect.durationSec) {
      // Not a timed buff (e.g. Perfect Cook Token): the owning system applies it.
      if (!this.hooks.useSpecial) throw new GameError(`${def.name} can't be used yet.`);
      this.hooks.useSpecial(p, def); // throws if it can't be used right now
      const changed = this.econ.run(p, () => {
        this.econ.remove(p, iid);
        const c = this.econ.refreshCosmetics(p);
        this.econ.saveState(p);
        return c;
      });
      this.bump(p, 'potionsUsed');
      this.addXp(p, this.cfg.levels.xp.potionUse);
      this.check(p);
      return { removed: iid, cosmeticsChanged: changed };
    }
    const now = this.clock();
    const durMs = Math.round(def.effect.durationSec * 1000 * this.mods(p).potionDuration);
    const capMs = this.cfg.economy.potionMaxStackMin * 60_000;
    const existing = p.prog.buffs.find((b) => b.item === def.id && b.until > now);
    if (existing && existing.until - now + durMs > capMs) throw new GameError(`You can stack ${def.name} up to ${this.cfg.economy.potionMaxStackMin} minutes.`);
    const cosmeticsChanged = this.econ.run(p, () => {
      this.econ.remove(p, iid);
      const changed = this.econ.refreshCosmetics(p);
      this.econ.saveState(p);
      return changed;
    });
    p.prog.buffs = p.prog.buffs.filter((b) => b.until > now);
    if (existing) existing.until += durMs;
    else p.prog.buffs.push({ item: def.id, kind: def.effect.buff, mult: def.effect.mult, until: now + durMs });
    this.bump(p, 'potionsUsed');
    this.addXp(p, this.cfg.levels.xp.potionUse);
    this.check(p);
    return { removed: iid, cosmeticsChanged };
  }

  equipTitle(p: OnlinePlayer, id: string | null) {
    if (id !== null && !p.prog.titles.includes(id)) throw new GameError("You haven't earned that title yet.");
    if (p.prog.title === id) return;
    p.prog.title = id;
    if (id) this.bump(p, 'titleEquips');
    this.hooks.publicChanged(p, { title: id });
    this.check(p);
  }

  claimDaily(p: OnlinePlayer) {
    const today = dayKey(this.clock());
    const st = loginStatus(p.prog.login, today);
    if (!st.canClaim) throw new GameError("You've already claimed today's reward. Come back tomorrow!");
    const reward = this.cfg.quests.login[st.nextDay - 1];
    const before = this.money(p);
    let roll: { crateId: string; results: RollResult[] } | undefined;
    const granted = this.econ.run(p, () => {
      const items = this.grant(p, reward, `daily-${st.nextDay}`);
      if (reward.crate) roll = this.hooks.freeRoll(p, reward.crate);
      p.prog.login = { lastDay: today, streak: st.nextDay };
      this.bump(p, 'dailyClaims');
      p.prog.stats.loginStreak = st.keepsStreak ? (p.prog.stats.loginStreak ?? 0) + 1 : 1;
      this.max(p, 'bestLoginStreak', p.prog.stats.loginStreak);
      this.save(p);
      return items;
    });
    this.afterGrant(p, before, granted, 'daily');
    const crate = roll ? this.cfg.crateById.get(roll.crateId) : undefined;
    if (roll && crate) this.countRolls(p, crate, roll.results, 0);
    this.check(p);
    return { day: st.nextDay, roll };
  }

  claimQuest(p: OnlinePlayer, id: string) {
    this.rolloverQuests(p);
    const q = p.prog.quests.list.find((x) => x.id === id);
    const def = this.cfg.quests.daily.find((d) => d.id === id);
    if (!q || !def) throw new GameError("That isn't one of today's quests.");
    if (q.claimed) throw new GameError('Already claimed.');
    if (!questProgress(def, q, p.prog.stats).done) throw new GameError('Not done yet!');
    const before = this.money(p);
    const granted = this.econ.run(p, () => {
      const items = this.grant(p, { sen: q.senReward, xp: def.reward.xp, items: def.reward.items }, `quest-${id}`);
      q.claimed = true;
      this.bump(p, 'questsDone');
      this.save(p);
      return items;
    });
    this.afterGrant(p, before, granted, 'quest');
    this.check(p);
  }

  /** A one-off reward (an NPC errand...): paid in one transaction, then the usual checks. */
  reward(p: OnlinePlayer, r: Reward, reason: string, stat?: string) {
    const before = this.money(p);
    const granted = this.econ.run(p, () => {
      const items = this.grant(p, r, reason);
      if (stat) this.bump(p, stat);
      this.save(p);
      return items;
    });
    this.afterGrant(p, before, granted, reason);
    this.check(p);
  }

  // ---------------------------------------------------------------- the check
  /** Hands out new quests when the day changes (quests are per calendar day). */
  private rolloverQuests(p: OnlinePlayer) {
    const today = dayKey(this.clock());
    if (p.prog.quests.day === today) return;
    p.prog.quests = { day: today, list: pickQuests(this.cfg.quests, p.prog.stage, p.prog.stats, this.rand, this.hooks.flagsOf?.(p)) };
    this.notified.delete(p.id);
  }

  /** Quests we've already told the player are ready (so the toast shows once). */
  private notified = new Map<number, Set<string>>();

  /**
   * Applies everything that follows from the player's current numbers: level-ups, a new wealth
   * stage, new titles and Hustle Path goals, with their rewards (one transaction), then saves and
   * tells the client. Safe to call any time; it's a no-op if nothing changed.
   */
  check(p: OnlinePlayer, events: ProgressEvent[] = []): ProgressEvent[] {
    if (!p.prog) return events;
    const now = this.clock();
    p.prog.buffs = p.prog.buffs.filter((b) => b.until > now);
    this.rolloverQuests(p);
    const g = p.prog;
    const beforeMoney = this.money(p);
    const beforeLevel = g.level;
    const announcements: Array<[string, string, boolean]> = [];
    const granted = this.econ.run(p, () => {
      const items: InventoryItem[] = [];
      // Rewards can give XP (and so levels), so loop until nothing new happens.
      for (let pass = 0; pass < 6; pass++) {
        let changed = false;
        const info = levelInfo(this.cfg.levels, g.xp);
        while (g.level < info.level) {
          g.level++;
          const r = levelUpReward(this.cfg.levels, g.level);
          items.push(...this.grant(p, r, `level-${g.level}`));
          events.push({ kind: 'level', level: g.level, rewardSen: r.sen ?? 0, items: r.items ?? [] });
          if (g.level % 10 === 0) announcements.push([`⭐ ${p.name} reached Level ${g.level}!`, 'rare', false]);
          changed = true;
        }
        const snap = this.snapshot(p);
        const stage = stageForNetWorth(this.cfg.stages, snap.netWorthSen);
        while (g.stage < stage) {
          g.stage++;
          const def = stageDef(this.cfg.stages, g.stage);
          if (def.reward) items.push(...this.grant(p, def.reward, `stage-${g.stage}`));
          events.push({ kind: 'stage', stage: g.stage });
          if (g.stage >= this.cfg.stages.announceFrom) {
            announcements.push([`${def.icon} ${p.name} is now a ${def.name.toUpperCase()}!`, 'legendary', g.stage >= this.cfg.stages.bannerFrom]);
          }
          changed = true;
        }
        const snap2 = this.snapshot(p);
        const owned = new Set(g.titles);
        const tierIdx = (id: string) => this.cfg.rarities.tiers.findIndex((t) => t.id === id);
        for (const t of this.cfg.titles.titles) {
          if (owned.has(t.id) || !conditionProgress(t.cond, snap2, this.cfg.stages).done) continue;
          g.titles.push(t.id);
          if (t.cond.type !== 'always') events.push({ kind: 'title', id: t.id }); // no toast for the starter title
          if (tierIdx(t.rarity) >= tierIdx(this.cfg.titles.announceFrom)) announcements.push([`🏷️ ${p.name} earned the title "${t.name}"!`, t.rarity, false]);
          changed = true;
        }
        for (const i of newlyDoneGoals(this.cfg.goals, new Set(g.goalsDone), snap2, this.cfg.stages)) {
          const goal = this.cfg.goals.goals[i];
          items.push(...this.grant(p, goal.reward, `goal-${goal.id}`));
          events.push({ kind: 'goal', id: goal.id, rewardSen: goal.reward.sen ?? 0, items: goal.reward.items ?? [] });
          g.goalsDone.push(goal.id);
          changed = true;
        }
        if (!changed) break;
      }
      this.save(p);
      return items;
    });
    // Quests that just became claimable.
    const seen = this.notified.get(p.id) ?? new Set<string>();
    this.notified.set(p.id, seen);
    for (const q of g.quests.list) {
      const def = this.cfg.quests.daily.find((d) => d.id === q.id);
      if (!def || q.claimed || seen.has(q.id) || !questProgress(def, q, g.stats).done) continue;
      seen.add(q.id);
      events.push({ kind: 'questReady', id: q.id });
    }
    this.afterGrant(p, beforeMoney, granted, 'reward');
    if (g.level !== beforeLevel) this.hooks.publicChanged(p, { level: g.level });
    for (const [text, tier, banner] of announcements) this.hooks.announce(text, tier, banner);
    this.hooks.progress(p, events);
    return events;
  }

  private snapshot(p: OnlinePlayer) {
    return buildSnapshot(this.cfg.prog, {
      level: p.prog.level, stage: p.prog.stage, walletSen: p.walletSen, inventory: p.inventory,
      index: p.index, pages: p.pages, stats: p.prog.stats, skills: p.skills, assetsSen: this.hooks.assetsOf?.(p) ?? 0,
    });
  }

  /** Pays a reward (call inside econ.run). Returns the items granted. */
  private grant(p: OnlinePlayer, r: Reward, reason: string): InventoryItem[] {
    if ((r.sen ?? 0) > 0 || (r.shards ?? 0) > 0) this.econ.change(p, r.sen ?? 0, r.shards ?? 0, reason);
    if (r.xp) this.addXp(p, r.xp);
    const items: InventoryItem[] = [];
    for (const id of r.items ?? []) {
      const def = this.cfg.itemById.get(id);
      if (def) items.push(this.econ.grant(p, id, 'normal', null).item);
    }
    return items;
  }

  private money(p: OnlinePlayer) {
    return { sen: p.walletSen, shards: p.shards };
  }

  private afterGrant(p: OnlinePlayer, before: { sen: number; shards: number }, items: InventoryItem[], reason: string) {
    if (p.walletSen !== before.sen || p.shards !== before.shards) this.hooks.wallet(p, p.walletSen - before.sen, reason);
    if (items.length) this.hooks.items(p, items);
  }
}
