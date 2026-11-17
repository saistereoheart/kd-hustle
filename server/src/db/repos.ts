// Thin repositories over prepared statements. All SQL is parameterised.
import type { Appearance, Direction, EquipSlot, HotbarRef, InventoryItem, JobProgress, PityState } from '@kh/shared';
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
  /** Map version the position was saved on (see town.overrides.json "version"). */
  mapVersion: number;
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
  map_version: number;
}

export interface EconRecord {
  walletSen: number;
  shards: number;
  equipped: Partial<Record<EquipSlot, number>>;
  pity: Record<string, PityState>;
  jobs: Record<string, JobProgress>;
  pages: string[];
  skills: Record<string, number>;
  /** null = never set (use the default layout). */
  hotbar: Array<HotbarRef | null> | null;
}

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
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
      'INSERT INTO players (account_id, scene, x, y, dir, created_at, updated_at, map_version, wallet_sen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    playerById: db.prepare('SELECT * FROM players WHERE account_id = ?'),
    savePlayer: db.prepare(
      `UPDATE players SET appearance_json = ?, has_character = ?, scene = ?, x = ?, y = ?, dir = ?,
       updated_at = ?, last_saved_at = ?, map_version = ? WHERE account_id = ?`,
    ),
    econById: db.prepare('SELECT wallet_sen, shards, equipped_json, pity_json, jobs_json, pages_json, skills_json, hotbar_json FROM players WHERE account_id = ?'),
    setHotbar: db.prepare('UPDATE players SET hotbar_json = ? WHERE account_id = ?'),
    setMoney: db.prepare('UPDATE players SET wallet_sen = ?, shards = ? WHERE account_id = ?'),
    setEconState: db.prepare('UPDATE players SET equipped_json = ?, pity_json = ?, jobs_json = ?, pages_json = ?, skills_json = ? WHERE account_id = ?'),
    invList: db.prepare('SELECT iid, item_id, variant, serial, obtained_at FROM inventory_items WHERE account_id = ? ORDER BY iid'),
    invInsert: db.prepare('INSERT INTO inventory_items (account_id, item_id, variant, serial, obtained_at) VALUES (?, ?, ?, ?, ?)'),
    invDelete: db.prepare('DELETE FROM inventory_items WHERE iid = ? AND account_id = ?'),
    indexList: db.prepare('SELECT item_id FROM collection_index WHERE account_id = ?'),
    indexAdd: db.prepare('INSERT OR IGNORE INTO collection_index (account_id, item_id, first_found_at) VALUES (?, ?, ?)'),
    rollInsert: db.prepare('INSERT INTO roll_log (account_id, crate_id, item_id, tier, variant, serial, rolled_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    rollCountItem: db.prepare('SELECT COUNT(*) AS n FROM roll_log WHERE item_id = ?'),
    txInsert: db.prepare('INSERT INTO transactions (account_id, delta_sen, balance_sen, delta_shards, reason, ref, at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    announceInsert: db.prepare('INSERT INTO announcements (text, tier, at) VALUES (?, ?, ?)'),
  };

  return {
    /** Run fn inside one SQLite transaction (all-or-nothing). */
    tx: <T>(fn: () => T): T => db.transaction(fn)(),
    econ: {
      load: (accountId: number): EconRecord => {
        const r = s.econById.get(accountId) as
          | { wallet_sen: number; shards: number; equipped_json: string; pity_json: string; jobs_json: string; pages_json: string; skills_json: string; hotbar_json: string | null }
          | undefined;
        return {
          walletSen: r?.wallet_sen ?? 0,
          shards: r?.shards ?? 0,
          equipped: parseJson(r?.equipped_json, {}),
          pity: parseJson(r?.pity_json, {}),
          jobs: parseJson(r?.jobs_json, {}),
          pages: parseJson(r?.pages_json, []),
          skills: parseJson(r?.skills_json, {}),
          hotbar: parseJson<Array<HotbarRef | null> | null>(r?.hotbar_json, null),
        };
      },
      setHotbar: (accountId: number, hotbar: Array<HotbarRef | null>) => s.setHotbar.run(JSON.stringify(hotbar), accountId),
      setMoney: (accountId: number, walletSen: number, shards: number) => s.setMoney.run(walletSen, shards, accountId),
      setState: (accountId: number, e: Pick<EconRecord, 'equipped' | 'pity' | 'jobs' | 'pages' | 'skills'>) =>
        s.setEconState.run(JSON.stringify(e.equipped), JSON.stringify(e.pity), JSON.stringify(e.jobs), JSON.stringify(e.pages), JSON.stringify(e.skills), accountId),
      logTx: (accountId: number, deltaSen: number, balanceSen: number, deltaShards: number, reason: string, ref: string | null) =>
        s.txInsert.run(accountId, deltaSen, balanceSen, deltaShards, reason, ref, Date.now()),
    },
    inventory: {
      list: (accountId: number): InventoryItem[] =>
        (s.invList.all(accountId) as Array<{ iid: number; item_id: string; variant: string; serial: number | null; obtained_at: number }>).map((r) => ({
          iid: r.iid,
          itemId: r.item_id,
          variant: r.variant,
          serial: r.serial,
          obtainedAt: r.obtained_at,
        })),
      insert: (accountId: number, itemId: string, variant: string, serial: number | null): InventoryItem => {
        const at = Date.now();
        const info = s.invInsert.run(accountId, itemId, variant, serial, at);
        return { iid: Number(info.lastInsertRowid), itemId, variant, serial, obtainedAt: at };
      },
      delete: (accountId: number, iid: number) => s.invDelete.run(iid, accountId).changes === 1,
    },
    collection: {
      list: (accountId: number) => (s.indexList.all(accountId) as Array<{ item_id: string }>).map((r) => r.item_id),
      /** Returns true if this is the first time the player found the item. */
      add: (accountId: number, itemId: string) => s.indexAdd.run(accountId, itemId, Date.now()).changes === 1,
    },
    rolls: {
      log: (accountId: number, crateId: string, itemId: string, tier: string, variant: string, serial: number | null) =>
        s.rollInsert.run(accountId, crateId, itemId, tier, variant, serial, Date.now()),
      countItem: (itemId: string) => (s.rollCountItem.get(itemId) as { n: number }).n,
    },
    announcements: {
      add: (text: string, tier: string) => s.announceInsert.run(text, tier, Date.now()),
    },
    accounts: {
      count: () => (s.countAccounts.get() as { n: number }).n,
      byName: (username: string) => s.accountByName.get(username) as AccountRow | undefined,
      byId: (id: number) => s.accountById.get(id) as AccountRow | undefined,
      /** Creates the account and its player row atomically. */
      create: (username: string, passwordHash: string, isAdmin: boolean, spawn: { x: number; y: number }, mapVersion = 0, walletSen = 30000) => {
        const now = Date.now();
        return db.transaction(() => {
          const info = s.insertAccount.run(username, passwordHash, isAdmin ? 1 : 0, now);
          const id = Number(info.lastInsertRowid);
          s.insertPlayer.run(id, 'town', spawn.x, spawn.y, 'down', now, now, mapVersion, walletSen);
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
          mapVersion: r.map_version,
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
              p.mapVersion,
              p.accountId,
            );
          }
        })();
      },
    },
  };
}
export type Repos = ReturnType<typeof createRepos>;
