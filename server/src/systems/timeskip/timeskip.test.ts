import { describe, expect, it } from 'vitest';
import { gameTime, type TimeConfig } from '@kh/shared';
import { SkipNightVote } from './timeskip';

const cfg = { allowedHours: [20, 5] as [number, number], skipToHour: 7, durationMs: 30_000, cooldownMs: 60_000, majority: 0.5 };
const time: TimeConfig = {
  realMsPerGameMinute: 1000,
  offsetGameMinutes: 0,
  phases: { dawn: [5, 7], day: [7, 18], dusk: [18, 20] },
  rushHours: [],
  skipVote: cfg,
};
/** Real ms at which the clock shows `hour`:00 on day 3. */
const at = (hour: number) => (3 * 1440 + hour * 60) * 1000;

describe('skip-the-night vote', () => {
  it('only starts at night', () => {
    const v = new SkipNightVote(time, cfg);
    expect(v.vote(1, 'a', true, 3, at(12))).toMatchObject({ ok: false });
    expect(v.vote(1, 'a', true, 3, at(22))).toMatchObject({ ok: true });
  });

  it('a lone player skips straight away', () => {
    const v = new SkipNightVote(time, cfg);
    const r = v.vote(1, 'a', true, 1, at(23));
    expect(r).toMatchObject({ ok: true, passed: true });
  });

  it('needs MORE than half of the players online', () => {
    const v = new SkipNightVote(time, cfg);
    expect(v.needed(2)).toBe(2);
    expect(v.needed(3)).toBe(2);
    expect(v.needed(4)).toBe(3);
    expect(v.needed(5)).toBe(3);
    expect(v.vote(1, 'a', true, 4, at(1))).toMatchObject({ ok: true, passed: false });
    expect(v.vote(2, 'b', false, 4, at(1))).toMatchObject({ ok: true, passed: false });
    expect(v.vote(3, 'c', true, 4, at(1))).toMatchObject({ ok: true, passed: false });
    // b changes their mind: 3 of 4.
    expect(v.vote(2, 'b', true, 4, at(1))).toMatchObject({ ok: true, passed: true });
  });

  it('passes when a no-voter leaves and the yes votes become a majority', () => {
    const v = new SkipNightVote(time, cfg);
    v.vote(1, 'a', true, 3, at(21));
    v.vote(2, 'b', false, 3, at(21));
    expect(v.leave(2, 2, at(21))).toBe(false); // 1 of 2 isn't more than half
    expect(v.leave(3, 1, at(21))).toBe(true); // 1 of 1
  });

  it('expires, then cools down before the next vote', () => {
    const v = new SkipNightVote(time, cfg);
    v.vote(1, 'a', true, 3, at(21));
    expect(v.tick(at(21) + 29_000)).toBe(false);
    expect(v.tick(at(21) + 30_000)).toBe(true);
    expect(v.active).toBe(false);
    expect(v.vote(1, 'a', true, 3, at(21) + 31_000)).toMatchObject({ ok: false });
    expect(v.vote(1, 'a', true, 3, at(21) + 91_000)).toMatchObject({ ok: true });
  });

  it('jumps the clock to 7 AM the next morning', () => {
    const v = new SkipNightVote(time, cfg);
    for (const h of [20, 23.5, 0, 4]) {
      const now = at(h);
      const shifted = { ...time, offsetGameMinutes: v.skipMinutes(now) };
      const t = gameTime(shifted, now);
      expect(t.hour).toBe(7);
      expect(t.minute).toBe(0);
    }
  });
});
