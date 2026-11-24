import { describe, expect, it } from 'vitest';
import rarities from '../../config/rarities.json';
import { joinVariants } from '../items/variants';
import { C2S } from './messages';

describe('item messages accept every variant combination', () => {
  const order = rarities.variants.map((v) => v.id);
  const special = order.filter((v) => v !== 'normal');
  // Every subset of the special variants (shiny, golden, rainbow…), joined the way items store them.
  const combos = Array.from({ length: 1 << special.length }, (_, m) => joinVariants(order, special.filter((_, i) => m & (1 << i))));

  it('pawn sell / scrap (#31: a triple-variant item gave "bad request")', () => {
    expect(combos).toContain(special.join('+'));
    for (const variant of combos) expect(C2S.stack.safeParse({ itemId: 'chef_zul', variant, grade: 'A', count: 1 }).success).toBe(true);
  });

  it('hotbar slots', () => {
    for (const variant of combos) expect(C2S.hotbarSet.safeParse({ slot: 1, ref: { kind: 'item', itemId: 'potion_luck', variant } }).success).toBe(true);
  });
});
