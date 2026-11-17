// Schema migrations, applied in order and recorded in schema_migrations.
// Later phases append new entries (never edit an applied one). A migration has SQL, and/or a
// `run` step for data changes that are easier in code; both run in the same transaction.
import type Database from 'better-sqlite3';

export interface Migration {
  id: number;
  name: string;
  sql?: string;
  run?: (db: Database.Database) => void;
}

/** Migration 6's hotbar change: remove the motorbike (left over from when it could be ordered
 *  from the phone, now replaced by Ronda rides). Every other slot is kept as it is. */
export function withoutMotorbike(saved: unknown[]): unknown[] {
  const isBike = (v: unknown) => !!v && typeof v === 'object' && (v as { kind?: string }).kind === 'vehicle' && (v as { id?: string }).id === 'motorbike';
  const bar = saved.slice(0, 10).map((v) => (isBike(v) ? null : (v ?? null)));
  while (bar.length < 10) bar.push(null);
  return bar;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'accounts_sessions_players',
    sql: `
      CREATE TABLE accounts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        is_admin      INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL
      );

      -- Only a SHA-256 of the session token is stored, so a leaked DB can't be used to log in.
      CREATE TABLE sessions (
        token_hash  TEXT PRIMARY KEY,
        account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX idx_sessions_account ON sessions(account_id);

      CREATE TABLE players (
        account_id      INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        appearance_json TEXT,
        has_character   INTEGER NOT NULL DEFAULT 0,
        scene           TEXT NOT NULL DEFAULT 'town',
        x               REAL NOT NULL,
        y               REAL NOT NULL,
        dir             TEXT NOT NULL DEFAULT 'down',
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        last_saved_at   INTEGER
      );
    `,
  },
  {
    id: 2,
    name: 'players_map_version',
    // Which map version a saved position belongs to. When the map changes in a way that
    // invalidates old coordinates, players are moved to a safe spot on next login.
    sql: `ALTER TABLE players ADD COLUMN map_version INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    id: 3,
    name: 'economy_inventory_gacha',
    sql: `
      ALTER TABLE players ADD COLUMN wallet_sen INTEGER NOT NULL DEFAULT 30000;
      ALTER TABLE players ADD COLUMN shards INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE players ADD COLUMN equipped_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE players ADD COLUMN pity_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE players ADD COLUMN jobs_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE players ADD COLUMN pages_json TEXT NOT NULL DEFAULT '[]';

      CREATE TABLE inventory_items (
        iid         INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        item_id     TEXT NOT NULL,
        variant     TEXT NOT NULL,
        serial      INTEGER,
        obtained_at INTEGER NOT NULL
      );
      CREATE INDEX idx_inventory_account ON inventory_items(account_id);

      CREATE TABLE collection_index (
        account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        item_id        TEXT NOT NULL,
        first_found_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, item_id)
      );

      -- Every roll is logged (CLAUDE.md asks for every Legendary+; all of them is cheap).
      CREATE TABLE roll_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        crate_id   TEXT NOT NULL,
        item_id    TEXT NOT NULL,
        tier       TEXT NOT NULL,
        variant    TEXT NOT NULL,
        serial     INTEGER,
        rolled_at  INTEGER NOT NULL
      );
      CREATE INDEX idx_roll_item ON roll_log(item_id);
      CREATE INDEX idx_roll_account ON roll_log(account_id, rolled_at);

      -- Economy log: every change to a wallet or shard balance.
      CREATE TABLE transactions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id   INTEGER NOT NULL,
        delta_sen    INTEGER NOT NULL,
        balance_sen  INTEGER NOT NULL,
        delta_shards INTEGER NOT NULL DEFAULT 0,
        reason       TEXT NOT NULL,
        ref          TEXT,
        at           INTEGER NOT NULL
      );
      CREATE INDEX idx_tx_account ON transactions(account_id, at);

      CREATE TABLE announcements (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        tier TEXT NOT NULL,
        at   INTEGER NOT NULL
      );
    `,
  },
  {
    id: 4,
    name: 'player_skills',
    sql: "ALTER TABLE players ADD COLUMN skills_json TEXT NOT NULL DEFAULT '{}';",
  },
  {
    id: 5,
    name: 'player_hotbar',
    // NULL = never set: the server fills in the default (bicycle in slot 1).
    sql: 'ALTER TABLE players ADD COLUMN hotbar_json TEXT;',
  },
  {
    id: 6,
    name: 'hotbar_drop_motorbike',
    // Ronda rides (phone) replace the rentable motorbike, so take the leftover motorbike out of
    // everyone's hotbar. Nothing else changes.
    run: (db) => {
      const rows = db.prepare('SELECT account_id, hotbar_json FROM players WHERE hotbar_json IS NOT NULL').all() as Array<{ account_id: number; hotbar_json: string }>;
      const set = db.prepare('UPDATE players SET hotbar_json = ? WHERE account_id = ?');
      for (const r of rows) {
        let bar: Array<unknown>;
        try {
          bar = JSON.parse(r.hotbar_json);
        } catch {
          continue;
        }
        if (!Array.isArray(bar)) continue;
        set.run(JSON.stringify(withoutMotorbike(bar)), r.account_id);
      }
    },
  },
];
