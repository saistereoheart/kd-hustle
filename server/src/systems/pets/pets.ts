// 🐾 Teman, server side: buying a starter, the battle team, training (pay for a level), stat
// upgrades, pet gear, and battle XP. A pet is an inventory item; its progress is kept per item
// (iid) in player_data 'pets'. Pets in the team and gear on a pet can't be sold, traded or merged.
import {
  PET_STATS, addPetXp, emptyPets, gradeMult, newProgress, petStats, petUpgradeCostSen, petXpToNext, trainCostSen, variantMult,
  type Fighter, type PetCard, type PetProgress, type PetStat, type PetsState, type PetsView,
} from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { Repos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { GameError, type Economy } from '../economy/economy';

export interface PetHooks {
  wallet: (p: OnlinePlayer, delta: number, reason: string) => void;
  items: (p: OnlinePlayer, items: OnlinePlayer['inventory']) => void;
  check: (p: OnlinePlayer) => void;
}

export class PetSystem {
  private cache = new Map<number, PetsState>();

  constructor(
    private cfg: ServerConfig,
    private repos: Repos,
    private econ: Economy,
    private hooks: PetHooks,
  ) {}

  private pc() {
    return this.cfg.pets;
  }

  private typeOf(p: OnlinePlayer, iid: number): string | null {
    const it = p.inventory.find((i) => i.iid === iid);
    return it ? (this.cfg.itemById.get(it.itemId)?.type ?? null) : null;
  }

  /** Your pets' state, tidied: pets or gear you no longer have are dropped. */
  state(p: OnlinePlayer): PetsState {
    let s = this.cache.get(p.id);
    if (!s) {
      s = this.repos.playerData.load<PetsState>(p.id, 'pets') ?? emptyPets();
      s.team ??= [];
      s.pets ??= {};
      this.cache.set(p.id, s);
    }
    const have = new Set(p.inventory.map((i) => i.iid));
    for (const k of Object.keys(s.pets)) {
      if (!have.has(Number(k))) delete s.pets[k];
      else if (s.pets[k].gear !== null && !have.has(s.pets[k].gear!)) s.pets[k].gear = null;
    }
    s.team = s.team.filter((iid) => this.typeOf(p, iid) === 'pet').slice(0, this.pc().battle.teamSize);
    return s;
  }

  private save(p: OnlinePlayer) {
    this.repos.playerData.save(p.id, 'pets', this.state(p));
  }

  private progOf(s: PetsState, iid: number): PetProgress {
    return (s.pets[iid] ??= newProgress());
  }

  private mine(p: OnlinePlayer, iid: number) {
    if (this.typeOf(p, iid) !== 'pet') throw new GameError("That isn't one of your Teman.");
    return p.inventory.find((i) => i.iid === iid)!;
  }

  statsOf(p: OnlinePlayer, iid: number): Record<PetStat, number> {
    const it = this.mine(p, iid);
    const def = this.cfg.itemById.get(it.itemId)!;
    const prog = this.progOf(this.state(p), iid);
    const gearIt = prog.gear !== null ? p.inventory.find((i) => i.iid === prog.gear) : undefined;
    const gearDef = gearIt && this.cfg.itemById.get(gearIt.itemId);
    const grades = this.cfg.prog.grades!;
    return petStats(
      this.pc(),
      { id: def.id, rarity: def.rarity, gradeMult: gradeMult(grades, it.grade), variantMult: variantMult(this.cfg.rarities, it.variant) },
      prog,
      gearIt && gearDef ? { id: gearDef.id, rarity: gearDef.rarity, gradeMult: gradeMult(grades, gearIt.grade) } : null,
    );
  }

  view(p: OnlinePlayer): PetsView {
    const s = this.state(p);
    const pc = this.pc();
    const pets: PetCard[] = p.inventory
      .filter((i) => this.cfg.itemById.get(i.itemId)?.type === 'pet')
      .map((i) => {
        const prog = this.progOf(s, i.iid);
        const max = prog.level >= pc.maxLevel;
        const upgradeSen = {} as Record<PetStat, number | null>;
        for (const st of PET_STATS) upgradeSen[st] = prog.up[st] >= pc.upgrade.maxLevel ? null : petUpgradeCostSen(pc, prog.up[st]);
        return {
          iid: i.iid, itemId: i.itemId, level: prog.level, xp: prog.xp, xpNext: max ? 0 : petXpToNext(pc, prog.level), up: { ...prog.up }, gear: prog.gear,
          stats: this.statsOf(p, i.iid), trainSen: max ? null : trainCostSen(pc, prog.level), upgradeSen,
        };
      });
    return { team: [...s.team], teamSize: pc.battle.teamSize, starters: { ...pc.starters }, pets };
  }

  /** Buy a starter (the first one also joins your team). */
  buyStarter(p: OnlinePlayer, id: string): PetsView {
    const pc = this.pc();
    if (!pc.starters.ids.includes(id)) throw new GameError("That one isn't sold here: roll a Telur Teman.");
    if (p.walletSen < pc.starters.priceSen) throw new GameError('Not enough money.');
    const got = this.econ.run(p, () => {
      this.econ.change(p, -pc.starters.priceSen, 0, 'pets', `starter:${id}`);
      return this.econ.grant(p, id, 'normal', null);
    });
    this.hooks.wallet(p, -pc.starters.priceSen, 'pets');
    this.hooks.items(p, [got.item]);
    const s = this.state(p);
    if (s.team.length < pc.battle.teamSize) s.team.push(got.item.iid);
    this.save(p);
    this.hooks.check(p);
    return this.view(p);
  }

  setTeam(p: OnlinePlayer, iids: number[]): PetsView {
    const pc = this.pc();
    const uniq = [...new Set(iids)];
    if (uniq.length > pc.battle.teamSize) throw new GameError(`A team has up to ${pc.battle.teamSize} Teman.`);
    for (const iid of uniq) this.mine(p, iid);
    this.state(p).team = uniq;
    this.save(p);
    return this.view(p);
  }

  /** Pay for a training session: one level up now. */
  train(p: OnlinePlayer, iid: number): { view: PetsView; level: number } {
    this.mine(p, iid);
    const s = this.state(p);
    const prog = this.progOf(s, iid);
    if (prog.level >= this.pc().maxLevel) throw new GameError("It's already at the top level.");
    const cost = trainCostSen(this.pc(), prog.level);
    if (p.walletSen < cost) throw new GameError('Not enough money.');
    this.econ.run(p, () => this.econ.change(p, -cost, 0, 'pets', `train:${iid}`));
    this.hooks.wallet(p, -cost, 'pets');
    prog.level++;
    prog.xp = 0;
    this.save(p);
    return { view: this.view(p), level: prog.level };
  }

  upgrade(p: OnlinePlayer, iid: number, stat: PetStat): PetsView {
    this.mine(p, iid);
    const pc = this.pc();
    const prog = this.progOf(this.state(p), iid);
    if (prog.up[stat] >= pc.upgrade.maxLevel) throw new GameError('That stat is maxed.');
    const cost = petUpgradeCostSen(pc, prog.up[stat]);
    if (p.walletSen < cost) throw new GameError('Not enough money.');
    this.econ.run(p, () => this.econ.change(p, -cost, 0, 'pets', `upgrade:${iid}:${stat}`));
    this.hooks.wallet(p, -cost, 'pets');
    prog.up[stat]++;
    this.save(p);
    return this.view(p);
  }

  /** Put a piece of pet gear on a pet (or take it off with null). One pet per piece. */
  setGear(p: OnlinePlayer, iid: number, gear: number | null): PetsView {
    this.mine(p, iid);
    const s = this.state(p);
    if (gear !== null) {
      if (this.typeOf(p, gear) !== 'petgear') throw new GameError("That isn't pet gear.");
      for (const k of Object.keys(s.pets)) if (s.pets[k].gear === gear) s.pets[k].gear = null; // moves from another pet
    }
    this.progOf(s, iid).gear = gear;
    this.save(p);
    return this.view(p);
  }

  /** Pets in the team and gear on a pet: kept out of selling, trading and merging. */
  lockedIids(p: OnlinePlayer): Set<number> {
    const s = this.state(p);
    const out = new Set<number>(s.team);
    for (const k of Object.keys(s.pets)) if (s.pets[k].gear !== null) out.add(s.pets[k].gear!);
    return out;
  }

  /** Your team, ready to fight (full HP), in order. */
  fighters(p: OnlinePlayer): Fighter[] {
    const s = this.state(p);
    return s.team.map((iid) => {
      const it = p.inventory.find((i) => i.iid === iid)!;
      const def = this.cfg.itemById.get(it.itemId)!;
      const sp = this.pc().species[def.id];
      const st = this.statsOf(p, iid);
      return { side: 'pet', id: def.id, name: def.name, hp: st.hp, maxHp: st.hp, atk: st.atk, def: st.def, spd: st.spd, points: 0, move: sp?.move ?? 'Serang', ultimate: sp?.ultimate ?? 'Serangan Maut', iid } satisfies Fighter;
    });
  }

  /** Battle XP for these pets; returns who levelled up. */
  addXp(p: OnlinePlayer, iids: number[], xp: number): Array<{ name: string; level: number }> {
    const s = this.state(p);
    const out: Array<{ name: string; level: number }> = [];
    for (const iid of iids) {
      if (this.typeOf(p, iid) !== 'pet') continue;
      const prog = this.progOf(s, iid);
      if (addPetXp(this.pc(), prog, xp)) {
        const it = p.inventory.find((i) => i.iid === iid)!;
        out.push({ name: this.cfg.itemById.get(it.itemId)?.name ?? 'Teman', level: prog.level });
      }
    }
    this.save(p);
    return out;
  }

  unload(p: OnlinePlayer) {
    this.cache.delete(p.id);
  }
}
