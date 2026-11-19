import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { Economy } from '../economy/economy';
import { JobSystem } from './jobs';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
let seed = 5;
const rand = (max: number) => (seed = (seed * 16807) % 2147483647) % max;

function setup() {
  const repos = createRepos(openDatabase(':memory:'));
  const id = repos.accounts.create('job', 'h', false, { x: 0, y: 0 }, 2, 0);
  const T = cfg.map.tileSize;
  // Start near a housing area: the first terrace's door.
  const home = cfg.map.buildings.find((b) => b.kind === 'terrace' && b.door)!;
  const p = {
    id, name: 'job', walletSen: 0, shards: 0, inventory: [], equipped: {}, cosmetics: {}, index: new Set<string>(), pages: new Set<string>(),
    pity: {}, jobs: {}, job: null, vehicle: null, skills: {}, x: (home.door!.frontX + 0.5) * T, y: (home.door!.frontY + 0.5) * T,
  } as unknown as OnlinePlayer;
  const econ = new Economy(repos, cfg);
  return { p, jobs: new JobSystem(cfg, econ, rand), T };
}

describe('Flyer Run', () => {
  it('drops a flyer at each marked house (any order) and pays at the end, with a speed bonus', () => {
    const { p, jobs, T } = setup();
    const job = jobs.start(p, 'flyers', 1000);
    if (job.kind !== 'flyers') throw new Error('wrong job');
    expect(job.stops).toHaveLength(cfg.jobs.flyers.stops);
    expect(() => {
      p.x = -99999;
      jobs.advance(p, 2000);
    }).toThrow(/marked houses/);
    let last: ReturnType<JobSystem['advance']> | null = null;
    for (const s of [...job.stops].reverse()) {
      p.x = s.x * T;
      p.y = s.y * T;
      last = jobs.advance(p, 5000);
    }
    expect(last!.job).toBeNull();
    expect(last!.paidSen).toBe(job.baseSen);
    expect(last!.tipSen).toBe(Math.round(job.baseSen * cfg.jobs.flyers.speedBonus));
    expect(p.walletSen).toBe(job.baseSen + last!.tipSen!);
    expect(p.jobs.flyers.done).toBe(1);
  });
});

describe('Mamak Helper', () => {
  it('pays each drink by quality, then ends the shift', () => {
    const { p, jobs } = setup();
    const job = jobs.start(p, 'mamak', 1000);
    if (job.kind !== 'mamak') throw new Error('wrong job');
    let paid = 0;
    for (let n = 1; n <= cfg.jobs.mamak.drinks; n++) {
      const cur = p.job as typeof job;
      expect(cur.n).toBe(n);
      // Nonsense input: every step a miss → the lowest quality still pays a little.
      const r = jobs.submitMamak(p, cur.jobId, cur.drink.steps.map(() => ({ startMs: 0, ev: [] })), 1000 + n * 60_000);
      paid += r.paidSen;
      if (n < cfg.jobs.mamak.drinks) expect(r.job).not.toBeNull();
      else expect(r).toMatchObject({ job: null, totalSen: paid });
    }
    const burnt = cfg.recipes.quality.find((q) => q.id === 'burnt')!.mult;
    expect(paid).toBe(cfg.jobs.mamak.drinks * Math.round(cfg.jobs.mamak.perDrinkSen * burnt));
    expect(p.walletSen).toBe(paid);
    expect(p.jobs.mamak.done).toBe(1);
  });
});
