// 🗝️ Labirin Purba (docs/LABYRINTH.md): your save down there, where you are, and what you can do in
// a room. The floors themselves are built from fixed seeds by shared/src/lab/generate.ts, the same
// on every machine. The server checks every step: a door must be next to you (and open), a chest
// must be in your room and not opened yet today, and so on.
import {
  LAB_OPPOSITE, dayKey, gearBonus, labFloor, labGear, labPlayerStats, labPotion, roomLayout, seenAdd,
  type LabConfig, type LabDir, type LabFloor, type LabRoom, type LabRoomView, type LabSelf, type LabSlot, type LabUse,
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
  /** ⚔️ Your HP down here (it carries over between fights; campfires and time heal it). */
  hp?: number;
  /** When `hp` was last brought up to date (out-of-fight healing). */
  hpAt?: number;
  /** Monster groups beaten: `${floor}:${room}` → when (they're back after a while). */
  cleared: Record<string, number>;
  /** ⚔️ Gear worn (slot → gear id) and owned (kept forever). */
  gear: Partial<Record<LabSlot, string>>;
  owned: string[];
  /** 🧪 Potions carried: id → count. */
  potions: Record<string, number>;
  /** 👹 Floors whose boss you've beaten (their stairs down are open for you). */
  bosses: number[];
  /** 🍵 The tavern drink working on you: fights left. */
  drink?: { id: string; left: number };
}

export function emptyLab(): LabSave {
  return { coins: 0, carried: 0, save: { floor: 0, room: -1 }, deepest: 0, seen: {}, chests: {}, keys: [], unlocked: [], looted: [], cleared: {}, gear: {}, owned: [], potions: {}, bosses: [] };
}

/** How near (tiles) you must be to a door / chest / fire to use it. */
const REACH = 1.9;

export class LabSystem {
  private cache = new Map<number, LabSave>();

  /** The lead Teman's tiny boost for a player (set by the game; 0 without one). */
  temanBoost: (p: OnlinePlayer) => number = () => 0;
  /** Is this player in a fight right now (set by the battles)? */
  inFight: (p: OnlinePlayer) => boolean = () => false;

  constructor(
    readonly cfg: LabConfig,
    private repos: Repos,
    private rand: () => number,
    private clock: () => number = Date.now,
  ) {}

  // ---------------------------------------------------------------- ⚔️ HP and stats
  stats(p: OnlinePlayer) {
    const st = labPlayerStats(this.cfg, this.temanBoost(p), gearBonus(this.cfg, this.state(p).gear));
    // 🍵 A tavern drink: +a share of some stats while it lasts.
    const d = this.state(p).drink;
    const def = d ? this.cfg.tavern.drinks.find((x) => x.id === d.id) : undefined;
    if (def) {
      st.hp = Math.round(st.hp * (1 + (def.hp ?? 0)));
      st.atk = Math.round(st.atk * (1 + (def.atk ?? 0)) * 10) / 10;
      st.def = Math.round(st.def * (1 + (def.def ?? 0)) * 10) / 10;
      st.spd = Math.round(st.spd * (1 + (def.spd ?? 0)) * 10) / 10;
    }
    return st;
  }

  // ---------------------------------------------------------------- 🍵 the tavern
  /** Standing at the tavern counter (the entrance hall)? */
  private atTavern(p: OnlinePlayer): boolean {
    const pos = p.lab;
    if (!pos || this.inFight(p) || pos.floor !== 0) return false;
    const f = this.floor(0);
    const room = f.rooms[pos.room];
    if (room.kind !== 'start') return false;
    return this.near(pos, roomLayout(this.cfg, f, room).spot.tavern, 2.4);
  }

  /** Buy a drink: it works for your next few fights (a new one replaces the old). */
  drink(p: OnlinePlayer, id: string): string {
    const t = this.cfg.tavern;
    if (!this.atTavern(p)) throw new GameError(`Drinks are at ${t.name}, in the entrance hall.`);
    const d = t.drinks.find((x) => x.id === id);
    if (!d) throw new GameError(`${t.keeper} doesn't make that.`);
    const s = this.state(p);
    this.pay(s, d.price);
    const before = this.stats(p).hp;
    if (s.hp !== undefined) this.hp(p);
    s.drink = { id: d.id, left: d.battles };
    this.maxHpChanged(p, before);
    this.save(p);
    return `${d.icon} ${d.name}: ${d.desc}`;
  }

