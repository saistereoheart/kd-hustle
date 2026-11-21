import { describe, expect, it } from 'vitest';
import { SnapClock } from './snapClock';

const cfg = { periodMs: 1000 / 15, startMs: 160, minMs: 80, maxMs: 300, marginMs: 20 };
const SERVER0 = 1_700_000_000_000;

/** Feeds `n` snapshots taken every period, each arriving after `lat(i)` ms of network delay. */
function run(clock: SnapClock, n: number, lat: (i: number) => number, start = 0) {
  const out: Array<{ mapped: number; serverT: number; arrive: number }> = [];
  for (let i = start; i < start + n; i++) {
    const serverT = SERVER0 + i * cfg.periodMs;
    const arrive = 5000 + i * cfg.periodMs + lat(i);
    out.push({ mapped: clock.map(serverT, arrive), serverT, arrive });
  }
  return out;
}

describe('SnapClock', () => {
  it('places snapshots on the server timeline, not their arrival time', () => {
    const c = new SnapClock(cfg);
    // 2 ms base latency with up to 40 ms of jitter.
    const r = run(c, 200, (i) => 2 + ((i * 37) % 41));
    // Spacing of mapped times matches the server's spacing exactly once the fastest one is seen.
    const tail = r.slice(60);
    for (let i = 1; i < tail.length; i++) expect(tail[i].mapped - tail[i - 1].mapped).toBeCloseTo(cfg.periodMs, 3);
  });

  it('settles to a short delay on a clean link and a longer one on a jittery link', () => {
    const clean = new SnapClock(cfg);
    run(clean, 600, () => 3);
    expect(clean.delay).toBeLessThan(95);
    expect(clean.delay).toBeGreaterThanOrEqual(cfg.minMs);
    const jittery = new SnapClock(cfg);
    run(jittery, 600, (i) => 20 + ((i * 53) % 120)); // up to 120 ms late
    expect(jittery.delay).toBeGreaterThan(180);
    expect(jittery.delay).toBeLessThanOrEqual(cfg.maxMs);
  });

  it('ignores a rare spike (it holds briefly instead of raising the delay for everyone)', () => {
    const c = new SnapClock(cfg);
    run(c, 300, (i) => (i === 250 ? 400 : 3));
    expect(c.delay).toBeLessThan(100);
  });

  it('keeps mapped times increasing even if the server clock steps back', () => {
    const c = new SnapClock(cfg);
    const a = run(c, 100, () => 3);
    // Server clock jumps back by 1 s: its stamps are 1 s lower for the same arrival times.
    const b: number[] = [];
    for (let i = 100; i < 200; i++) b.push(c.map(SERVER0 + i * cfg.periodMs - 1000, 5000 + i * cfg.periodMs + 3));
    const all = [...a.map((x) => x.mapped), ...b];
    for (let i = 1; i < all.length; i++) expect(all[i]).toBeGreaterThan(all[i - 1]);
    // ...and it recovers: the last ones are back to ~3 ms before arrival.
    expect(5000 + 199 * cfg.periodMs + 3 - b[b.length - 1]).toBeLessThan(10);
    expect(c.delay).toBeLessThan(170); // rose briefly while the jump was being confirmed
  });
});
