// Server events (spec §14): Lucky Hour, Rush Hour, the Pasar Malam Festival, Durian Season...
// Started by an admin (/event) or at random. While one runs, everyone gets its buffs, and an
// event crate (if any) can be rolled.
import { z } from 'zod';
import { BUFF_KINDS } from '../economy/schemas';

export const eventsConfigSchema = z.object({
  /** Every this many minutes, maybe start a random event (if none is running). */
  randomEveryMin: z.number().positive(),
  randomChance: z.number().min(0).max(1),
  events: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      icon: z.string(),
      desc: z.string(),
      minutes: z.number().positive(),
      buffs: z.array(z.object({ kind: z.enum(BUFF_KINDS), mult: z.number().positive() })),
      /** A limited crate that can only be rolled during this event. */
      crate: z.string().optional(),
    }),
  ).min(1),
});
export type EventsConfig = z.infer<typeof eventsConfigSchema>;
export type EventDef = EventsConfig['events'][number];

/** The event running now (sent to clients). */
export interface ActiveEvent {
  id: string;
  endsAt: number;
}
