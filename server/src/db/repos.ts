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

/** Saved progression (Phase 3). Buff timers are saved as time LEFT, so they pause while offline. */
export interface ProgressRecord {
  xp: number;
  level: number;
  stage: number;
  title: string | null;
  titles: string[];
  stats: Record<string, number>;
  buffs: Array<{ item: string; kind: string; mult: number; leftMs: number }>;
  login: { lastDay: string | null; streak: number };
  quests: { day: string | null; list: Array<{ id: string; base: number; target: number; senReward: number; claimed: boolean }> };
  /** Legacy (before Phase 4): how many goals were done, in order. */
  path?: number;
  goalsDone: string[];
  /** Fractional XP not yet credited (manifesting earns a fraction per payout). */
  xpFrac: number;
  /** Set by migration 7 for players from before Phase 3: turn their stats into XP on login. */
  retroXp?: boolean;
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
    invList: db.prepare('SELECT iid, item_id, variant, grade, serial, obtained_at FROM inventory_items WHERE account_id = ? ORDER BY iid'),
    invInsert: db.prepare('INSERT INTO inventory_items (account_id, item_id, variant, grade, serial, obtained_at) VALUES (?, ?, ?, ?, ?, ?)'),
    invUpdateLook: db.prepare('UPDATE inventory_items SET grade = ?, variant = ? WHERE iid = ? AND account_id = ?'),
    invDelete: db.prepare('DELETE FROM inventory_items WHERE iid = ? AND account_id = ?'),
    indexList: db.prepare('SELECT item_id FROM collection_index WHERE account_id = ?'),
    indexAdd: db.prepare('INSERT OR IGNORE INTO collection_index (account_id, item_id, first_found_at) VALUES (?, ?, ?)'),
    rollInsert: db.prepare('INSERT INTO roll_log (account_id, crate_id, item_id, tier, variant, serial, rolled_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    rollCountItem: db.prepare('SELECT COUNT(*) AS n FROM roll_log WHERE item_id = ?'),
    txSums: db.prepare('SELECT reason, SUM(CASE WHEN delta_sen > 0 THEN delta_sen ELSE 0 END) AS inSen, SUM(CASE WHEN delta_sen < 0 THEN -delta_sen ELSE 0 END) AS outSen, COUNT(*) AS n FROM transactions WHERE account_id = ? AND at >= ? AND delta_sen != 0 GROUP BY reason'),
    txInsert: db.prepare('INSERT INTO transactions (account_id, delta_sen, balance_sen, delta_shards, reason, ref, at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    announceInsert: db.prepare('INSERT INTO announcements (text, tier, at) VALUES (?, ?, ?)'),
    stallDelete: db.prepare('DELETE FROM stalls WHERE account_id = ?'),
    stallsAll: db.prepare('SELECT s.account_id, s.tier, s.plot, s.data_json, a.username FROM stalls s JOIN accounts a ON a.id = s.account_id'),
    stallUpsert: db.prepare(
      `INSERT INTO stalls (account_id, tier, plot, data_json, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET tier = excluded.tier, plot = excluded.plot, data_json = excluded.data_json, updated_at = excluded.updated_at`,
    ),
    propsAll: db.prepare('SELECT p.unit_id, p.account_id, p.type, p.data_json, a.username FROM properties p JOIN accounts a ON a.id = p.account_id'),
    propUpsert: db.prepare(
      `INSERT INTO properties (unit_id, account_id, type, data_json, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(unit_id) DO UPDATE SET account_id = excluded.account_id, type = excluded.type, data_json = excluded.data_json, updated_at = excluded.updated_at`,
    ),
    propDelete: db.prepare('DELETE FROM properties WHERE unit_id = ?'),
    mkAll: db.prepare('SELECT m.*, a.username, b.username AS bidder FROM market_listings m JOIN accounts a ON a.id = m.seller_id LEFT JOIN accounts b ON b.id = m.top_bidder_id ORDER BY m.id'),
    mkInsert: db.prepare('INSERT INTO market_listings (seller_id, item_id, variant, grade, serial, kind, price_sen, ends_at, listed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    mkBid: db.prepare('UPDATE market_listings SET top_bid_sen = ?, top_bidder_id = ?, ends_at = ? WHERE id = ?'),
    mkDelete: db.prepare('DELETE FROM market_listings WHERE id = ?'),
    mkSale: db.prepare('INSERT INTO market_sales (item_id, variant, grade, price_sen, kind, at) VALUES (?, ?, ?, ?, ?, ?)'),
    mkHistory: db.prepare('SELECT item_id, variant, grade, price_sen, kind, at FROM market_sales WHERE item_id = ? ORDER BY at DESC LIMIT ?'),
    bqAll: db.prepare('SELECT b.*, a.username FROM boutique_listings b JOIN accounts a ON a.id = b.seller_id ORDER BY b.id'),
    bqInsert: db.prepare('INSERT INTO boutique_listings (seller_id, item_id, variant, grade, serial, price_sen, listed_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    bqDelete: db.prepare('DELETE FROM boutique_listings WHERE id = ?'),
    pdAll: db.prepare('SELECT account_id, data_json FROM player_data WHERE kind = ?'),
    pdGet: db.prepare('SELECT data_json FROM player_data WHERE account_id = ? AND kind = ?'),
    pdUpsert: db.prepare(
      `INSERT INTO player_data (account_id, kind, data_json, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id, kind) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`,
    ),
    progressById: db.prepare('SELECT xp, level, stage, title, progress_json FROM players WHERE account_id = ?'),
    setProgress: db.prepare('UPDATE players SET xp = ?, level = ?, stage = ?, title = ?, progress_json = ? WHERE account_id = ?'),
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
      /** Money in/out per reason since a time (for the 💰 money breakdown). */
      sums: (accountId: number, since: number) => s.txSums.all(accountId, since) as Array<{ reason: string; inSen: number; outSen: number; n: number }>,
      logTx: (accountId: number, deltaSen: number, balanceSen: number, deltaShards: number, reason: string, ref: string | null) =>
        s.txInsert.run(accountId, deltaSen, balanceSen, deltaShards, reason, ref, Date.now()),
    },
    stalls: {
      all: () =>
        (s.stallsAll.all() as Array<{ account_id: number; tier: number; plot: string; data_json: string; username: string }>).map((r) => ({
          owner: r.account_id,
          ownerName: r.username,
          tier: r.tier,
          plot: r.plot,
          data: parseJson<Record<string, unknown>>(r.data_json, {}),
        })),
      save: (accountId: number, tier: number, plot: string, data: unknown) => s.stallUpsert.run(accountId, tier, plot, JSON.stringify(data), Date.now()),
      delete: (accountId: number) => s.stallDelete.run(accountId),
    },
    properties: {
      all: () =>
        (s.propsAll.all() as Array<{ unit_id: string; account_id: number; type: string; data_json: string; username: string }>).map((r) => ({
          unit: r.unit_id,
          owner: r.account_id,
          ownerName: r.username,
          type: r.type,
          data: parseJson<Record<string, unknown>>(r.data_json, {}),
        })),
      save: (unit: string, owner: number, type: string, data: unknown) => s.propUpsert.run(unit, owner, type, JSON.stringify(data), Date.now()),
      delete: (unit: string) => s.propDelete.run(unit),
    },
    /** Pasar Online: listings and the sales history. */
    market: {
      all: () =>
        (s.mkAll.all() as Array<{ id: number; seller_id: number; username: string; item_id: string; variant: string; grade: string; serial: number | null; kind: string; price_sen: number; top_bid_sen: number; top_bidder_id: number | null; bidder: string | null; ends_at: number | null; listed_at: number }>).map((r) => ({
          id: r.id, seller: r.seller_id, sellerName: r.username, itemId: r.item_id, variant: r.variant, grade: r.grade, serial: r.serial, kind: r.kind as 'fixed' | 'auction',
          priceSen: r.price_sen, topBidSen: r.top_bid_sen, topBidder: r.top_bidder_id, topBidderName: r.bidder, endsAt: r.ends_at, listedAt: r.listed_at,
        })),
      insert: (seller: number, itemId: string, variant: string, grade: string, serial: number | null, kind: string, priceSen: number, endsAt: number | null, at: number) =>
        Number(s.mkInsert.run(seller, itemId, variant, grade, serial, kind, priceSen, endsAt, at).lastInsertRowid),
      bid: (id: number, sen: number, bidder: number, endsAt: number | null) => s.mkBid.run(sen, bidder, endsAt, id).changes === 1,
      delete: (id: number) => s.mkDelete.run(id).changes === 1,
      sale: (itemId: string, variant: string, grade: string, priceSen: number, kind: string, at: number) => s.mkSale.run(itemId, variant, grade, priceSen, kind, at),
      history: (itemId: string, limit: number) =>
        (s.mkHistory.all(itemId, limit) as Array<{ item_id: string; variant: string; grade: string; price_sen: number; kind: string; at: number }>).map((r) => ({ itemId: r.item_id, variant: r.variant, grade: r.grade, priceSen: r.price_sen, kind: r.kind as 'fixed' | 'auction', at: r.at })),
    },
    /** Items on display in player boutiques. */
    boutique: {
      all: () =>
        (s.bqAll.all() as Array<{ id: number; seller_id: number; username: string; item_id: string; variant: string; grade: string; serial: number | null; price_sen: number; listed_at: number }>).map((r) => ({
          id: r.id, seller: r.seller_id, sellerName: r.username, itemId: r.item_id, variant: r.variant, grade: r.grade, serial: r.serial, priceSen: r.price_sen, listedAt: r.listed_at,
        })),
      insert: (seller: number, itemId: string, variant: string, grade: string, serial: number | null, priceSen: number, at: number) =>
        Number(s.bqInsert.run(seller, itemId, variant, grade, serial, priceSen, at).lastInsertRowid),
      /** True if it was still there (so two buyers can't both get it). */
      delete: (id: number) => s.bqDelete.run(id).changes === 1,
    },
    /** Per-player JSON blobs by kind ('ventures', 'finance', 'boutique'). */
    playerData: {
      load: <T>(accountId: number, kind: string): T | null => {
        const r = s.pdGet.get(accountId, kind) as { data_json: string } | undefined;
        return r ? parseJson<T | null>(r.data_json, null) : null;
      },
      save: (accountId: number, kind: string, data: unknown) => s.pdUpsert.run(accountId, kind, JSON.stringify(data), Date.now()),
      /** Every player's blob of this kind (leaderboards). */
      all: <T>(kind: string): Array<{ id: number; data: T }> =>
        (s.pdAll.all(kind) as Array<{ account_id: number; data_json: string }>).map((r) => ({ id: r.account_id, data: parseJson<T>(r.data_json, {} as T) })),
    },
    progress: {
      load: (accountId: number): ProgressRecord => {
        const r = s.progressById.get(accountId) as { xp: number; level: number; stage: number; title: string | null; progress_json: string | null } | undefined;
        const j = parseJson<Partial<ProgressRecord>>(r?.progress_json, {});
        return {
          xp: r?.xp ?? 0,
          level: r?.level ?? 1,
          stage: r?.stage ?? 1,
          title: r?.title ?? null,
          titles: Array.isArray(j.titles) ? j.titles : [],
          stats: j.stats && typeof j.stats === 'object' ? j.stats : {},
          buffs: Array.isArray(j.buffs) ? j.buffs : [],
          login: j.login ?? { lastDay: null, streak: 0 },
          quests: j.quests ?? { day: null, list: [] },
          path: typeof j.path === 'number' ? j.path : 0,
          goalsDone: Array.isArray(j.goalsDone) ? j.goalsDone : [],
          xpFrac: typeof j.xpFrac === 'number' ? j.xpFrac : 0,
          retroXp: j.retroXp === true,
        };
      },
      save: (accountId: number, p: ProgressRecord) => {
        const { xp, level, stage, title, ...rest } = p;
        s.setProgress.run(xp, level, stage, title, JSON.stringify({ ...rest, retroXp: undefined }), accountId);
      },
    },
    inventory: {
      list: (accountId: number): InventoryItem[] =>
        (s.invList.all(accountId) as Array<{ iid: number; item_id: string; variant: string; grade: string; serial: number | null; obtained_at: number }>).map((r) => ({
          iid: r.iid,
          itemId: r.item_id,
          variant: r.variant,
          grade: r.grade,
          serial: r.serial,
          obtainedAt: r.obtained_at,
        })),
      insert: (accountId: number, itemId: string, variant: string, serial: number | null, grade = 'D'): InventoryItem => {
        const at = Date.now();
        const info = s.invInsert.run(accountId, itemId, variant, grade, serial, at);
        return { iid: Number(info.lastInsertRowid), itemId, variant, grade, serial, obtainedAt: at };
      },
      /** Change an item's tier and/or variant (merging, shard rerolls). */
      setLook: (accountId: number, iid: number, grade: string, variant: string) => s.invUpdateLook.run(grade, variant, iid, accountId).changes === 1,
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
      /**
       * Admin /resetplayer (applied at server start, before anything is loaded): back to a new
       * player. Keeps the account, the character's look and their position.
       */
      resetProgress: (id: number, walletSen: number) =>
        db.transaction(() => {
          for (const sql of [
            'DELETE FROM inventory_items WHERE account_id = ?',
            'DELETE FROM collection_index WHERE account_id = ?',
            'DELETE FROM stalls WHERE account_id = ?',
            'DELETE FROM properties WHERE account_id = ?',
            'DELETE FROM player_data WHERE account_id = ?',
            'DELETE FROM boutique_listings WHERE seller_id = ?',
            'DELETE FROM market_listings WHERE seller_id = ?',
          ]) db.prepare(sql).run(id);
          db.prepare("UPDATE players SET wallet_sen = ?, shards = 0, equipped_json = '{}', pity_json = '{}', jobs_json = '{}', pages_json = '[]', skills_json = '{}', hotbar_json = NULL, xp = 0, level = 1, stage = 1, title = NULL, progress_json = NULL WHERE account_id = ?").run(walletSen, id);
        })(),
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
