// 🗝️ Labirin Purba fights on the server: a battle per encounter, its players (a party in the same
// room; a lone player is a party of one), the round timer, and what happens at the end (Syiling,
// falling back to your save point, running back a room). The rules are in shared/src/lab/battle.ts.
import {
  groupCoins, labPotion, resolveLabRound, rollGroup,
  type LabAction, type LabBattleEnd, type LabBattleView, type LabConfig, type LabEvent, type LabFighter,
} from '@kh/shared';
import type { OnlinePlayer } from '../../game/world';
import { GameError } from '../economy/economy';
import type { LabSystem } from './lab';

interface Battle {
  id: number;
  floor: number;
  room: number;
  fighters: LabFighter[];
  members: Map<number, OnlinePlayer>;
  choices: Map<string, LabAction>;
  round: number;
  deadline: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface LabBattleHooks {
  /** A battle started (or someone joined): show it to these players. */
  started(players: OnlinePlayer[], view: LabBattleView): void;
  /** Someone picked (the others see who's ready). */
  picked(players: OnlinePlayer[], view: LabBattleView): void;
  /** A round was played; `ends` has an entry for each player whose fight is over. */
  round(players: OnlinePlayer[], events: LabEvent[], view: LabBattleView, ends: Map<number, LabBattleEnd>): void;
}

const pid = (p: OnlinePlayer) => `p${p.id}`;

export class LabBattles {
  private battles = new Map<number, Battle>();
  private byPlayer = new Map<number, Battle>();
  private nextId = 1;

  constructor(
    private cfg: LabConfig,
    private lab: LabSystem,
    private hooks: LabBattleHooks,
    private rand: () => number,
    private clock: () => number = Date.now,
    private schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
    private cancel: (t: ReturnType<typeof setTimeout>) => void = clearTimeout,
  ) {
    lab.inFight = (p) => this.byPlayer.has(p.id);
  }

  inFight(p: OnlinePlayer) {
    return this.byPlayer.has(p.id);
  }

  view(p: OnlinePlayer): LabBattleView | null {
    const b = this.byPlayer.get(p.id);
    return b ? this.viewOf(b) : null;
  }

  /** Just walked into a room: a waiting monster group jumps out (for you and your party here). */
  encounter(players: OnlinePlayer[]): boolean {
    const lead = players[0];
    if (!lead?.lab || players.some((p) => this.byPlayer.has(p.id))) return false;
    if (!this.lab.monstersHere(lead)) return false;
    const { floor, room } = lead.lab;
    const fighters: LabFighter[] = players.map((p) => this.fighterOf(p));
    fighters.push(...rollGroup(this.cfg, floor, players.length, this.rand));
    const b: Battle = { id: this.nextId++, floor, room, fighters, members: new Map(players.map((p) => [p.id, p])), choices: new Map(), round: 1, deadline: 0, timer: null };
    this.battles.set(b.id, b);
    for (const p of players) this.byPlayer.set(p.id, b);
    this.arm(b);
    this.hooks.started(players, this.viewOf(b));
    return true;
  }

  /** A player's pick for this round. Resolves at once when everyone still standing has picked. */
  act(p: OnlinePlayer, action: LabAction) {
    const b = this.byPlayer.get(p.id);
    if (!b) throw new GameError("You're not in a fight.");
    const me = b.fighters.find((f) => f.id === pid(p));
    if (!me || me.out) throw new GameError("You're out of this fight.");
    if (action.kind === 'skill' && me.focus < this.cfg.player.skillCost) throw new GameError('Not enough focus yet.');
    if (action.kind === 'item') {
      const pot = labPotion(this.cfg, action.item);
      if (!pot) throw new GameError('Unknown potion.');
      if (this.lab.potionCount(p, pot.id) < 1) throw new GameError(`You have no ${pot.name} left.`);
      if (pot.home) throw new GameError(`${pot.name} doesn't work in a fight. Try 🏃 Run or 💨 Asap Lari.`);
      if (pot.revive && !b.fighters.some((f) => f.side === 'party' && f.out && !f.fled)) throw new GameError('Nobody has fallen.');
      if (pot.heal && me.hp >= me.maxHp) throw new GameError("You're at full HP.");
    }
    b.choices.set(me.id, action);
    if (this.everyoneReady(b)) this.play(b);
    else this.hooks.picked([...b.members.values()], this.viewOf(b));
  }