  // ---------------------------------------------------------------- 🌿 bushes and cobwebs
  /** Which brush tile each player last stepped into (a new one rolls again). */
  private brushAt = new Map<number, number>();
  /** Something jumped out: the handler starts the fight. */
  private ambushes = new Set<number>();
  /** No ambush until then (a short calm after every fight). */
  private calmUntil = new Map<number, number>();

  /** Walked into a bush / cobweb tile (each new one): maybe something wakes up. */
  private brushStep(p: OnlinePlayer, L: ReturnType<typeof roomLayout>) {
    const pos = p.lab!;
    const T = this.cfg.tile;
    const i = Math.floor(pos.y / T) * L.w + Math.floor(pos.x / T);
    if (!L.brush.has(i)) return void this.brushAt.delete(p.id);
    if (this.brushAt.get(p.id) === i) return;
    this.brushAt.set(p.id, i);
    if (this.clock() < (this.calmUntil.get(p.id) ?? 0) || this.inFight(p)) return;
    if (this.rand() < this.cfg.brush.chance) this.ambushes.add(p.id);
  }

  /** Did something jump out of the brush at this player (since the last check)? */
  takeAmbush(p: OnlinePlayer): boolean {
    return this.ambushes.delete(p.id);
  }

  /** A fight ended for this player: a short calm, and one fight less on their drink. */
  battleDone(p: OnlinePlayer) {
    this.calmUntil.set(p.id, this.clock() + this.cfg.brush.graceSec * 1000);
    this.ambushes.delete(p.id);
    const s = this.state(p);
    if (!s.drink) return;
    const before = this.stats(p).hp;
    if (--s.drink.left <= 0) {
      if (s.hp !== undefined) this.hp(p);
      delete s.drink;
      this.maxHpChanged(p, before);
    }
    this.save(p);
  }

  // ---------------------------------------------------------------- 🛒 the merchant, gear, potions
  /** Standing by the merchant (the entrance hall, or a rest chamber)? */
  private atMerchant(p: OnlinePlayer): boolean {
    const pos = p.lab;
    if (!pos || this.inFight(p)) return false;
    const room = this.floor(pos.floor).rooms[pos.room];
    if (!((pos.floor === 0 && room.kind === 'start') || room.kind === 'rest')) return false;
    const f = this.floor(pos.floor);
    return this.near(pos, roomLayout(this.cfg, f, room).spot.merchant, 2.6);
  }

  /** Pay Syiling: carried first (it's at risk anyway), then banked. */
  private pay(s: LabSave, price: number) {
    if (s.carried + s.coins < price) throw new GameError(`That's ${price} Syiling. You have ${s.carried + s.coins}.`);
    const fromCarried = Math.min(s.carried, price);
    s.carried -= fromCarried;
    s.coins -= price - fromCarried;
  }

  /** Buy gear (once; you wear it at once if the slot is empty or it's better) or potions. */
  buy(p: OnlinePlayer, id: string, n = 1): string {
    if (!this.atMerchant(p)) throw new GameError(`Buy from ${this.cfg.merchant.name}: in the entrance hall or a rest chamber.`);
    const s = this.state(p);
    const g = labGear(this.cfg, id);
    if (g) {
      if (s.owned.includes(g.id)) throw new GameError(`You already have ${g.name}.`);
      if (s.deepest < g.minFloor) throw new GameError(`${g.name} is sold once you've reached floor ${g.minFloor + 1}.`);
      this.pay(s, g.price);
      s.owned.push(g.id);
      const cur = labGear(this.cfg, s.gear[g.slot]);
      const wear = !cur || g.tier > cur.tier;
      const before = this.stats(p).hp;
      if (s.hp !== undefined) this.hp(p);
      if (wear) s.gear[g.slot] = g.id;
      this.maxHpChanged(p, before);
      this.save(p);
      return `🛒 ${g.name}${wear ? ' · now wearing it' : ''}`;
    }
    const pot = labPotion(this.cfg, id);
    if (!pot) throw new GameError("The merchant doesn't sell that.");
    const have = s.potions[pot.id] ?? 0;
    const room = this.cfg.potions.max - have;
    if (room <= 0) throw new GameError(`You can carry ${this.cfg.potions.max} ${pot.name} at most.`);
    const k = Math.min(n, room);
    this.pay(s, pot.price * k);
    s.potions[pot.id] = have + k;
    this.save(p);
    return `🛒 ${pot.icon} ${pot.name} ×${k}`;
  }

