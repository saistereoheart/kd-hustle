// 🗝️ Labirin Purba (docs/LABYRINTH.md): your save down there, where you are, and what you can do in
// a room. The floors themselves are built from fixed seeds by shared/src/lab/generate.ts, the same
// on every machine. The server checks every step: a door must be next to you (and open), a chest
// must be in your room and not opened yet today, and so on.
import {
  LAB_OPPOSITE, dayKey, weekKey, classMods, itemName, itemScrap, resolveWorn, rollClass, rollLoot, wornBonus, type LabItem, labElement, labMove, labSkill, labFloor, labGear, labLevel, labPointsFree, labPotion, labStats, labUltimate, treeBlock, rollSpellBook, roomLayout, seenAdd,
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
  /** Keys held (`${floor}:${key index}`); any one opens any locked treasure door on its floor. */
  keys: string[];
  /** Keys spent on a door (so their room stays empty). */
  used: string[];
  unlocked: string[];
  looted: string[];
  /** Where you were when you last left / dropped (not used to resume: you come back at `save`). */
  last?: { floor: number; room: number };
  /** ⚔️ Your HP down here (it carries over between fights; campfires and time heal it). */
  hp?: number;
  /** When `hp` was last brought up to date (out-of-fight healing). */
  hpAt?: number;
  /** 🔷 Mana (carries over like HP) and when it was last brought up to date. */
  mana?: number;
  manaAt?: number;
  /** 🔥 The element whose 💥 skill is equipped (its 📜 ultimate comes with it). */
  element?: string;
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
  /** 📈 Labirin XP (levels and skill points come from it) and skill ranks learned. */
  xp: number;
  skills: Record<string, number>;
  /** 📜 Spell books owned (each powers up its element's ultimate); `book` is from before elements
   *  (no longer used); the day of the last tavern roll. */
  books: string[];
  book?: string;
  rollDay?: string;
  /** 📦 Crates broken: `${floor}:${room}:${i}` → when (they're back `crates.respawnMin` later). */
  crates?: Record<string, number>;
  /** 🪨 Floors whose secret stash you've found. */
  secrets?: number[];
  /** 🐲 World boss fights this week: the week (its Monday) and how many. */
  wbWeek?: string;
  wbCount?: number;
  /** 💎 Diamonds; 🎁 dropped gear (worn as `#uid` in `gear`) and the next uid. */
  diamonds?: number;
  items?: LabItem[];
  nextUid?: number;
  /** 🎭 The class worn and the non-basic classes owned. */
  cls?: string;
  classes?: string[];
  /** 🌳 Skill-tree version (1: the tree; older saves had their skill points given back once). */
  treeV?: number;
  /** 💥 Extra element skills learned (feedback #29/#30), and the one picked for each element. */
  moves?: string[];
  picks?: Record<string, string>;
}

