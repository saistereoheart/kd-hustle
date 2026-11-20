// Socket.IO game layer: authenticates sockets with the session token, loads players into
// the World, validates every message with zod, and broadcasts position snapshots.
import type { Server, Socket } from 'socket.io';
import {
  C2S, DIR_INDEX, FEEDBACK_MAX_CHARS, FEEDBACK_MIN_CHARS, type FeedbackReport, atDoor, roomStyleOf, validateAppearance,
  type ClientToServerEvents, type InitPayload, type ServerToClientEvents, type SnapshotRow,
} from '@kh/shared';
import type { AuthedAccount, AuthService } from '../auth/authService';
import { hashToken } from '../auth/authService';
import { RateLimiter } from '../auth/rateLimit';
import type { ServerConfig } from '../config/loadConfig';
import type { Repos } from '../db/repos';
import { log } from '../log';
import type { SaveManager } from '../save/saveManager';
import { ChatHistory, sanitizeChat } from '../systems/chat/chat';
import { newMoveState, validateMove } from '../systems/movement/moveValidator';
import { placePlayer } from '../systems/movement/placement';
import path from 'node:path';
import { getPaths } from '../paths';
import { FeedbackDesk } from '../systems/feedback/feedback';
import { EmoteSystem } from '../systems/emotes/emotes';
import { SkipNightVote } from '../systems/timeskip/timeskip';
import { attachEconomy } from './economyHandlers';
import { emptyProgress } from '../systems/progression/progression';
import type { OnlinePlayer, World } from './world';

interface SocketData {
  account: AuthedAccount;
  tokenHash: string;
}
export type GameIO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface GameDeps {
  cfg: ServerConfig;
  auth: AuthService;
  repos: Repos;
  world: World;
  saves: SaveManager;
  /** /reloadconfig (throws if a file is invalid). */
  reloadConfig?: () => void;
}