  /** Wear a piece you own (null: take that slot off). Not in a fight. */
  equip(p: OnlinePlayer, slot: LabSlot, id: string | null) {
    if (this.inFight(p)) throw new GameError("Not in the middle of a fight!");
    const s = this.state(p);
    const before = this.stats(p).hp;
    if (s.hp !== undefined) this.hp(p); // bring healing up to date first
    if (id === null) delete s.gear[slot];
    else {
      const g = labGear(this.cfg, id);
      if (!g || g.slot !== slot) throw new GameError("That doesn't go there.");
      if (!s.owned.includes(g.id)) throw new GameError("You don't have that yet.");
      s.gear[slot] = g.id;
    }
    this.maxHpChanged(p, before);
    this.save(p);
  }

  /** Gear changed max HP: more max → that much more HP now; less → HP stays within it. */
  private maxHpChanged(p: OnlinePlayer, before: number) {
    const s = this.state(p);
    const after = this.stats(p).hp;
    if (s.hp === undefined) return;
    s.hp = Math.min(after, s.hp + Math.max(0, after - before));
  }

  potionCount(p: OnlinePlayer, id: string): number {
    return this.state(p).potions[id] ?? 0;
  }

  /** Take used potions out of the bag (after a battle round). */
  consume(p: OnlinePlayer, id: string) {
    const s = this.state(p);
    const n = (s.potions[id] ?? 0) - 1;
    if (n > 0) s.potions[id] = n;
    else delete s.potions[id];
    this.save(p);
  }

  /** A potion out of a fight: a heal, or 🧵 home. `left`: you're out (back in town). */
  useItem(p: OnlinePlayer, id: string): { text: string; left?: boolean } {
    const pot = labPotion(this.cfg, id);
    if (!pot) throw new GameError('Unknown potion.');
    if (!p.lab) throw new GameError('Use it in the labyrinth.');
    if (this.inFight(p)) throw new GameError('Use it from the 🧪 Items button in the fight.');
    if (this.potionCount(p, id) < 1) throw new GameError(`You have no ${pot.name}.`);
    if (pot.home) {
      this.consume(p, id);
      const carried = this.state(p).carried;
      this.leave(p, true);
      return { text: `🧵 ${pot.name}: back to town.${carried ? ` Banked ${carried} Syiling.` : ''}`, left: true };
    }
    if (pot.heal) {
      const max = this.stats(p).hp;
      const hp = this.hp(p);
      if (hp >= max) throw new GameError("You're already at full HP.");
      this.setHp(p, hp + max * pot.heal);
      this.consume(p, id);
      return { text: `${pot.icon} ${pot.name}: +${this.hp(p) - hp} HP` };
    }
    throw new GameError(`${pot.name} only works in a fight.`);
  }

  /** Current HP (healing a little for the time spent out of a fight since last asked). */
  hp(p: OnlinePlayer): number {
    const s = this.state(p);
    const max = this.stats(p).hp;
    const now = this.clock();
    if (s.hp === undefined) s.hp = max;
    if (!this.inFight(p) && s.hpAt !== undefined && s.hp < max) s.hp = Math.min(max, s.hp + max * this.cfg.player.regenPer10s * ((now - s.hpAt) / 10_000));
    s.hp = Math.min(max, s.hp);
    s.hpAt = now;
    return Math.max(0, Math.round(s.hp));
  }

  setHp(p: OnlinePlayer, hp: number) {
    const s = this.state(p);
    s.hp = Math.max(0, Math.min(this.stats(p).hp, hp));
    s.hpAt = this.clock();
  }

  /** 👹 Is this floor's boss waiting here for this player (its stairs room, not beaten yet)? */
  bossHere(p: OnlinePlayer): boolean {
    const pos = p.lab;
    if (!pos) return false;
    return this.floor(pos.floor).rooms[pos.room].kind === 'boss' && !this.state(p).bosses.includes(pos.floor);
  }

  /** Does this room have a monster group (or the boss) waiting for this player? */
  monstersHere(p: OnlinePlayer): boolean {
    const pos = p.lab;
    if (!pos) return false;
    if (this.bossHere(p)) return true;
    const room = this.floor(pos.floor).rooms[pos.room];
    if (!room.monsters) return false;
    const at = this.state(p).cleared[`${pos.floor}:${pos.room}`];
    return at === undefined || this.clock() - at > this.cfg.battle.respawnMin * 60_000;
  }

