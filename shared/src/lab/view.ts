// 🗝️ Labirin Purba: what the server tells clients (and the zod schemas for what clients send).
import { z } from 'zod';
import type { Appearance, Direction } from '../character/appearance';
import type { Cosmetics } from '../protocol/messages';
import type { LabDir } from './generate';
import type { LabFighter, LabOutcome } from './battle';
import type { LabSlot } from './gear';

/** Someone else in the same room (drawn walking about). */
export interface LabOther {
  id: number;
  name: string;
  level: number;
  appearance: Appearance;
  cosmetics: Cosmetics;
  x: number;
  y: number;
  dir: Direction;
}

/** Your labyrinth save, as the phone app and the HUD show it. */
export interface LabSelf {
  /** 🪙 banked (safe) and carried (half is lost if your party falls). */
  coins: number;
  carried: number;
  /** Where you come back to: a rest chamber (floor, room) or the entrance hall (0, start). */
  save: { floor: number; room: number };
  /** Deepest floor reached (0-based). */
  deepest: number;
  /** Keys held: `${floor}:${key index}` (any key opens any locked treasure door on its floor). */
  keys: string[];
  /** Keys already spent on a door (their room stays empty): `${floor}:${key index}`. */
  used: string[];
  /** Treasure rooms opened (their door stays open for you): `${floor}:${treasure index}`. */
  unlocked: string[];
  /** Treasure already taken: `${floor}:${treasure index}`. */
  looted: string[];
  /** In the labyrinth right now. */
  inside: boolean;
  /** ⚔️ HP down here (it carries over between fights). */
  hp: number;
  maxHp: number;
  /** 🐾 Your lead Teman's boost (0.03 = +3% ATK, DEF and HP). */
  boost: number;
  /** ⚔️ Gear: what you wear (slot → gear id) and everything you own. */
  gear: Partial<Record<LabSlot, string>>;
  owned: string[];
  /** 🧪 Potions carried: id → how many. */
  potions: Record<string, number>;
  /** Your fighting stats with all of that. */
  stats: { hp: number; atk: number; def: number; spd: number; crit: number; block: number };
  /** 👹 Floors whose boss you've beaten (0-based). */
  bosses: number[];
  /** 🍵 The tavern drink working on you (and how many more fights it lasts), or null. */
  drink: { id: string; left: number } | null;
  /** 📈 Labirin XP, level (and XP into / needed for the next), free skill points and skill ranks. */
  xp: number;
  level: number;
  xpInto: number;
  xpNeed: number;
  points: number;
  skills: Record<string, number>;
  /** 📜 Spell books owned, the one worn (its ultimate), and whether today's tavern roll is used. */
  books: string[];
  book: string | null;
  rolled: boolean;
}

/** The room you're in, and what's left in it for you. */
export interface LabRoomView {
  floor: number;
  room: number;
  /** Where you stand (px, room-local). */
  x: number;
  y: number;
  dir: Direction;
  /** Rooms of this floor you've seen (a bitset as hex, room id = bit). */
  seen: string;
  /** This room's chest is already opened today (or the treasure taken). */
  chestDone: boolean;
  /** 📦 Crates here (index among the room's crate props) you've broken that aren't back yet; 🪨 this
   *  floor's secret stash already found. */
  broken?: number[];
  secretFound?: boolean;
  others: LabOther[];
  self: LabSelf;
}

// ---------------------------------------------------------------- 👥 parties
/** Your party: who's in it, where they are (for the map) and who's been invited. */
export interface LabPartyView {
  id: number;
  leader: number;
  members: Array<{
    id: number;
    name: string;
    level: number;
    online: boolean;
    /** In the labyrinth, and where (floor, room). */
    inside: boolean;
    floor?: number;
    room?: number;
    fighting: boolean;
  }>;
  invited: Array<{ id: number; name: string }>;
  max: number;
}

// ---------------------------------------------------------------- ⚔️ battles
export interface LabBattleView {
  id: number;
  floor: number;
  room: number;
  round: number;
  /** Server time the round resolves by itself (everyone then ⚔️ Attacks). */
  deadline: number;
  roundSec: number;
  fighters: LabFighter[];
  /** Fighters (ids) who have picked this round. */
  chosen: string[];
  /** 👹 A boss fight: no running away. */
  boss: boolean;
  /** 🌿 It jumped out of a bush or a cobweb you walked through. */
  ambush?: boolean;
}

/** How a battle ended for one player. */
export interface LabBattleEnd {
  outcome: Exclude<LabOutcome, null>;
  /** Syiling won (carried). */
  coins: number;
  /** Syiling lost by falling. */
  lost: number;
  /** 📈 Labirin XP won, and the new level if you went up. */
  xp?: number;
  levelUp?: number;
}


export const LAB_C2S = {
  labEnter: z.object({ at: z.enum(['save', 'entrance']).default('save') }),
  labMove: z.object({ x: z.number().finite(), y: z.number().finite(), dir: z.enum(['up', 'down', 'left', 'right']), moving: z.boolean() }),
  labDoor: z.object({ dir: z.enum(['n', 'e', 's', 'w']) }),
  labUse: z.object({ what: z.enum(['chest', 'key', 'rest', 'down', 'up', 'exit', 'crate', 'secret']) }),
  labAct: z.object({ kind: z.enum(['attack', 'skill', 'ultimate', 'guard', 'run', 'item']), target: z.string().max(8).optional(), item: z.string().max(32).optional() }),
  /** 📖 Learn one more rank of a skill (a skill point). */
  labSkill: z.object({ id: z.string().max(32) }),
  /** 📜 Wear a spell book you own (null: none). */
  labBook: z.object({ id: z.string().max(32).nullable() }),
  /** 🛒 At the merchant: buy gear (n = 1) or potions. */
  labBuy: z.object({ id: z.string().max(32), n: z.number().int().min(1).max(20).default(1) }),
  /** ⚔️ Wear a piece you own (or take a slot off: id null). Not in a fight. */
  labEquip: z.object({ slot: z.enum(['weapon', 'shield', 'armour', 'charm']), id: z.string().max(32).nullable() }),
  /** 🧪 A potion out of a fight (a heal, or 🧵 Tali Pulang home). */
  labItem: z.object({ id: z.string().max(32) }),
  /** 🍵 A drink at the tavern (entrance hall). */
  labDrink: z.object({ id: z.string().max(32) }),
  /** 👥 Parties: invite a player, answer an invite, the leader removes someone. */
  labInvite: z.object({ id: z.number().int().positive() }),
  labPartyId: z.object({ party: z.number().int().positive() }),
  labKick: z.object({ id: z.number().int().positive() }),
};

export type LabUse = z.infer<typeof LAB_C2S.labUse>['what'];
export type { LabDir };

/** Bitset helpers for `seen` (hex, little-endian nibbles: room id = bit). */
export function seenHas(hex: string, id: number): boolean {
  const n = parseInt(hex[id >> 2] ?? '0', 16);
  return !!(n & (1 << (id & 3)));
}
export function seenAdd(hex: string, id: number): string {
  const i = id >> 2;
  const s = hex.padEnd(i + 1, '0');
  const n = parseInt(s[i], 16) | (1 << (id & 3));
  return s.slice(0, i) + n.toString(16) + s.slice(i + 1);
}
