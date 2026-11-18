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
  {
    id: 7,
    name: 'progression',
    // Phase 3: XP, level, wealth stage and title as columns (for leaderboards later), everything
    // else (titles, stats, buffs, daily login + quests, Hustle Path) as JSON.
    sql: `
      ALTER TABLE players ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE players ADD COLUMN level INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE players ADD COLUMN stage INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE players ADD COLUMN title TEXT;
      ALTER TABLE players ADD COLUMN progress_json TEXT;
    `,
    // Existing players: rebuild their stats from the roll log, job counts and the economy log, so
    // titles, goals and XP count what they already did. The server turns these stats into XP on
    // their next login (it needs the XP config for that).
    run: (db) => backfillProgress(db),
  },
  {
    id: 8,
    name: 'stalls',
    // Phase 4: one food business per player (tier + plot as columns; stock, upgrades, mastery,
    // reputation... as JSON). Customers and the queue live in memory only.
    sql: `
      CREATE TABLE stalls (
        account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        tier       INTEGER NOT NULL,
        plot       TEXT NOT NULL UNIQUE,
        data_json  TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 9,
    name: 'properties',
    // Phase 5: owned homes. The unit id is "<OSM building id>#<n>" (stable across map changes);
    // mode, rent, tenant, Airbnb layout, reviews... live in data_json.
    sql: `
      CREATE TABLE properties (
        unit_id    TEXT PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        type       TEXT NOT NULL,
        data_json  TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX properties_owner ON properties(account_id);
    `,
  },
  {
    id: 10,
    name: 'item grades',
    // Item tiers (Tier D..S, "grade" in code). Existing items are tier D.
    sql: `
      ALTER TABLE inventory_items ADD COLUMN grade TEXT NOT NULL DEFAULT 'D';
    `,
  },
  {
    id: 11,
    name: 'player data',
    // Phase 6: per-player JSON blobs by kind: 'ventures' (idle businesses + the retail shop),
    // 'finance' (credit score + loans).
    sql: `
      CREATE TABLE player_data (
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL,
        data_json  TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, kind)
      );
    `,
  },
  {
    id: 12,
    name: 'boutique listings',
    // Phase 6: items on display in player boutiques (taken out of the seller's inventory while
    // listed; back in it if the listing is cancelled, in the buyer's when sold).
    sql: `
      CREATE TABLE boutique_listings (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        seller_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        item_id    TEXT NOT NULL,
        variant    TEXT NOT NULL,
        grade      TEXT NOT NULL,
        serial     INTEGER,
        price_sen  INTEGER NOT NULL,
        listed_at  INTEGER NOT NULL
      );
    `,
  },
  {
    id: 13,
    name: 'pasar online',
    // Phase 7: the marketplace. A listed item is out of the seller's inventory; an auction's top
    // bid is held (already taken from the bidder). Sales are kept for price history.
    sql: `
      CREATE TABLE market_listings (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        seller_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        item_id       TEXT NOT NULL,
        variant       TEXT NOT NULL,
        grade         TEXT NOT NULL,
        serial        INTEGER,
        kind          TEXT NOT NULL,
        price_sen     INTEGER NOT NULL,
        top_bid_sen   INTEGER NOT NULL DEFAULT 0,
        top_bidder_id INTEGER,
        ends_at       INTEGER,
        listed_at     INTEGER NOT NULL
      );
      CREATE TABLE market_sales (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id   TEXT NOT NULL,
        variant   TEXT NOT NULL,
        grade     TEXT NOT NULL,
        price_sen INTEGER NOT NULL,
        kind      TEXT NOT NULL,
        at        INTEGER NOT NULL
      );
      CREATE INDEX market_sales_item ON market_sales(item_id, at);
    `,
  },
];

/** Migration 7's backfill (exported for tests). */
export function backfillProgress(db: Database.Database) {
  const players = db.prepare('SELECT account_id, jobs_json, skills_json FROM players').all() as Array<{ account_id: number; jobs_json: string; skills_json: string }>;
  const rollStmt = db.prepare('SELECT crate_id, tier, COUNT(*) AS n FROM roll_log WHERE account_id = ? GROUP BY crate_id, tier');
  const txSum = db.prepare("SELECT COALESCE(SUM(-delta_sen), 0) AS s FROM transactions WHERE account_id = ? AND reason = 'crate'");
  const jobSum = db.prepare("SELECT COALESCE(SUM(delta_sen), 0) AS s FROM transactions WHERE account_id = ? AND reason LIKE 'job-%'");
  const sells = db.prepare("SELECT ref FROM transactions WHERE account_id = ? AND reason = 'pawn-sell'");
  const manifest = db.prepare("SELECT ref FROM transactions WHERE account_id = ? AND reason = 'manifest'");
  const set = db.prepare('UPDATE players SET progress_json = ? WHERE account_id = ?');
  const EPIC_PLUS = new Set(['epic', 'legendary', 'mythic', 'divine', 'secret']);
  for (const p of players) {
    const stats: Record<string, number> = {};
    const add = (k: string, n: number) => {
      if (n > 0) stats[k] = (stats[k] ?? 0) + n;
    };
    for (const r of rollStmt.all(p.account_id) as Array<{ crate_id: string; tier: string; n: number }>) {
      add('rolls', r.n);
      add(`rolls_${r.crate_id}`, r.n);
      if (EPIC_PLUS.has(r.tier)) add('epicPlusRolls', r.n);
      if (r.tier !== 'common' && r.tier !== 'uncommon' && r.tier !== 'rare' && r.tier !== 'epic') add(`${r.tier}Rolls`, r.n);
    }
    let jobs: Record<string, { done?: number }> = {};
    try {
      jobs = JSON.parse(p.jobs_json || '{}');
    } catch {
      /* keep empty */
    }
    for (const [kind, j] of Object.entries(jobs)) {
      add('jobs', j.done ?? 0);
      add(`jobs_${kind}`, j.done ?? 0);
    }
    add('crateSpendSen', (txSum.get(p.account_id) as { s: number }).s);
    add('jobEarnSen', (jobSum.get(p.account_id) as { s: number }).s);
    for (const r of sells.all(p.account_id) as Array<{ ref: string | null }>) add('sells', Number(/x(\d+)$/.exec(r.ref ?? '')?.[1] ?? 1));
    for (const r of manifest.all(p.account_id) as Array<{ ref: string | null }>) add('manifestSecs', Number(/^(\d+)s$/.exec(r.ref ?? '')?.[1] ?? 0));
    let skills: Record<string, number> = {};
    try {
      skills = JSON.parse(p.skills_json || '{}');
    } catch {
      /* keep empty */
    }
    add('skillLevels', Math.max(0, (skills.manifest ?? 1) - 1));
    set.run(JSON.stringify({ stats, retroXp: true }), p.account_id);
  }
}
