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
});
export type LabConfig = z.infer<typeof labConfigSchema>;
