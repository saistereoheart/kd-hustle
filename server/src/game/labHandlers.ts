// 🗝️ Labirin Purba over the network: entering hides you in town (like being inside a building),
// each labyrinth room is a socket.io room, and the others in your room see you walk about.
import { DIRECTIONS, LAB_C2S, type LabOther, type LabRoomView } from '@kh/shared';
import type { Server, Socket } from 'socket.io';
import { log } from '../log';
import { GameError } from '../systems/economy/economy';
import { labRoomKey, type LabSystem } from '../systems/lab/lab';
import { LabBattles } from '../systems/lab/labBattles';
import { LAB_VOID, type OnlinePlayer, type World } from './world';

// The game's typed sockets are loose here on purpose (this module only adds events).
type AnyIO = Server;
type AnySocket = Socket;

const DIR_INDEX = Object.fromEntries(DIRECTIONS.map((d, i) => [d, i])) as Record<string, number>;

export function createLabHandlers(io: AnyIO, world: World, lab: LabSystem, socketOf: (p: OnlinePlayer) => AnySocket | undefined, rand: () => number) {
  const keyOf = (p: OnlinePlayer) => (p.lab ? labRoomKey(p.lab.floor, p.lab.room) : null);
  const othersIn = (key: string, except?: number): LabOther[] =>
    [...world.players.values()]
      .filter((o) => o.lab && keyOf(o) === key && o.id !== except)
      .map((o) => ({ id: o.id, name: o.name, level: o.prog.level, appearance: o.appearance!, cosmetics: o.cosmetics, x: o.lab!.x, y: o.lab!.y, dir: o.lab!.dir }));
  /** Tell everyone in a room who's there now. */
  const announce = (key: string) => {
    for (const o of world.players.values()) if (keyOf(o) === key) socketOf(o)?.emit('lab:others', { room: key, others: othersIn(key, o.id) });
  };
  /** Moved rooms (or in / out): socket rooms and the "who's here" lists of both rooms. */
  const moved = (p: OnlinePlayer, from: string | null) => {
    const to = keyOf(p);
    const s = socketOf(p);
    if (from && from !== to) {
      void s?.leave(from);
      announce(from);
    }
    if (to && to !== from) {
      void s?.join(to);
      announce(to);
    }
  };
  /** In town, you're "inside" while you're down there (hidden, standing at your spot). */
  const setInside = (p: OnlinePlayer, inside: boolean) => {
    const id = inside ? 'lab' : null;
    if (p.interior === id) return;
    p.interior = id;
    // Out of town while you're down there: off the map, so no stall, NPC, door, crate or job is in
    // reach. Your spot is kept (others see you "inside" there, and it's what's saved) for coming back.
    if (inside) {
      p.labReturn = { x: p.x, y: p.y };
      p.x = LAB_VOID.x;
      p.y = LAB_VOID.y;
      p.moving = false;
    } else if (p.labReturn) {
      p.x = p.labReturn.x;
      p.y = p.labReturn.y;
      p.labReturn = null;
    }
    io.to(p.scene).emit('player:updated', { id: p.id, interior: id });
  };
  const withOthers = (p: OnlinePlayer, v: LabRoomView): LabRoomView => ({ ...v, others: othersIn(keyOf(p)!, p.id) });

  // ⚔️ Fights. Each player's fight ends on its own (ran away, or the battle is over); anyone it
  // moved (fell back to their save point, ran back a room) gets their new room with the round.
  const battles = new LabBattles(lab.cfg, lab, {
    started: (players, view) => {
      for (const p of players) socketOf(p)?.emit('lab:battle', { view });
    },
    picked: (players, view) => {
      for (const p of players) socketOf(p)?.emit('lab:battle', { view });
    },
    round: (players, events, view, ends) => {
      for (const p of players) {
        const end = ends.get(p.id);
        const from = battleRoom.get(p.id) ?? null;
        let room: LabRoomView | undefined;
        if (end && p.lab) {
          battleRoom.delete(p.id);
          if (keyOf(p) !== from) moved(p, from);
          room = withOthers(p, lab.view(p));
        }
        socketOf(p)?.emit('lab:round', { events, view, end, room });
      }
    },
  }, rand);
  /** Which room each fighter's fight is in (to know if the end moved them). */
  const battleRoom = new Map<number, string>();
  /** Walked into a room: a waiting group jumps out. */
  const encounter = (p: OnlinePlayer) => {
    if (battles.encounter([p])) battleRoom.set(p.id, keyOf(p)!);
  };

  function register(socket: AnySocket, me: OnlinePlayer, handle: <A, R>(socket: AnySocket, event: string, schema: { safeParse: (v: unknown) => { success: true; data: A } | { success: false } } | null, fn: (args: A) => R) => void) {
    handle(socket, 'lab:self', null, () => ({ self: lab.self(me) }));
    handle(socket, 'lab:enter', LAB_C2S.labEnter, ({ at }) => {
      if (!me.hasCharacter) throw new GameError('Create your character first.');
      const view = lab.enter(me, at);
      setInside(me, true);
      moved(me, null);
      return { view: withOthers(me, view), battle: battles.view(me) };
    });
    handle(socket, 'lab:leave', null, () => {
      const from = keyOf(me);
      lab.leave(me);
      moved(me, from);
      setInside(me, false);
      return { self: lab.self(me) };
    });
    handle(socket, 'lab:door', LAB_C2S.labDoor, ({ dir }) => {
      const from = keyOf(me);
      const view = lab.door(me, dir);
      moved(me, from);
      setImmediate(() => encounter(me)); // after the reply (the client shows the room, then the fight)
      return { view: withOthers(me, view) };
    });
    handle(socket, 'lab:use', LAB_C2S.labUse, ({ what }) => {
      const from = keyOf(me);
      const r = lab.use(me, what);
      moved(me, from);
      if (r.view && keyOf(me) !== from) setImmediate(() => encounter(me));
      if (r.left) setInside(me, false);
      return { text: r.text, view: r.view ? withOthers(me, r.view) : undefined, self: lab.self(me), left: r.left };
    });
    handle(socket, 'lab:act', LAB_C2S.labAct, ({ kind, target, item }) => {
      if (kind === 'item') {
        if (!item) throw new GameError('Pick a potion.');
        battles.act(me, { kind, item, target });
      } else battles.act(me, kind === 'attack' || kind === 'skill' ? { kind, target } : { kind });
      return {};
    });
    // 🛒 The merchant, ⚔️ gear and 🧪 potions out of a fight.
    handle(socket, 'lab:buy', LAB_C2S.labBuy, ({ id, n }) => {
      const text = lab.buy(me, id, n);
      return { self: lab.self(me), text };
    });
    handle(socket, 'lab:equip', LAB_C2S.labEquip, ({ slot, id }) => {
      lab.equip(me, slot, id);
      return { self: lab.self(me) };
    });
    handle(socket, 'lab:item', LAB_C2S.labItem, ({ id }) => {
      const from = keyOf(me);
      const r = lab.useItem(me, id);
      if (r.left) {
        moved(me, from);
        setInside(me, false);
      }
      return { self: lab.self(me), text: r.text, left: r.left };
    });
    socket.on('lab:move', (msg: unknown) => {
      const parsed = LAB_C2S.labMove.safeParse(msg);
      if (!parsed.success || !me.lab) return;
      const m = parsed.data;
      if (!lab.move(me, m.x, m.y, m.dir, m.moving)) socket.emit('lab:correct', { x: me.lab.x, y: me.lab.y });
    });
  }

  /** Positions of everyone in each labyrinth room with company (called with the town snapshots). */
  function snapshots(t: number) {
    const rooms = new Map<string, OnlinePlayer[]>();
    for (const p of world.players.values()) {
      const k = keyOf(p);
      if (k) (rooms.get(k) ?? rooms.set(k, []).get(k)!).push(p);
    }
    for (const [k, list] of rooms) {
      if (list.length < 2) continue;
      const rows = list.map((p): [number, number, number, number, number] => [p.id, Math.round(p.lab!.x), Math.round(p.lab!.y), DIR_INDEX[p.lab!.dir] ?? 0, p.lab!.moving ? 1 : 0]);
      // Not volatile: the town snapshot just went out on the same connections (they're still in the
      // town room), and a volatile packet right behind it finds the socket busy and is dropped.
      io.to(k).emit('lab:snap', { t, p: rows });
    }
  }

  /** Disconnected / left the server while inside. */
  function drop(p: OnlinePlayer) {
    const from = keyOf(p);
    if (!from) return;
    try {
      battles.drop(p);
      battleRoom.delete(p.id);
      lab.drop(p);
    } catch (err) {
      log.error('lab drop failed', err);
    }
    announce(from);
    setInside(p, false);
  }

  return { register, snapshots, drop };
}
