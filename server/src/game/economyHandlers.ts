// Phase 2 socket handlers: crates, inventory, pawn shop, jobs, vehicles and admin /give.
// Every handler validates input with zod, checks the player is standing at the right place,
// and lets the systems do the (transactional) work.
import {
  C2S, collides, formatMoney, formatOneIn, HOTBAR_SLOTS, manifestRateSen, skillUpgradeCostSen,
  type Announcement, type EquipSlot, type HotbarRef, type MovementConfig, type CollisionGrid,
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
import { RideSystem } from '../systems/rides/rides';
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
  world.starterVehicles = Object.entries(cfg.vehicles.vehicles).filter(([, v]) => v.starter).map(([id]) => id);
  const gridFor = (grid: 'walk' | 'drive'): CollisionGrid => (grid === 'drive' ? cfg.map.driveCollision : cfg.map.collision);
  /** Movement rules for a player right now (walking or riding). */
  const moveRules = (p: OnlinePlayer): { grid: CollisionGrid; movement: MovementConfig } => {
    const v = p.vehicle ? cfg.vehicles.vehicles[p.vehicle] : undefined;
    if (!v) return { grid: cfg.map.collision, movement: cfg.movement };
    return { grid: gridFor(v.grid), movement: { ...cfg.movement, walkSpeed: v.speed, hitbox: v.hitbox } };
  };
  const socketOf = (p: OnlinePlayer) => io.sockets.sockets.get(p.socketId);
  /** Puts the player on a vehicle (or off it, with null) and tells everyone. */
  function setVehicle(p: OnlinePlayer, vehicle: string | null) {
    p.vehicle = vehicle;
    // Landing somewhere this ride (or your feet) can't be, e.g. hopping off on a highway:
    // step to the nearest spot that's allowed.
    const rules = moveRules(p);
    if (collides(rules.grid, p.x, p.y, rules.movement.hitbox)) {
      const spot = placePlayer(rules.grid, rules.movement.hitbox, { x: p.x, y: p.y, mapVersion: p.mapVersion }, { mapVersion: p.mapVersion, spawn: cfg.map.spawnPx });
      p.x = spot.x;
      p.y = spot.y;
      p.dirty = true;
      socketOf(p)?.emit('move:correct', { x: p.x, y: p.y, seq: 0 });
    }
    p.move = newMoveState(p.x, p.y, Date.now(), rules.movement);
    if (vehicle && p.emote) {
      p.emote = null;
      io.to(p.scene).emit('emote:stopped', { id: p.id });
    }
    io.to(p.scene).emit('player:updated', { id: p.id, vehicle });
  }
  const jobs = new JobSystem(cfg, econ, cryptoRand);
  const rides = new RideSystem(cfg.rides, cfg.map, cfg.terrain);
  /** Drop a Ronda passenger off where they are now (a walkable spot) and sync their client. */
  function endRide(p: OnlinePlayer, arrived: boolean) {
    rides.end(p);
    setVehicle(p, null); // also steps to the nearest walkable spot if needed
    socketOf(p)?.emit('move:correct', { x: p.x, y: p.y, seq: 0 });
    socketOf(p)?.emit('ride:ended', { x: p.x, y: p.y, arrived });
  }
  const rideTimer = setInterval(() => {
    const now = Date.now();
    for (const p of world.players.values()) if (p.ride && rides.step(p, now)) endRide(p, true);
  }, 1000 / Math.max(10, cfg.net.snapshotRateHz));
  log.info(`Delivery jobs: ${jobs.candidateCounts.pickups} pickup shops, ${jobs.candidateCounts.dropoffs} homes`);

  /** Is the player standing at an interactable of this type (and crate)? */
  const nearInteractable = (p: OnlinePlayer, type: 'crate' | 'jobs' | 'pawn' | 'carwash', crate?: string) =>
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
      if (kind === 'carwash') {
        if (!nearInteractable(me, 'carwash')) throw new GameError('Go to Kilat Car Wash (east of the Jobs Board) to wash cars.');
        if (me.vehicle) throw new GameError('Hop off your ride first.');
      } else if (!nearInteractable(me, 'jobs')) throw new GameError('Find the Jobs Board in Dataran Sunway to take a job.');
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
    handle(socket, 'carwash:submit', C2S.carwashSubmit, ({ jobId, ...input }) => {
      const r = jobs.submitCarwash(me, jobId, input);
      if (r.paidSen > 0) pushWallet(me, r.paidSen, 'job');
      socketOf(me)?.emit('job:update', { job: null, jobs: me.jobs });
      return r;
    });

    // --- vehicles -------------------------------------------------------------------------
    handle(socket, 'vehicle:ride', C2S.vehicleRide, ({ vehicle }) => {
      if (me.ride) throw new GameError(`You're on a ${cfg.rides.appName} ride. Tap "Get off here" to stop.`);
      if (vehicle !== null) {
        if (!world.vehiclesOf(me).includes(vehicle)) throw new GameError("You don't have that ride.");
        if (me.job?.kind === 'carwash') throw new GameError('Finish washing the car first.');
      }
      if (vehicle !== me.vehicle) setVehicle(me, vehicle);
      return { vehicle: me.vehicle, vehicles: world.vehiclesOf(me) };
    });

    // --- Ronda rides (phone app: point A to point B for a fare) -----------------------------
    handle(socket, 'ride:quote', C2S.rideQuote, ({ x, y }) => {
      if (!me.hasCharacter) throw new GameError('Create your character first.');
      if (me.job?.kind === 'carwash') throw new GameError('Finish washing the car first.');
      return { quote: rides.quote(me, x, y) };
    });
    handle(socket, 'ride:book', C2S.rideBook, ({ quoteId }) => {
      if (me.job?.kind === 'carwash') throw new GameError('Finish washing the car first.');
      const q = rides.checkBooking(me, quoteId);
      econ.run(me, () => econ.change(me, -q.fareSen, 0, 'ride', `${q.meters}m`));
      pushWallet(me, -q.fareSen, 'ride');
      if (me.emote) {
        me.emote = null;
        io.to(me.scene).emit('emote:stopped', { id: me.id });
      }
      const ride = rides.start(me, q);
      me.vehicle = cfg.rides.vehicle;
      io.to(me.scene).emit('player:updated', { id: me.id, vehicle: me.vehicle });
      return { walletSen: me.walletSen, route: q.route, pickupMs: cfg.rides.pickupMs, durationMs: Math.round(rides.durationMs(ride)), destName: q.destName };
    });
    handle(socket, 'ride:stop', null, () => {
      if (!me.ride) throw new GameError("You're not on a ride.");
      endRide(me, false);
      return {};
    });

    // --- hotbar ---------------------------------------------------------------------------
    handle(socket, 'hotbar:set', C2S.hotbarSet, ({ slot, ref }) => {
      if (ref?.kind === 'vehicle' && (!cfg.vehicles.vehicles[ref.id] || cfg.vehicles.vehicles[ref.id].passenger)) throw new GameError('Unknown vehicle.');
      if (ref?.kind === 'item') {
        if (!cfg.itemById.has(ref.itemId) || !cfg.rarities.variants.some((v) => v.id === ref.variant)) throw new GameError('Unknown item.');
        if (!me.inventory.some((i) => i.itemId === ref.itemId && i.variant === ref.variant)) throw new GameError("You don't have that item.");
      }
      const next = [...me.hotbar];
      // An item/vehicle lives in one slot at a time: moving it clears the old slot.
      if (ref) for (let i = 0; i < next.length; i++) if (next[i] && JSON.stringify(next[i]) === JSON.stringify(ref)) next[i] = null;
      next[slot] = ref;
      me.hotbar = next;
      repos.econ.setHotbar(me.id, next);
      return { hotbar: next };
    });
  }

  /** Admin chat commands (spec §17). Returns a reply for the sender, or null if not a command. */
  function chatCommand(me: OnlinePlayer, text: string): string | null {
    if (!text.startsWith('/')) return null;
    if (!me.isAdmin) return 'Unknown command.';
    const [cmd, target, what, value, extra] = text.slice(1).split(/\s+/);
    if (cmd === 'tp') {
      // /tp <x> <y> in tiles from the origin (Menara Mitraland = 0 0)
      const x = Number(target), y = Number(what);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return 'Usage: /tp <x> <y> (tiles from Menara Mitraland)';
      const spot = placePlayer(cfg.map.collision, cfg.movement.hitbox, { x: (x + 0.5) * T, y: (y + 0.5) * T, mapVersion: me.mapVersion }, { mapVersion: me.mapVersion, spawn: cfg.map.spawnPx });
      me.x = spot.x;
      me.y = spot.y;
      me.dirty = true;
      me.move = newMoveState(me.x, me.y, Date.now(), moveRules(me).movement);
      socketOf(me)?.emit('move:correct', { x: me.x, y: me.y, seq: 0 });
      return `Teleported to ${x}, ${y}.`;
    }
    if (cmd !== 'give') return 'Commands: /give <player|me> money <RM> · /give <player|me> item <itemId> [variant] · /give <player|me> shards <n> · /tp <x> <y>';
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
    p.skills = e.skills;
    p.manifestBank = 0;
    p.manifestSecs = 0;
    p.hotbar = normalizeHotbar(e.hotbar);
    p.ride = null;
    p.rideQuote = null;
    econ.refreshCosmetics(p);
  }

  /** 10 slots; a brand-new player gets their starter bicycle in slot 1. */
  function normalizeHotbar(saved: Array<HotbarRef | null> | null): Array<HotbarRef | null> {
    const bar: Array<HotbarRef | null> = new Array(HOTBAR_SLOTS).fill(null);
    if (!saved) {
      world.starterVehicles.forEach((id, i) => {
        if (i < HOTBAR_SLOTS) bar[i] = { kind: 'vehicle', id };
      });
      return bar;
    }
    for (let i = 0; i < HOTBAR_SLOTS; i++) bar[i] = saved[i] ?? null;
    return bar;
  }

  // --- Manifesting: earn RM every second while holding the 🧘 Manifest emote ---------------
  // Earnings are banked in memory and paid out in one transaction every N seconds (and when
  // the player stops or leaves), so a busy server isn't writing to the DB every second.
  const manifestLevel = (p: OnlinePlayer) => Math.max(1, p.skills.manifest ?? 1);
  function flushManifest(p: OnlinePlayer) {
    const sen = Math.floor(p.manifestBank);
    if (sen < 1) return;
    try {
      econ.run(p, () => econ.change(p, sen, 0, 'manifest', `${p.manifestSecs}s`));
      p.manifestBank -= sen;
      p.manifestSecs = 0;
      pushWallet(p, sen, 'manifest');
    } catch (err) {
      log.error('manifest payout failed', err);
    }
  }
  const manifestTimer = setInterval(() => {
    for (const p of world.players.values()) {
      if (p.hasCharacter && p.emote === 'manifest' && !p.moving && !p.vehicle) {
        p.manifestBank += manifestRateSen(cfg.skills, manifestLevel(p));
        p.manifestSecs++;
        if (p.manifestSecs >= cfg.skills.manifestFlushEverySec) flushManifest(p);
      } else if (p.manifestBank >= 1) {
        flushManifest(p);
      }
    }
  }, 1000);

  function registerSkills(socket: AnySocket, me: OnlinePlayer) {
    handle(socket, 'skill:upgrade', C2S.skillUpgrade, () => {
      const level = manifestLevel(me);
      if (level >= cfg.skills.skills.manifest.maxLevel) throw new GameError('Manifesting is already maxed out.');
      const cost = skillUpgradeCostSen(cfg.skills, level);
      econ.run(me, () => {
        econ.change(me, -cost, 0, 'skill', `manifest:${level + 1}`);
        me.skills = { ...me.skills, manifest: level + 1 };
        econ.saveState(me);
      });
      pushWallet(me, -cost, 'skill');
      return { level: level + 1, walletSen: me.walletSen };
    });
  }

  return {
    register: (socket: AnySocket, me: OnlinePlayer) => {
      register(socket, me);
      registerSkills(socket, me);
    },
    chatCommand,
    moveRules,
    loadInto,
    flushManifest,
    cancelJob: (p: OnlinePlayer) => jobs.cancel(p),
    /** On disconnect: off the ride. A Ronda passenger is dropped off where they are. */
    leave: (p: OnlinePlayer) => {
      if (p.ride) {
        rides.step(p);
        rides.end(p);
        const spot = placePlayer(cfg.map.collision, cfg.movement.hitbox, { x: p.x, y: p.y, mapVersion: p.mapVersion }, { mapVersion: p.mapVersion, spawn: cfg.map.spawnPx });
        p.x = spot.x;
        p.y = spot.y;
        p.dirty = true;
      }
      p.vehicle = null;
      p.rideQuote = null;
    },
    isRiding: (p: OnlinePlayer) => p.ride !== null,
    stop: () => {
      clearInterval(manifestTimer);
      clearInterval(rideTimer);
    },
  };
}
