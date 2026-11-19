// Map data v2. Two files:
//   shared/map/kd.osm.json         GENERATED from OpenStreetMap by `npm run import-map`.
//                                   © OpenStreetMap contributors, ODbL 1.0. Don't hand-edit.
//   shared/map/town.overrides.json  OUR additions: origin, bounds, spawn, districts, parody
//                                   names for landmarks, extra paths/areas, gameplay decor.
//
// All coordinates are in TILES relative to a fixed world origin (Menara Mitraland), so the
// map can grow by extending `bounds` without moving anything that already exists.
// Geometry is stored flat ([x0, y0, x1, y1, ...]) to keep the JSON small.
import { z } from 'zod';

const int = z.number().int();
export const rectSchema = z.tuple([int, int, int.positive(), int.positive()]);
export const pointSchema = z.tuple([z.number(), z.number()]);
export type Rect = z.infer<typeof rectSchema>;
export type Point = z.infer<typeof pointSchema>;
const flat = z.array(z.number());

export const ROAD_CLASSES = ['highway', 'arterial', 'street', 'service'] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

export const PATH_KINDS = ['footway', 'steps', 'cycleway', 'track', 'pedestrian'] as const;

export const AREA_KINDS = ['park', 'forest', 'water', 'parking', 'field', 'golf', 'plaza', 'construction', 'grass'] as const;
export type AreaKind = (typeof AREA_KINDS)[number];

export const BUILDING_KINDS = [
  'shoplot', 'office', 'tower', 'mall', 'terrace', 'semid', 'bungalow', 'flat', 'condo', 'hospital', 'station',
  'casino', 'hypermarket', 'bank', 'shop', 'clubhouse', 'civic', 'furniture', 'school', 'parking', 'construction',
  'roof', 'religious',
] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

export const DECOR_KINDS = ['fountain', 'jobsboard', 'lookout', 'busstop', 'stall'] as const;

export const INTERACT_TYPES = ['crate', 'jobs', 'pawn', 'carwash', 'market', 'furniture', 'casino', 'kitchen', 'cashier', 'stairs', 'showroom'] as const;
export type InteractType = (typeof INTERACT_TYPES)[number];

// ------------------------------------------------------------- generated OSM data
export const osmRoadSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  cls: z.enum(ROAD_CLASSES),
  lanes: int.positive(),
  oneway: z.boolean(),
  elevated: z.boolean(),
  pts: flat,
});
export type OsmRoad = z.infer<typeof osmRoadSchema>;

export const osmMapDataSchema = z.object({
  meta: z.object({
    source: z.string(),
    license: z.string(),
    attribution: z.string(),
    generatedAt: z.string(),
    metersPerTile: z.number(),
    origin: z.object({ lat: z.number(), lon: z.number() }),
  }),
  roads: z.array(osmRoadSchema),
  paths: z.array(z.object({ id: z.string(), kind: z.enum(PATH_KINDS), bridge: z.boolean(), pts: flat })),
  buildings: z.array(
    z.object({ id: z.string(), kind: z.enum(BUILDING_KINDS), levels: z.number().nullable(), poly: flat, entrances: flat.optional() }),
  ),
  areas: z.array(z.object({ id: z.string(), kind: z.enum(AREA_KINDS), poly: flat })),
  waterways: z.array(z.object({ id: z.string(), width: z.number(), pts: flat })),
  rails: z.array(z.object({ id: z.string(), elevated: z.boolean(), pts: flat })),
  trees: flat,
  crossings: flat,
});
export type OsmMapData = z.infer<typeof osmMapDataSchema>;

// ------------------------------------------------------------- our overrides
export const overridesSchema = z.object({
  version: int.positive(),
  origin: z.object({ lat: z.number(), lon: z.number(), label: z.string().optional() }),
  metersPerTile: z.number().positive(),
  tileSize: int.positive(),
  /** [minX, minY, width, height] in origin-relative tiles. */
  bounds: rectSchema,
  osmFetchBbox: z.object({ south: z.number(), west: z.number(), north: z.number(), east: z.number() }),
  spawn: pointSchema,
  districts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      rect: rectSchema,
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      label: pointSchema.optional(),
    }),
  ),
  /** Per-building overrides keyed by OSM id ("w123" / "r456"). */
  buildings: z.record(
    z.string(),
    z.object({
      name: z.string().optional(),
      kind: z.enum(BUILDING_KINDS).optional(),
      hidden: z.boolean().optional(),
      door: pointSchema.optional(),
      /** Extra entrances (tile coords on the wall), e.g. a hypermarket's side doors. */
      doors: z.array(pointSchema).optional(),
    }),
  ),
  /** Extra areas or names for OSM areas. */
  areas: z.array(
    z.object({ id: z.string().optional(), kind: z.enum(AREA_KINDS).optional(), rect: rectSchema.optional(), name: z.string().optional() }),
  ),
  /** OSM road ids to treat as elevated (viaducts you can walk under), where OSM lacks the bridge tag. */
  elevate: z.array(z.string()).default([]),
  /** Extra footpaths/bridges to fix connectivity where OSM has gaps. */
  paths: z.array(z.object({ kind: z.enum(['footway', 'bridge']), width: z.number().positive().default(1.5), pts: z.array(pointSchema).min(2) })),
  decor: z.array(z.object({ kind: z.enum(DECOR_KINDS), x: z.number(), y: z.number() })),
  /** Things players can use: crate machines, the Jobs Board, the pawn shop. Either at a
   *  building's door (building = OSM id) or at a point (x, y in tiles). */
  interactables: z
    .array(
      z.object({
        id: z.string(),
        type: z.enum(INTERACT_TYPES),
        name: z.string(),
        crate: z.string().optional(),
        /** Casino stations: which game (slots, roulette, blackjack, crash, wheel, highlow). */
        game: z.string().optional(),
        building: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
      }),
    )
    .default([]),
  /** Spots where players' food stalls go (Phase 4): pasar malam plots (tier 1), food truck spots
   *  (tier 2) and kopitiam shoplots (tier 3, at a building's door). Ids are stable: ownership
   *  refers to them. Customers queue from `queueFrom` (offset from the spot) every `queueStep`. */
  stallPlots: z
    .array(
      z.object({
        id: z.string(),
        tier: z.number().int().positive(),
        building: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        queueFrom: z.tuple([z.number(), z.number()]).optional(),
        queueStep: z.tuple([z.number(), z.number()]).optional(),
      }),
    )
    .default([]),
});
export type MapOverrides = z.input<typeof overridesSchema>;
export type ParsedOverrides = z.output<typeof overridesSchema>;

/** What the server sends to clients and what buildMap() consumes. */
export interface MapSource {
  data: OsmMapData;
  overrides: MapOverrides;
}
