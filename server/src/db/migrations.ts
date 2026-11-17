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
];
