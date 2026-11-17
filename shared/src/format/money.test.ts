import { describe, expect, it } from 'vitest';
import { formatMoney, formatMoneyExact } from './money';

describe('formatMoney (sen → short RM)', () => {
  it('formats the spec examples', () => {
    expect(formatMoney(125_000)).toBe('RM 1,250');
    expect(formatMoney(1_250_000)).toBe('RM 12.5K');
    expect(formatMoney(340_000_000)).toBe('RM 3.4M');
    expect(formatMoney(120_000_000_000)).toBe('RM 1.2B');
    expect(formatMoney(500_000_000_000_000)).toBe('RM 5T');
  });

  it('handles small, zero and negative amounts', () => {
    expect(formatMoney(0)).toBe('RM 0');
    expect(formatMoney(30_000)).toBe('RM 300');
    expect(formatMoney(-125_000)).toBe('-RM 1,250');
  });

  it('formats exact values with sen', () => {
    expect(formatMoneyExact(125_050)).toBe('RM 1,250.50');
  });
});
