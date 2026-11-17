// Thin repositories over prepared statements. All SQL is parameterised.
import type { Appearance, Direction } from '@kh/shared';
import type { DB } from './db';

export interface AccountRow {
  id: number;
  username: string;
  password_hash: string;
  is_admin: number;
  created_at: number;
}

export interface PlayerRecord {
  accountId: number;
  appearance: Appearance | null;
  hasCharacter: boolean;
  scene: string;
  x: number;
  y: number;
  dir: Direction;
  lastSavedAt: number | null;
}

interface PlayerRow {
  account_id: number;
  appearance_json: string | null;
  has_character: number;
  scene: string;
  x: number;
  y: number;
  dir: string;
  last_saved_at: number | null;
}

export function createRepos(db: DB) {
  const s = {
    countAccounts: db.prepare('SELECT COUNT(*) AS n FROM accounts'),
    insertAccount: db.prepare('INSERT INTO accounts (username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)'),
    accountByName: db.prepare('SELECT * FROM accounts WHERE username = ?'),
    accountById: db.prepare('SELECT * FROM accounts WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, account_id, created_at) VALUES (?, ?, ?)'),
    sessionAccount: db.prepare('SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteSessionsFor: db.prepare('DELETE FROM sessions WHERE account_id = ?'),
    insertPlayer: db.prepare(
      'INSERT INTO players (account_id, scene, x, y, dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ),
    playerById: db.prepare('SELECT * FROM players WHERE account_id = ?'),
    savePlayer: db.prepare(
      `UPDATE players SET appearance_json = ?, has_character = ?, scene = ?, x = ?, y = ?, dir = ?,
       updated_at = ?, last_saved_at = ? WHERE account_id = ?`,
    ),
  };

  return {
    accounts: {
      count: () => (s.countAccounts.get() as { n: number }).n,
      byName: (username: string) => s.accountByName.get(username) as AccountRow | undefined,
      byId: (id: number) => s.accountById.get(id) as AccountRow | undefined,
      /** Creates the account and its player row atomically. */
      create: (username: string, passwordHash: string, isAdmin: boolean, spawn: { x: number; y: number }) => {
        const now = Date.now();
        return db.transaction(() => {
          const info = s.insertAccount.run(username, passwordHash, isAdmin ? 1 : 0, now);
          const id = Number(info.lastInsertRowid);
          s.insertPlayer.run(id, 'town', spawn.x, spawn.y, 'down', now, now);
          return id;
        })();
      },
    },
    sessions: {
      create: (tokenHash: string, accountId: number) => s.insertSession.run(tokenHash, accountId, Date.now()),
      account: (tokenHash: string) => s.sessionAccount.get(tokenHash) as AccountRow | undefined,
      delete: (tokenHash: string) => s.deleteSession.run(tokenHash),
      deleteForAccount: (accountId: number) => s.deleteSessionsFor.run(accountId),
    },
    players: {
      load: (accountId: number): PlayerRecord | undefined => {
        const r = s.playerById.get(accountId) as PlayerRow | undefined;
        if (!r) return undefined;
        let appearance: Appearance | null = null;
        try {
          appearance = r.appearance_json ? (JSON.parse(r.appearance_json) as Appearance) : null;
        } catch {
          appearance = null;
        }
        return {
          accountId: r.account_id,
          appearance,
          hasCharacter: r.has_character === 1 && appearance !== null,
          scene: r.scene,
          x: r.x,
          y: r.y,
          dir: (['down', 'up', 'left', 'right'].includes(r.dir) ? r.dir : 'down') as Direction,
          lastSavedAt: r.last_saved_at,
        };
      },
      /** Saves many players in ONE transaction (all-or-nothing). */
      saveMany: (records: PlayerRecord[], now = Date.now()) => {
        db.transaction(() => {
          for (const p of records) {
            s.savePlayer.run(
              p.appearance ? JSON.stringify(p.appearance) : null,
              p.hasCharacter ? 1 : 0,
              p.scene,
              p.x,
              p.y,
              p.dir,
              now,
              now,
              p.accountId,
            );
          }
        })();
      },
    },
  };
}
export type Repos = ReturnType<typeof createRepos>;