export function emptyLab(): LabSave {
  return { coins: 0, carried: 0, save: { floor: 0, room: -1 }, deepest: 0, seen: {}, chests: {}, keys: [], used: [], unlocked: [], looted: [], cleared: {}, gear: {}, owned: [], potions: {}, bosses: [], xp: 0, skills: {}, books: [] };
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
  /** 🌀 Your abyss stats: (base from level + skill tree, + Labirin gear) × (1 + buffs: class, drink, Teman, tree %). */
  stats(p: OnlinePlayer) {
    const s = this.state(p);
    return labStats(this.cfg, {
      level: labLevel(this.cfg, s.xp).level, ranks: s.skills, gear: wornBonus(this.cfg, s.gear, s.items),
      cls: s.cls, drink: s.drink?.id, teman: this.temanBoost(p),
    });
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
      if (this.cfg.gear.tiers[g.tier]?.dropOnly) throw new GameError(`${g.name} isn't sold: only the 🐲 world boss drops it.`);
      if (s.owned.includes(g.id)) throw new GameError(`You already have ${g.name}.`);
      if (s.deepest < g.minFloor) throw new GameError(`${g.name} is sold once you've reached floor ${g.minFloor + 1}.`);
      this.pay(s, g.price);
      s.owned.push(g.id);
      const cur = resolveWorn(this.cfg, s.gear[g.slot], s.items)?.piece;
      const wear = !cur || g.tier > cur.tier;
      const before = this.stats(p).hp;
      if (s.hp !== undefined) this.hp(p);
      if (wear) s.gear[g.slot] = g.id;
      this.maxHpChanged(p, before);
      this.save(p);
      return `🛒 ${g.name}${wear ? ' · now wearing it' : ''}`;
    }
    const book = this.cfg.spells.list.find((b) => b.id === id);
    if (book) {
      if (book.dropOnly) throw new GameError(`${book.name} isn't sold: only the 🐲 world boss drops it.`);
      if (book.rollOnly) throw new GameError(`${book.name} isn't sold: only the tavern's daily roll has it.`);
      if (s.books.includes(book.id)) throw new GameError(`You already have ${book.name}.`);
      if (s.deepest < book.minFloor) throw new GameError(`${book.name} is sold once you've reached floor ${book.minFloor + 1}.`);
      this.pay(s, book.price);
      s.books.push(book.id);
      this.save(p);
      return `🛒 ${book.icon} ${book.name} · ${this.bookLine(book.element)}`;
    }
    const mv = labMove(this.cfg, id);
    if (mv) {
      const { el, move } = mv;
      if ((s.moves ?? []).includes(move.id)) throw new GameError(`You already know ${move.name}.`);
      if (move.boss !== undefined) {
        const boss = this.cfg.bosses[Math.min(move.boss, this.cfg.bosses.length - 1)];
        if (!s.bosses.includes(move.boss)) throw new GameError(`Only ${boss.icon} ${boss.name} (floor ${move.boss + 1}) can teach ${move.name}: beat it first.`);
      } else if (s.deepest < move.minFloor) throw new GameError(`${move.name} is taught once you've reached floor ${move.minFloor + 1}.`);
      this.pay(s, move.price);
      s.moves = [...(s.moves ?? []), move.id];
      // Learned: it's your skill now (switch back in 🔥 Elements whenever you like).
      s.element = el.id;
      s.picks = { ...(s.picks ?? {}), [el.id]: move.id };
      this.save(p);
      return `📖 ${el.icon} ${move.name} learned and equipped (🔷 ${move.mana} mana)`;
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
    else if (id.startsWith('#')) {
      // 🎁 A dropped item.
      const w = resolveWorn(this.cfg, id, s.items);
      if (!w || w.piece.slot !== slot) throw new GameError("That doesn't go there.");
      s.gear[slot] = id;
    } else {
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
    if (pot.mana) {
      const max = this.stats(p).mana;
      const m = this.mana(p);
      if (m >= max) throw new GameError('Your mana is already full.');
      this.setMana(p, m + max * pot.mana);
      this.consume(p, id);
      return { text: `${pot.icon} ${pot.name}: +${this.mana(p) - m} 🔷 mana` };
    }
    throw new GameError(`${pot.name} only works in a fight.`);
  }

  // ---------------------------------------------------------------- 🔥 the hall's campfire
  /** Players sitting by the campfire (since their HP was last brought up to date). */
  private warm = new Set<number>();

  /** Close to the entrance hall's campfire? */
  atFire(p: OnlinePlayer): boolean {
    const pos = p.lab;
    if (!pos || pos.floor !== 0 || this.inFight(p)) return false;
    const f = this.floor(0);
    const L = roomLayout(this.cfg, f, f.rooms[pos.room]);
    return !!L.hall && this.near(pos, L.hall.fire, this.cfg.player.campfire.reach);
  }

  /** After a step: sat down by the fire or walked off (HP is settled at the old rate first). */
  private fireStep(p: OnlinePlayer) {
    const w = this.atFire(p);
    if (w === this.warm.has(p.id)) return;
    this.hp(p);
    this.mana(p);
    if (w) this.warm.add(p.id);
    else this.warm.delete(p.id);
  }

  /** Current HP (healing a little for the time spent out of a fight since last asked; faster by the campfire). */
  hp(p: OnlinePlayer): number {
    const s = this.state(p);
    const max = this.stats(p).hp;
    const now = this.clock();
    if (s.hp === undefined) s.hp = max;
    if (!this.inFight(p) && s.hpAt !== undefined && s.hp < max) {
      const sec = (now - s.hpAt) / 1000;
      const fire = this.cfg.player.campfire;
      const warm = this.warm.has(p.id) && this.atFire(p) ? (fire.hp / fire.everySec) * sec : 0;
      const k = 1 + this.stats(p).regen; // 🌿 Pulih Pantas
      s.hp = Math.min(max, s.hp + (max * this.cfg.player.regenPer10s * (sec / 10) + warm) * k);
    }
    s.hp = Math.min(max, s.hp);
    s.hpAt = now;
    return Math.max(0, Math.round(s.hp));
  }

  setHp(p: OnlinePlayer, hp: number) {
    const s = this.state(p);
    s.hp = Math.max(0, Math.min(this.stats(p).hp, hp));
    s.hpAt = this.clock();
  }

  /** 🔷 Current mana (a little back for the time spent out of a fight since last asked; faster by the campfire). */
  mana(p: OnlinePlayer): number {
    const s = this.state(p);
    const max = this.stats(p).mana;
    const now = this.clock();
    if (s.mana === undefined) s.mana = max;
    if (!this.inFight(p) && s.manaAt !== undefined && s.mana < max) {
      const sec = (now - s.manaAt) / 1000;
      const m = this.cfg.player.mana;
      const fire = this.cfg.player.campfire;
      const warm = this.warm.has(p.id) && this.atFire(p) ? (m.campfire / fire.everySec) * sec : 0;
      s.mana = s.mana + max * m.regenPer10s * (sec / 10) + warm;
    }
    s.mana = Math.min(max, s.mana);
    s.manaAt = now;
    return Math.max(0, Math.floor(s.mana));
  }

  setMana(p: OnlinePlayer, mana: number) {
    const s = this.state(p);
    s.mana = Math.max(0, Math.min(this.stats(p).mana, mana));
    s.manaAt = this.clock();
  }

  /** Back to full HP and mana (resting, falling). */
  private refill(p: OnlinePlayer) {
    const st = this.stats(p);
    this.setHp(p, st.hp);
    this.setMana(p, st.mana);
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
  won(p: OnlinePlayer, floor: number, room: number, coins: number, boss = false, ambush = false, xp = 0, monsters = 0): { coins: number; xp: number; levelUp?: number; drops: string[] } {
    const s = this.state(p);
    if (boss) {
      if (!s.bosses.includes(floor)) s.bosses.push(floor);
    } else if (!ambush) s.cleared[`${floor}:${room}`] = this.clock(); // (the room's own group stays)
    const got = Math.round(coins * (1 + this.stats(p).coins)); // 🪙 Untung Purba, 🎭 Pencuri
    s.carried += got;
    // 🎁 Loot: 💎 diamonds, maybe a gear drop, and (floor bosses) the limited class.
    const drops: string[] = [];
    if (monsters > 0) {
      const loot = rollLoot(this.cfg, floor, monsters, boss, this.rand);
      if (loot.diamonds) (s.diamonds = (s.diamonds ?? 0) + loot.diamonds), drops.push(`💎 +${loot.diamonds}`);
      if (loot.item) drops.push(`🎁 ${this.addItem(s, loot.item)}`);
      if (boss) drops.push(...this.classDrop(s, 'boss'));
    }
    // 📈 XP: a new level brings a skill point (and tops up the HP the new level's skills might add later).
    const before = labLevel(this.cfg, s.xp).level;
    s.xp += xp;
    const after = labLevel(this.cfg, s.xp).level;
    this.save(p);
    return { coins: got, xp, levelUp: after > before ? after : undefined, drops };
  }

  // ---------------------------------------------------------------- 🎁 loot, 💎 diamonds, 🎭 classes
  /** Into the bag; its name. */
  private addItem(s: LabSave, it: Omit<LabItem, 'uid'>): string {
    s.items ??= [];
    s.nextUid = (s.nextUid ?? 0) + 1;
    s.items.push({ ...it, uid: s.nextUid });
    return itemName(this.cfg, it);
  }

  /** A limited class drop (if lucky and not owned yet). */
  private classDrop(s: LabSave, from: 'boss' | 'worldBoss'): string[] {
    const c = this.cfg.classes.find((x) => x.source === 'drop' && x.from === from);
    const chance = from === 'boss' ? this.cfg.loot.classDrop.boss : this.cfg.loot.classDrop.worldBoss;
    if (!c || (s.classes ?? []).includes(c.id) || this.rand() >= chance) return [];
    (s.classes ??= []).push(c.id);
    return [`🎭 Class: ${c.icon} ${c.name}!`];
  }

  /** Scrap a dropped item (not one you're wearing) for diamonds. */
  scrap(p: OnlinePlayer, uid: number): string {
    if (this.inFight(p)) throw new GameError('Not in the middle of a fight!');
    const s = this.state(p);
    const it = (s.items ?? []).find((x) => x.uid === uid);
    if (!it) throw new GameError('No such item.');
    if (Object.values(s.gear).includes(`#${uid}`)) throw new GameError("You're wearing it: take it off first.");
    const d = itemScrap(this.cfg, it);
    s.items = s.items!.filter((x) => x.uid !== uid);
    s.diamonds = (s.diamonds ?? 0) + d;
    this.save(p);
    return `♻️ ${itemName(this.cfg, it)} scrapped: +${d} 💎`;
  }

  /** Classes you own (the basic ones and what you've bought, rolled or found). */
  ownedClasses(s: LabSave): string[] {
    return [...this.cfg.classes.filter((c) => c.source === 'basic').map((c) => c.id), ...(s.classes ?? [])];
  }

  /** Wear a class you own (not in a fight). */
  setClass(p: OnlinePlayer, id: string): string {
    if (this.inFight(p)) throw new GameError('Not in the middle of a fight!');
    const c = this.cfg.classes.find((x) => x.id === id);
    if (!c) throw new GameError('No such class.');
    const s = this.state(p);
    if (!this.ownedClasses(s).includes(id)) throw new GameError(`You don't have ${c.name} yet.`);
    const before = this.stats(p).hp;
    if (s.hp !== undefined) this.hp(p);
    s.cls = id;
    this.maxHpChanged(p, before);
    this.save(p);
    return `🎭 ${c.icon} ${c.name}: ${c.desc}`;
  }

  /** Buy a shop class (at the merchant). It's worn at once. */
  buyClass(p: OnlinePlayer, id: string): string {
    if (!this.atMerchant(p)) throw new GameError(`Classes are sold by ${this.cfg.merchant.name}: in the entrance hall or a rest chamber.`);
    const c = this.cfg.classes.find((x) => x.id === id);
    if (!c || c.source !== 'shop') throw new GameError("That class isn't for sale.");
    const s = this.state(p);
    if (this.ownedClasses(s).includes(id)) throw new GameError(`You already have ${c.name}.`);
    this.pay(s, c.price ?? 0);
    (s.classes ??= []).push(id);
    this.save(p);
    return this.setClass(p, id);
  }

  /** 🎲 Roll for a class with diamonds: a new roll-class, or some diamonds back. */
  classRoll(p: OnlinePlayer): string {
    if (this.inFight(p)) throw new GameError('Not in the middle of a fight!');
    const r = this.cfg.loot.classRoll;
    const s = this.state(p);
    if ((s.diamonds ?? 0) < r.price) throw new GameError(`A class roll costs ${r.price} 💎 (you have ${s.diamonds ?? 0}).`);
    const left = this.cfg.classes.filter((c) => c.source === 'roll' && !(s.classes ?? []).includes(c.id));
    if (!left.length) throw new GameError('You already have every class the roll can give.');
    s.diamonds = (s.diamonds ?? 0) - r.price;
    const c = rollClass(this.cfg, s.classes ?? [], this.rand);
    if (!c) {
      s.diamonds += r.refund;
      this.save(p);
      return `🎲 No class this time… +${r.refund} 💎 back.`;
    }
    (s.classes ??= []).push(c.id);
    this.save(p);
    return `🎲 New class: ${c.icon} ${c.name}! ${c.desc}`;
  }

  // ---------------------------------------------------------------- 🐲 the world boss
  /** Fights left this week. */
  wbLeft(p: OnlinePlayer): number {
    const w = this.cfg.worldBoss;
    if (!w) return 0;
    const s = this.state(p);
    return s.wbWeek === weekKey(this.clock()) ? Math.max(0, w.perWeek - (s.wbCount ?? 0)) : w.perWeek;
  }

  /** Can this party call the world boss here? (Throws why not.) */
  wbCheck(players: OnlinePlayer[]) {
    const w = this.cfg.worldBoss;
    if (!w) throw new GameError('There is no world boss.');
    if (players.length < w.minParty) throw new GameError(`🐲 ${w.name} needs a party of at least ${w.minParty}. Invite someone (👥).`);
    const lead = players[0];
    const f0 = this.floor(0);
    for (const p of players) {
      if (!p.lab || p.lab.floor !== 0 || p.lab.room !== f0.start) throw new GameError(`Everyone in the party has to be in the entrance hall (${p.name} isn't).`);
      if (this.inFight(p)) throw new GameError(`${p.name} is in a fight.`);
      if (this.wbLeft(p) < 1) throw new GameError(`${p.name} has fought ${w.name} ${w.perWeek} times this week already (it resets on Monday).`);
    }
    void lead;
  }

  /** A world boss fight starts: it uses one of this week's tries. */
  wbSpend(p: OnlinePlayer) {
    const s = this.state(p);
    const wk = weekKey(this.clock());
    if (s.wbWeek !== wk) (s.wbWeek = wk), (s.wbCount = 0);
    s.wbCount = (s.wbCount ?? 0) + 1;
    this.save(p);
  }

  /** Beat the world boss: Syiling + XP, and the rare mythic drops (each rolled for this player). */
  wonWorld(p: OnlinePlayer): { coins: number; xp: number; levelUp?: number; drops: string[] } {
    const w = this.cfg.worldBoss!;
    const s = this.state(p);
    const got = this.won(p, 0, -1, w.coins, false, true, w.xp);
    const drops: string[] = [];
    s.diamonds = (s.diamonds ?? 0) + this.cfg.loot.diamond.worldBoss;
    drops.push(`💎 +${this.cfg.loot.diamond.worldBoss}`);
    drops.push(...this.classDrop(s, 'worldBoss'));
    // A 🐲 set piece: a random slot of the drop-only tier (one you don't have yet if you can).
    if (this.rand() < w.setChance) {
      const pieces = this.cfg.gear.slots.map((sl) => `${sl.id}_${w.set}`).filter((id) => labGear(this.cfg, id));
      const missing = pieces.filter((id) => !s.owned.includes(id));
      const pool = missing.length ? missing : pieces;
      const id = pool[Math.floor(this.rand() * pool.length)];
      const g = labGear(this.cfg, id);
      if (g && !s.owned.includes(id)) {
        s.owned.push(id);
        const cur = resolveWorn(this.cfg, s.gear[g.slot], s.items)?.piece;
        const before = this.stats(p).hp;
        if (s.hp !== undefined) this.hp(p);
        if (!cur || g.tier > cur.tier) s.gear[g.slot] = id;
        this.maxHpChanged(p, before);
        drops.push(`🐲 ${g.icon} ${g.name}`);
      } else if (g) {
        // Already own every piece: it melts into Syiling instead.
        s.carried += w.coins;
        drops.push(`🐲 ${g.name} (a spare: +${w.coins} Syiling)`);
      }
    }
    // 📜 The boss skill (a book).
    if (this.rand() < w.skillChance) {
      const book = this.cfg.spells.list.find((b) => b.id === w.skill);
      if (book && !s.books.includes(book.id)) {
        s.books.push(book.id);
        drops.push(`📜 ${book.icon} ${book.name}`);
      }
    }
    this.save(p);
    return { ...got, drops };
  }

  // ---------------------------------------------------------------- 📖 skills and 📜 spell books
  /** Learn one more rank of a skill (a free skill point; not in a fight). */
  learn(p: OnlinePlayer, id: string): string {
    if (this.inFight(p)) throw new GameError('Not in the middle of a fight!');
    const def = this.cfg.tree.nodes.find((k) => k.id === id);
    if (!def) throw new GameError('No such skill.');
    const s = this.state(p);
    const rank = s.skills[id] ?? 0;
    const why = treeBlock(this.cfg, s.skills, id, labPointsFree(this.cfg, s.xp, s.skills));
    if (why) throw new GameError(why);
    const before = this.stats(p).hp;
    if (s.hp !== undefined) this.hp(p);
    s.skills[id] = rank + 1;
    this.maxHpChanged(p, before);
    this.save(p);
    return `${def.icon} ${def.name} rank ${rank + 1}`;
  }

  /** Unlearn every skill at the merchant (for Syiling): the points come back. */
  respec(p: OnlinePlayer): string {
    if (!this.atMerchant(p)) throw new GameError(`${this.cfg.merchant.name} can help you unlearn your skills: in the entrance hall or a rest chamber.`);
    const s = this.state(p);
    if (!Object.values(s.skills).some((n) => n > 0)) throw new GameError("You haven't learned any skills yet.");
    this.pay(s, this.cfg.progress.respec);
    const before = this.stats(p).hp;
    if (s.hp !== undefined) this.hp(p);
    s.skills = {};
    this.maxHpChanged(p, before);
    this.save(p);
    return '📖 Skills unlearned: every point is free to spend again.';
  }

  /** 📜 "Use" a spell book you own: switch to its element (its ultimate comes with it). null: nothing to do. */
  wearBook(p: OnlinePlayer, id: string | null) {
    if (id === null) return;
    const s = this.state(p);
    const book = this.cfg.spells.list.find((b) => b.id === id);
    if (!book) throw new GameError('No such spell book.');
    if (!s.books.includes(id)) throw new GameError("You don't have that book.");
    if (book.element) this.setElement(p, book.element);
  }

  /** 🔥 Equip an element's 💥 skill (any time, even in a fight: it counts from your next pick). */
  setElement(p: OnlinePlayer, id: string, skill?: string): string {
    const e = this.cfg.elements.find((x) => x.id === id);
    if (!e) throw new GameError('No such element.');
    const s = this.state(p);
    if (skill !== undefined) {
      // The element's free skill (its own id), or an extra one you've learned.
      if (skill !== e.id) {
        const m = e.more.find((x) => x.id === skill);
        if (!m) throw new GameError("That isn't one of this element's skills.");
        if (!(s.moves ?? []).includes(m.id)) throw new GameError(`You haven't learned ${m.name} yet.`);
      }
      s.picks = { ...(s.picks ?? {}), [e.id]: skill };
    }
    s.element = e.id;
    this.save(p);
    const sk = labSkill(this.cfg, e.id, this.skillPick(s, e.id)).skill;
    return `${e.icon} ${sk.name} equipped · 📜 ${labUltimate(this.cfg, e.id, s.books).move}`;
  }

  /** 💥 The skill picked for an element (only if it's one you've learned; else its free one). */
  skillPick(s: LabSave, element = s.element): string | undefined {
    const id = element ? s.picks?.[element] : undefined;
    return id && (s.moves ?? []).includes(id) ? id : undefined;
  }

  /** What a newly bought book does for you. */
  private bookLine(element: string | undefined): string {
    const e = this.cfg.elements.find((x) => x.id === element);
    return e ? `powers up the ${e.icon} ${e.name} ultimate (equip ${e.icon} ${e.name} to use it)` : 'yours for good';
  }

  /** 🎲 The tavern's once-a-day roll: a spell book you don't have yet, or a free drink. */
  roll(p: OnlinePlayer): { text: string; book?: string } {
    const t = this.cfg.tavern;
    if (!this.atTavern(p)) throw new GameError(`The daily roll is at ${t.name}, in the entrance hall.`);
    const s = this.state(p);
    const today = dayKey(this.clock());
    if (s.rollDay === today) throw new GameError(`${t.keeper}: "Esok datang lagi! One roll a day."`);
    this.pay(s, this.cfg.spells.roll.price);
    s.rollDay = today;
    const book = rollSpellBook(this.cfg, s.books, this.rand);
    if (book) {
      s.books.push(book.id);
      this.save(p);
      return { text: `🎲 ${book.icon} ${book.name}! ${book.desc}`, book: book.id };
    }
    // No book: a drink on the house.
    const d = t.drinks[Math.floor(this.rand() * t.drinks.length)];
    const before = this.stats(p).hp;
    if (s.hp !== undefined) this.hp(p);
    s.drink = { id: d.id, left: d.battles };
    this.maxHpChanged(p, before);
    this.save(p);
    return { text: `🎲 No book today… ${t.keeper} pours you a free ${d.icon} ${d.name} (${d.desc}).` };
  }

  /** Fell in battle: lose part of the carried coins, wake at your save point, healed. */
  fell(p: OnlinePlayer): number {
    const s = this.state(p);
    const lost = Math.floor(s.carried * this.cfg.deathLoss);
    s.carried -= lost;
    const save = s.save.room < 0 ? { floor: 0, room: this.floor(0).start } : s.save;
    this.place(p, save.floor, save.room, null);
    this.refill(p);
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
      const saved = this.repos.playerData.load<Partial<LabSave>>(p.id, 'lab') ?? {};
      s = { ...emptyLab(), ...saved };
      // Older saves: each door was opened with its own key, so that key is spent.
      if (!saved.used) s.used = [...s.unlocked];
      // 🌳 The skill tree replaced the old skills: every point comes back once (spend them again).
      if (!saved.treeV) {
        s.skills = {};
        s.treeV = 1;
      }
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
    this.warm.delete(id);
    this.ambushes.delete(id);
    this.calmUntil.delete(id);
  }

  self(p: OnlinePlayer): LabSelf {
    const s = this.state(p);
    const save = s.save.room < 0 ? { floor: 0, room: this.floor(0).start } : s.save;
    const st = this.stats(p);
    return {
      coins: s.coins, carried: s.carried, save, deepest: s.deepest, keys: [...s.keys], used: [...s.used], unlocked: [...s.unlocked], looted: [...s.looted], inside: !!p.lab,
      hp: this.hp(p), maxHp: st.hp, boost: Math.min(this.cfg.teman.max, this.temanBoost(p)),
      gear: { ...s.gear }, owned: [...s.owned], potions: { ...s.potions }, stats: st, bosses: [...s.bosses],
      drink: s.drink ? { ...s.drink } : null,
      ...(() => {
        const lv = labLevel(this.cfg, s.xp);
        return { xp: s.xp, level: lv.level, xpInto: lv.into, xpNeed: lv.need, points: labPointsFree(this.cfg, s.xp, s.skills) };
      })(),
      skills: { ...s.skills }, books: [...s.books], rolled: s.rollDay === dayKey(this.clock()),
      mana: this.mana(p), maxMana: st.mana, element: labElement(this.cfg, s.element).id, wbLeft: this.wbLeft(p),
      moves: [...(s.moves ?? [])], skill: labSkill(this.cfg, s.element, this.skillPick(s, labElement(this.cfg, s.element).id)).skill.id,
      diamonds: s.diamonds ?? 0, items: (s.items ?? []).map((x) => ({ ...x })), cls: s.cls ?? this.cfg.classes[0]?.id ?? '', classes: this.ownedClasses(s),
      ...(() => {
        const u = labUltimate(this.cfg, s.element, s.books);
        return { ultimate: u.id, book: u.id.startsWith('ult_') ? null : u.id };
      })(),
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
    // 🌀 You come through the portal: you appear just in front of it.
    p.lab = { floor: target.floor, room: target.room, x: (L.spot.portal[0] + 0.5) * T, y: (L.spot.portal[1] + 1.6) * T, dir: 'down', moving: false, at: this.clock() };
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
    // 🌀 Out through the portal: walk up to it.
    if (!anywhere && !this.near(pos, roomLayout(this.cfg, this.floor(pos.floor), room).spot.portal, 2.4)) throw new GameError('Walk into the 🌀 portal to leave.');
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
    this.fireStep(p);
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
        // Any key from this floor fits (its own key first, if you hold it).
        const key = s.keys.includes(k) ? k : s.keys.find((x) => x.startsWith(`${pos.floor}:`));
        if (!key) throw new GameError('🔒 Locked. Find a 🗝️ key on this floor: any key opens it.');
        s.keys = s.keys.filter((x) => x !== key);
        s.used.push(key);
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
      if (s.keys.includes(k) || s.used.includes(k)) throw new GameError('You already took this key.');
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
      this.refill(p);
      this.save(p);
      return { text: `🔥 Rested. HP and mana full. You'll come back here.${banked ? ` Banked ${banked} Syiling.` : ''}`, view: this.view(p) };
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
    if (what === 'crate') {
      // The nearest crate in reach.
      const crates = L.props.filter((x) => x.kind === 'crate');
      let best = -1, bd = Infinity;
      crates.forEach((c, i) => {
        const d = Math.hypot(pos.x - (c.at[0] + 0.5) * this.cfg.tile, pos.y - (c.at[1] + 0.5) * this.cfg.tile);
        if (d < bd) (bd = d), (best = i);
      });
      if (best < 0 || !this.near(pos, crates[best].at)) throw new GameError('Walk up to a crate.');
      const k = `${pos.floor}:${room.id}:${best}`;
      const cr = this.cfg.crates;
      s.crates ??= {};
      if (this.clock() - (s.crates[k] ?? -Infinity) < cr.respawnMin * 60_000) throw new GameError('Just splinters now.');
      s.crates[k] = this.clock();
      // Old ones that are back don't need remembering.
      for (const [key, at] of Object.entries(s.crates)) if (this.clock() - at >= cr.respawnMin * 60_000) delete s.crates[key];
      s.crates[k] = this.clock();
      const r = this.rand();
      let text = '📦 Smash! Nothing inside but dust.';
      if (r < cr.potionChance && cr.potions.length) {
        const id = cr.potions[Math.floor(this.rand() * cr.potions.length)];
        const pot = labPotion(this.cfg, id);
        if (pot && (s.potions[id] ?? 0) < this.cfg.potions.max) {
          s.potions[id] = (s.potions[id] ?? 0) + 1;
          text = `📦 Smash! A ${pot.icon} ${pot.name} was inside.`;
        } else {
          const coins = Math.max(1, Math.round(this.coins(pos.floor, cr.coinMult)));
          s.carried += coins;
          text = `📦 Smash! +${coins} Syiling Purba`;
        }
      } else if (r < cr.potionChance + cr.coinChance) {
        const coins = Math.max(1, Math.round(this.coins(pos.floor, cr.coinMult)));
        s.carried += coins;
        text = `📦 Smash! +${coins} Syiling Purba`;
      }
      this.save(p);
      return { text, view: this.view(p) };
    }
    if (what === 'secret') {
      const sec = L.props.find((x) => x.kind === 'secret');
      if (!sec) throw new GameError('Nothing hidden here… or is there?');
      if (!this.near(pos, sec.at, 2.2)) throw new GameError('Walk up to the cracked rock.');
      s.secrets ??= [];
      if (s.secrets.includes(pos.floor)) throw new GameError('The hollow behind the rock is empty now.');
      s.secrets.push(pos.floor);
      const coins = this.coins(pos.floor, this.cfg.crates.secretMult);
      s.carried += coins;
      this.save(p);
      return { text: `🪨 The cracked rock gives way: a hidden stash! +${coins} Syiling Purba`, view: this.view(p) };
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
    const now = this.clock();
    const ms = this.cfg.crates.respawnMin * 60_000;
    const broken = Object.entries(s.crates ?? {})
      .filter(([k, at]) => k.startsWith(`${pos.floor}:${room.id}:`) && now - at < ms)
      .map(([k]) => Number(k.split(':')[2]));
    return { floor: pos.floor, room: pos.room, x: pos.x, y: pos.y, dir: pos.dir, seen: s.seen[pos.floor] ?? '', chestDone, broken, secretFound: (s.secrets ?? []).includes(pos.floor), others, self: this.self(p) };
  }
}

/** The socket.io room for everyone in one labyrinth room. */
export function labRoomKey(floor: number, room: number) {
  return `lab:${floor}:${room}`;
}
