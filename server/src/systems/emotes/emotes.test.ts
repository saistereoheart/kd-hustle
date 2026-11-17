import { describe, expect, it } from 'vitest';
import { EmoteSystem } from './emotes';

const cfg = {
  maxLength: 140, historySize: 50, bubbleMs: 5000, rateLimit: { count: 5, windowMs: 5000 },
  emoteRateLimit: { count: 6, windowMs: 2000 },
  emotes: [
    { id: 'wave', name: 'Wave', emoji: '👋', loop: false, durationMs: 2400 },
    { id: 'sit', name: 'Sit', emoji: '🪑', loop: true, durationMs: 0 },
  ],
};

describe('EmoteSystem', () => {
  it('lets players spam emotes up to the burst limit', () => {
    let now = 0;
    const sys = new EmoteSystem(cfg, () => now);
    const p = { id: 1, emote: null };
    for (let i = 0; i < 6; i++) expect(sys.play(p, 'wave').kind).toBe('played');
    expect(sys.play(p, 'wave')).toEqual({ kind: 'ignored', reason: 'rate' });
    now = 2001;
    expect(sys.play(p, 'wave').kind).toBe('played');
  });

  it('remembers continuous emotes until the player moves or stops', () => {
    const sys = new EmoteSystem(cfg);
    const p = { id: 2, emote: null as string | null };
    sys.play(p, 'sit');
    expect(p.emote).toBe('sit');
    expect(sys.onMove(p, false)).toBe(false); // standing still keeps sitting
    expect(p.emote).toBe('sit');
    expect(sys.onMove(p, true)).toBe(true);
    expect(p.emote).toBeNull();
    sys.play(p, 'sit');
    sys.play(p, 'wave'); // a one-shot emote replaces the loop
    expect(p.emote).toBeNull();
    sys.play(p, 'sit');
    expect(sys.stop(p)).toBe(true);
    expect(sys.stop(p)).toBe(false);
  });

  it('ignores unknown emotes', () => {
    const sys = new EmoteSystem(cfg);
    expect(sys.play({ id: 3, emote: null }, 'moonwalk')).toEqual({ kind: 'ignored', reason: 'unknown' });
  });
});