  /** Left the game (disconnected) mid-fight: counts as running away. */
  drop(p: OnlinePlayer) {
    const b = this.byPlayer.get(p.id);
    if (!b) return;
    const me = b.fighters.find((f) => f.id === pid(p));
    if (me) {
      me.out = true;
      me.fled = true;
    }
    this.lab.setHp(p, me?.hp ?? 0);
    this.byPlayer.delete(p.id);
    b.members.delete(p.id);
    if (!b.members.size) return this.close(b);
    if (this.everyoneReady(b)) this.play(b);
  }

  // ---------------------------------------------------------------- the rounds
  private fighterOf(p: OnlinePlayer): LabFighter {
    const st = this.lab.stats(p);
    return { id: pid(p), side: 'party', name: p.name, move: '', hp: Math.max(1, this.lab.hp(p)), maxHp: st.hp, atk: st.atk, def: st.def, spd: st.spd, focus: 0, out: false, crit: st.crit, block: st.block };
  }

  private everyoneReady(b: Battle) {
    for (const p of b.members.values()) {
      const f = b.fighters.find((x) => x.id === pid(p));
      if (f && !f.out && !b.choices.has(f.id)) return false;
    }
    return true;
  }

  private arm(b: Battle) {
    if (b.timer) this.cancel(b.timer);
    b.deadline = this.clock() + this.cfg.battle.roundSec * 1000;
    b.timer = this.schedule(() => this.play(b), this.cfg.battle.roundSec * 1000 + 250);
  }

  private play(b: Battle) {
    if (!this.battles.has(b.id)) return;
    if (b.timer) this.cancel(b.timer);
    b.timer = null;
    const actions = Object.fromEntries(b.choices);
    b.choices.clear();
    const { events, outcome, used } = resolveLabRound(this.cfg, b.fighters, actions, this.rand);
    const players = [...b.members.values()];
    // 🧪 Potions used this round come out of their bags.
    for (const u of used) {
      const who = players.find((x) => pid(x) === u.actor);
      if (who) this.lab.consume(who, u.item);
    }
    const ends = new Map<number, LabBattleEnd>();
    // Each player: HP carries over. Running away ends your fight at once; fainting doesn't (you
    // wait it out: if your party wins you're back up at 1 HP and share the Syiling).
    for (const p of players) {
      const f = b.fighters.find((x) => x.id === pid(p))!;
      if (outcome === null && !f.fled) continue;
      let end: LabBattleEnd;
      if (f.fled) {
        this.lab.setHp(p, f.hp);
        end = { outcome: 'fled', coins: 0, lost: 0 };
      } else if (outcome === 'win') {
        const coins = groupCoins(this.cfg, b.floor, b.fighters.filter((x) => x.side === 'foe'));
        this.lab.setHp(p, f.out ? 1 : f.hp);
        this.lab.won(p, b.floor, b.room, coins);
        end = { outcome: 'win', coins, lost: 0 };
      } else {
        end = { outcome: 'wipe', coins: 0, lost: 0 };
      }
      ends.set(p.id, end);
    }
    // Free them before moving anyone (the moves check they're not fighting).
    for (const id of ends.keys()) {
      this.byPlayer.delete(id);
      b.members.delete(id);
    }
    for (const p of players) {
      const end = ends.get(p.id);
      if (end?.outcome === 'wipe') end.lost = this.lab.fell(p);
      else if (end?.outcome === 'fled') this.lab.fled(p);
    }
    const view = this.viewOf(b);
    if (!b.members.size) this.close(b);
    else {
      b.round++;
      this.arm(b);
      view.round = b.round;
      view.deadline = b.deadline;
    }
    this.hooks.round(players, events, view, ends);
  }

  private close(b: Battle) {
    if (b.timer) this.cancel(b.timer);
    b.timer = null;
    this.battles.delete(b.id);
    for (const id of b.members.keys()) this.byPlayer.delete(id);
  }

  private viewOf(b: Battle): LabBattleView {
    return { id: b.id, floor: b.floor, room: b.room, round: b.round, deadline: b.deadline, roundSec: this.cfg.battle.roundSec, fighters: b.fighters.map((f) => ({ ...f })), chosen: [...b.choices.keys()] };
  }
}
