// 🗝️ Labirin Purba: balance (shared/config/labyrinth.json). See docs/LABYRINTH.md.
import { z } from 'zod';

export const labConfigSchema = z.object({
  name: z.string(),
  /** Floors, top to bottom. Each one's layout comes from its own seed: never change a seed (it
   *  would remake that floor for everyone). */
  floors: z.array(z.object({
    name: z.string(),
    seed: z.number().int(),
    /** The rooms grid (cells; some stay empty). */
    w: z.number().int().min(4).max(32),
    h: z.number().int().min(4).max(32),
    /** Wall / floor colours of this floor's rooms. */
    wall: z.string(),
    floor: z.string(),
  })).min(1),
  gen: z.object({
    /** Share of grid cells left out (makes the outline ragged). */
    holes: z.number().min(0).max(0.6),
    /** Extra doors between neighbouring rooms beyond the maze (loops, more than one way round). */
    loops: z.number().min(0).max(0.6),
    /** Rooms with a small chest (a loot box). */
    chests: z.number().min(0).max(1),
    /** Rooms with a monster group. */
    monsters: z.number().min(0).max(1),
    /** Locked treasure rooms per floor (each one's key is somewhere else on the floor). */
    treasure: z.number().int().min(0).max(6),
  }),
  /** A room's inside, in tiles (odd numbers keep the doors centred). */
  room: z.object({ w: z.number().int().min(9).max(31), h: z.number().int().min(7).max(25) }),
  /** 🪙 found in a loot box: base × (1 + perFloor × (floor − 1)), ± spread. Treasure: × treasureMult. */
  coins: z.object({ chest: z.number().int().positive(), perFloor: z.number().min(0), spread: z.number().min(0).max(1), treasureMult: z.number().positive() }),
  /** Share of carried coins lost when the whole party falls. */
  deathLoss: z.number().min(0).max(1),
  /** Walking speed inside (px/s at the room's own scale) and the tile size. */
  tile: z.number().int().positive(),
  walkSpeed: z.number().positive(),
  /** ⚔️ Your "weakened state" down here (gear adds to it later). */
  player: z.object({
    hp: z.number().positive(), atk: z.number().positive(), def: z.number().min(0), spd: z.number().positive(),
    /** Focus: +1 a round (max `focusMax`); a 💥 Skill spends `skillCost` for `skillPower` × damage. */
    focusMax: z.number().int().positive(), skillCost: z.number().int().positive(), skillPower: z.number().positive(),
    /** 🛡️ Guard: damage taken × this for the round. */
    guardCut: z.number().min(0).max(1),
    crit: z.number().min(0).max(1), critMult: z.number().min(1),
    /** Out of a fight you get this share of max HP back every 10 s. */
    regenPer10s: z.number().min(0).max(1),
  }),
  battle: z.object({
    /** Seconds to pick (then you ⚔️ Attack). */
    roundSec: z.number().positive(),
    /** 🏃 Run: chance it works. */
    runChance: z.number().min(0).max(1),
    /** A beaten group is back after this many minutes. */
    respawnMin: z.number().positive(),
    /** Damage varies ± this. */
    variance: z.number().min(0).max(0.5),
    /** Monsters per group: 1 + up to this many more (deeper floors fill it). */
    extraMax: z.number().int().min(0).max(4),
  }),
  /** 🐾 Your lead Teman doesn't fight here; it gives a tiny boost (ATK, DEF, HP) by rarity × tier × variant. */
  teman: z.object({
    rarity: z.record(z.string(), z.number().min(0)),
    /** Tier and variant count as their pet multipliers ^ this (soft). */
    soften: z.number().min(0).max(1),
    max: z.number().min(0).max(0.5),
  }),
  /** Monsters' stats grow per floor (× growth^(floor)). */
  scale: z.object({ hp: z.number().min(1), atk: z.number().min(1), def: z.number().min(1), spd: z.number().min(1) }),
  monsters: z.array(z.object({
    id: z.string(), name: z.string(), icon: z.string(),
    hp: z.number().positive(), atk: z.number().positive(), def: z.number().min(0), spd: z.number().positive(),
    /** Floors it lives on (0-based, inclusive). */
    floors: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
    /** Syiling it drops (× the floor's coin growth). */
    coins: z.number().int().min(0),
    move: z.string(),
    line: z.string().default(''),
  })).min(2),
});
export type LabConfig = z.infer<typeof labConfigSchema>;
