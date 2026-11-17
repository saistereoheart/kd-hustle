// Socket.IO game layer: authenticates sockets with the session token, loads players into
// the World, validates every message with zod, and broadcasts position snapshots.
import type { Server, Socket } from 'socket.io';
import {
  C2S, collides, DIR_INDEX, validateAppearance,
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
}

export function attachGame(io: GameIO, deps: GameDeps) {
  const { cfg, auth, repos, world, saves } = deps;
  const chat = new ChatHistory(cfg.chat.historySize);
  const chatLimiter = new RateLimiter(cfg.chat.rateLimit.count, cfg.chat.rateLimit.windowMs);
  const emoteIds = new Set(cfg.chat.emotes.map((e) => e.id));
  const spawn = cfg.map.spawnPx;

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
  });

  io.on('connection', (socket: GameSocket) => {
    const acc = socket.data.account;
    let p = world.get(acc.id);

    if (p) {
      // Same account connected again (second tab/device): the newest connection wins.
      saves.saveNow(p);
      const oldId = p.socketId;
      p.socketId = socket.id;
      if (oldId !== socket.id) kickSocket(oldId, 'This account was opened somewhere else.');
    } else {
      const rec = repos.players.load(acc.id);
      if (!rec) {
        log.warn(`No player row for account ${acc.id}`);
        socket.disconnect(true);
        return;
      }
      // If the map changed and the saved spot is now inside a wall, return to spawn.
      const bad = !Number.isFinite(rec.x) || !Number.isFinite(rec.y) || collides(cfg.map, rec.x, rec.y, cfg.movement.hitbox);
      const x = bad ? spawn.x : rec.x;
      const y = bad ? spawn.y : rec.y;
      p = {
        id: acc.id,
        name: acc.username,
        isAdmin: acc.isAdmin,
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
        move: newMoveState(x, y, Date.now(), cfg.movement),
        lastEmoteAt: 0,
      };
      world.add(p);
      if (p.hasCharacter) socket.to(p.scene).emit('player:joined', world.toPublic(p));
      log.info(`${p.name} connected (${world.players.size} online)`);
    }

    const me = p;
    void socket.join(me.scene);
    socket.emit('init', buildInit(me));

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
      } else {
        io.to(me.scene).emit('player:updated', { id: me.id, appearance: res.value });
      }
    });

    // --- movement -------------------------------------------------------------------
    socket.on('move', (msg) => {
      if (!me.hasCharacter) return;
      const parsed = C2S.move.safeParse(msg);
      if (!parsed.success) return;
      const m = parsed.data;
      const verdict = validateMove(me.move, m.x, m.y, Date.now(), cfg.map, cfg.movement);
      if (!verdict.ok) {
        me.moving = false;
        socket.emit('move:correct', { x: me.move.x, y: me.move.y, seq: m.seq });
        return;
      }
      if (me.x !== m.x || me.y !== m.y || me.dir !== m.dir) me.dirty = true;
      me.x = m.x;
      me.y = m.y;
      me.dir = m.dir;
      me.moving = m.moving;
    });

    // --- chat + emotes ----------------------------------------------------------------
    socket.on('chat:send', (msg, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!me.hasCharacter) return reply({ ok: false, error: 'Create your character first' });
      const parsed = C2S.chatSend.safeParse(msg);
      if (!parsed.success) return reply({ ok: false, error: 'Bad message' });
      if (!chatLimiter.hit(String(me.id))) return reply({ ok: false, error: 'Slow down a bit!' });
      const text = sanitizeChat(parsed.data.text, cfg.chat.maxLength);
      if (!text) return reply({ ok: false, error: 'Empty message' });
      const m = chat.add({ fromId: me.id, fromName: me.name, text });
      io.to(me.scene).emit('chat:msg', m);
      reply({ ok: true });
    });

    socket.on('emote', (msg) => {
      if (!me.hasCharacter) return;
      const parsed = C2S.emote.safeParse(msg);
      if (!parsed.success || !emoteIds.has(parsed.data.emote)) return;
      const now = Date.now();
      if (now - me.lastEmoteAt < cfg.chat.emoteCooldownMs) return;
      me.lastEmoteAt = now;
      io.to(me.scene).emit('emote:played', { id: me.id, emote: parsed.data.emote });
    });

    // --- logout + disconnect ----------------------------------------------------------
    socket.on('logout', (ack) => {
      saves.saveNow(me); // save trigger 2
      repos.sessions.delete(socket.data.tokenHash);
      if (typeof ack === 'function') ack({ ok: true });
      setTimeout(() => socket.disconnect(true), 100);
    });

    socket.on('disconnect', () => {
      const current = world.get(me.id);
      if (!current || current.socketId !== socket.id) return; // replaced by a newer connection
      try {
        saves.saveNow(current); // save trigger 3
      } catch (err) {
        log.error(`Save on disconnect failed for ${me.name}`, err);
      }
      world.remove(me.id);
      if (current.hasCharacter) io.to(current.scene).emit('player:left', { id: me.id });
      log.info(`${me.name} disconnected (${world.players.size} online)`);
    });
  });

  // --- snapshots ------------------------------------------------------------------------
  const snapshotTimer = setInterval(() => {
    const t = Date.now();
    for (const scene of world.scenes()) {
      const rows: SnapshotRow[] = world
        .inScene(scene)
        .map((p) => [p.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, DIR_INDEX[p.dir], p.moving ? 1 : 0]);
      io.to(scene).volatile.emit('snapshot', { t, p: rows });
    }
  }, 1000 / cfg.net.snapshotRateHz);

  saves.onAutosaved = (p, at) => {
    io.sockets.sockets.get(p.socketId)?.emit('saved', { at });
  };

  return {
    stop() {
      clearInterval(snapshotTimer);
    },
  };
}
