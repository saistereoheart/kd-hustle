// Schema migrations, applied in order and recorded in schema_migrations.
// Later phases append new entries (never edit an applied one).
export const MIGRATIONS: Array<{ id: number; name: string; sql: string }> = [
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
];