  /** Beat the group here: Syiling (carried) and the room stays quiet for a while. Beat the boss:
   *  the stairs down open for good. */
  won(p: OnlinePlayer, floor: number, room: number, coins: number, boss = false, ambush = false) {
    const s = this.state(p);
    if (boss) {
      if (!s.bosses.includes(floor)) s.bosses.push(floor);
    } else if (!ambush) s.cleared[`${floor}:${room}`] = this.clock(); // (the room's own group stays)
    s.carried += coins;
    this.save(p);
  }

  /** Fell in battle: lose part of the carried coins, wake at your save point, healed. */
  fell(p: OnlinePlayer): number {
    const s = this.state(p);
    const lost = Math.floor(s.carried * this.cfg.deathLoss);
    s.carried -= lost;
    const save = s.save.room < 0 ? { floor: 0, room: this.floor(0).start } : s.save;
    this.place(p, save.floor, save.room, null);
    this.setHp(p, this.stats(p).hp);
    this.see(p);
    this.save(p);
    return lost;
  }

  /** Ran away: back through the door you came in by (or stay put if there isn't one). */
  fled(p: OnlinePlayer) {
    const pos = p.lab;
    if (!pos?.from) return;
    this.place(p, pos.floor, pos.from.room, pos.from.by);
    this.save(p);
  }

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
    this.brushAt.delete(id);
    this.ambushes.delete(id);
    this.calmUntil.delete(id);
  }

  self(p: OnlinePlayer): LabSelf {
    const s = this.state(p);
    const save = s.save.room < 0 ? { floor: 0, room: this.floor(0).start } : s.save;
    const st = this.stats(p);
    return {
      coins: s.coins, carried: s.carried, save, deepest: s.deepest, keys: [...s.keys], unlocked: [...s.unlocked], looted: [...s.looted], inside: !!p.lab,
      hp: this.hp(p), maxHp: st.hp, boost: Math.min(this.cfg.teman.max, this.temanBoost(p)),
      gear: { ...s.gear }, owned: [...s.owned], potions: { ...s.potions }, stats: st, bosses: [...s.bosses],
      drink: s.drink ? { ...s.drink } : null,
    };
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
    if (!pos || this.inFight(p)) return false;
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
    this.brushStep(p, L);
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
    const from = { room: pos.room, by: dir };
    this.place(p, pos.floor, d.to, LAB_OPPOSITE[dir]);
    p.lab!.from = from;
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
      this.setHp(p, this.stats(p).hp);
      this.save(p);
      return { text: `🔥 Rested. HP full. You'll come back here.${banked ? ` Banked ${banked} Syiling.` : ''}`, view: this.view(p) };
    }
    if (what === 'down') {
      if (room.kind !== 'boss') throw new GameError('No stairs down here.');
      if (!this.near(pos, L.spot.feature)) throw new GameError('Walk up to the stairs.');
      if (pos.floor + 1 >= this.cfg.floors.length) throw new GameError("This is the bottom. There's nowhere deeper.");
      if (!s.bosses.includes(pos.floor)) throw new GameError(`👹 ${this.cfg.bosses[pos.floor]?.name ?? 'The boss'} guards the stairs. Beat it first.`);
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
    if (this.inFight(p)) throw new GameError("You're in a fight!");
    return p.lab;
  }

  /** Where you are (reading only: fine during a fight). */
  private inside(p: OnlinePlayer) {
    if (!p.lab) throw new GameError("You're not in the labyrinth.");
    return p.lab;
  }

  private near(pos: { x: number; y: number }, tile: [number, number], reach = REACH) {
    const T = this.cfg.tile;
    return Math.hypot(pos.x - (tile[0] + 0.5) * T, pos.y - (tile[1] + 0.5) * T) <= reach * T;
  }

  private coins(floor: number, mult: number): number {
    const c = this.cfg.coins;
    const base = c.chest * (1 + c.perFloor * floor) * mult;
    return Math.max(1, Math.round(base * (1 - c.spread + this.rand() * c.spread * 2)));
  }

  private see(p: OnlinePlayer) {
    const pos = this.inside(p);
    const s = this.state(p);
    s.seen[pos.floor] = seenAdd(s.seen[pos.floor] ?? '', pos.room);
  }

  view(p: OnlinePlayer, others: LabRoomView['others'] = []): LabRoomView {
    const pos = this.inside(p);
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
