// Puts position snapshots on the SERVER's timeline and decides how far in the past to draw others.
//
// Stamping a snapshot with its arrival time (as before) turned every WiFi hiccup and server timer
// wobble into a visible stutter, and needed a big fixed delay (160 ms) to hide it. Here each
// snapshot is placed at the moment the server took it (its own timestamp, mapped onto this
// device's clock through the least-delayed snapshot seen). Arrival jitter then only matters if a
// snapshot is so late it isn't there yet when it's needed, so the delay is sized to how late they
// actually arrive: ~90 ms on good WiFi, more on a jittery link (ZeroTier, busy WiFi).

export interface SnapClockConfig {
  /** Time between snapshots (ms). */
  periodMs: number;
  /** Delay to start with, before there's anything to measure. */
  startMs: number;
  minMs: number;
  maxMs: number;
  /** Safety margin on top of the measured lateness. */
  marginMs: number;
}

/** How many recent snapshots the lateness estimate looks at (~6 s at 15 Hz). */
const WINDOW = 90;
/** The fastest-arriving snapshot in this many defines the clock mapping (~3 s at 15 Hz). */
const BASE_WINDOW = 45;
/** Lateness percentile to cover: a rare spike is allowed to cause a brief hold. */
const PCT = 0.95;
/** Per snapshot, the delay may rise this much (ms) and fall this much: up fast, down gently. */
const RISE = 6;
const FALL = 0.6;
/** If this many snapshots in a row all arrive more than JUMP_MS later than the mapping says, the
 *  server's clock stepped back (or the route changed): the mapping is reset. */
const JUMP_MS = 150;
const JUMP_RUN = 8;

export class SnapClock {
  /** Local time minus server time for the least-delayed recent snapshot (ms). */
  private base = NaN;
  private recentD: number[] = [];
  private late: number[] = [];
  private lastMapped = -Infinity;
  /** How far in the past (ms) to draw remote players right now. */
  delay: number;

  constructor(private readonly c: SnapClockConfig) {
    this.delay = c.startMs;
  }

  /**
   * A snapshot stamped `serverT` (server Date.now) arrived at local time `now` (performance.now).
   * Returns the local time its positions belong at.
   */
  map(serverT: number, now: number): number {
    const d = now - serverT;
    this.recentD.push(d);
    if (this.recentD.length > BASE_WINDOW) this.recentD.shift();
    const windowMin = Math.min(...this.recentD);
    const run = this.recentD.slice(-JUMP_RUN);
    if (!(this.base <= d)) this.base = d; // first one, or one that came quicker: adopt it at once
    else if (run.length === JUMP_RUN && Math.min(...run) - this.base > JUMP_MS) {
      // Server clock jumped back: start over from the latest few (the old lateness no longer applies).
      this.base = Math.min(...run);
      this.recentD = run;
      this.late = [];
    } else if (windowMin > this.base) this.base += Math.min(windowMin - this.base, 0.5); // slow drift
    // Never earlier than the previous one (keeps the sample buffers in order).
    const mapped = Math.max(serverT + this.base, this.lastMapped + 1);
    this.lastMapped = mapped;
    this.late.push(now - mapped);
    if (this.late.length > WINDOW) this.late.shift();
    this.retarget();
    return mapped;
  }

  /** The delay this link needs: one snapshot interval plus how late snapshots run, plus a margin. */
  target(): number {
    const s = [...this.late].sort((a, b) => a - b);
    const lateP = s.length ? s[Math.min(s.length - 1, Math.floor(s.length * PCT))] : this.c.startMs - this.c.periodMs - this.c.marginMs;
    return Math.min(this.c.maxMs, Math.max(this.c.minMs, this.c.periodMs + Math.max(0, lateP) + this.c.marginMs));
  }

  private retarget() {
    // Wait for a little history before moving off the start value.
    if (this.late.length < 15) return;
    const t = this.target();
    if (t > this.delay) this.delay = Math.min(t, this.delay + RISE);
    else this.delay = Math.max(t, this.delay - FALL);
  }
}
