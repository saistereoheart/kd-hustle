import { describe, expect, it } from 'vitest';
import { splitIncome } from './progression';

describe('income breakdown', () => {
  it('RM 120 with Hustle Harder +20% = RM 100 base + RM 20 bonus', () => {
    const r = splitIncome(12_000, [[{ label: 'Hustle Harder Lv 4', add: 0.2 }]]);
    expect(r.base).toBeCloseTo(10_000);
    expect(r.parts).toEqual([{ label: 'Hustle Harder Lv 4', sen: expect.closeTo(2_000, 5) }]);
  });
  it('stacked factors multiply and the parts add back up to the total', () => {
    const r = splitIncome(26_400, [[{ label: 'skill', add: 0.1 }, { label: 'gear', add: 0.1 }], [{ label: 'rebirth', add: 1 }]]);
    expect(r.base).toBeCloseTo(26_400 / (1.2 * 2));
    expect(r.base + r.parts.reduce((a, p) => a + p.sen, 0)).toBeCloseTo(26_400);
    expect(r.parts.find((p) => p.label === 'rebirth')!.sen).toBeCloseTo(13_200);
  });
});
