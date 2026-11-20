import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import { ROOT } from '../../paths';
import { ShoplotSystem } from './shoplots';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));

function setup() {
  const repos = createRepos(openDatabase(':memory:'));
  const a = repos.accounts.create('ali', 'h', false, { x: 0, y: 0 }, 2, 0);
  const b = repos.accounts.create('bob', 'h', false, { x: 0, y: 0 }, 2, 0);
  return { repos, a, b, lots: new ShoplotSystem(cfg, repos) };
}

describe('shoplots', () => {
  it('there are shoplots to take (the kopitiam ones)', () => {
    const { lots } = setup();
    expect(lots.spots.size).toBeGreaterThan(100);
  });

  it('a Venture takes the free shoplot nearest to you; one business per shoplot', () => {
    const { lots, a, b } = setup();
    const [first, s] = [...lots.spots.entries()][0];
    const got = lots.claim(a, 'ali', 'venture', 'burger', { x: s.x, y: s.y });
    expect(got).toBe(first);
    expect(lots.isFree(first)).toBe(false);
    // Bob near the same door gets a different one; asking for Ali's fails.
    expect(lots.claim(b, 'bob', 'venture', 'burger', { x: s.x, y: s.y })).not.toBe(first);
    expect(() => lots.claim(b, 'bob', 'venture', 'laundry', { x: 0, y: 0 }, first)).toThrow(/taken/);
    // Claiming again for the same business keeps the one you have.
    expect(lots.claim(a, 'ali', 'venture', 'burger', { x: 0, y: 0 })).toBe(first);
  });

  it("a kopitiam's shoplot isn't free, and a Venture's blocks a kopitiam", () => {
    const { lots, a } = setup();
    const [kop] = [...lots.spots.keys()];
    lots.stallBuildings = () => new Set([kop]);
    expect(lots.isFree(kop)).toBe(false);
    expect(() => lots.claim(a, 'ali', 'venture', 'x', { x: 0, y: 0 }, kop)).toThrow(/taken/);
    const mine = lots.claim(a, 'ali', 'venture', 'x', { x: 0, y: 0 });
    expect(lots.takenByVenture(mine)).toBe(true);
  });

  it('moving and letting go; kept in the DB across restarts', () => {
    const { repos, lots, a } = setup();
    const spots = [...lots.spots.keys()];
    lots.claim(a, 'ali', 'venture', 'burger', { x: 0, y: 0 }, spots[0]);
    lots.move(a, 'venture', 'burger', spots[1]);
    expect(lots.of(a, 'venture', 'burger')).toBe(spots[1]);
    expect(lots.isFree(spots[0])).toBe(true);
    const again = new ShoplotSystem(cfg, repos);
    expect(again.of(a, 'venture', 'burger')).toBe(spots[1]);
    again.releaseAll(a, 'venture');
    expect(again.isFree(spots[1])).toBe(true);
    expect(again.public()).toHaveLength(0);
  });
});
