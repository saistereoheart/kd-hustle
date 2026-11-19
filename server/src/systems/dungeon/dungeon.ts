// ⚔️ Gua Gelap, server side (rules in shared/src/dungeon). The server owns the run: it picks the
// enemies, issues each turn (zone, speed, wind-up) and grades the two taps the client reports,
// checking they're possible (no taps from before the turn was sent, none later than the time
// that has really passed). Loot is paid when you cash out, fall, flee or disconnect.
import {
  dayKey, deathLoot, enemyFor, floorLoot, makeTurn, playerStats, resolveTurn,
  type DungeonLoot, type DungeonRun, type DungeonTurn, type DungeonView, type RandInt, type TurnResult,
} from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { Repos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { GameError, type Economy } from '../economy/economy';
import type { ProgressionSystem } from '../progression/progression';

/** Allowance for the network between the server sending a turn and the client's taps (ms). */
const LATENCY_MS = 600;
/** Faster than a human can react: such a strike counts as a miss. */
const MIN_STRIKE_MS = 120;

interface Saved {
  day: string;
  runs: number;
  best: number;
}

interface ServerRun extends DungeonRun {
  /** Server ms the current turn was sent. */
  issuedAt: number;
}

export interface DungeonHooks {
  wallet: (p: OnlinePlayer, delta: number, reason: string) => void;
}

export class DungeonSystem {
  private runs = new Map<number, ServerRun>();
  private saved = new Map<number, Saved>();
  private nonce = 1;

  constructor(
    private cfg: ServerConfig,
    private repos: Repos,
    private econ: Economy,
    private prog: ProgressionSystem,
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
    return {
      name: this.dc().name,
      runsLeft: Math.max(0, this.dc().runsPerDay - s.runs),
      runsPerDay: this.dc().runsPerDay,
      best: s.best,
      run: r ? { floor: r.floor, hp: r.hp, maxHp: r.maxHp, atk: r.atk, enemy: { ...r.enemy }, phase: r.phase, loot: { ...r.loot }, turn: r.turn } : null,
    };
  }

  private newTurn(r: ServerRun): DungeonTurn {
    r.turn = makeTurn(this.dc(), r.floor, this.nonce++, this.rand);
    r.issuedAt = this.clock();
    return r.turn;
  }

  enter(p: OnlinePlayer): DungeonView {
    const old = this.runs.get(p.id);
    if (old && old.phase !== 'dead') throw new GameError("You're already in the cave.");
    this.runs.delete(p.id);
    const s = this.state(p);
    if (s.runs >= this.dc().runsPerDay) throw new GameError(`That's all ${this.dc().runsPerDay} runs for today. The cave opens again tomorrow.`);
    s.runs++;
    this.store(p);
    const st = playerStats(this.dc(), p.prog.level);
    const r: ServerRun = {
      floor: 1, hp: st.hp, maxHp: st.hp, atk: st.atk, enemy: enemyFor(this.dc(), 1, p.prog.level, this.rand), phase: 'fight',
      loot: { sen: 0, shards: 0, xp: 0 }, turn: null, issuedAt: 0,
    };
    this.newTurn(r);
    this.runs.set(p.id, r);
    this.prog.bump(p, 'dungeonRuns');
    return this.view(p);
  }

  /** Your two taps for the current turn (ms after it was shown; null = didn't tap). */
  turn(p: OnlinePlayer, nonce: number, strikeMs: number | null, blockMs: number | null): { result: TurnResult; view: DungeonView; paid: DungeonLoot | null } {
    const r = this.runs.get(p.id);
    if (!r || r.phase !== 'fight' || !r.turn) throw new GameError('No fight going on.');
    if (r.turn.nonce !== nonce) throw new GameError('That turn is over.');
    // Only what's possible: not before the turn, not later than the time that has really passed.
    const elapsed = this.clock() - r.issuedAt + LATENCY_MS;
    const ok = (ms: number | null) => (ms === null || (Number.isFinite(ms) && ms >= 0 && ms <= elapsed) ? ms : null);
    let s = ok(strikeMs);
    if (s !== null && s < MIN_STRIKE_MS) s = null;
    let b = ok(blockMs);
    if (b !== null && s !== null && b < s) b = null;
    const result = resolveTurn(this.dc(), r, r.turn, s, b, p.prog.stage);
    let paid: DungeonLoot | null = null;
    if (result.killed) {
      this.prog.bump(p, 'dungeonFloors');
      if (r.enemy.boss) this.prog.bump(p, 'dungeonBosses');
      const st = this.state(p);
      if (r.floor > st.best) {
        st.best = r.floor;
        this.store(p);
      }
      this.prog.max(p, 'dungeonBest', r.floor);
      r.turn = null;
    } else if (result.dead) {
      r.turn = null;
      paid = this.pay(p, deathLoot(this.dc(), r.loot));
    } else this.newTurn(r);
    return { result, view: this.view(p), paid };
  }

  /** After clearing a floor: on to the next one (patched up a little first). */
  deeper(p: OnlinePlayer): DungeonView {
    const r = this.runs.get(p.id);
    if (!r || r.phase !== 'cleared') throw new GameError('Beat this floor first.');
    r.floor++;
    r.hp = Math.min(r.maxHp, r.hp + Math.round(r.maxHp * this.dc().healPerFloor));
    r.enemy = enemyFor(this.dc(), r.floor, p.prog.level, this.rand);
    r.phase = 'fight';
    this.newTurn(r);
    return this.view(p);
  }

  /** Cash out between floors (all the loot), or flee mid-fight (like falling: half). */
  leave(p: OnlinePlayer): { paid: DungeonLoot; view: DungeonView } {
    const r = this.runs.get(p.id);
    if (!r) throw new GameError("You're not in the cave.");
    this.runs.delete(p.id);
    if (r.phase === 'dead') return { paid: { sen: 0, shards: 0, xp: 0 }, view: this.view(p) }; // already paid
    const loot = r.phase === 'cleared' ? r.loot : deathLoot(this.dc(), r.loot);
    return { paid: this.pay(p, loot), view: this.view(p) };
  }

  private pay(p: OnlinePlayer, loot: DungeonLoot): DungeonLoot {
    if (loot.sen || loot.shards) {
      this.econ.run(p, () => this.econ.change(p, loot.sen, loot.shards, 'dungeon', `floor`));
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

  /** For tests: loot for a floor at the player's stage. */
  lootFor(p: OnlinePlayer, floor: number) {
    return floorLoot(this.dc(), p.prog.stage, floor);
  }
}
