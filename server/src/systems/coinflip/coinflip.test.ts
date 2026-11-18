import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { betLimits } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import { World, type OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { Economy } from '../economy/economy';
import { emptyProgress } from '../progression/progression';
import { COINFLIP_FEE, CoinflipSystem } from './coinflip';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));

function setup(flip: number) {
  const repos = createRepos(openDatabase(':memory:'));
  const world = new World();
  const econ = new Economy(repos, cfg);
  const mk = (name: string, stage: number) => {
    const id = repos.accounts.create(name, 'h', false, { x: 0, y: 0 }, 2, 10_000_000);
    const p = { id, name, hasCharacter: true, walletSen: 10_000_000, shards: 0, inventory: [], equipped: {}, cosmetics: {}, index: new Set(), pages: new Set(), pity: {}, jobs: {}, skills: {}, prog: emptyProgress() } as unknown as OnlinePlayer;
    p.prog.stage = stage;
    world.add(p);
    return p;
  };
  const a = mk('ali', 4), b = mk('bala', 3);
  const results: string[] = [];
  const cf = new CoinflipSystem(cfg.casino, econ, world, () => flip, {
    challenge: () => {}, result: (_p, r) => results.push(r.winner), notice: () => {}, wallet: () => {}, announce: () => {}, check: () => {},
  });
  return { a, b, cf, results };
}

describe('PvP coinflip', () => {
  it('stakes within the lower stage limits; the winner takes the pot minus 2%', () => {
    const s = setup(1); // heads: the challenger wins
    const [min, max] = betLimits(cfg.casino, 3);
    expect(() => s.cf.challenge(s.a, s.b.id, max + 1)).toThrow(/Stakes between you/);
    s.cf.challenge(s.a, s.b.id, min);
    const r = s.cf.respond(s.b, s.a.id, true);
    expect(r?.winner).toBe('ali');
    const won = 2 * min - Math.round(2 * min * COINFLIP_FEE);
    expect(s.a.walletSen).toBe(10_000_000 - min + won);
    expect(s.b.walletSen).toBe(10_000_000 - min);
    expect(s.results).toEqual(['ali', 'ali']);
    expect(() => s.cf.respond(s.b, s.a.id, true)).toThrow(/expired/); // used up
  });

  it('declining costs nothing; the other side can win too', () => {
    const s = setup(0); // tails: the one who accepted wins
    const [min] = betLimits(cfg.casino, 3);
    s.cf.challenge(s.a, s.b.id, min);
    s.cf.respond(s.b, s.a.id, false);
    expect(s.a.walletSen).toBe(10_000_000);
    s.cf.challenge(s.a, s.b.id, min);
    expect(s.cf.respond(s.b, s.a.id, true)?.winner).toBe('bala');
  });
});
