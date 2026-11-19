// Helping players find their way: points of interest (big signs on the map and in the world),
// which spot each goal/quest is about (for the guide arrow), random hints and the Handbook.
// All text lives in guide.json.
import { z } from 'zod';
import type { BuiltMap } from '../map/build';

export const POI_KINDS = ['work', 'crate', 'shop', 'stall', 'soon'] as const;
export type PoiKind = (typeof POI_KINDS)[number];

export const guideConfigSchema = z.object({
  pois: z.array(
    z.object({
      id: z.string().min(1).max(32),
      label: z.string().min(1).max(32),
      sub: z.string().max(60).default(''),
      icon: z.string().min(1).max(8),
      kind: z.enum(POI_KINDS),
      /** Where it is: a building (its door), an interactable, or the middle of a stall tier's plots. */
      building: z.string().optional(),
      interactable: z.string().optional(),
      stallTier: z.number().int().positive().optional(),
    }),
  ),
  /** "goal:<id>" / "quest:<id>" → POI id ("mystall" = your own stall, else the pasar malam). */
  targets: z.record(z.string(), z.string()),
  hintEveryMs: z.number().int().min(30_000),
  hints: z.array(z.string().min(1).max(200)).min(1),
  handbook: z.array(
    z.object({ id: z.string(), icon: z.string(), title: z.string(), steps: z.array(z.string().min(1)).min(1) }),
  ),
});
export type GuideConfig = z.infer<typeof guideConfigSchema>;
export type PoiDef = GuideConfig['pois'][number];
export interface Poi extends PoiDef {
  /** Tile coords of the spot (a door front, the interactable, or the plots' middle). */
  x: number;
  y: number;
}

/** Places every POI on the map (skips ones whose building/interactable isn't there). */
export function resolvePois(map: Pick<BuiltMap, 'buildings' | 'interactables' | 'stallPlots'>, cfg: GuideConfig): Poi[] {
  const out: Poi[] = [];
  for (const p of cfg.pois) {
    let at: [number, number] | null = null;
    if (p.building) {
      const d = map.buildings.find((b) => b.id === p.building)?.door;
      if (d) at = [d.frontX + 0.5, d.frontY + 0.5];
    } else if (p.interactable) {
      const it = map.interactables.find((i) => i.id === p.interactable);
      if (it) at = [it.x, it.y];
    } else if (p.stallTier) {
      const plots = map.stallPlots.filter((s) => s.tier === p.stallTier && !s.auto);
      if (plots.length) at = [plots.reduce((a, s) => a + s.x, 0) / plots.length, plots.reduce((a, s) => a + s.y, 0) / plots.length];
    }
    if (at) out.push({ ...p, x: at[0], y: at[1] });
  }
  return out;
}

/** The POI a goal or quest is about ("goal:first_job" → the Jobs Board), if any. */
export function targetOf(cfg: GuideConfig, key: string): string | null {
  return cfg.targets[key] ?? null;
}
