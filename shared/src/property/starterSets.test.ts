import { describe, expect, it } from 'vitest';
import { starterShopSets, STARTER_CHAIR, STARTER_TABLE } from './starterSets';

const piece = (id: string) => (id === STARTER_TABLE ? { w: 1, h: 1, category: 'tables' } : id === STARTER_CHAIR ? { w: 1, h: 1, category: 'chairs' } : id === 'sofa' ? { w: 2, h: 1, category: 'seating' } : undefined);

describe('shop starter tables', () => {
  it('a chair facing in on each side of every table, down both walls, up to the max', () => {
    const sets = starterShopSets({ W: 12, H: 14, front: [5, 6], max: 6, layout: [], piece });
    expect(sets.length).toBe(18);
    expect(sets.slice(0, 3).map((p) => [p.item, p.rot])).toEqual([[STARTER_CHAIR, 3], [STARTER_TABLE, 0], [STARTER_CHAIR, 1]]);
  });

  it('leaves room for your furniture, and none once you have a table', () => {
    const withSofa = starterShopSets({ W: 12, H: 14, front: [5, 6], max: 6, layout: [{ iid: 1, item: 'sofa', x: 1, y: 2, rot: 0 }], piece });
    expect(withSofa.some((p) => p.y === 2 && p.x <= 3)).toBe(false);
    expect(starterShopSets({ W: 12, H: 14, front: [5, 6], max: 6, layout: [{ iid: 1, item: STARTER_TABLE, x: 4, y: 4, rot: 0 }], piece })).toEqual([]);
  });
});
