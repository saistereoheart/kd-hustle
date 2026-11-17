import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/db';
import { createRepos } from '../db/repos';
import { AuthService } from './authService';
import { RateLimiter } from './rateLimit';

const authCfg = {
  bcryptCost: 4, // fast for tests
  tokenBytes: 32,
  username: { min: 3, max: 16, pattern: '^[A-Za-z0-9_]+$' },
  passwordMin: 6,
  passwordMax: 72,
  loginRateLimit: { count: 5, windowMs: 60000 },
  registerRateLimit: { count: 10, windowMs: 60000 },
};

function setup(adminUsername?: string) {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const auth = new AuthService(repos, authCfg, { adminUsername, spawn: { x: 100, y: 100 } });
  return { db, repos, auth };
}

describe('AuthService', () => {
  it('registers, creates a player row, and makes the first account admin', async () => {
    const { auth, repos } = setup();
    const a = await auth.register({ username: 'haidar', password: 'secret1', confirm: 'secret1' });
    const b = await auth.register({ username: 'aisyah', password: 'secret2', confirm: 'secret2' });
    expect(a.ok && a.account.isAdmin).toBe(true);
    expect(b.ok && b.account.isAdmin).toBe(false);
    const player = repos.players.load(a.ok ? a.account.id : -1);
    expect(player).toMatchObject({ x: 100, y: 100, hasCharacter: false, scene: 'town' });
  });

  it('uses ADMIN_USERNAME when set', async () => {
    const { auth } = setup('Boss');
    const a = await auth.register({ username: 'first', password: 'secret1', confirm: 'secret1' });
    const b = await auth.register({ username: 'boss', password: 'secret1', confirm: 'secret1' });
    expect(a.ok && a.account.isAdmin).toBe(false);
    expect(b.ok && b.account.isAdmin).toBe(true);
  });

  it('validates input and rejects duplicate usernames (case-insensitive)', async () => {
    const { auth } = setup();
    expect((await auth.register({ username: 'ab', password: 'secret1', confirm: 'secret1' })).ok).toBe(false);
    expect((await auth.register({ username: 'bad name', password: 'secret1', confirm: 'secret1' })).ok).toBe(false);
    expect((await auth.register({ username: 'okname', password: '123', confirm: '123' })).ok).toBe(false);
    expect((await auth.register({ username: 'okname', password: 'secret1', confirm: 'secret2' })).ok).toBe(false);
    expect((await auth.register({ username: 'Haidar', password: 'secret1', confirm: 'secret1' })).ok).toBe(true);
    const dup = await auth.register({ username: 'HAIDAR', password: 'secret1', confirm: 'secret1' });
    expect(dup).toEqual({ ok: false, error: 'That username is taken' });
  });

  it('logs in with the right password only', async () => {
    const { auth } = setup();
    await auth.register({ username: 'haidar', password: 'secret1', confirm: 'secret1' });
    expect((await auth.login({ username: 'haidar', password: 'wrong!!' })).ok).toBe(false);
    expect((await auth.login({ username: 'nobody', password: 'secret1' })).ok).toBe(false);
    expect((await auth.login({ username: 'HAIDAR', password: 'secret1' })).ok).toBe(true);
  });

  it('keeps only one active session per account and notifies the game', async () => {
    const { auth } = setup();
    const reg = await auth.register({ username: 'haidar', password: 'secret1', confirm: 'secret1' });
    if (!reg.ok) throw new Error('register failed');
    const kicked: number[] = [];
    auth.onSessionReplaced = (id) => kicked.push(id);
    expect(auth.resolveToken(reg.token)?.username).toBe('haidar');
    const login = await auth.login({ username: 'haidar', password: 'secret1' });
    if (!login.ok) throw new Error('login failed');
    expect(auth.resolveToken(reg.token)).toBeUndefined(); // old device logged out
    expect(auth.resolveToken(login.token)?.id).toBe(reg.account.id);
    expect(kicked).toEqual([reg.account.id]);
    auth.logout(login.token);
    expect(auth.resolveToken(login.token)).toBeUndefined();
  });

  it('ignores junk tokens', () => {
    const { auth } = setup();
    expect(auth.resolveToken(undefined)).toBeUndefined();
    expect(auth.resolveToken(123)).toBeUndefined();
    expect(auth.resolveToken('short')).toBeUndefined();
  });
});

describe('RateLimiter', () => {
  it('allows N hits per window then blocks until the window passes', () => {
    let now = 0;
    const rl = new RateLimiter(5, 60_000, () => now);
    for (let i = 0; i < 5; i++) expect(rl.hit('ip')).toBe(true);
    expect(rl.hit('ip')).toBe(false);
    expect(rl.hit('other-ip')).toBe(true);
    expect(rl.retryAfter('ip')).toBe(60_000);
    now = 60_001;
    expect(rl.hit('ip')).toBe(true);
  });
});
