import crypto from 'node:crypto';
// Phase 2 socket handlers: crates, inventory, pawn shop, jobs, vehicles and admin /give.
// Every handler validates input with zod, checks the player is standing at the right place,
// and lets the systems do the (transactional) work.
import { variantLabel, petLook, temanBoost,
  C2S, collides, setBoxes, stallFootprint, formatMoney, formatOneIn, gameTime, formatClock, HOTBAR_SLOTS, stageForNetWorth, netWorthSen, stageDef, totalXpForLevel, dayKey,
  type Announcement, type EquipSlot, type HotbarRef, type MovementConfig, type CollisionGrid, type RerollPity
} from '@kh/shared';
import type { Socket } from 'socket.io';
import { RateLimiter } from '../auth/rateLimit';
import type { ServerConfig } from '../config/loadConfig';
import type { Repos } from '../db/repos';
import { log } from '../log';
import { Economy, GameError } from '../systems/economy/economy';
import { cryptoRand, Gacha } from '../systems/gacha/gacha';
import { LabSystem } from '../systems/lab/lab';
import { createLabHandlers } from './labHandlers';
import { DungeonSystem } from '../systems/dungeon/dungeon';
import { PetSystem } from '../systems/pets/pets';
import { GarageSystem } from '../systems/garage/garage';
import { InventorySystem } from '../systems/inventory/inventory';
import { JobSystem } from '../systems/jobs/jobs';
import { newMoveState } from '../systems/movement/moveValidator';
import { placePlayer } from '../systems/movement/placement';
import { RideSystem } from '../systems/rides/rides';
import { ProgressionSystem } from '../systems/progression/progression';
import { StallSystem } from '../systems/stalls/stalls';
import { NpcSystem } from '../systems/npcs/npcs';
import { PropertySystem } from '../systems/property/property';
import type { ChatHistory } from '../systems/chat/chat';
import type { GameIO } from './gameServer';
import { createVentures } from './ventureHandlers';
import { createLoans } from './loanHandlers';
import { createCasino } from './casinoHandlers';
import { createMusic } from './musicHandlers';
import { createSocial } from './socialHandlers';
import { createEvents } from './eventHandlers';
import { createRebirth } from './rebirthHandlers';
import { createParking } from './parkingHandlers';
import { ShoplotSystem } from '../systems/shoplots/shoplots';
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
  // 🚗 Motor Kota (created below; vehicles bought there count as yours and have tuned top speeds)
  let garage: GarageSystem | null = null;
  world.ownedVehicles = (p) => garage?.owned(p) ?? [];
  const gridFor = (grid: 'walk' | 'drive'): CollisionGrid => (grid === 'drive' ? cfg.map.driveCollision : cfg.map.collision);
  /** Movement rules for a player right now (walking or riding). */
  const moveRules = (p: OnlinePlayer): { grid: CollisionGrid; movement: MovementConfig } => {
    const v = p.vehicle ? cfg.vehicles.vehicles[p.vehicle] : undefined;
    if (!v) {
      const walk = p.prog ? prog.mods(p).walk : 1; // Kaki Lari skill
      return { grid: cfg.map.collision, movement: walk === 1 ? cfg.movement : { ...cfg.movement, walkSpeed: cfg.movement.walkSpeed * walk } };
    }
    return { grid: gridFor(v.grid), movement: { ...cfg.movement, walkSpeed: garage ? garage.speedOf(p, p.vehicle!) : v.speed, hitbox: v.hitbox } };
  };
  const socketOf = (p: OnlinePlayer) => io.sockets.sockets.get(p.socketId);
  /** Puts the player on a vehicle (or off it, with null) and tells everyone. */
  function setVehicle(p: OnlinePlayer, vehicle: string | null) {
    p.vehicle = vehicle;
    p.engine = null;
    p.vehicleLook = garage?.lookOf(p, vehicle) ?? null;
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
    io.to(p.scene).emit('player:updated', { id: p.id, vehicle, vehicleLook: p.vehicleLook });
  }
  // 🅿️ Vehicles you put down, get in and out of, and give people a lift in.
  const parking = createParking({
    cfg, world, io, socketOf, setVehicle, moveRules, gridFor,
    lookOf: (p, vehicle) => garage?.lookOf(p, vehicle) ?? null,
  });
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
  const nearInteractable = (p: OnlinePlayer, type: import('@kh/shared').InteractType, crate?: string) =>
    cfg.map.interactables.some(
      (i) =>
        i.type === type &&
        (!crate || i.crate === crate) &&
        // Any entrance of its building counts (you use it from inside, entered through that door).
        i.spots.some(([sx, sy]) => Math.hypot(p.x / T - sx, p.y / T - sy) <= cfg.economy.interactRadiusTiles),
    );

  // Wallet updates: the first goes out at once; any more within WALLET_GAP_MS are merged into
  // one trailing update (cooks, ventures and rent can tick many times a second, and every update
  // makes the client redraw).
  const WALLET_GAP_MS = 400;
  const walletOut = new Map<number, { last: number; timer: ReturnType<typeof setTimeout> | null; delta: number; reason?: string }>();
  const sendWallet = (p: OnlinePlayer, delta?: number, reason?: string) =>
    socketOf(p)?.emit('wallet', { walletSen: p.walletSen, shards: p.shards, delta, reason });
  const pushWallet = (p: OnlinePlayer, delta?: number, reason?: string) => {
    const now = Date.now();
    const w = walletOut.get(p.id) ?? { last: 0, timer: null, delta: 0 };
    walletOut.set(p.id, w);
    if (!w.timer && now - w.last >= WALLET_GAP_MS) {
      w.last = now;
      return sendWallet(p, delta, reason);
    }
    w.delta += delta ?? 0;
    w.reason = reason ?? w.reason;
    if (w.timer) return;
    w.timer = setTimeout(() => {
      w.timer = null;
      w.last = Date.now();
      const d = w.delta;
      w.delta = 0;
      const live = world.get(p.id);
      if (live) sendWallet(live, d, w.reason);
      else walletOut.delete(p.id);
    }, Math.max(0, w.last + WALLET_GAP_MS - now));
  };

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

  /** A big roll: the banner (and the takeover for the top tiers) for everyone, and a chat line. The
   *  roller's own client shows it the moment their reel lands (it comes back with the roll), so
   *  everyone else gets it after the reel's usual length. Returns the announcement. */
  const announce = (p: OnlinePlayer, r: { itemId: string; tier: string; variant: string; serial: number | null; oneIn: number }): Announcement => {
    const def = cfg.itemById.get(r.itemId)!;
    const tierName = cfg.rarities.tiers.find((t) => t.id === r.tier)?.name.toUpperCase() ?? r.tier;
    const variant = r.variant !== 'normal' ? `${variantLabel(cfg.rarities.variants, r.variant)} ` : '';
    const serial = r.serial ? ` #${r.serial}` : '';
    const text = `🔥 ${p.name} rolled [${tierName}] ${variant}${def.name}${serial} (${formatOneIn(r.oneIn)})!`;
    repos.announcements.add(text, r.tier);
    const a: Announcement = {
      text, tier: r.tier, takeover: r.tier === 'divine' || r.tier === 'secret', playerName: p.name, itemId: r.itemId, variant: r.variant, oneIn: r.oneIn,
    };
    // Wait for the roller's reel to finish so the banner doesn't spoil it.
    setTimeout(() => {
      io.except(p.socketId).emit('announce', a);
      io.emit('chat:msg', chat.add({ fromId: null, fromName: 'Server', text, system: true }));
    }, cfg.economy.announceDelayMs);
    return a;
  };

  // --- server events (Phase 7): Lucky Hour, Rush Hour... ------------------------------------
  const events = createEvents({
    cfg, io, world, rand: cryptoRand,
    announce: (text, banner) => {
      repos.announcements.add(text, 'legendary');
      io.emit('chat:msg', chat.add({ fromId: null, fromName: 'Server', text, system: true }));
      if (banner) io.emit('announce', { text, tier: 'legendary', takeover: false, playerName: '', itemId: '', variant: 'normal', oneIn: 0 });
    },
  });
  // --- progression (Phase 3) ---------------------------------------------------------------
  // eslint-disable-next-line prefer-const
  let stalls: StallSystem;
  let props: PropertySystem | null = null;
  // eslint-disable-next-line prefer-const
  let finance: ReturnType<typeof createLoans>;
  // eslint-disable-next-line prefer-const
  let rebirth: ReturnType<typeof createRebirth>;
  /** Set once the Pasar Online is up (net worth counts what you have listed or bid). */
  let marketRef: import('../systems/market/market').MarketSystem | null = null;
  /** Homes, stalls and businesses, minus what you owe (loans count against net worth). */
  const assetsOf = (p: OnlinePlayer) => {
    // Items on the Pasar Online and bids being held are still yours.
    const held = marketRef?.heldOf(p);
    const market = held ? netWorthSen(cfg.prog, held.bidsSen, held.items) : 0;
    return stalls.assetsOf(p) + (props?.assetsOf(p) ?? 0) + ventures.assetsOf(p) + market - (finance?.owedOf(p) ?? 0);
  };
  const prog: ProgressionSystem = new ProgressionSystem(cfg, repos, econ, cryptoRand, {
    wallet: (p, delta, reason) => pushWallet(p, delta, reason),
    items: (p, items) => socketOf(p)?.emit('inv:added', { items, index: [...p.index] }),
    progress: (p, events) => socketOf(p)?.emit('progress', { progress: prog.state(p), events }),
    publicChanged: (p, change) => io.to(p.scene).emit('player:updated', { id: p.id, ...change }),
    announce: (text, tier, banner) => {
      repos.announcements.add(text, tier);
      io.emit('chat:msg', chat.add({ fromId: null, fromName: 'Server', text, system: true }));
      if (banner) io.emit('announce', { text, tier, takeover: false, playerName: '', itemId: '', variant: 'normal', oneIn: 0 });
    },
    freeRoll: (p, crateId) => {
      const batch = gacha.roll(p, crateId, 1, { ...rollMods(p, crateId), free: true });
      const announced = batch.announce.map((r) => announce(p, r));
      return { crateId, results: batch.results, announce: announced };
    },
    useSpecial: (p, item) => {
      if (item.effect?.buff === 'perfectCook') return stalls.addPerfectTokens(p, item.effect.charges ?? 0);
      throw new GameError(`${item.name} can't be used yet.`);
    },
    assetsOf,
    extraBuffs: () => events.buffs(),
    rebirthMods: (p) => rebirth?.mods(p) ?? { luck: 1, income: 1 },
    flagsOf: (p) => new Set(stalls.get(p.id) ? ['stall'] : []),
  });
  // --- food stalls (Phase 4) ------------------------------------------------------------------
  const pets = new PetSystem(cfg, repos, econ, {
    wallet: (p, delta, reason) => pushWallet(p, delta, reason),
    items: (p, items) => socketOf(p)?.emit('inv:added', { items, index: [...p.index] }),
    check: (p) => prog.check(p),
  });
  world.petOf = (p) => pets.leadOf(p);
  garage = new GarageSystem(cfg, repos, econ, {
    wallet: (p, delta, reason) => pushWallet(p, delta, reason),
    look: (p) => io.to(p.scene).emit('player:updated', { id: p.id, vehicle: p.vehicle, vehicleLook: p.vehicleLook }),
  });
  const garageSys = garage;
  const dungeon = new DungeonSystem(cfg, repos, econ, prog, pets, cryptoRand, { wallet: (p, delta, reason) => pushWallet(p, delta, reason) });
  // 🗝️ Labirin Purba
  const labSys = new LabSystem(cfg.lab, repos, () => cryptoRand(1_000_000) / 1_000_000);
  const labNet = createLabHandlers(io as never, world, labSys, (p) => socketOf(p) as never, () => cryptoRand(1_000_000) / 1_000_000);
  // Your lead Teman stays out of the fights down there, but gives a tiny boost.
  labSys.temanBoost = (p) => {
    const iid = pets.state(p).team[0];
    const it = iid === undefined ? undefined : p.inventory.find((i) => i.iid === iid);
    if (!it) return 0;
    const look = petLook(cfg.pets, it.grade, it.variant);
    return temanBoost(cfg.lab, cfg.itemById.get(it.itemId)?.rarity ?? 'common', look.gradeMult, look.variantMult);
  };
  stalls = new StallSystem(cfg, repos, econ, prog, world, cryptoRand, {
    publicChanged: (list) => {
      io.emit('stalls', { stalls: list });
      syncStallBoxes();
    },
    selfChanged: (p, stall) => socketOf(p)?.emit('stall:self', { stall }),
    event: (p, ev) => socketOf(p)?.emit('stall:event', ev),
    wallet: (p, delta, reason) => pushWallet(p, delta, reason),
    removed: (plot) => {
      io.emit('stalls', { stalls: [], removed: [plot] });
      syncStallBoxes();
    },
  });
  world.stallOf = (p) => stalls.selfOf(p);
  /**
   * Stalls and food trucks are solid: their footprints go into the collision grids (walking and
   * driving) while a plot is taken. Anyone standing where one just appeared is nudged out.
   */
  const boxed = new Set<string>();
  function syncStallBoxes() {
    const taken = new Set(stalls.all().map((s) => s.plot));
    let changed = false;
    for (const plot of cfg.map.stallPlots) {
      if (plot.auto && !taken.has(plot.id) && !boxed.has(plot.id)) continue; // hundreds of free shoplots: nothing to do
      if (taken.has(plot.id)) boxed.add(plot.id);
      else boxed.delete(plot.id);
      if (setBoxes([cfg.map.collision, cfg.map.driveCollision], `stall:${plot.id}`, taken.has(plot.id) ? stallFootprint(plot, T) : [])) changed = true;
    }
    if (!changed) return;
    for (const p of world.players.values()) {
      const rules = moveRules(p);
      if (p.interior || !collides(rules.grid, p.x, p.y, rules.movement.hitbox)) continue;
      const spot = placePlayer(rules.grid, rules.movement.hitbox, { x: p.x, y: p.y, mapVersion: p.mapVersion }, { mapVersion: p.mapVersion, spawn: cfg.map.spawnPx });
      p.x = spot.x;
      p.y = spot.y;
      p.dirty = true;
      p.move = newMoveState(p.x, p.y, Date.now(), rules.movement);
      socketOf(p)?.emit('move:correct', { x: p.x, y: p.y, seq: 0 });
    }
  }
  syncStallBoxes();
  const stallTimer = setInterval(() => {
    try {
      stalls.tick();
    } catch (err) {
      log.error('stall tick failed', err);
    }
  }, 250);
  const stallSaveTimer = setInterval(() => stalls.saveDirty(), 10_000);
  world.progressOf = (p) => prog.state(p);
  const npcs = new NpcSystem({
    map: cfg.map,
    cfg: cfg.npcs,
    pay: (p, sen, xp, reason) => prog.reward(p, { sen, xp }, reason, 'errands'),
    stageOf: (p) => p.prog.stage,
  });
  // --- property (Phase 5) ---------------------------------------------------------------------
  /** Can't be sold, traded or merged right now: furniture placed in a home, pets in the team, pet gear in use. */
  const lockedIids = (p: OnlinePlayer) => new Set([...propSys.lockedIids(p), ...pets.lockedIids(p)]);
  const propSys = new PropertySystem(cfg, repos, econ, world, cryptoRand, {
    publicChanged: () => io.emit('props', { props: propSys.all() }),
    selfChanged: (p) => socketOf(p)?.emit('props:self', { props: propSys.selfOf(p) }),
    wallet: (p, delta, reason) => pushWallet(p, delta, reason),
    event: (p, ev) => socketOf(p)?.emit('prop:event', ev),
    mods: (p) => {
      // Property skills; half income while late on the Ah Long.
      const m = prog.mods(p).property;
      const k = finance.incomeMult(p);
      return { ...m, rent: m.rent * k, airbnb: m.airbnb * k };
    },
    isPledged: (p, unit) => finance.isPledged(p, 'property', unit),
  });
  props = propSys;
  // --- businesses and the shop (Phase 6) ------------------------------------------------------
  // 🏪 One business per shoplot: Ventures and kopitiams share the town's shoplots.
  const shoplots = new ShoplotSystem(cfg, repos);
  shoplots.stallBuildings = () => {
    const out = new Set<string>();
    for (const s of stalls.all()) {
      const plot = cfg.map.stallPlots.find((x) => x.id === s.plot);
      if (plot?.building) out.add(plot.building);
    }
    return out;
  };
  stalls.blockedBuilding = (b) => shoplots.takenByVenture(b);
  // 🏪 Every Venture's and kopitiam's shoplot is also a shop floor you furnish (a "unit" in the
  // property system): its stars bring customers / income, customers make it dirty.
  const plotBuilding = (plotId: string) => {
    const plot = cfg.map.stallPlots.find((x) => x.id === plotId);
    return plot && plot.tier >= cfg.stalls.cashierFromTier ? (plot.building ?? null) : null;
  };
  stalls.shopMult = (plotId) => {
    const b = plotBuilding(plotId);
    return b ? propSys.shopMult(b) : 1;
  };
  stalls.shopVisit = (plotId, n) => {
    const b = plotBuilding(plotId);
    if (b) propSys.shopVisit(b, n);
  };
  const syncShops = () => {
    const want = new Map<string, { owner: number; ownerName: string; kind: 'venture' | 'kopitiam' }>();
    for (const s of shoplots.public()) want.set(s.building, { owner: s.ownerId, ownerName: s.ownerName, kind: 'venture' });
    for (const s of stalls.all()) {
      const b = plotBuilding(s.plot);
      if (b) want.set(b, { owner: s.owner, ownerName: s.ownerName, kind: 'kopitiam' });
    }
    if (propSys.syncShops(want)) {
      for (const p of world.players.values()) if (p.hasCharacter && want.size) socketOf(p)?.emit('props:self', { props: propSys.selfOf(p) as never });
    }
    propSys.flushShops();
  };
  const shopTimer = setInterval(() => {
    try {
      syncShops();
    } catch (err) {
      log.error('shop sync failed', err);
    }
  }, 5000);
  const ventures = createVentures({
    cfg, repos, econ, world, socketOf, pushWallet, shoplots,
    shopMult: (b) => propSys.shopMult(b),
    shopVisit: (b, n) => propSys.shopVisit(b, n),
    shoplotsChanged: () => syncShops(),
    incomeMult: (p) => prog.mods(p).passive * finance.incomeMult(p), // Passive Income (skill + gear); half while late on the Ah Long
    check: (p) => prog.check(p),
    io,
    lockedIids: (p) => lockedIids(p),
  });
  // --- loans (Phase 6): Bank Kota and the Ah Long -----------------------------------------------
  finance = createLoans({
    cfg, repos, econ, world, io, socketOf, pushWallet,
    netWorth: (p) => netWorthSen(cfg.prog, p.walletSen, p.inventory, assetsOf(p)),
    props: () => propSys,
    biz: () => ventures.biz,
    check: (p) => prog.check(p),
  });
  // --- trading, gifting, leaderboards (Phase 7) ----------------------------------------------
  const social = createSocial({
    cfg, repos, econ, world, io, socketOf, pushWallet,
    lockedIids: (p) => lockedIids(p),
    assetsOf,
    bestAirbnb: (p) => Math.max(0, ...propSys.selfOf(p).filter((s) => s.mode === 'airbnb').map((s) => s.rating.stars)),
    cosmeticsChanged: (p) => {
      if (econ.refreshCosmetics(p)) broadcastCosmetics(p);
    },
    check: (p) => prog.check(p),
    announce: (text) => {
      repos.announcements.add(text, 'legendary');
      io.emit('chat:msg', chat.add({ fromId: null, fromName: 'Server', text, system: true }));
    },
  });
  marketRef = social.market;
  // --- rebirth (Phase 8) -------------------------------------------------------------------------
  rebirth = createRebirth({
    cfg, repos, io, socketOf,
    blocker: (p) => {
      const held = marketRef?.heldOf(p);
      if (held?.bidsSen) return 'Settle your Pasar Online bids first.';
      if (held?.items.length) return 'Take your items off Pasar Online first.';
      if (ventures.shelfCount(p)) return 'Take your items off the Butik shelf first.';
      return null;
    },
    wipe: (p) => {
      stalls.remove(p);
      for (const s of propSys.ownedBy(p)) propSys.repossess(p, s.unit);
      ventures.biz.resetAll(p);
      finance.loans.clearAll(p);
    },
    resetSelf: (p, startSen) => {
      if (p.job) jobs.cancel(p);
      p.errand = null;
      flushManifest(p);
      const before = { sen: p.walletSen, shards: p.shards };
      repos.accounts.rebirthReset(p.id, startSen);
      repos.econ.logTx(p.id, startSen - before.sen, startSen, -before.shards, 'rebirth', `#${p.rebirths ?? 0}`);
      // XP and level stay; the rest of progress starts over (daily streak and today's quests too stay).
      const pr = p.prog;
      pr.stage = 1;
      pr.title = null;
      pr.titles = [];
      pr.stats = { rebirths: (pr.stats.rebirths ?? 0) + 1 };
      prog.rebaseQuests(p);
      pr.goalsDone = [];
      pr.buffs = [];
      prog.save(p);
      loadInto(p);
      if (econ.refreshCosmetics(p)) broadcastCosmetics(p);
    },
    announce: (text) => {
      repos.announcements.add(text, 'legendary');
      io.emit('chat:msg', chat.add({ fromId: null, fromName: 'Server', text, system: true }));
      io.emit('announce', { text, tier: 'legendary', takeover: false, playerName: '', itemId: '', variant: 'normal', oneIn: 0 });
    },
  });
  // --- the shared radio ---------------------------------------------------------------------
  const radio = createMusic({ cfg, io, world });
  // --- the Lucky Strand Casino (Phase 7) --------------------------------------------------------
  const casino = createCasino({
    cfg, repos, econ, world, io, socketOf, pushWallet,
    announce: (text) => {
      repos.announcements.add(text, 'legendary');
      io.emit('chat:msg', chat.add({ fromId: null, fromName: 'Server', text, system: true }));
      io.emit('announce', { text, tier: 'legendary', takeover: false, playerName: '', itemId: '', variant: 'normal', oneIn: 0 });
    },
    check: (p) => prog.check(p),
  });
  inv.lockedIids = (p) => lockedIids(p);
  const propTimer = setInterval(() => {
    try {
      propSys.tick();
    } catch (err) {
      log.error('property tick failed', err);
    }
  }, 1000);
  jobs.modsFor = (p) => {
    const m = prog.mods(p);
    return { jobPay: m.jobPay, carwashExtraSec: m.carwashExtraSec };
  };
  /** Luck, variant chance and pity for this player's roll. */
  const rollMods = (p: OnlinePlayer, crateId: string) => {
    const m = prog.mods(p);
    const crate = cfg.crateById.get(crateId);
    return { luck: m.luck, variantChance: m.variantChance, pity: crate ? prog.crateFor(p, crate).pity : undefined };
  };
  // Quests and the daily reward reset at midnight: refresh online players when the day changes
  // (check() hands out the new quests and sends the fresh daily-reward state).
  const dayTimer = setInterval(() => {
    const today = dayKey(Date.now());
    for (const p of world.players.values()) if (p.hasCharacter && p.prog && p.prog.quests.day !== today) prog.check(p);
  }, 60_000);

  function register(socket: AnySocket, me: OnlinePlayer) {
    // --- crates -------------------------------------------------------------------------
    handle(socket, 'crate:roll', C2S.crateRoll, ({ crateId, count, remote }) => {
      if (!me.hasCharacter) throw new GameError('Create your character first.');
      if (!rollLimiter.hit(String(me.id))) throw new GameError('Easy, tiger! One roll at a time.');
      const crate = cfg.crateById.get(crateId);
      if (!crate) throw new GameError('Unknown crate.');
      if (!events.crateOpen(crate.event)) throw new GameError(`The ${crate.name} is only around during its event.`);
      if (!remote && !nearInteractable(me, 'crate', crateId)) throw new GameError(`Go to the ${crate.name} to roll it.`);
      const lock = prog.crateLock(me, crate);
      if (lock) throw new GameError(lock);
      // A quick roll from the phone: the same roll, plus a small fee (charged first, so it can't be dodged).
      const fee = remote && !crate.priceShards ? Math.round(crate.priceSen * count * cfg.economy.phoneRollFee) : 0;
      if (fee && me.walletSen < crate.priceSen * count + fee) throw new GameError(`That's ${formatMoney(crate.priceSen * count + fee)} with the phone fee.`);
      if (fee) econ.run(me, () => econ.change(me, -fee, 0, 'crate-phone-fee', `${crateId}x${count}`));
      const batch = gacha.roll(me, crateId, count, rollMods(me, crateId));
      const announced = batch.announce.map((r) => announce(me, r));
      const spentSen = crate.priceShards ? 0 : crate.priceSen * count; // the Chef Search is paid in shards
      pushWallet(me, -spentSen - fee + (batch.pageReward?.sen ?? 0), 'crate');
      prog.onRolls(me, crate, batch.results, spentSen);
      return { results: batch.results, walletSen: me.walletSen, pity: me.pity[crateId], pageReward: batch.pageReward, announce: announced };
    });

    // --- inventory ------------------------------------------------------------------------
    handle(socket, 'inv:equip', C2S.equip, ({ iid }) => {
      if (inv.equip(me, iid)) broadcastCosmetics(me);
      prog.onEquip(me);
      return {};
    });
    handle(socket, 'inv:merge', C2S.invMerge, ({ iids }) => {
      const r = inv.merge(me, iids, (max) => crypto.randomInt(Math.max(1, max)));
      prog.check(me);
      return { removed: r.removed, item: r.item, bonus: r.bonus };
    });
    handle(socket, 'inv:mergeAll', C2S.invMergeAll, ({ items, upTo }) => {
      const r = inv.mergeAll(me, items, upTo, (max) => crypto.randomInt(Math.max(1, max)));
      prog.check(me);
      return r;
    });
    // Reroll pity (misses in a row) lives in player_data, per player.
    const pityOf = (): RerollPity => ({ grade: 0, variant: 0, ...(repos.playerData.load<Partial<RerollPity>>(me.id, 'reroll') ?? {}) });
    handle(socket, 'inv:pity', null, () => ({ pity: pityOf() }));
    handle(socket, 'inv:reroll', C2S.invReroll, ({ iid, what }) => {
      const pity = pityOf();
      const r = inv.reroll(me, iid, what, (max) => crypto.randomInt(Math.max(1, max)), prog.mods(me).luck, pity[what]);
      pity[what] = r.improved ? 0 : pity[what] + 1;
      repos.playerData.save(me.id, 'reroll', pity);
      if (r.cosmeticsChanged) broadcastCosmetics(me);
      pushWallet(me, 0, 'reroll');
      return { item: r.item, improved: r.improved, shards: me.shards, rolled: r.rolled, forced: r.forced, pity };
    });
    handle(socket, 'item:use', C2S.itemUse, ({ iid }) => {
      const r = prog.useItem(me, iid);
      if (r.cosmeticsChanged) broadcastCosmetics(me);
      return { removed: r.removed };
    });

    // --- progression: titles, daily reward, quests, Hustle Skills -----------------------------
    handle(socket, 'title:equip', C2S.titleEquip, ({ title }) => {
      prog.equipTitle(me, title);
      return {};
    });
    handle(socket, 'daily:claim', null, () => prog.claimDaily(me));
    handle(socket, 'quest:claim', C2S.questClaim, ({ id }) => {
      prog.claimQuest(me, id);
      return {};
    });
    handle(socket, 'skill:upgrade', C2S.skillUpgrade, ({ skill }) => prog.upgradeSkill(me, skill));

    // --- property and Airbnb (Phase 5) -----------------------------------------------------
    handle(socket, 'prop:buy', C2S.propUnit, ({ unit }) => {
      propSys.buy(me, unit);
      prog.check(me);
      return {};
    });
    handle(socket, 'prop:sell', C2S.propUnit, ({ unit }) => propSys.sell(me, unit));
    handle(socket, 'prop:evict', C2S.propUnit, ({ unit }) => propSys.evict(me, unit));
    handle(socket, 'prop:mode', C2S.propMode, ({ unit, mode }) => {
      propSys.setMode(me, unit, mode);
      return {};
    });
    handle(socket, 'prop:prices', C2S.propPrices, ({ unit, rentSen, nightSen }) => {
      propSys.setPrices(me, unit, rentSen, nightSen);
      return {};
    });
    handle(socket, 'prop:staff', C2S.propStaff, ({ unit, role, on }) => {
      propSys.setStaff(me, unit, role, on);
      return {};
    });
    handle(socket, 'prop:layout', C2S.propLayout, ({ unit, layout }) => {
      const r = propSys.setLayout(me, unit, layout);
      me.prog.stats.decorations = (me.prog.stats.decorations ?? 0) + 1;
      prog.check(me);
      return { stars: r.stars };
    });
    handle(socket, 'shop:view', C2S.shopView, ({ building }) => ({ view: propSys.shopView(building) }));
    handle(socket, 'prop:fix', C2S.propFix, ({ unit, req, how }) => propSys.fix(me, unit, req, how));
    handle(socket, 'prop:clean', C2S.propClean, ({ unit, phase }) => propSys.clean(me, unit, phase));
    handle(socket, 'welcome:spin', null, () => propSys.luckySpin(me));
    ventures.register(socket, me, handle);
    labNet.register(socket as never, me, handle as never);
    finance.register(socket, me, handle);
    casino.register(socket, me, handle);
    radio.register(socket, me, handle);
    social.register(socket, me, handle);
    rebirth.register(socket, me, handle);
    // ⚔️ Gua Gelap
    handle(socket, 'dungeon:view', null, () => ({ view: dungeon.view(me) }));
    handle(socket, 'dungeon:enter', null, () => ({ view: dungeon.enter(me) }));
    handle(socket, 'dungeon:act', C2S.dungeonAct, ({ action, skip }) => dungeon.act(me, action, skip));
    // 🚗 Motor Kota (buying needs you at the showroom; the garage app works anywhere)
    handle(socket, 'garage:view', null, () => {
      // Rides bought before achievements existed (or before a rebirth) still count.
      const n = garageSys.owned(me).length;
      if (n > (me.prog.stats.vehiclesBought ?? 0)) {
        prog.max(me, 'vehiclesBought', n);
        prog.check(me);
      }
      return { view: garageSys.view(me) };
    });
    handle(socket, 'garage:buy', C2S.garageModel, ({ model }) => {
      if (!nearInteractable(me, 'showroom')) throw new GameError(`Buy it at the ${cfg.garage.name} showroom.`);
      const view = garageSys.buy(me, model);
      prog.bump(me, 'vehiclesBought');
      prog.check(me);
      return { view, vehicles: world.vehiclesOf(me) };
    });
    handle(socket, 'garage:upgrade', C2S.garageUpgrade, ({ model, part }) => {
      const view = garageSys.upgrade(me, model, part);
      prog.bump(me, 'garageUpgrades');
      prog.check(me);
      return { view };
    });
    handle(socket, 'garage:style', C2S.garageStyle, ({ model, kind, id }) => ({ view: garageSys.style(me, model, kind, id) }));
    // 🐾 Teman
    handle(socket, 'pets:view', null, () => ({ view: pets.view(me) }));
    // The lead Teman walks beside you in town: tell everyone when it changes.
    const petChanged = () => io.to(me.scene).emit('player:updated', { id: me.id, pet: pets.leadOf(me) });
    handle(socket, 'pets:buy', C2S.petsBuy, ({ id }) => {
      const view = pets.buyStarter(me, id);
      petChanged();
      return { view };
    });
    handle(socket, 'pets:team', C2S.petsTeam, ({ iids }) => {
      const view = pets.setTeam(me, iids);
      petChanged();
      return { view };
    });
    handle(socket, 'pets:train', C2S.petsIid, ({ iid }) => {
      const r = pets.train(me, iid);
      prog.bump(me, 'petTrains');
      prog.check(me);
      return r;
    });
    handle(socket, 'pets:upgrade', C2S.petsUpgrade, ({ iid, stat }) => {
      const view = pets.upgrade(me, iid, stat);
      prog.bump(me, 'petUpgrades');
      prog.check(me);
      return { view };
    });
    handle(socket, 'pets:gear', C2S.petsGear, ({ iid, gear }) => ({ view: pets.setGear(me, iid, gear) }));
    handle(socket, 'dungeon:deeper', null, () => ({ view: dungeon.deeper(me) }));
    handle(socket, 'dungeon:rest', C2S.dungeonRest, ({ choice }) => ({ view: dungeon.rest(me, choice) }));
    handle(socket, 'dungeon:leave', null, () => dungeon.leave(me));
    handle(socket, 'event:view', null, () => ({ event: events.view() }));
    handle(socket, 'furniture:buy', C2S.furnitureBuy, ({ item, qty }) => {
      if (!nearInteractable(me, 'furniture')) throw new GameError(`Buy furniture inside ${cfg.furniture.storeName}.`);
      const piece = cfg.furniture.pieces[item];
      if (!piece?.storeSen) throw new GameError("That isn't sold in the store.");
      if (qty > cfg.economy.furnitureMaxQty) throw new GameError(`Up to ${cfg.economy.furnitureMaxQty} at a time.`);
      const cost = piece.storeSen * qty;
      if (me.walletSen < cost) throw new GameError('Not enough money.');
      const items = econ.run(me, () => {
        econ.change(me, -cost, 0, 'furniture', `${item}x${qty}`);
        return Array.from({ length: qty }, () => econ.grant(me, item, 'normal', null).item);
      });
      pushWallet(me, -cost, 'furniture');
      socketOf(me)?.emit('inv:added', { items, index: [] });
      me.prog.stats.furnitureBought = (me.prog.stats.furnitureBought ?? 0) + qty;
      prog.check(me);
      return { items };
    });

    // --- wandering NPCs: chat and errands ---------------------------------------------------
    handle(socket, 'npc:talk', C2S.npc, ({ npc }) => npcs.talk(me, npc));
    handle(socket, 'npc:accept', C2S.npc, ({ npc }) => ({ errand: npcs.accept(me, npc) }));
    handle(socket, 'npc:progress', null, () => npcs.progress(me));
    handle(socket, 'npc:cancel', null, () => {
      npcs.cancel(me);
      return {};
    });

    // --- food stall (Phase 4) -----------------------------------------------------------------
    handle(socket, 'stall:buy', C2S.stallBuy, ({ tier, plot }) => {
      stalls.buy(me, tier, plot);
      return {};
    });
    handle(socket, 'stall:move', C2S.stallMove, ({ plot }) => stalls.move(me, plot));
    handle(socket, 'stall:open', C2S.stallOpen, ({ open }) => {
      stalls.setOpen(me, open);
      return {};
    });
    handle(socket, 'stall:cook', C2S.stallCook, ({ customerId, token }) => {
      if (me.vehicle) throw new GameError('Hop off your ride first.');
      if (me.job?.kind === 'carwash') throw new GameError('Finish washing the car first.');
      return stalls.cook(me, customerId, !!token);
    });
    handle(socket, 'stall:serve', C2S.stallServe, ({ dishId, inputs }) => ({ result: stalls.serve(me, dishId, inputs) }));
    handle(socket, 'stall:redo', null, () => ({ dish: stalls.redo(me) }));
    handle(socket, 'stall:cancel', null, () => {
      stalls.cancel(me);
      return {};
    });
    handle(socket, 'stall:upgrade', C2S.stallUpgrade, ({ key }) => {
      stalls.upgrade(me, key);
      return {};
    });
    handle(socket, 'stall:hire', null, () => {
      stalls.hire(me);
      return {};
    });
    handle(socket, 'stall:fire', null, () => {
      stalls.fire(me);
      return {};
    });
    handle(socket, 'stall:stock', C2S.stallStock, ({ recipe, qty, delivery }) => {
      if (!delivery && !nearInteractable(me, 'market')) throw new GameError('Buy in person inside Gergasi Hypermarket, or order delivery for a fee.');
      stalls.buyStock(me, recipe, qty, delivery);
      return {};
    });
    handle(socket, 'stall:stockAll', null, () => {
      if (!nearInteractable(me, 'market')) throw new GameError('Buy all is for in person, inside Gergasi Hypermarket.');
      return stalls.buyStockAll(me);
    });
    handle(socket, 'inv:unequip', C2S.unequip, ({ slot }) => {
      if (inv.unequip(me, slot as EquipSlot)) broadcastCosmetics(me);
      return {};
    });

    // --- pawn shop + shard shop -----------------------------------------------------------
    const atPawn = () => {
      if (!nearInteractable(me, 'pawn')) throw new GameError('Go inside Kedai Pajak Untung to sell or scrap items.');
    };
    handle(socket, 'pawn:sell', C2S.stack, ({ itemId, variant, count, grade }) => {
      atPawn();
      const r = inv.sell(me, itemId, variant, count, grade);
      if (r.cosmeticsChanged) broadcastCosmetics(me);
      pushWallet(me, r.gainedSen, 'pawn');
      prog.onSell(me, r.removed.length);
      return { removed: r.removed, gainedSen: r.gainedSen };
    });
    handle(socket, 'pawn:scrap', C2S.stack, ({ itemId, variant, count, grade }) => {
      atPawn();
      const r = inv.scrap(me, itemId, variant, count, grade);
      if (r.cosmeticsChanged) broadcastCosmetics(me);
      pushWallet(me, 0, 'scrap');
      prog.onScrap(me, r.removed.length);
      return { removed: r.removed, gainedShards: r.gainedShards, keptLast: r.keptLast };
    });
    handle(socket, 'pawn:scrapAll', C2S.scrapAll, ({ items, maxGrade, keepVariants }) => {
      atPawn();
      const r = inv.scrapAll(me, items, { maxGrade, keepVariants });
      pushWallet(me, 0, 'scrap');
      prog.onScrap(me, r.count);
      return r;
    });
    handle(socket, 'shard:buy', C2S.shardBuy, ({ itemId }) => {
      atPawn();
      const r = inv.shardBuy(me, itemId);
      pushWallet(me, 0, 'shard-shop');
      return r;
    });

    // --- jobs -----------------------------------------------------------------------------
    handle(socket, 'job:start', C2S.jobStart, ({ kind, remote }) => {
      if (kind === 'carwash') {
        if (!nearInteractable(me, 'carwash')) throw new GameError('Go inside Kilat Car Wash to wash cars.');
        if (me.vehicle) throw new GameError('Hop off your ride first.');
      } else if (!remote && !nearInteractable(me, 'jobs')) throw new GameError('Find a Jobs Board (or take a delivery from 📱 → Jobs).');
      const job = jobs.start(me, kind);
      const { budgetMs: _b, ...visible } = job;
      return { job: visible };
    });
    handle(socket, 'job:progress', null, () => {
      const kind = me.job?.kind === 'flyers' ? 'flyers' : 'delivery';
      const r = jobs.advance(me);
      if (r.paidSen !== undefined) pushWallet(me, r.paidSen + (r.tipSen ?? 0), 'job');
      const job = r.job ? (({ budgetMs: _b, ...v }) => v)(r.job) : null;
      socketOf(me)?.emit('job:update', { job, jobs: me.jobs });
      if (r.paidSen !== undefined) prog.onJob(me, kind, r.paidSen + (r.tipSen ?? 0), false);
      return { job, paidSen: r.paidSen, tipSen: r.tipSen, levelUp: r.levelUp };
    });
    handle(socket, 'job:mamak', C2S.jobMamak, ({ jobId, inputs }) => {
      const r = jobs.submitMamak(me, jobId, inputs);
      pushWallet(me, r.paidSen, 'job');
      socketOf(me)?.emit('job:update', { job: r.job, jobs: me.jobs });
      if (!r.job) prog.onJob(me, 'mamak', r.totalSen ?? r.paidSen, false);
      return { job: r.job, quality: r.quality, paidSen: r.paidSen, totalSen: r.totalSen, levelUp: r.levelUp };
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
      prog.onJob(me, 'carwash', r.paidSen, r.cleaned >= 0.999);
      return r;
    });

    // --- vehicles -------------------------------------------------------------------------
    // Riding now means getting into a vehicle you've put down (see parkingHandlers); this one is
    // only for getting off.
    handle(socket, 'vehicle:ride', C2S.vehicleRide, ({ vehicle }) => {
      if (me.ride) throw new GameError(`You're on a ${cfg.rides.appName} ride. Tap "Get off here" to stop.`);
      if (vehicle !== null) throw new GameError('Put it down first (its hotbar key), then get in.');
      if (!parking.exit(me) && me.vehicle) setVehicle(me, null);
      return { vehicle: me.vehicle, vehicles: world.vehiclesOf(me) };
    });
    parking.register(socket, me, handle);

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
    if (cmd === 'time') {
      // /time <hour>: jump the in-game clock for everyone (testing, events).
      const h = Number(target);
      if (!(h >= 0 && h < 24)) return 'Usage: /time <hour 0-23> (moves the in-game clock for everyone)';
      const cur = gameTime(cfg.time, Date.now());
      cfg.time.offsetGameMinutes += ((h * 60 - (cur.total % 1440)) % 1440 + 1440) % 1440;
      io.emit('time:offset', { offsetGameMinutes: cfg.time.offsetGameMinutes });
      stalls.tick();
      return `It's now ${formatClock(gameTime(cfg.time, Date.now()))} in-game.`;
    }
    if (cmd === 'event') {
      // /event <id> [minutes] | /event stop
      if (target === 'stop') {
        events.stop();
        return 'Event stopped.';
      }
      if (!target) return `Usage: /event <${cfg.events.events.map((e) => e.id).join('|')}> [minutes] · /event stop`;
      try {
        const def = events.start(target, what ? Number(what) : undefined);
        return `${def.name} started.`;
      } catch (e) {
        return (e as Error).message;
      }
    }
    if (cmd === 'music') {
      // /music rescan: pick up music files added to the genre folders.
      const n = radio.rescan();
      io.emit('music', radio.music.view());
      return `Radio: ${n} tracks found.`;
    }
    if (cmd === 'loanday') {
      // /loanday <player|me> [n]: run n loan days now (testing instalments, missed payments, collectors).
      const p = target === 'me' ? me : world.byName(target ?? '');
      if (!p) return 'Usage: /loanday <player|me> [days]';
      const n = Math.max(1, Math.min(30, Math.round(Number(what) || 1)));
      for (let i = 0; i < n; i++) finance.loans.loanDay(p);
      return `Ran ${n} loan day${n > 1 ? 's' : ''} for ${p.name}.`;
    }
    const HELP = 'Commands: /time <hour> · /event <id> [min] · /music rescan · /loanday <player|me> [days] · /give <player|me> money <RM> · /give <player|me> item <itemId> [variant] · /give <player|me> shards <n> · /give <player|me> xp <n> · /setlevel <player|me> <n> · /setstage <player|me> <n> · /tp <x> <y>';
    if (cmd === 'setlevel' || cmd === 'setstage') {
      const p = target === 'me' ? me : world.byName(target ?? '');
      if (!p) return `No online player called "${target}".`;
      const n = Math.round(Number(what));
      if (cmd === 'setlevel') {
        if (!(n >= 1 && n <= cfg.levels.maxLevel)) return `Usage: /setlevel <player> <1-${cfg.levels.maxLevel}>`;
        // Sets the XP; levelling up through check() pays the normal level-up rewards.
        p.prog.xp = Math.max(p.prog.xp, totalXpForLevel(cfg.levels, n));
        if (n < p.prog.level) {
          p.prog.xp = totalXpForLevel(cfg.levels, n);
          p.prog.level = n;
          io.to(p.scene).emit('player:updated', { id: p.id, level: n });
        }
        prog.check(p);
        return `${p.name} is now Level ${p.prog.level}.`;
      }
      const st = cfg.stages.stages.find((x) => x.n === n);
      if (!st) return `Usage: /setstage <player> <1-${cfg.stages.stages.length}>`;
      // Tops up their wallet to the stage's net worth (stages come from net worth), then checks.
      const need = st.minNetWorthSen - netWorthSen(cfg.prog, p.walletSen, p.inventory);
      if (need > 0) {
        econ.run(p, () => econ.change(p, need, 0, 'admin-setstage', me.name));
        pushWallet(p, need, 'admin');
      }
      if (n < p.prog.stage) p.prog.stage = n;
      prog.check(p);
      return `${p.name} is now ${stageDef(cfg.stages, p.prog.stage).name} (stage ${p.prog.stage}, needs net worth ${formatMoney(st.minNetWorthSen)}; computed ${stageForNetWorth(cfg.stages, netWorthSen(cfg.prog, p.walletSen, p.inventory))}).`;
    }
    if (cmd !== 'give') return HELP;
    const p = target === 'me' ? me : world.byName(target ?? '');
    if (!p) return `No online player called "${target}".`;
    try {
      if (what === 'xp') {
        const n = Math.round(Number(value));
        if (!Number.isSafeInteger(n) || n <= 0) return 'Usage: /give <player> xp <n>';
        p.prog.xp += n;
        prog.check(p);
        return `Gave ${p.name} ${n} XP (now Level ${p.prog.level}).`;
      }
      if (what === 'money') {
        const sen = Math.round(Number(value) * 100);
        if (!Number.isSafeInteger(sen) || sen === 0) return 'Usage: /give <player> money <RM>';
        econ.run(p, () => econ.change(p, sen, 0, 'admin-give', me.name));
        pushWallet(p, sen, 'admin');
        prog.check(p); // a richer player may have reached a new wealth stage
        return `Gave ${p.name} ${formatMoney(sen)}.`;
      }
      if (what === 'shards') {
        const n = Math.round(Number(value));
        if (!Number.isSafeInteger(n) || n === 0) return 'Usage: /give <player> shards <n>';
        econ.run(p, () => econ.change(p, 0, n, 'admin-give', me.name));
        pushWallet(p, 0, 'admin');
        prog.check(p);
        return `Gave ${p.name} ${n} shards.`;
      }
      if (what === 'item') {
        const def = cfg.itemById.get(value ?? '');
        if (!def) return `Unknown item "${value}".`;
        const variant = extra && cfg.rarities.variants.some((v) => v.id === extra) ? extra : 'normal';
        const { item } = econ.run(p, () => econ.grant(p, def.id, variant, null));
        socketOf(p)?.emit('inv:added', { items: [item], index: [...p.index] });
        prog.check(p);
        return `Gave ${p.name} ${variant !== 'normal' ? `${variant} ` : ''}${def.name}.`;
      }
    } catch (err) {
      return err instanceof GameError ? err.message : 'Command failed.';
    }
    return 'Usage: /give <player|me> money|item|shards|xp ...';
  }

  /** Load a player's economy state from the DB when they connect. */
  function loadInto(p: OnlinePlayer) {
    finance.loans.of(p); // loads loans and sets the Ah Long tag before anyone sees the player
    rebirth.load(p); // the stars by the name
    const e = repos.econ.load(p.id);
    p.walletSen = e.walletSen;
    p.shards = e.shards;
    p.equipped = e.equipped;
    p.pity = e.pity;
    p.jobs = e.jobs;
    p.pages = new Set(e.pages);
    p.inventory = repos.inventory.list(p.id);
    p.index = new Set(repos.collection.list(p.id));
    // 📖 Best tier / variant ever (kept up from now on; what you hold now fills in the past).
    p.best = repos.collection.best(p.id);
    repos.tx(() => {
      for (const i of p.inventory) econ.noteBest(p, i);
    });
    p.cosmetics = {};
    p.skills = e.skills;
    p.manifestBank = 0;
    p.manifestSecs = 0;
    p.hotbar = normalizeHotbar(e.hotbar);
    p.ride = null;
    p.rideQuote = null;
    econ.refreshCosmetics(p);
    prog.load(p);
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
  function flushManifest(p: OnlinePlayer) {
    const sen = Math.floor(p.manifestBank);
    if (sen < 1) return;
    const secs = p.manifestSecs;
    try {
      econ.run(p, () => econ.change(p, sen, 0, 'manifest', `${secs}s`));
      p.manifestBank -= sen;
      p.manifestSecs = 0;
      pushWallet(p, sen, 'manifest');
      prog.onManifest(p, secs);
    } catch (err) {
      log.error('manifest payout failed', err);
    }
  }
  const manifestTimer = setInterval(() => {
    for (const p of world.players.values()) {
      if (p.hasCharacter && p.emote === 'manifest' && !p.moving && !p.vehicle) {
        p.manifestBank += prog.manifestRate(p); // skill level × Passive Income × Income Booster
        p.manifestSecs++;
        if (p.manifestSecs >= cfg.upgrades.manifestFlushEverySec) flushManifest(p);
      } else if (p.manifestBank >= 1) {
        flushManifest(p);
      }
    }
  }, 1000);

  return {
    register: (socket: AnySocket, me: OnlinePlayer) => {
      register(socket, me);
    },
    /** 🗝️ Labirin Purba: positions in its rooms (with the town snapshots), and out when disconnected. */
    labSnapshots: (t: number) => labNet.snapshots(t),
    labDrop: (p: OnlinePlayer) => labNet.drop(p),
    labForget: (id: number) => {
      labSys.forget(id);
      labNet.forget(id);
    },
    /** After `init`: hand out anything already earned (titles, goals...) and send the progress. */
    afterInit: (p: OnlinePlayer, awayMs = 0) => {
      if (!p.hasCharacter) return;
      // Offline income (homes kept earning while you were away) and the welcome-back screen.
      // Offline income, worked out from real time since the last save (so time the server was
      // down counts too): your stall (if left open with cooks), managed businesses, then homes.
      const extra: Array<{ label: string; sen: number; detail?: string }> = [];
      // Pasar Online sales, auction wins and refunds that came in while you were away.
      const mk = social.market.collect(p);
      if (mk.sen || mk.notes.length) extra.push({ label: `🛒 ${cfg.market.name}`, sen: mk.sen, detail: mk.notes.slice(-4).join(' · ') });
      if (awayMs > 0) {
        const o = rebirth.offlineFor(p); // Night Owl / Autopilot perks
        const st = stalls.offline(p, awayMs, o.capHours, o.efficiency);
        const tier = st && stalls.get(p.id) ? cfg.stalls.tiers.find((t) => t.tier === stalls.get(p.id)!.s.tier) : undefined;
        if (st && (st.sen || st.dishes)) {
          extra.push({ label: `${tier?.icon ?? '🍳'} Your ${tier?.name ?? 'stall'}`, sen: st.sen, detail: `${st.dishes} dishes by your cooks · wages ${formatMoney(st.wagesSen)}${st.restockSen ? ` · auto restock ${formatMoney(st.restockSen)}` : ''}${st.soldOut ? ' · ⚠️ SOLD OUT: restock in 📱 → Business, or no customers will come' : ''}` });
        }
        extra.push(...ventures.offline(p, awayMs, o));
      }
      const away = propSys.welcomeBack(p, awayMs, rebirth.offlineFor(p), extra);
      socketOf(p)?.emit('props:self', { props: propSys.selfOf(p) });
      ventures.sendSelf(p);
      finance.sendSelf(p);
      rebirth.push(p);
      const won = casino.collect(p);
      if (won) socketOf(p)?.emit('loan:event', { text: `🎰 Winnings from the casino while you were away: +${formatMoney(won)}`, kind: 'good' });
      if (away) {
        socketOf(p)?.emit('welcome', away);
        pushWallet(p);
      }
      prog.check(p);
    },
    propsPublic: () => propSys.all(),
    /** Owns a home in this building (so they may go inside it). */
    ownsIn: (p: OnlinePlayer, building: string) => propSys.ownedBy(p).some((s) => propSys.unitOf(s.unit)?.building === building),
    saveProgress: (p: OnlinePlayer) => {
      prog.save(p);
      ventures.save(p);
      finance.save(p);
      social.snapshot(p); // leaderboards keep you while you're offline
    },
    stallsPublic: () => stalls.all(),
    shoplotsPublic: () => shoplots.public(),
    /** The clock jumped (night skipped): stalls open/close for the new hour right away. */
    clockJumped: () => stalls.tick(),
    leaveStall: (p: OnlinePlayer) => {
      stalls.leave(p);
      ventures.unload(p); // saved, then dropped from memory until they log in again
      finance.unload(p);
      casino.leave(p);
      radio.leave(p);
      social.leave(p);
      rebirth.unload(p);
      dungeon.unload(p); // a run in progress pays out
      pets.unload(p);
      garageSys.unload(p);
    },
    chatCommand,
    moveRules,
    loadInto,
    flushManifest,
    cancelJob: (p: OnlinePlayer) => jobs.cancel(p),
    /** On disconnect: off the ride. A Ronda passenger is dropped off where they are. */
    leave: (p: OnlinePlayer) => {
      parking.leave(p);
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
    /** Riding along in someone's vehicle: the server moves them. */
    isCarried: (p: OnlinePlayer) => parking.isPassenger(p),
    /** A move was accepted: a driver brings their vehicle and passengers along. */
    onMoved: (p: OnlinePlayer) => parking.onMoved(p),
    parkedPublic: (scene: string) => parking.all(scene),
    stop: () => {
      clearInterval(shopTimer);
      propSys.flushShops();
      clearInterval(manifestTimer);
      clearInterval(rideTimer);
      clearInterval(dayTimer);
      clearInterval(stallTimer);
      clearInterval(stallSaveTimer);
      clearInterval(propTimer);
      ventures.stop();
      finance.stop();
      casino.stop(); // hands back undecided bets (before everyone is saved)
      radio.stop();
      social.stop();
      events.dispose();
      stalls.saveDirty(true);
    },
  };
}
