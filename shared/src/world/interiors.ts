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
 * Room size (tiles) for a building, from its footprint as it sits on the map (east–west = the
 * room's width, north–south = its height), so the doorway can be on the same side as the door
 * you came in by. A deep shoplot is a long room, malls and hypermarkets are big halls. Never
 * smaller in area than the style's own w × h.
 */
export function roomSize(cfg: InteriorsConfig, style: Pick<RoomStyle, 'w' | 'h'>, b: Pick<BuiltBuilding, 'bbox'>, metersPerTile: number): { w: number; h: number } {
  const z = cfg.sizing;
  const m = metersPerTile / z.metersPerRoomTile;
  let w = Math.max(9, Math.round((b.bbox.x1 - b.bbox.x0) * m));
  let h = Math.max(8, Math.round((b.bbox.y1 - b.bbox.y0) * m));
  const need = style.w * style.h;
  if (w * h < need) {
    const k = Math.sqrt(need / (w * h));
    w = Math.round(w * k);
    h = Math.round(h * k);
  }
  return { w: Math.min(z.maxW, w), h: Math.min(z.maxH, h) };
}

/** Which wall of the room a door is in (its outward direction on the map), and where along it
 *  (0..1 from the left / top), matching where the door is on the building. */
export function doorSide(b: Pick<BuiltBuilding, 'bbox'>, d: { x: number; y: number; nx: number; ny: number }): { side: 'top' | 'bottom' | 'left' | 'right'; at: number } {
  const bw = Math.max(1e-6, b.bbox.x1 - b.bbox.x0), bh = Math.max(1e-6, b.bbox.y1 - b.bbox.y0);
  if (Math.abs(d.nx) > Math.abs(d.ny)) return { side: d.nx > 0 ? 'right' : 'left', at: Math.max(0, Math.min(1, (d.y - b.bbox.y0) / bh)) };
  return { side: d.ny > 0 ? 'bottom' : 'top', at: Math.max(0, Math.min(1, (d.x - b.bbox.x0) / bw)) };
}

/** Is a player at tile (tx, ty) standing at one of this building's doors? (server check) */
export function atDoor(map: Pick<BuiltMap, 'buildings'>, buildingId: string, tx: number, ty: number, radius: number): boolean {
  const b = map.buildings.find((x) => x.id === buildingId);
  return !!b && b.doors.some((d) => Math.hypot(d.frontX + 0.5 - tx, d.frontY + 0.5 - ty) <= radius);
}
