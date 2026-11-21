// 🗝️ Labirin Purba (docs/LABYRINTH.md): your save down there, where you are, and what you can do in
// a room. The floors themselves are built from fixed seeds by shared/src/lab/generate.ts, the same
// on every machine. The server checks every step: a door must be next to you (and open), a chest
// must be in your room and not opened yet today, and so on.
import {
  LAB_OPPOSITE, dayKey, labFloor, roomLayout, seenAdd,
  type LabConfig, type LabDir, type LabFloor, type LabRoom, type LabRoomView, type LabSelf, type LabUse,
} from '@kh/shared';
import type { Repos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { GameError } from '../economy/economy';

/** What's saved (playerData `lab`). */
export interface LabSave {
  coins: number;
  carried: number;
  save: { floor: number; room: number };
  deepest: number;
  /** Seen rooms per floor (hex bitsets). */
  seen: Record<string, string>;
  /** Loot boxes opened: `${floor}:${room}` → the day (they refill the next day). */
  chests: Record<string, string>;
  keys: string[];
  unlocked: string[];
  looted: string[];
  /** Where you were when you last left / dropped (not used to resume: you come back at `save`). */
  last?: { floor: number; room: number };
}

export function emptyLab(): LabSave {
  return { coins: 0, carried: 0, save: { floor: 0, room: -1 }, deepest: 0, seen: {}, chests: {}, keys: [], unlocked: [], looted: [] };
}

/** How near (tiles) you must be to a door / chest / fire to use it. */
const REACH = 1.9;

export class LabSystem {
  private cache = new Map<number, LabSave>();

  constructor(
    private cfg: LabConfig,
    private repos: Repos,
    private rand: () => number,
    private clock: () => number = Date.now,
  ) {}

  floor(n: number): LabFloor {
    return labFloor(this.cfg, n);
  }

  state(p: OnlinePlayer): LabSave {
    let s = this.cache.get(p.id);
    if (!s) {
      s = { ...emptyLab(), ...(this.repos.playerData.load<Partial<LabSave>>(p.id, 'lab') ?? {}) };
      this.cache.set(p.id, s);
    }
    return s;
  }

  save(p: OnlinePlayer) {
    this.repos.playerData.save(p.id, 'lab', this.state(p));
  }

  /** Forget a player who has left the server (after saving). */
  forget(id: number) {
    this.cache.delete(id);
  }

  self(p: OnlinePlayer): LabSelf {
    const s = this.state(p);
    const save = s.save.room < 0 ? { floor: 0, room: this.floor(0).start } : s.save;
    return { coins: s.coins, carried: s.carried, save, deepest: s.deepest, keys: [...s.keys], unlocked: [...s.unlocked], looted: [...s.looted], inside: !!p.lab };
  }

  // ---------------------------------------------------------------- entering, leaving
  enter(p: OnlinePlayer, at: 'save' | 'entrance'): LabRoomView {
    if (p.lab) throw new GameError("You're already in the labyrinth.");
    if (p.ride || p.vehicle) throw new GameError('Get off your ride first.');
    const s = this.state(p);
    const target = at === 'entrance' || s.save.room < 0 ? { floor: 0, room: this.floor(0).start } : s.save;
    const f = this.floor(target.floor);
    const L = roomLayout(this.cfg, f, f.rooms[target.room]);
    const T = this.cfg.tile;
    p.lab = { floor: target.floor, room: target.room, x: (L.spot.centre[0] + 0.5) * T, y: (L.h - 2.5) * T, dir: 'up', moving: false, at: this.clock() };
    this.see(p);
    return this.view(p);
  }

  /** Leave for town (from the entrance hall or a rest chamber): carried coins are banked. */
  leave(p: OnlinePlayer, anywhere = false) {
    const pos = p.lab;
    if (!pos) throw new GameError("You're not in the labyrinth.");
    const room = this.floor(pos.floor).rooms[pos.room];
    const exit = (pos.floor === 0 && room.kind === 'start') || room.kind === 'rest';
    if (!exit && !anywhere) throw new GameError('You can only leave from the entrance hall or a rest chamber.');
    const s = this.state(p);
    s.coins += s.carried;
    s.carried = 0;
    s.last = { floor: pos.floor, room: pos.room };
    p.lab = null;
    this.save(p);
  }

  /** Disconnected / logged out inside: you're out (carried coins kept for next time). */
  drop(p: OnlinePlayer) {
    if (!p.lab) return;
    const s = this.state(p);
    s.last = { floor: p.lab.floor, room: p.lab.room };
    p.lab = null;
    this.save(p);
  }

  // ---------------------------------------------------------------- walking
  /** A step inside the room (room-local px). Returns false if it's refused (the client is told where it is). */
  move(p: OnlinePlayer, x: number, y: number, dir: LabRoomView['dir'], moving: boolean): boolean {
    const pos = p.lab;
    if (!pos) return false;
    const f = this.floor(pos.floor);
    const L = roomLayout(this.cfg, f, f.rooms[pos.room]);
    const T = this.cfg.tile;
    const now = this.clock();
    const dt = Math.min(1, Math.max(0.05, (now - pos.at) / 1000));
    const far = Math.hypot(x - pos.x, y - pos.y);
    // Inside the walls (doorways are where you leave, through lab:door), not in a pillar, not too fast.
    const inRoom = x >= T * 0.6 && y >= T * 0.9 && x <= (L.w - 0.6) * T && y <= (L.h - 0.4) * T;
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    const ok = inRoom && !L.solid.has(ty * L.w + tx) && far <= this.cfg.walkSpeed * dt * 1.35 + T * 0.6;
    pos.at = now;
    if (!ok) return false;
    pos.x = x;
    pos.y = y;
    pos.dir = dir;
    pos.moving = moving;
    return true;
  }

  /** Through a door to the next room (you come in by the opposite door). */
  door(p: OnlinePlayer, dir: LabDir): LabRoomView {
    const pos = this.at(p);
    const f = this.floor(pos.floor);
    const room = f.rooms[pos.room];
    const d = room.doors[dir];
    if (!d) throw new GameError('No door there.');
    const L = roomLayout(this.cfg, f, room);
    if (!this.near(pos, L.doorAt[dir]!)) throw new GameError('Walk up to the door first.');
    const s = this.state(p);
    if (d.lock !== undefined) {
      const k = `${pos.floor}:${d.lock}`;
      if (!s.unlocked.includes(k)) {
        if (!s.keys.includes(k)) throw new GameError('🔒 Locked. Its key is somewhere on this floor.');
        s.keys = s.keys.filter((x) => x !== k);
        s.unlocked.push(k);
      }
    }
    this.place(p, pos.floor, d.to, LAB_OPPOSITE[dir]);
    this.see(p);
    this.save(p);
    return this.view(p);
  }

  /** Stand just inside a room by one of its doors (or in the middle if it has none that way). */
  private place(p: OnlinePlayer, floor: number, roomId: number, by: LabDir | null) {
    const f = this.floor(floor);
    const L = roomLayout(this.cfg, f, f.rooms[roomId]);
    const T = this.cfg.tile;
    const d = by ? L.doorAt[by] : undefined;
    const step: Record<LabDir, [number, number]> = { n: [0, 1.4], s: [0, -1.4], w: [1.4, 0], e: [-1.4, 0] };
    const [tx, ty] = d ? [d[0] + step[by!][0], d[1] + step[by!][1]] : [L.spot.centre[0], L.h - 2.5];
    const facing: Record<LabDir, LabRoomView['dir']> = { n: 'down', s: 'up', w: 'right', e: 'left' };
    p.lab = { floor, room: roomId, x: (tx + 0.5) * T, y: (ty + 0.5) * T + (by === 'n' ? T * 0.3 : 0), dir: by ? facing[by] : 'up', moving: false, at: this.clock() };
  }

  // ---------------------------------------------------------------- using things
  use(p: OnlinePlayer, what: LabUse): { text: string; view?: LabRoomView; left?: boolean } {
    const pos = this.at(p);
    const f = this.floor(pos.floor);
    const room = f.rooms[pos.room];
    const L = roomLayout(this.cfg, f, room);
    const s = this.state(p);
    const today = dayKey(this.clock());
    if (what === 'chest') {
      if (room.kind === 'treasure') {
        const k = `${pos.floor}:${f.treasure.indexOf(room.id)}`;
        if (!this.near(pos, L.spot.centre)) throw new GameError('Walk up to the chest.');
        if (s.looted.includes(k)) throw new GameError("It's empty. You took everything.");
        const coins = this.coins(pos.floor, this.cfg.coins.treasureMult);
        s.looted.push(k);
        s.carried += coins;
        this.save(p);
        return { text: `💰 Treasure! +${coins} Syiling Purba`, view: this.view(p) };
      }
      if (!room.chest) throw new GameError('No chest here.');
      if (!this.near(pos, L.spot.chest)) throw new GameError('Walk up to the chest.');
      const k = `${pos.floor}:${room.id}`;
      if (s.chests[k] === today) throw new GameError('Empty. It fills up again tomorrow.');
      const coins = this.coins(pos.floor, 1);
      s.chests[k] = today;
      s.carried += coins;
      this.save(p);
      return { text: `📦 +${coins} Syiling Purba`, view: this.view(p) };
    }
    if (what === 'key') {
      if (room.key === undefined) throw new GameError('No key here.');
      if (!this.near(pos, L.spot.feature)) throw new GameError('Walk up to it.');
      const k = `${pos.floor}:${room.key}`;
      if (s.keys.includes(k) || s.unlocked.includes(k)) throw new GameError('You already have this key.');
      s.keys.push(k);
      this.save(p);
      return { text: '🗝️ A key! It opens a locked door somewhere on this floor.', view: this.view(p) };
    }
    if (what === 'rest') {
      if (room.kind !== 'rest' && !(pos.floor === 0 && room.kind === 'start')) throw new GameError('No campfire here.');
      if (!this.near(pos, L.spot.feature)) throw new GameError('Walk up to the fire.');
      const banked = s.carried;
      s.coins += s.carried;
      s.carried = 0;
      s.save = { floor: pos.floor, room: room.id };
      this.save(p);
      return { text: `🔥 Rested. You'll come back here.${banked ? ` Banked ${banked} Syiling.` : ''}`, view: this.view(p) };
    }
    if (what === 'down') {
      if (room.kind !== 'boss') throw new GameError('No stairs down here.');
      if (!this.near(pos, L.spot.feature)) throw new GameError('Walk up to the stairs.');
      if (pos.floor + 1 >= this.cfg.floors.length) throw new GameError("This is the bottom. There's nowhere deeper.");
      const next = pos.floor + 1;
      this.place(p, next, this.floor(next).start, null);
      s.deepest = Math.max(s.deepest, next);
      this.see(p);
      this.save(p);
      return { text: `⬇️ ${this.cfg.floors[next].name} (floor ${next + 1})`, view: this.view(p) };
    }
    if (what === 'up') {
      if (room.kind !== 'start' || pos.floor === 0) throw new GameError('No stairs up here.');
      if (!this.near(pos, L.spot.feature)) throw new GameError('Walk up to the stairs.');
      const prev = pos.floor - 1;
      this.place(p, prev, this.floor(prev).boss, null);
      this.see(p);
      this.save(p);
      return { text: `⬆️ ${this.cfg.floors[prev].name} (floor ${prev + 1})`, view: this.view(p) };
    }
    // exit: out to town (entrance hall or a rest chamber)
    this.leave(p);
    return { text: '🚪 Back to town.', left: true };
  }

  // ---------------------------------------------------------------- helpers
  private at(p: OnlinePlayer) {
    if (!p.lab) throw new GameError("You're not in the labyrinth.");
    return p.lab;
  }

  private near(pos: { x: number; y: number }, tile: [number, number]) {
    const T = this.cfg.tile;
    return Math.hypot(pos.x - (tile[0] + 0.5) * T, pos.y - (tile[1] + 0.5) * T) <= REACH * T;
  }

  private coins(floor: number, mult: number): number {
    const c = this.cfg.coins;
    const base = c.chest * (1 + c.perFloor * floor) * mult;
    return Math.max(1, Math.round(base * (1 - c.spread + this.rand() * c.spread * 2)));
  }

  private see(p: OnlinePlayer) {
    const pos = this.at(p);
    const s = this.state(p);
    s.seen[pos.floor] = seenAdd(s.seen[pos.floor] ?? '', pos.room);
  }

  view(p: OnlinePlayer, others: LabRoomView['others'] = []): LabRoomView {
    const pos = this.at(p);
    const s = this.state(p);
    const f = this.floor(pos.floor);
    const room: LabRoom = f.rooms[pos.room];
    const chestDone = room.kind === 'treasure' ? s.looted.includes(`${pos.floor}:${f.treasure.indexOf(room.id)}`) : s.chests[`${pos.floor}:${room.id}`] === dayKey(this.clock());
    return { floor: pos.floor, room: pos.room, x: pos.x, y: pos.y, dir: pos.dir, seen: s.seen[pos.floor] ?? '', chestDone, others, self: this.self(p) };
  }
}

/** The socket.io room for everyone in one labyrinth room. */
export function labRoomKey(floor: number, room: number) {
  return `lab:${floor}:${room}`;
}
