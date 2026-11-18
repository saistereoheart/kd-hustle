// Building interiors (Pokémon style): walk up to a door, press E, and the town fades behind a
// small room. Shops, machines and counters are used from INSIDE. Which room a building gets
// comes from interiors.json (by building id, else by kind); homes are locked.
import { z } from 'zod';
import { hexColor } from '../config/schemas';
import type { BuiltBuilding, BuiltMap } from '../map/build';

export const FURNITURE = [
  'shelf', 'fridge', 'plant', 'glasscase', 'safe', 'hose', 'buckets', 'tyres', 'trolleys', 'fountain', 'bench', 'kiosk',
  'atm', 'sofa', 'slot', 'table', 'desk', 'gate', 'tv', 'bed', 'boxes', 'ladder', 'sign',
] as const;
export type Furniture = (typeof FURNITURE)[number];

export const roomStyleSchema = z.object({
  label: z.string(),
  /** Room size in tiles (the back wall takes the top 2 rows). */
  w: z.number().int().min(8).max(24),
  h: z.number().int().min(6).max(14),
  floor: hexColor,
  floor2: hexColor,
  wall: hexColor,
  trim: hexColor,
  furniture: z.array(z.enum(FURNITURE)).max(10),
  /** Who stands behind the counter (null: nobody). */
  keeper: z.string().nullable(),
  greeting: z.string(),
});
export type RoomStyle = z.infer<typeof roomStyleSchema>;

export const interiorsConfigSchema = z
  .object({
    /** How close (tiles) to a door's front you must be to go in. */
    enterRadiusTiles: z.number().positive(),
    lockedKinds: z.array(z.string()),
    lockedMessage: z.string(),
    byKind: z.record(z.string(), z.string()),
    byBuilding: z.record(z.string(), z.string()),
    styles: z.record(z.string(), roomStyleSchema),
  })
  .superRefine((c, ctx) => {
    for (const [k, s] of [...Object.entries(c.byKind), ...Object.entries(c.byBuilding)])
      if (!c.styles[s]) ctx.addIssue({ code: 'custom', message: `${k} → unknown room style "${s}"` });
  });
export type InteriorsConfig = z.infer<typeof interiorsConfigSchema>;

/** The room style id for a building, or null if it can't be entered. */
export function roomStyleOf(cfg: InteriorsConfig, b: Pick<BuiltBuilding, 'id' | 'kind' | 'door'>): string | null {
  if (!b.door) return null;
  const byId = cfg.byBuilding[b.id];
  if (byId) return byId;
  if (cfg.lockedKinds.includes(b.kind)) return null;
  return cfg.byKind[b.kind] ?? null;
}

/** Is a player at tile (tx, ty) standing at one of this building's doors? (server check) */
export function atDoor(map: Pick<BuiltMap, 'buildings'>, buildingId: string, tx: number, ty: number, radius: number): boolean {
  const b = map.buildings.find((x) => x.id === buildingId);
  return !!b && b.doors.some((d) => Math.hypot(d.frontX + 0.5 - tx, d.frontY + 0.5 - ty) <= radius);
}
