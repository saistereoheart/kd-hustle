// Phase 2 socket handlers: crates, inventory, pawn shop, jobs, vehicles and admin /give.
// Every handler validates input with zod, checks the player is standing at the right place,
// and lets the systems do the (transactional) work.
import {
  C2S, collides, formatMoney, formatOneIn,
  type Announcement, type EquipSlot, type MovementConfig, type CollisionGrid,
} from '@kh/shared';
import type { Socket } from 'socket.io';
import { RateLimiter } from '../auth/rateLimit';
import type { ServerConfig } from '../config/loadConfig';
import type { Repos } from '../db/repos';
import { log } from '../log';
import { Economy, GameError } from '../systems/economy/economy';
import { cryptoRand, Gacha } from '../systems/gacha/gacha';
import { InventorySystem } from '../systems/inventory/inventory';
import { JobSystem } from '../systems/jobs/jobs';
import { newMoveState } from '../systems/movement/moveValidator';
import { placePlayer } from '../systems/movement/placement';
import type { ChatHistory } from '../systems/chat/chat';
import type { GameIO } from './gameServer';
import type { OnlinePlayer, World } from './world';

type AnySocket = Socket;

export function attachEconomy(io: GameIO, deps: { cfg: ServerConfig; repos: Repos; world: World; chat: ChatHistory }) {
  const { cfg, repos, world, chat } = deps;
  const econ = new Economy(repos, cfg);
  const gacha = new Gacha(repos, cfg, econ);
  const inv = new InventorySystem(cfg, econ);
  const rollLimiter = new RateLimiter(cfg.economy.rollRateLimit.count, cfg.economy.rollRateLimit.windowMs);
  const T = cfg.map.tileSize;

  // --- vehicles ---------------------------------------------------------------------------
  const driveGrid: CollisionGrid = { ...cfg.map, solid: cfg.map.driveSolid };
  /** Movement rules for a player right now (walking or riding). */
  const moveRules = (p: OnlinePlayer): { grid: CollisionGrid; movement: MovementConfig } => {
    const v = p.vehicle ? cfg.vehicles.vehicles[p.vehicle] : undefined;
    if (!v) return { grid: cfg.map, movement: cfg.movement };
    return { grid: driveGrid, movement: { ...cfg.movement, walkSpeed: v.speed, hitbox: v.hitbox } };
  };
  const socketOf = (p: OnlinePlayer) => io.sockets.sockets.get(p.socketId);
  const jobs = new JobSystem(cfg, econ, cryptoRand, {
    mount(p, vehicle) {
      p.vehicle = vehicle;
      p.move = newMoveState(p.x, p.y, Date.now(), moveRules(p).movement);
      io.to(p.scene).emit('player:updated', { id: p.id, vehicle });
    },
    dismount(p) {
      p.vehicle = null;
      // Hopping off on a highway or other no-walk tile: step to the nearest walkable spot.
      if (collides(cfg.map, p.x, p.y, cfg.movement.hitbox)) {
        const spot = placePlayer(cfg.map, cfg.movement.hitbox, { x: p.x, y: p.y, mapVersion: p.mapVersion }, { mapVersion: p.mapVersion, spawn: cfg.map.spawnPx });
        p.x = spot.x;
        p.y = spot.y;
        p.dirty = true;
      }
      p.move = newMoveState(p.x, p.y, Date.now(), cfg.movement);
      socketOf(p)?.emit('move:correct', { x: p.x, y: p.y, seq: 0 });
      io.to(p.scene).emit('player:updated', { id: p.id, vehicle: null });
    },
  });
  log.info(`Delivery jobs: ${jobs.candidateCounts.pickups} pickup shops, ${jobs.candidateCounts.dropoffs} homes`);

  /** Is the player standing at an interactable of this type (and crate)? */
  const nearInteractable = (p: OnlinePlayer, type: 'crate' | 'jobs' | 'pawn', crate?: string) =>
    cfg.map.interactables.some(
      (i) => i.type === type && (!crate || i.crate === crate) && Math.hypot(p.x / T - i.x, p.y / T - i.y) <= cfg.economy.interactRadiusTiles,
    );

  const pushWallet = (p: OnlinePlayer, delta?: number, reason?: string) =>
    socketOf(p)?.emit('wallet', { walletSen: p.walletSen, shards: p.shards, delta, reason });

  const broadcastCosmetics = (p: OnlinePlayer) => io.to(p.scene).emit('player:updated', { id: p.id, cosmetics: p.cosmetics });

  /** Wraps a handler: zod-parse, run, turn GameErrors into { ok: false } and log real bugs. */
  function handle<A, R>(socket: AnySocket, event: string, schema: { safeParse: (v: unknown) => { success: true; data: A } | { success: false } } | null, fn: (args: A) => R) {
    socket.on(event, (...raw: unknown[]) => {
      const ack = typeof raw[raw.length - 1] === 'function' ? (raw.pop() as (r: unknown) => void) : () => {};
      try {
        let args = undefined as A;
        if (schema) {
          const parsed = schema.safeParse(raw[0]);
          if (!parsed.success) return ack({ ok: false, error: 'Bad request' });
          args = parsed.data;
        }
        ack({ ok: true, ...(fn(args) as object) });
      } catch (err) {
        if (err instanceof GameError) return ack({ ok: false, error: err.message });
        log.error(`${event} failed`, err);
        ack({ ok: false, error: 'Something went wrong. Try again.' });
      }
    });
  }

  const announce = (p: OnlinePlayer, r: { itemId: string; tier: string; variant: string; serial: number | null; oneIn: number }) => {
    const def = cfg.itemById.get(r.itemId)!;
    const tierName = cfg.rarities.tiers.find((t) => t.id === r.tier)?.name.toUpperCase() ?? r.tier;
    const variant = r.variant !== 'normal' ? `${cfg.rarities.variants.find((v) => v.id === r.variant)?.name ?? r.variant} ` : '';
    const serial = r.serial ? ` #${r.serial}` : '';
    const text = `🔥 ${p.name} rolled [${tierName}] ${variant}${def.name}${serial} (${formatOneIn(r.oneIn)})!`;
    repos.announcements.add(text, r.tier);
    const a: Announcement = {
      text, tier: r.tier, takeover: r.tier === 'divine' || r.tier === 'secret', playerName: p.name, itemId: r.itemId, variant: r.variant, oneIn: r.oneIn,
    };
    // Wait for the roller's reel to finish so the banner doesn't spoil it.
    setTimeout(() => {
      io.emit('announce', a);
      io.emit('chat:msg', chat.add({ fromId: null, fromName: 'Server', text, system: true }));
    }, cfg.economy.announceDelayMs);
  };

  function register(socket: AnySocket, me: OnlinePlayer) {
    // --- crates -------------------------------------------------------------------------
    handle(socket, 'crate:roll', C2S.crateRoll, ({ crateId, count }) => {
      if (!me.hasCharacter) throw new GameError('Create your character first.');
      if (!rollLimiter.hit(String(me.id))) throw new GameError('Easy, tiger! One roll at a time.');
      const crate = cfg.crateById.get(crateId);
      if (!crate) throw new GameError('Unknown crate.');
      if (!nearInteractable(me, 'crate', crateId)) throw new GameError(`Walk to the ${crate.name} to roll it.`);
      const batch = gacha.roll(me, crateId, count);
      for (const r of batch.announce) announce(me, r);
      pushWallet(me, -crate.priceSen * count + (batch.pageReward?.sen ?? 0), 'crate');
      return { results: batch.results, walletSen: me.walletSen, pity: me.pity[crateId], pageReward: batch.pageReward };
    });

    // --- inventory ------------------------------------------------------------------------
    handle(socket, 'inv:equip', C2S.equip, ({ iid }) => {
      if (inv.equip(me, iid)) broadcastCosmetics(me);
      return {};
    });
    handle(socket, 'inv:unequip', C2S.unequip, ({ slot }) => {
      if (inv.unequip(me, slot as EquipSlot)) broadcastCosmetics(me);
      return {};
    });

    // --- pawn shop + shard shop -----------------------------------------------------------
    const atPawn = () => {
      if (!nearInteractable(me, 'pawn')) throw new GameError('Visit Kedai Pajak Untung to sell or scrap items.');
    };
    handle(socket, 'pawn:sell', C2S.stack, ({ itemId, variant, count }) => {
      atPawn();
      const r = inv.sell(me, itemId, variant, count);
      if (r.cosmeticsChanged) broadcastCosmetics(me);
      pushWallet(me, r.gainedSen, 'pawn');
      return { removed: r.removed, gainedSen: r.gainedSen };
    });
    handle(socket, 'pawn:scrap', C2S.stack, ({ itemId, variant, count }) => {
      atPawn();
      const r = inv.scrap(me, itemId, variant, count);
      if (r.cosmeticsChanged) broadcastCosmetics(me);
      pushWallet(me, 0, 'scrap');
      return { removed: r.removed, gainedShards: r.gainedShards };
    });
    handle(socket, 'shard:buy', C2S.shardBuy, ({ itemId }) => {
      atPawn();
      const r = inv.shardBuy(me, itemId);
      pushWallet(me, 0, 'shard-shop');
      return r;
    });

    // --- jobs -----------------------------------------------------------------------------
    handle(socket, 'job:start', C2S.jobStart, ({ kind }) => {
      if (!nearInteractable(me, 'jobs')) throw new GameError('Find the Jobs Board in Dataran Sunway to take a job.');
      const job = jobs.start(me, kind);
      const { budgetMs: _b, ...visible } = job;
      return { job: visible };
    });
    handle(socket, 'job:progress', null, () => {
      const r = jobs.advance(me);
      if (r.paidSen !== undefined) pushWallet(me, r.paidSen + (r.tipSen ?? 0), 'job');
      const job = r.job ? (({ budgetMs: _b, ...v }) => v)(r.job) : null;
      socketOf(me)?.emit('job:update', { job, jobs: me.jobs });
      return { job, paidSen: r.paidSen, tipSen: r.tipSen, levelUp: r.levelUp };
    });
    handle(socket, 'job:cancel', null, () => {
      jobs.cancel(me);
      socketOf(me)?.emit('job:update', { job: null, jobs: me.jobs });
      return {};
    });
    handle(socket, 'carwash:submit', C2S.carwashSubmit, ({ jobId, points }) => {
      const r = jobs.submitCarwash(me, jobId, points);
      if (r.paidSen > 0) pushWallet(me, r.paidSen, 'job');
      socketOf(me)?.emit('job:update', { job: null, jobs: me.jobs });
      return r;
    });
  }

  /** Admin chat commands (spec §17). Returns a reply for the sender, or null if not a command. */
  function chatCommand(me: OnlinePlayer, text: string): string | null {
    if (!text.startsWith('/')) return null;
    if (!me.isAdmin) return 'Unknown command.';
    const [cmd, target, what, value, extra] = text.slice(1).split(/\s+/);
    if (cmd !== 'give') return 'Commands: /give <player|me> money <RM> · /give <player|me> item <itemId> [variant] · /give <player|me> shards <n>';
    const p = target === 'me' ? me : world.byName(target ?? '');
    if (!p) return `No online player called "${target}".`;
    try {
      if (what === 'money') {
        const sen = Math.round(Number(value) * 100);
        if (!Number.isSafeInteger(sen) || sen === 0) return 'Usage: /give <player> money <RM>';
        econ.run(p, () => econ.change(p, sen, 0, 'admin-give', me.name));
        pushWallet(p, sen, 'admin');
        return `Gave ${p.name} ${formatMoney(sen)}.`;
      }
      if (what === 'shards') {
        const n = Math.round(Number(value));
        if (!Number.isSafeInteger(n) || n === 0) return 'Usage: /give <player> shards <n>';
        econ.run(p, () => econ.change(p, 0, n, 'admin-give', me.name));
        pushWallet(p, 0, 'admin');
        return `Gave ${p.name} ${n} shards.`;
      }
      if (what === 'item') {
        const def = cfg.itemById.get(value ?? '');
        if (!def) return `Unknown item "${value}".`;
        const variant = extra && cfg.rarities.variants.some((v) => v.id === extra) ? extra : 'normal';
        const { item } = econ.run(p, () => econ.grant(p, def.id, variant, null));
        socketOf(p)?.emit('inv:added', { items: [item], index: [...p.index] });
        return `Gave ${p.name} ${variant !== 'normal' ? `${variant} ` : ''}${def.name}.`;
      }
    } catch (err) {
      return err instanceof GameError ? err.message : 'Command failed.';
    }
    return 'Usage: /give <player|me> money|item|shards ...';
  }

  /** Load a player's economy state from the DB when they connect. */
  function loadInto(p: OnlinePlayer) {
    const e = repos.econ.load(p.id);
    p.walletSen = e.walletSen;
    p.shards = e.shards;
    p.equipped = e.equipped;
    p.pity = e.pity;
    p.jobs = e.jobs;
    p.pages = new Set(e.pages);
    p.inventory = repos.inventory.list(p.id);
    p.index = new Set(repos.collection.list(p.id));
    p.cosmetics = {};
    econ.refreshCosmetics(p);
  }

  return { register, chatCommand, moveRules, loadInto, cancelJob: (p: OnlinePlayer) => jobs.cancel(p) };
}
