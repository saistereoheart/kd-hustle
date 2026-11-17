// The in-game clock (spec §2): 1 in-game hour = 1 real minute, so a day is 24 real minutes.
// It's pure arithmetic on wall-clock time, so the server and every client agree without syncing
// anything but the server's time (sent once in `init`).
import { z } from 'zod';

export const timeConfigSchema = z.object({
  /** Real milliseconds per in-game minute (1000 = an in-game hour per real minute). */
  realMsPerGameMinute: z.number().positive(),
  /** Shifts the clock so it isn't tied to UTC midnight. */
  offsetGameMinutes: z.number(),
  /** Lighting phases by hour: [from, to). Night is everything else. */
  phases: z.object({ dawn: z.tuple([z.number(), z.number()]), day: z.tuple([z.number(), z.number()]), dusk: z.tuple([z.number(), z.number()]) }),
  /** Meal times: more customers and better prices at stalls. */
  rushHours: z.array(z.object({ name: z.string(), from: z.number(), to: z.number() })),
});
export type TimeConfig = z.infer<typeof timeConfigSchema>;

export interface GameTime {
  /** In-game minutes since the epoch (monotonic). */
  total: number;
  day: number;
  hour: number;
  minute: number;
  /** Hour as a fraction (13.5 = 1:30 PM). */
  hourF: number;
}

export function gameTime(cfg: TimeConfig, nowMs: number): GameTime {
  const total = nowMs / cfg.realMsPerGameMinute + cfg.offsetGameMinutes;
  const day = Math.floor(total / 1440);
  const inDay = total - day * 1440;
  return { total, day, hour: Math.floor(inDay / 60), minute: Math.floor(inDay % 60), hourF: inDay / 60 };
}

/** Is `hourF` inside [from, to)? Ranges may wrap past midnight (e.g. 17 → 2). */
export function inHours(hourF: number, from: number, to: number): boolean {
  return from <= to ? hourF >= from && hourF < to : hourF >= from || hourF < to;
}

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';
export function dayPhase(cfg: TimeConfig, hourF: number): DayPhase {
  if (inHours(hourF, ...cfg.phases.day)) return 'day';
  if (inHours(hourF, ...cfg.phases.dawn)) return 'dawn';
  if (inHours(hourF, ...cfg.phases.dusk)) return 'dusk';
  return 'night';
}

/** How dark it is, 0 (noon) .. 1 (deep night), smooth through dawn and dusk. */
export function darkness(cfg: TimeConfig, hourF: number): number {
  const [d0, d1] = cfg.phases.dawn;
  const [k0, k1] = cfg.phases.dusk;
  if (inHours(hourF, d0, d1)) return 1 - (hourF - d0) / (d1 - d0);
  if (inHours(hourF, k0, k1)) return (hourF - k0) / (k1 - k0);
  return dayPhase(cfg, hourF) === 'day' ? 0 : 1;
}

export function rushHour(cfg: TimeConfig, hourF: number): string | null {
  return cfg.rushHours.find((r) => inHours(hourF, r.from, r.to))?.name ?? null;
}

/** "9:05 PM" */
export function formatClock(t: GameTime): string {
  const h12 = t.hour % 12 === 0 ? 12 : t.hour % 12;
  return `${h12}:${String(t.minute).padStart(2, '0')} ${t.hour < 12 ? 'AM' : 'PM'}`;
}
