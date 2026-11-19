// ⚔️ Gua Gelap, server side (rules in shared/src/dungeon and shared/src/pets). The server owns the
// run: your team (from 🐾 Teman), the enemies, every roll. Each round you send an action (or Auto,
// or Skip to play the fight out); the server answers with what happened. Loot is paid when you
// cash out, fall, flee or disconnect; your pets get XP for every floor they clear.
import {
  autoChoice, dayKey, deathLoot, enemyFor, floorLoot, resolveRound,
  type BattleAction, type BattleEvent, type DungeonLoot, type DungeonRun, type DungeonView, type RandInt,
} from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { Repos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { GameError, type Economy } from '../economy/economy';
import type { ProgressionSystem } from '../progression/progression';
import type { PetSystem } from '../pets/pets';

interface Saved {
  day: string;
  runs: number;
  best: number;
}

interface ServerRun extends DungeonRun {
  taunts: string[];
}

export interface DungeonHooks {
  wallet: (p: OnlinePlayer, delta: number, reason: string) => void;
}

const ZERO: DungeonLoot = { sen: 0, shards: 0, xp: 0, petXp: 0 };

export class DungeonSystem {
  private runs = new Map<number, ServerRun>();
  private saved = new Map<number, Saved>();

  constructor(
    private cfg: ServerConfig,
    private repos: Repos,
    private econ: Economy,
    private prog: ProgressionSystem,
    private pets: PetSystem,
    private rand: RandInt,
    private hooks: DungeonHooks,
    private clock: () => number = Date.now,
  ) {}

  private dc() {
    return this.cfg.dungeon;
  }

  private state(p: OnlinePlayer): Saved {
    let s = this.saved.get(p.id);
    if (!s) {
      const d = this.repos.playerData.load<Partial<Saved>>(p.id, 'dungeon');
      s = { day: d?.day ?? '', runs: d?.runs ?? 0, best: d?.best ?? 0 };
      this.saved.set(p.id, s);
    }
    const today = dayKey(this.clock());
    if (s.day !== today) {
      s.day = today;
      s.runs = 0;
    }
    return s;
  }

  private store(p: OnlinePlayer) {
    this.repos.playerData.save(p.id, 'dungeon', this.state(p));
  }

  view(p: OnlinePlayer): DungeonView {
    const s = this.state(p);
    const r = this.runs.get(p.id);
    const copy = (x: ServerRun): DungeonRun => ({
      floor: x.floor, team: x.team.map((f) => ({ ...f })), active: x.active, enemy: { ...x.enemy }, enemyLine: x.enemyLine, phase: x.phase, loot: { ...x.loot }, round: x.round,
    });
    return { name: this.dc().name, runsLeft: Math.max(0, this.dc().runsPerDay - s.runs), runsPerDay: this.dc().runsPerDay, best: s.best, run: r ? copy(r) : null };
  }

  private spawn(r: ServerRun) {
    const e = enemyFor(this.dc(), r.floor, this.rand);
    r.enemy = e.fighter;
    r.enemyLine = e.def.line;
    r.taunts = e.def.taunts;
    r.round = 0;
  }

  enter(p: OnlinePlayer): DungeonView {
    const old = this.runs.get(p.id);
    if (old && old.phase !== 'dead') throw new GameError("You're already in the cave.");
    this.runs.delete(p.id);
    const team = this.pets.fighters(p);
    if (!team.length) throw new GameError('You need a Teman to fight with: 📱 Teman → buy a starter (or roll a Telur Teman).');
    const s = this.state(p);
    if (s.runs >= this.dc().runsPerDay) throw new GameError(`That's all ${this.dc().runsPerDay} runs for today. The cave opens again tomorrow.`);
    s.runs++;
    this.store(p);
    const r: ServerRun = { floor: 1, team, active: 0, enemy: team[0], enemyLine: '', phase: 'fight', loot: { ...ZERO }, round: 0, taunts: [] };
    this.spawn(r);
    this.runs.set(p.id, r);
    this.prog.bump(p, 'dungeonRuns');
    return this.view(p);
  }

  /** One round (or, with `skip`, the whole fight on Auto). */
  act(p: OnlinePlayer, action: BattleAction | 'auto', skip = false): { events: BattleEvent[]; view: DungeonView; paid: DungeonLoot | null; levelUps: Array<{ name: string; level: number }> } {
    const r = this.runs.get(p.id);
    if (!r || r.phase !== 'fight') throw new GameError('No fight going on.');
    const pc = this.cfg.pets;
    const events: BattleEvent[] = [];
    let paid: DungeonLoot | null = null;
    let levelUps: Array<{ name: string; level: number }> = [];
    do {
      const me = r.team[r.active];
      const choice: BattleAction = action === 'auto' || skip ? autoChoice(pc, me, r.enemy) : action;
      const res = resolveRound(pc, r.team, r.active, r.enemy, choice, this.rand, r.taunts);
      events.push(...res.events);
      r.active = res.active;
      r.round++;
      if (res.over === 'win') {
        const loot = floorLoot(this.dc(), p.prog.stage, r.floor, pc.xp.perFloor, pc.xp.bossMult);
        r.loot = { sen: r.loot.sen + loot.sen, shards: r.loot.shards + loot.shards, xp: r.loot.xp + loot.xp, petXp: r.loot.petXp + loot.petXp };
        // Every pet on the team learns from the win (even one that fell).
        levelUps = this.pets.addXp(p, r.team.map((f) => f.iid!).filter(Boolean), loot.petXp);
        this.prog.bump(p, 'dungeonFloors');
        if (r.enemy.boss) this.prog.bump(p, 'dungeonBosses');
        const st = this.state(p);
        if (r.floor > st.best) {
          st.best = r.floor;
          this.store(p);
        }
        this.prog.max(p, 'dungeonBest', r.floor);
        r.phase = 'cleared';
      } else if (res.over === 'lose') {
        r.phase = 'dead';
        paid = this.pay(p, deathLoot(this.dc(), r.loot));
      } else if (r.round >= pc.battle.maxRounds) {
        // A stalemate: the enemy runs off. No loot for this floor, but you can carry on.
        events.push({ kind: 'flee', side: 'enemy', name: r.enemy.name, text: `${r.enemy.name} lari! (too long a fight)` });
        r.phase = 'cleared';
      }
    } while (skip && r.phase === 'fight');
    return { events, view: this.view(p), paid, levelUps };
  }

  /** After clearing a floor: on to the next one (the team patches up a little). */
  deeper(p: OnlinePlayer): DungeonView {
    const r = this.runs.get(p.id);
    if (!r || r.phase !== 'cleared') throw new GameError('Beat this floor first.');
    r.floor++;
    for (const f of r.team) if (f.hp > 0) f.hp = Math.min(f.maxHp, f.hp + Math.round(f.maxHp * this.dc().healPerFloor));
    if (r.team[r.active].hp <= 0) r.active = Math.max(0, r.team.findIndex((f) => f.hp > 0));
    for (const f of r.team) f.points = 0;
    r.phase = 'fight';
    this.spawn(r);
    return this.view(p);
  }

  /** Cash out between floors (all the loot), or flee mid-fight (like falling: half). */
  leave(p: OnlinePlayer): { paid: DungeonLoot; view: DungeonView } {
    const r = this.runs.get(p.id);
    if (!r) throw new GameError("You're not in the cave.");
    this.runs.delete(p.id);
    if (r.phase === 'dead') return { paid: { ...ZERO }, view: this.view(p) }; // already paid
    const loot = r.phase === 'cleared' ? r.loot : deathLoot(this.dc(), r.loot);
    return { paid: this.pay(p, loot), view: this.view(p) };
  }

  private pay(p: OnlinePlayer, loot: DungeonLoot): DungeonLoot {
    if (loot.sen || loot.shards) {
      this.econ.run(p, () => this.econ.change(p, loot.sen, loot.shards, 'dungeon', 'loot'));
      this.hooks.wallet(p, loot.sen, 'dungeon');
      this.prog.bump(p, 'dungeonEarnSen', loot.sen);
    }
    if (loot.xp) this.prog.addXp(p, loot.xp);
    this.prog.check(p);
    return loot;
  }

  /** Logged off / disconnected: cleared floors are banked in full, a fight in progress like fleeing. */
  unload(p: OnlinePlayer) {
    const r = this.runs.get(p.id);
    if (r && r.phase !== 'dead') {
      try {
        this.leave(p);
      } catch {
        /* nothing to pay */
      }
    }
    this.runs.delete(p.id);
    this.saved.delete(p.id);
  }
}
