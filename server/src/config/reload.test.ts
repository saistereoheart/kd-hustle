import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/db';
import { createRepos } from '../db/repos';
import { ROOT } from '../paths';
import { loadConfig, reloadBalance } from './loadConfig';

const dir = path.join(ROOT, 'shared/config'), mapDir = path.join(ROOT, 'shared/map');

describe('admin tools', () => {
  it('/reloadconfig updates the running config objects in place (references stay valid)', () => {
    const cfg = loadConfig(dir, mapDir);
    const casino = cfg.casino, stalls = cfg.stalls, items = cfg.itemById;
    casino.announceMult = 1; // pretend this was the old value
    cfg.itemById.clear();
    reloadBalance(cfg, dir, mapDir);
    expect(cfg.casino).toBe(casino);
    expect(cfg.stalls).toBe(stalls);
    expect(cfg.itemById).toBe(items);
    expect(cfg.casino.announceMult).toBeGreaterThan(1); // back to the file's value
    expect(cfg.itemById.size).toBeGreaterThan(100);
  });

  it('/resetplayer wipes progress, items and assets but keeps the account', () => {
    const repos = createRepos(openDatabase(':memory:'));
    const id = repos.accounts.create('oldtimer', 'h', false, { x: 0, y: 0 }, 2, 99_000_000);
    repos.inventory.insert(id, 'party_hat', 'normal', null);
    repos.playerData.save(id, 'ventures', { businesses: { carwash: { level: 9 } } });
    repos.playerData.save(id, 'reset', { at: 1 });
    repos.accounts.resetProgress(id, 30_000);
    expect(repos.inventory.list(id)).toEqual([]);
    expect(repos.playerData.load(id, 'ventures')).toBeNull();
    expect(repos.playerData.load(id, 'reset')).toBeNull(); // done
    expect(repos.econ.load(id).walletSen).toBe(30_000);
    expect(repos.accounts.byName('oldtimer')?.id).toBe(id);
  });
});
