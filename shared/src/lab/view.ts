// 🗝️ Labirin Purba: what the server tells clients (and the zod schemas for what clients send).
import { z } from 'zod';
import type { Appearance, Direction } from '../character/appearance';
import type { Cosmetics } from '../protocol/messages';
import type { LabDir } from './generate';

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
  /** Keys held: `${floor}:${treasure index}`. */
  keys: string[];
  /** Treasure rooms opened (their door stays open for you): `${floor}:${treasure index}`. */
  unlocked: string[];
  /** Treasure already taken: `${floor}:${treasure index}`. */
  looted: string[];
  /** In the labyrinth right now. */
  inside: boolean;
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
  others: LabOther[];
  self: LabSelf;
}

export const LAB_C2S = {
  labEnter: z.object({ at: z.enum(['save', 'entrance']).default('save') }),
  labMove: z.object({ x: z.number().finite(), y: z.number().finite(), dir: z.enum(['up', 'down', 'left', 'right']), moving: z.boolean() }),
  labDoor: z.object({ dir: z.enum(['n', 'e', 's', 'w']) }),
  labUse: z.object({ what: z.enum(['chest', 'key', 'rest', 'down', 'up', 'exit']) }),
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
