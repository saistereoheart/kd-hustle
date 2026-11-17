// Accounts and sessions. Passwords use bcrypt; session tokens are 32 random bytes, and only
// their SHA-256 is stored. One active session per account: logging in revokes older tokens
// and the onSessionReplaced hook lets the game kick the old socket (after saving it).
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import type { AuthConfig } from '@kh/shared';
import type { AccountRow, Repos } from '../db/repos';

export interface AuthedAccount {
  id: number;
  username: string;
  isAdmin: boolean;
}

export type AuthResult = { ok: true; token: string; account: AuthedAccount } | { ok: false; error: string };

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

const toAccount = (r: AccountRow): AuthedAccount => ({ id: r.id, username: r.username, isAdmin: r.is_admin === 1 });

export class AuthService {
  readonly registerSchema;
  readonly loginSchema;
  /** Called after a new login so the game can kick the account's existing connection. */
  onSessionReplaced: (accountId: number) => void = () => {};
  private dummyHash: string | undefined;

  constructor(
    private readonly repos: Repos,
    private readonly cfg: AuthConfig,
    private readonly opts: { adminUsername?: string; spawn: { x: number; y: number } },
  ) {
    const username = z
      .string()
      .trim()
      .min(cfg.username.min, `Username must be at least ${cfg.username.min} characters`)
      .max(cfg.username.max, `Username must be at most ${cfg.username.max} characters`)
      .regex(new RegExp(cfg.username.pattern), 'Username can only use letters, numbers and _');
    const password = z
      .string()
      .min(cfg.passwordMin, `Password must be at least ${cfg.passwordMin} characters`)
      .max(cfg.passwordMax, `Password must be at most ${cfg.passwordMax} characters`);
    this.registerSchema = z
      .object({ username, password, confirm: z.string() })
      .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
    this.loginSchema = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(200) });
  }

  async register(body: unknown): Promise<AuthResult> {
    const parsed = this.registerSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
    const { username, password } = parsed.data;
    if (this.repos.accounts.byName(username)) return { ok: false, error: 'That username is taken' };
    const hash = await bcrypt.hash(password, this.cfg.bcryptCost);
    // Admin: the ADMIN_USERNAME from .env if set, otherwise the very first account.
    const admin = this.opts.adminUsername
      ? username.toLowerCase() === this.opts.adminUsername.toLowerCase()
      : this.repos.accounts.count() === 0;
    let id: number;
    try {
      id = this.repos.accounts.create(username, hash, admin, this.opts.spawn);
    } catch {
      return { ok: false, error: 'That username is taken' }; // lost a race on the UNIQUE index
    }
    const token = this.issueToken(id);
    return { ok: true, token, account: { id, username, isAdmin: admin } };
  }

  async login(body: unknown): Promise<AuthResult> {
    const parsed = this.loginSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'Enter a username and password' };
    const row = this.repos.accounts.byName(parsed.data.username);
    // Always run bcrypt so response time doesn't reveal whether the username exists.
    this.dummyHash ??= bcrypt.hashSync('not-a-real-password', this.cfg.bcryptCost);
    const ok = await bcrypt.compare(parsed.data.password, row?.password_hash ?? this.dummyHash);
    if (!row || !ok) return { ok: false, error: 'Wrong username or password' };
    this.repos.sessions.deleteForAccount(row.id);
    const token = this.issueToken(row.id);
    this.onSessionReplaced(row.id);
    return { ok: true, token, account: toAccount(row) };
  }

  resolveToken(token: unknown): AuthedAccount | undefined {
    if (typeof token !== 'string' || token.length < 16 || token.length > 200) return undefined;
    const row = this.repos.sessions.account(hashToken(token));
    return row ? toAccount(row) : undefined;
  }

  logout(token: string) {
    this.repos.sessions.delete(hashToken(token));
  }

  private issueToken(accountId: number): string {
    const token = crypto.randomBytes(this.cfg.tokenBytes).toString('base64url');
    this.repos.sessions.create(hashToken(token), accountId);
    return token;
  }
}
