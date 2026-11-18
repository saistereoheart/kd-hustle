import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupDatabase, rotateBackups } from '../backup/backup';
import { openDatabase } from '../db/db';
import { createRepos } from '../db/repos';
import { World, type OnlinePlayer } from '../game/world';
import { SaveManager } from './saveManager';
import { emptyProgress } from '../systems/progression/progression';

function online(id: number, x: number): OnlinePlayer {
  return {
    id, name: `p${id}`, isAdmin: false, socketId: `s${id}`, appearance: null, hasCharacter: false,
    scene: 'town', x, y: 50, dir: 'down', moving: false, dirty: false, lastSavedAt: null, mapVersion: 2,
    move: { x, y: 50, budget: 0, lastAt: 0 }, emote: null, interior: null, walletSen: 0, shards: 0, inventory: [], equipped: {}, cosmetics: {}, index: new Set(), pages: new Set(), pity: {}, jobs: {}, job: null, vehicle: null, skills: {}, manifestBank: 0, manifestSecs: 0, hotbar: [], rideQuote: null, ride: null, prog: emptyProgress(), errand: null,
  };
}

describe('SaveManager', () => {
  it('autosaves only dirty players and notifies them', () => {
    const db = openDatabase(':memory:');
    const repos = createRepos(db);
    const a = repos.accounts.create('a_user', 'h', false, { x: 1, y: 1 });
    const b = repos.accounts.create('b_user', 'h', false, { x: 1, y: 1 });
    const world = new World();
    const pa = online(a, 300);
    const pb = online(b, 400);
    world.add(pa);
    world.add(pb);
    const saves = new SaveManager(repos, world, () => 12345);
    const notified: number[] = [];
    saves.onAutosaved = (p) => notified.push(p.id);

    pa.dirty = true;
    expect(saves.saveDirty()).toBe(1);
    expect(notified).toEqual([a]);
    expect(pa.dirty).toBe(false);
    expect(pa.lastSavedAt).toBe(12345);
    expect(repos.players.load(a)?.x).toBe(300);
    expect(repos.players.load(b)?.x).toBe(1); // untouched (not dirty)

    expect(saves.saveDirty()).toBe(0); // nothing changed since
    expect(saves.saveAll()).toBe(2); // shutdown saves everyone
    expect(repos.players.load(b)?.x).toBe(400);
  });

  it('persists appearance and character flag', () => {
    const db = openDatabase(':memory:');
    const repos = createRepos(db);
    const id = repos.accounts.create('c_user', 'h', false, { x: 1, y: 1 });
    const world = new World();
    const p = online(id, 10);
    p.appearance = { skin: '#ffffff' } as never;
    p.hasCharacter = true;
    world.add(p);
    new SaveManager(repos, world).saveNow(p);
    const rec = repos.players.load(id)!;
    expect(rec.hasCharacter).toBe(true);
    expect(rec.appearance).toEqual({ skin: '#ffffff' });
  });
});

describe('backups', () => {
  it('writes a backup and keeps only the newest N', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-backup-'));
    for (let i = 1; i <= 16; i++) fs.writeFileSync(path.join(dir, `game-20260101-0000${String(i).padStart(2, '0')}.db`), '');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep me');
    const deleted = rotateBackups(dir, 14);
    expect(deleted).toEqual(['game-20260101-000001.db', 'game-20260101-000002.db']);

    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-db-'));
    const db = openDatabase(path.join(dbDir, 'game.db'));
    createRepos(db).accounts.create('x_user', 'h', false, { x: 1, y: 1 });
    const file = await backupDatabase(db, dir, 14);
    expect(fs.existsSync(file)).toBe(true);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db'));
    expect(files.length).toBe(14);
    expect(fs.existsSync(path.join(dir, 'notes.txt'))).toBe(true);
    // The backup is a real, readable DB.
    const copy = openDatabase(file);
    expect(createRepos(copy).accounts.byName('x_user')).toBeTruthy();
    copy.close();
    db.close();
  });
});

describe('sanity', () => {
  it('chat sanitiser strips control characters and caps length', async () => {
    const { sanitizeChat } = await import('../systems/chat/chat');
    expect(sanitizeChat('  hi\u0000 there\n\n  ', 140)).toBe('hi there');
    expect(sanitizeChat('<b>x</b>', 140)).toBe('<b>x</b>'); // shown via textContent, never HTML
    expect(sanitizeChat('a'.repeat(300), 140).length).toBe(140);
  });
});
