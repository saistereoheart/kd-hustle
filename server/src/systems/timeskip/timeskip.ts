// Skip the night: any player can start a vote while it's night; it passes as soon as more
// than half of the players online vote yes (one player alone can skip). The in-game clock
// then jumps to morning for everyone. Votes expire, and there's a cooldown between votes.
import { dayPhase, gameTime, inHours, type SkipVoteState, type TimeConfig } from '@kh/shared';

/** time.json → skipVote: allowed hours [from, to) (may wrap midnight), the hour the clock jumps
 *  to, vote length, cooldown, and the fraction of online players that must say yes (strictly more). */
export type SkipVoteConfig = TimeConfig['skipVote'];

export type VoteState = SkipVoteState;

export type VoteResult = { ok: true; passed: boolean; state: VoteState } | { ok: false; error: string };

export class SkipNightVote {
  private yes = new Set<number>();
  private no = new Set<number>();
  private endsAt = 0;
  private startedBy: string | null = null;
  private cooldownUntil = 0;

  constructor(private time: TimeConfig, private cfg: SkipVoteConfig) {}

  /** Is it late enough to skip? */
  isNight(now: number): boolean {
    const t = gameTime(this.time, now);
    return inHours(t.hourF, ...this.cfg.allowedHours) && dayPhase(this.time, t.hourF) !== 'day';
  }

  get active() {
    return this.endsAt > 0;
  }

  /** Votes needed out of `online` players: strictly more than majority × online. */
  needed(online: number) {
    return Math.floor(online * this.cfg.majority) + 1;
  }

  state(online: number, now: number): VoteState {
    return {
      active: this.active,
      yes: this.yes.size,
      no: this.no.size,
      needed: this.needed(online),
      online,
      endsAt: this.endsAt,
      startedBy: this.startedBy,
      canStart: !this.active && now >= this.cooldownUntil && this.isNight(now),
      cooldownUntil: this.cooldownUntil,
    };
  }

  /**
   * A player votes. With no vote running, a yes starts one (if it's night and not cooling
   * down). Returns whether the vote passed with this ballot.
   */
  vote(playerId: number, name: string, yes: boolean, online: number, now: number): VoteResult {
    if (!this.active) {
      if (!yes) return { ok: false, error: 'There is no vote to say no to.' };
      if (!this.isNight(now)) return { ok: false, error: 'You can only skip the night (8 PM – 5 AM in-game).' };
      if (now < this.cooldownUntil) return { ok: false, error: `Wait ${Math.ceil((this.cooldownUntil - now) / 1000)} s before starting another vote.` };
      this.endsAt = now + this.cfg.durationMs;
      this.startedBy = name;
    }
    (yes ? this.yes : this.no).add(playerId);
    (yes ? this.no : this.yes).delete(playerId);
    const passed = this.yes.size >= this.needed(online);
    if (passed) this.finish(now);
    return { ok: true, passed, state: this.state(online, now) };
  }

  /** Someone left: drop their ballot. Returns true if the vote now passes. */
  leave(playerId: number, online: number, now: number): boolean {
    this.yes.delete(playerId);
    this.no.delete(playerId);
    if (this.active && online > 0 && this.yes.size >= this.needed(online)) {
      this.finish(now);
      return true;
    }
    return false;
  }

  /** Call every second: ends an expired vote. Returns true if it just expired. */
  tick(now: number): boolean {
    if (this.active && now >= this.endsAt) {
      this.finish(now);
      return true;
    }
    return false;
  }

  /** Minutes to add to the clock offset so it becomes `skipToHour` (the next morning). */
  skipMinutes(now: number): number {
    const t = gameTime(this.time, now);
    const inDay = t.total - t.day * 1440;
    return ((this.cfg.skipToHour * 60 - inDay) % 1440 + 1440) % 1440;
  }

  private finish(now: number) {
    this.yes.clear();
    this.no.clear();
    this.endsAt = 0;
    this.startedBy = null;
    this.cooldownUntil = now + this.cfg.cooldownMs;
  }
}