export function attachGame(io: GameIO, deps: GameDeps) {
  const { cfg, auth, repos, world, saves } = deps;
  const chat = new ChatHistory(cfg.chat.historySize);
  const chatLimiter = new RateLimiter(cfg.chat.rateLimit.count, cfg.chat.rateLimit.windowMs);
  const emotes = new EmoteSystem(cfg.chat);
  const economy = attachEconomy(io, { cfg, repos, world, chat });
  // Test-only switch so automated tests can use admin commands with throwaway accounts.
  const allAdmin = process.env.KH_TEST_ALL_ADMIN === '1';
  const spawn = cfg.map.spawnPx;

  // --- skip-the-night vote ------------------------------------------------------------
  const skip = new SkipNightVote(cfg.time, cfg.time.skipVote);
  /** Players connected right now (not ones in their reconnect grace period). */
  const onlineCount = () => [...world.players.values()].filter((p) => p.hasCharacter && !offline.has(p.id)).length;
  const voteState = () => skip.state(onlineCount(), Date.now());
  const feedback = new FeedbackDesk(repos, cfg.map.tileSize, Date.now, path.join(getPaths().dataDir, 'feedback'));
  const systemSay = (text: string) => io.emit('chat:msg', chat.add({ fromId: null, fromName: 'Server', text, system: true }));
  const skipNight = () => {
    cfg.time.offsetGameMinutes += skip.skipMinutes(Date.now());
    io.emit('time:offset', { offsetGameMinutes: cfg.time.offsetGameMinutes });
    economy.clockJumped();
    systemSay('🌅 Vote passed: the night was skipped. Good morning, Kota Damansara!');
  };
  const voteTimer = setInterval(() => {
    if (skip.tick(Date.now())) {
      systemSay('🌙 Not enough votes: the night goes on.');
      io.emit('time:vote', voteState());
    }
  }, 1000);

  // --- reconnect grace: a dropped connection keeps you in the world for a bit ---------------
  /** Players whose socket dropped, with the timer that removes them for good. */
  const offline = new Map<number, NodeJS.Timeout>();

  // --- auth handshake -------------------------------------------------------------
  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    const account = auth.resolveToken(token);
    if (!account) return next(new Error('unauthorized'));
    socket.data.account = account;
    socket.data.tokenHash = hashToken(token as string);
    next();
  });

  const kickSocket = (socketId: string, reason: string) => {
    const s = io.sockets.sockets.get(socketId);
    if (!s) return;
    s.emit('kicked', { reason });
    s.disconnect(true);
  };

  // A new login elsewhere: save, then kick the old connection (one session per account).
  auth.onSessionReplaced = (accountId) => {
    const p = world.get(accountId);
    if (!p) return;
    saves.saveNow(p);
    kickSocket(p.socketId, 'You logged in on another device.');
  };

  const buildInit = (p: OnlinePlayer): InitPayload => ({
    you: world.toSelf(p),
    needsCharacter: !p.hasCharacter,
    players: world.inScene(p.scene).filter((o) => o.id !== p.id).map((o) => world.toPublic(o)),
    chat: chat.list(),
    serverTime: Date.now(),
    stalls: economy.stallsPublic(),
    props: economy.propsPublic(),
    parked: economy.parkedPublic(p.scene),
  });

  io.on('connection', (socket: GameSocket) => {
    const acc = socket.data.account;
    let p = world.get(acc.id);

    /** How long they were logged out (for offline income); 0 when back within the grace period. */
    let awayMs = 0;
    const pending = offline.get(acc.id);
    if (pending) {
      clearTimeout(pending);
      offline.delete(acc.id);
    }
    if (p) {
      // Same account connected again (second tab/device, or back within the grace period).
      saves.saveNow(p);
      const oldId = p.socketId;
      p.socketId = socket.id;
      if (oldId !== socket.id) kickSocket(oldId, 'This account was opened somewhere else.');
    } else {
      const rec = repos.players.load(acc.id);
      if (rec?.lastSavedAt) awayMs = Math.max(0, Date.now() - rec.lastSavedAt);
      if (!rec) {
        log.warn(`No player row for account ${acc.id}`);
        socket.disconnect(true);
        return;
      }
      // Saved position → safe position (nudged out of new buildings / reset after a map change).
      const place = placePlayer(cfg.map.collision, cfg.movement.hitbox, rec, { mapVersion: cfg.map.overrides.version, spawn });
      if (place.moved) log.info(`Placed ${acc.username} at a safe spot (${place.reason})`);
      const { x, y } = place;
      const bad = place.moved;
      p = {
        id: acc.id,
        name: acc.username,
        isAdmin: acc.isAdmin || allAdmin,
        socketId: socket.id,
        appearance: rec.appearance,
        hasCharacter: rec.hasCharacter,
        scene: rec.scene || 'town',
        x,
        y,
        dir: rec.dir,
        moving: false,
        dirty: bad,
        lastSavedAt: rec.lastSavedAt,
        mapVersion: cfg.map.overrides.version,
        move: newMoveState(x, y, Date.now(), cfg.movement),
        emote: null,
        interior: null,
        walletSen: 0,
        shards: 0,
        inventory: [],
        equipped: {},
        cosmetics: {},
        index: new Set(),
        pages: new Set(),
        pity: {},
        jobs: {},
        job: null,
        vehicle: null,
        skills: {},
        manifestBank: 0,
        manifestSecs: 0,
        hotbar: [],
        rideQuote: null,
        ride: null,
        prog: emptyProgress(),
        errand: null,
      };
      economy.loadInto(p);
      world.add(p);
      if (p.hasCharacter) socket.to(p.scene).emit('player:joined', world.toPublic(p));
      log.info(`${p.name} connected (${world.players.size} online)`);
    }

    const me = p;
    void socket.join(me.scene);
    socket.emit('init', buildInit(me));
    economy.register(socket, me);
    economy.afterInit(me, awayMs);
    socket.emit('time:vote', voteState());

    // --- character creator ----------------------------------------------------------
    socket.on('character:save', (msg, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const parsed = C2S.characterSave.safeParse(msg);
      if (!parsed.success) return reply({ ok: false, error: 'Bad request' });
      const res = validateAppearance(parsed.data.appearance, cfg.character);
      if (!res.ok) return reply({ ok: false, error: res.error });
      const wasNew = !me.hasCharacter;
      me.appearance = res.value;
      me.hasCharacter = true;
      me.dirty = true;
      saves.saveNow(me); // save trigger 5: important change
      reply({ ok: true });
      if (wasNew) {
        socket.to(me.scene).emit('player:joined', world.toPublic(me));
        socket.emit('init', buildInit(me));
        economy.afterInit(me);
      } else {
        io.to(me.scene).emit('player:updated', { id: me.id, appearance: res.value });
      }
    });

    // --- movement -------------------------------------------------------------------
    socket.on('move', (msg) => {
      if (!me.hasCharacter) return;
      if (me.ride || economy.isCarried(me)) return; // Ronda / ride-along passengers are moved by the server
      const parsed = C2S.move.safeParse(msg);
      if (!parsed.success) return;
      const m = parsed.data;
      // Engine sound for the others (kept even if the move itself is corrected).
      me.engine = me.vehicle && m.rpm !== undefined && m.eng !== undefined ? [m.rpm, m.eng] : null;
      const rules = economy.moveRules(me); // walking or riding a vehicle
      const verdict = validateMove(me.move, m.x, m.y, Date.now(), rules.grid, rules.movement);
      if (!verdict.ok) {
        me.moving = false;
        socket.emit('move:correct', { x: me.move.x, y: me.move.y, seq: m.seq });
        return;
      }
      if (me.x !== m.x || me.y !== m.y || me.dir !== m.dir) me.dirty = true;
      // Walking around outdoors means you've left the building.
      if (me.interior && (me.x !== m.x || me.y !== m.y)) {
        me.interior = null;
        io.to(me.scene).emit('player:updated', { id: me.id, interior: null });
      }
      if (emotes.onMove(me, m.moving)) io.to(me.scene).emit('emote:stopped', { id: me.id });
      me.x = m.x;
      me.y = m.y;
      me.dir = m.dir;
      me.moving = m.moving;
      economy.onMoved(me);
    });

    // --- chat + emotes ----------------------------------------------------------------
    /** Server-wide admin commands (spec §17); the rest are in economyHandlers. */
    const adminCommand = (text: string): string | null => {
      if (!text.startsWith('/') || !me.isAdmin) return null;
      const [cmd, ...rest] = text.slice(1).split(/s+/);
      const arg = rest.join(' ');
      if (cmd === 'announce') {
        if (!arg) return 'Usage: /announce <message>';
        const m = chat.add({ fromId: null, fromName: 'Server', text: `📢 ${arg}`, system: true });
        io.emit('chat:msg', m);
        io.emit('announce', { text: `📢 ${arg}`, tier: 'legendary', takeover: false, playerName: '', itemId: '', variant: 'normal', oneIn: 0 });
        return 'Announced.';
      }
      if (cmd === 'kick') {
        const p = world.byName(rest[0] ?? '');
        if (!p) return `No online player called "${rest[0] ?? ''}".`;
        saves.saveNow(p);
        kickSocket(p.socketId, rest.slice(1).join(' ') || 'An admin kicked you. You can log in again.');
        return `Kicked ${p.name}.`;
      }
      if (cmd === 'saveall') return `Saved ${saves.saveAll()} players.`;
      if (cmd === 'reloadconfig') {
        try {
          deps.reloadConfig?.();
          return 'Balance config reloaded. Players should refresh the page to see new numbers in menus. Map and network settings need a restart.';
        } catch (e) {
          return `Not reloaded: ${(e as Error).message}`;
        }
      }
      if (cmd === 'resetplayer') {
        const acc = repos.accounts.byName(rest[0] ?? '');
        if (!acc) return 'Usage: /resetplayer <name> confirm (starts them over as a new player at the next server restart)';
        if (rest[1] !== 'confirm') return `This wipes ${acc.username}'s money, items, homes, stall, businesses and progress (not the account). Type /resetplayer ${acc.username} confirm`;
        repos.playerData.save(acc.id, 'reset', { at: Date.now(), by: me.name });
        const p = world.get(acc.id);
        if (p) kickSocket(p.socketId, 'Your progress is being reset. Log in again after the server restarts.');
        return `${acc.username} will be reset when the server restarts (Ctrl+C, then npm start).`;
      }
      if (cmd === 'help') return 'Admin: /announce <text> · /kick <name> [reason] · /saveall · /reloadconfig · /resetplayer <name> confirm · /time · /event · /music rescan · /loanday · /give · /setlevel · /setstage · /tp';
      return null;
    };

    socket.on('chat:send', (msg, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!me.hasCharacter) return reply({ ok: false, error: 'Create your character first' });
      const parsed = C2S.chatSend.safeParse(msg);
      if (!parsed.success) return reply({ ok: false, error: 'Bad message' });
      if (!chatLimiter.hit(String(me.id))) return reply({ ok: false, error: 'Slow down a bit!' });
      const text = sanitizeChat(parsed.data.text, cfg.chat.maxLength);
      if (!text) return reply({ ok: false, error: 'Empty message' });
      const commandReply = adminCommand(text) ?? economy.chatCommand(me, text);
      if (commandReply !== null) {
        socket.emit('chat:msg', { id: -Date.now(), fromId: null, fromName: 'Server', text: commandReply, t: Date.now(), system: true });
        return reply({ ok: true });
      }
      const m = chat.add({ fromId: me.id, fromName: me.name, text });
      io.to(me.scene).emit('chat:msg', m);
      reply({ ok: true });
    });

    // --- 🐞 bug reports / suggestions / feedback ------------------------------------------
    socket.on('feedback:send', (msg, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const parsed = C2S.feedbackSend.safeParse(msg);
      if (!parsed.success) return reply({ ok: false, error: `Write between ${FEEDBACK_MIN_CHARS} and ${FEEDBACK_MAX_CHARS} characters.` });
      const res = feedback.send(me, parsed.data.kind, parsed.data.text, parsed.data.client, parsed.data.image);
      if (!res.ok) return reply(res);
      log.info(`🐞 ${parsed.data.kind} #${res.id} from ${me.name}: ${parsed.data.text.slice(0, 120).replace(/\s+/g, ' ')}`);
      reply({ ok: true, id: res.id });
      // Let online admins know there's something new to read.
      for (const a of world.players.values()) if (a.isAdmin && a.id !== me.id) io.to(a.socketId).emit('feedback:new', { open: repos.feedback.countOpen() });
    });
    socket.on('feedback:list', (ack) => {
      if (typeof ack !== 'function') return;
      if (!me.isAdmin) return ack({ ok: false, error: 'Only the host can read reports.' });
      ack({ ok: true, reports: repos.feedback.list(150) as FeedbackReport[], open: repos.feedback.countOpen() });
    });
    socket.on('feedback:image', (msg, ack) => {
      if (typeof ack !== 'function') return;
      const id = Number((msg as { id?: unknown })?.id);
      if (!me.isAdmin || !Number.isInteger(id)) return ack({ ok: false, error: 'Bad request' });
      const dataUrl = feedback.image(id);
      ack(dataUrl ? { ok: true, dataUrl } : { ok: false, error: 'No picture.' });
    });
    socket.on('feedback:done', (msg, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const parsed = C2S.feedbackDone.safeParse(msg);
      if (!parsed.success || !me.isAdmin) return reply({ ok: false, error: 'Bad request' });
      if (!repos.feedback.setDone(parsed.data.id, parsed.data.done)) return reply({ ok: false, error: 'No such report.' });
      reply({ ok: true });
    });

    socket.on('net:ping', (ack) => typeof ack === 'function' && ack({ ok: true }));
    socket.on('money:ledger', (ack) => {
      if (typeof ack !== 'function') return;
      const now = Date.now();
      ack({ ok: true, hour: repos.econ.sums(me.id, now - 3_600_000), day: repos.econ.sums(me.id, now - 86_400_000) });
    });

    socket.on('emote', (msg) => {
      if (!me.hasCharacter) return;
      const parsed = C2S.emote.safeParse(msg);
      if (!parsed.success) return;
      const res = emotes.play(me, parsed.data.emote);
      if (res.kind === 'played') io.to(me.scene).emit('emote:played', { id: me.id, emote: res.emote });
    });

    // --- skip the night -----------------------------------------------------------------
    socket.on('time:vote', (msg, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const parsed = C2S.timeVote.safeParse(msg);
      if (!parsed.success || !me.hasCharacter) return reply({ ok: false, error: 'Bad request' });
      const wasActive = skip.active;
      const res = skip.vote(me.id, me.name, parsed.data.yes, onlineCount(), Date.now());
      if (!res.ok) return reply({ ok: false, error: res.error });
      reply({ ok: true });
      if (res.passed) skipNight();
      else if (!wasActive) systemSay(`🗳️ ${me.name} wants to skip the night. Vote in 📱 → Clock (${res.state.needed} of ${res.state.online} needed).`);
      io.emit('time:vote', voteState());
    });

    // --- building interiors --------------------------------------------------------------
    socket.on('interior', (msg, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const parsed = C2S.interior.safeParse(msg);
      if (!parsed.success || !me.hasCharacter) return reply({ ok: false, error: 'Bad request' });
      const id = parsed.data.building;
      if (id !== null) {
        const b = cfg.map.buildings.find((x) => x.id === id);
        if (!b || (!roomStyleOf(cfg.interiors, b) && !economy.ownsIn(me, id))) return reply({ ok: false, error: "You can't go in there." });
        if (me.ride || me.vehicle) return reply({ ok: false, error: 'Get off your ride first.' });
        const T = cfg.map.tileSize;
        if (!atDoor(cfg.map, id, me.x / T, me.y / T, cfg.interiors.enterRadiusTiles + 1.5)) return reply({ ok: false, error: 'Walk up to the door first.' });
      }
      if (me.interior !== id) {
        me.interior = id;
        io.to(me.scene).emit('player:updated', { id: me.id, interior: id });
      }
      reply({ ok: true });
    });

    socket.on('emote:stop', () => {
      if (emotes.stop(me)) io.to(me.scene).emit('emote:stopped', { id: me.id });
    });

    // --- logout + disconnect ----------------------------------------------------------
    socket.on('logout', (ack) => {
      saves.saveNow(me); // save trigger 2
      repos.sessions.delete(socket.data.tokenHash);
      if (typeof ack === 'function') ack({ ok: true });
      setTimeout(() => socket.disconnect(true), 100);
    });

    socket.on('disconnect', (reason) => {
      const current = world.get(me.id);
      if (!current || current.socketId !== socket.id) return; // replaced by a newer connection
      // Save straight away (never lose progress), but keep them in the world for a short grace
      // period: a WiFi hiccup reconnects without anyone noticing. Logging out leaves at once.
      try {
        economy.flushManifest(current);
        economy.saveProgress(current);
        saves.saveNow(current); // save trigger 3
      } catch (err) {
        log.error(`Save on disconnect failed for ${me.name}`, err);
      }
      const graceMs = reason === 'server namespace disconnect' ? 0 : cfg.net.reconnectGraceMs;
      const remove = () => {
        offline.delete(me.id);
        const p = world.get(me.id);
        if (!p || p.socketId !== socket.id) return; // came back on a new connection
        if (p.job) economy.cancelJob(p);
        economy.leave(p); // off the ride; a Ronda passenger is dropped off where they are
        economy.flushManifest(p);
        try {
          economy.saveProgress(p); // buff timers pause while offline
          economy.leaveStall(p); // the stall closes while its owner is away
          saves.saveNow(p);
        } catch (err) {
          log.error(`Save on leave failed for ${me.name}`, err);
        }
        world.remove(me.id);
        if (p.hasCharacter) io.to(p.scene).emit('player:left', { id: me.id });
        log.info(`${me.name} left (${world.players.size} online)`);
        if (skip.leave(me.id, onlineCount(), Date.now())) skipNight();
        io.emit('time:vote', voteState());
      };
      if (graceMs <= 0) return remove();
      offline.set(me.id, setTimeout(remove, graceMs));
      log.info(`${me.name} disconnected; keeping them for ${Math.round(graceMs / 1000)} s in case they reconnect`);
    });
  });

  // --- snapshots ------------------------------------------------------------------------
  const snapshotTimer = setInterval(() => {
    const t = Date.now();
    for (const scene of world.scenes()) {
      const rows: SnapshotRow[] = world
        .inScene(scene)
        .map((p): SnapshotRow => {
          const row: SnapshotRow = [p.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, DIR_INDEX[p.dir], p.moving ? 1 : 0];
          if (p.vehicle && p.engine) row.push(p.engine[0], p.engine[1]);
          return row;
        });
      io.to(scene).volatile.emit('snapshot', { t, p: rows });
    }
  }, 1000 / cfg.net.snapshotRateHz);

  saves.onAutosaved = (p, at) => {
    io.sockets.sockets.get(p.socketId)?.emit('saved', { at });
  };

  return {
    stop() {
      clearInterval(snapshotTimer);
      clearInterval(voteTimer);
      for (const t of offline.values()) clearTimeout(t);
      economy.stop();
      for (const p of world.players.values()) {
        economy.flushManifest(p);
        try {
          economy.saveProgress(p);
        } catch (err) {
          log.error(`Progress save on shutdown failed for ${p.name}`, err);
        }
      }
    },
  };
}
