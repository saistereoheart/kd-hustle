import { describe, expect, it } from 'vitest';
import casinoJson from '../../config/casino.json';
import {
  casinoConfigSchema, crashMsFor, crashMultAt, crashPoint, handValue, highLowChance, highLowMult, isBlackjack, rouletteReturn, settleBlackjack, slotsPayout, slotsRtp,
  wheelLayout, wheelRtp, ROULETTE_BETS,
} from './casino';

const cfg = casinoConfigSchema.parse(casinoJson);
const card = (rank: number, suit = 0) => rank * 4 + suit;

describe('casino maths (house edge 1–6%)', () => {
  it('slots return about 95%; three of a kind and two cherries pay', () => {
    const rtp = slotsRtp(cfg);
    expect(rtp).toBeGreaterThan(0.94);
    expect(rtp).toBeLessThan(0.98);
    expect(slotsPayout(cfg, ['seven', 'seven', 'seven'])).toBe(1000);
    expect(slotsPayout(cfg, ['cherry', 'durian', 'cherry'])).toBe(cfg.slots.twoOfFirst);
    expect(slotsPayout(cfg, ['cherry', 'durian', 'seven'])).toBe(0);
  });

  it('European roulette: every bet returns 36/37', () => {
    for (const bet of [...ROULETTE_BETS, 'n:0', 'n:17']) {
      let back = 0;
      for (let n = 0; n <= 36; n++) back += rouletteReturn(bet, n);
      expect(back / 37).toBeCloseTo(36 / 37, 6);
    }
    expect(rouletteReturn('red', 0)).toBe(0);
    expect(rouletteReturn('red', 1)).toBe(2);
    expect(rouletteReturn('n:7', 7)).toBe(36);
  });

  it('blackjack hands: soft aces, naturals, settling', () => {
    expect(handValue([card(1), card(6)])).toEqual({ total: 17, soft: true });
    expect(handValue([card(1), card(6), card(10)])).toEqual({ total: 17, soft: false });
    expect(handValue([card(1), card(1), card(9)])).toEqual({ total: 21, soft: true });
    expect(isBlackjack([card(1), card(13)])).toBe(true);
    expect(settleBlackjack(cfg, [card(1), card(12)], [card(10), card(9)], false)).toEqual({ result: 'blackjack', returns: 2.5 });
    expect(settleBlackjack(cfg, [card(1), card(12)], [card(10), card(9)], true).result).toBe('win'); // 21 after a split isn't a blackjack
    expect(settleBlackjack(cfg, [card(10), card(8)], [card(10), card(8)], false)).toEqual({ result: 'push', returns: 1 });
    expect(settleBlackjack(cfg, [card(10), card(8), card(5)], [card(10), card(8)], false).result).toBe('bust');
    expect(settleBlackjack(cfg, [card(10), card(7)], [card(10), card(6), card(9)], false).result).toBe('win');
  });

  it('crash: P(reaching x) = (1 − edge)/x, and the multiplier curve inverts', () => {
    let reach2 = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) if (crashPoint(cfg, (i + 0.5) / N) >= 2) reach2++;
    expect(reach2 / N).toBeCloseTo((1 - cfg.crash.houseEdge) / 2, 2);
    expect(crashPoint(cfg, 0)).toBe(1); // sometimes it busts straight away
    expect(crashMultAt(cfg, crashMsFor(cfg, 3) + 1)).toBeGreaterThanOrEqual(3);
  });

  it('wheel: every segment returns about 96%; the layout has every slot', () => {
    for (const s of cfg.wheel.segments) {
      expect(wheelRtp(cfg, s.id)).toBeGreaterThan(0.93);
      expect(wheelRtp(cfg, s.id)).toBeLessThan(0.99);
    }
    const layout = wheelLayout(cfg);
    expect(layout).toHaveLength(cfg.wheel.segments.reduce((a, s) => a + s.count, 0));
    for (const s of cfg.wheel.segments) expect(layout.filter((x) => x === s.id)).toHaveLength(s.count);
  });

  it('high-low pays fair odds minus the edge', () => {
    for (let r = 1; r <= 13; r++)
      for (const g of ['higher', 'lower'] as const) {
        const p = highLowChance(r, g);
        if (!p) {
          expect(highLowMult(cfg, r, g)).toBe(0);
          continue;
        }
        expect(p * highLowMult(cfg, r, g)).toBeGreaterThan(0.95);
        expect(p * highLowMult(cfg, r, g)).toBeLessThanOrEqual(1 - cfg.highlow.houseEdge + 1e-9);
      }
  });
});
