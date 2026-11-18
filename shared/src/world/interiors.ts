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
  /** Pieces repeated to fill the extra floor of a big room (default: the big pieces above). */
  fill: z.array(z.enum(FURNITURE)).optional(),
  /** Who stands behind the counter (null: nobody). */
  keeper: z.string().nullable(),
  greeting: z.string(),
});
export type RoomStyle = z.infer<typeof roomStyleSchema>;

export const interiorsConfigSchema = z
  .object({
    /** How close (tiles) to a door's front you must be to go in. */
    enterRadiusTiles: z.number().positive(),
    /** The room follows the building's real footprint: metres of building per room tile, and
     *  the biggest room (tiles). A style's w × h is the smallest. */
    sizing: z.object({ metersPerRoomTile: z.number().positive(), maxW: z.number().int().min(8), maxH: z.number().int().min(6) }),
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

/**
 * Room size (tiles) for a building, from its footprint: the wall with the door you came in by
 * becomes the room's width (the doorway is at the bottom), the depth behind it the height. So a
 * deep shoplot is a long narrow room, and malls and hypermarkets are big halls.
 */
export function roomSize(
  cfg: InteriorsConfig,
  style: Pick<RoomStyle, 'w' | 'h'>,
  b: Pick<BuiltBuilding, 'poly' | 'bbox'>,
  door: { nx: number; ny: number } | null,
  metersPerTile: number,
): { w: number; h: number } {
  let wide: number, deep: number;
  const l = door ? Math.hypot(door.nx, door.ny) : 0;
  if (door && l > 0 && b.poly.length >= 6) {
    const nx = door.nx / l, ny = door.ny / l;
    let n0 = Infinity, n1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (let i = 0; i + 1 < b.poly.length; i += 2) {
      const x = b.poly[i], y = b.poly[i + 1];
      const n = x * nx + y * ny, t = -x * ny + y * nx;
      n0 = Math.min(n0, n), n1 = Math.max(n1, n), t0 = Math.min(t0, t), t1 = Math.max(t1, t);
    }
    wide = t1 - t0;
    deep = n1 - n0;
  } else {
    wide = b.bbox.x1 - b.bbox.x0;
    deep = b.bbox.y1 - b.bbox.y0;
  }
  const z = cfg.sizing;
  const fit = (m: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), Math.round((m * metersPerTile) / z.metersPerRoomTile)));
  return { w: fit(wide, style.w, z.maxW), h: fit(deep, style.h, z.maxH) };
}

/** Is a player at tile (tx, ty) standing at one of this building's doors? (server check) */
export function atDoor(map: Pick<BuiltMap, 'buildings'>, buildingId: string, tx: number, ty: number, radius: number): boolean {
  const b = map.buildings.find((x) => x.id === buildingId);
  return !!b && b.doors.some((d) => Math.hypot(d.frontX + 0.5 - tx, d.frontY + 0.5 - ty) <= radius);
}
