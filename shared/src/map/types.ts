// The town map is authored as data (shared/map/town.json) and rasterised into tiles by
// buildMap(). Rects are [x, y, w, h] in tile units; points are [x, y] tile centres.
import { z } from 'zod';

const int = z.number().int();
export const rectSchema = z.tuple([int, int, int.positive(), int.positive()]);
export const pointSchema = z.tuple([z.number(), z.number()]);
export type Rect = z.infer<typeof rectSchema>;
export type Point = z.infer<typeof pointSchema>;

export const AREA_KINDS = ['plaza', 'park', 'field', 'forest', 'water', 'parking', 'golf', 'bridge', 'trail'] as const;
export type AreaKind = (typeof AREA_KINDS)[number];

export const ROAD_KINDS = ['street', 'avenue', 'highway', 'trail'] as const;
export type RoadKind = (typeof ROAD_KINDS)[number];

export const BUILDING_KINDS = [
  'shoplot', 'office', 'tower', 'mall', 'terrace', 'semid', 'bungalow', 'flat', 'condo',
  'hospital', 'station', 'casino', 'hypermarket', 'bank', 'shop', 'clubhouse', 'civic', 'furniture',
] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

export const SIDES = ['n', 's', 'e', 'w'] as const;
export type Side = (typeof SIDES)[number];

export const DECOR_KINDS = ['fountain', 'jobsboard', 'lookout', 'busstop'] as const;

export const districtSchema = z.object({
  id: z.string(),
  name: z.string(),
  rect: rectSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** Optional label position on the full map (tile coords); defaults to the rect centre. */
  label: pointSchema.optional(),
});

export const areaSchema = z.object({
  kind: z.enum(AREA_KINDS),
  rect: rectSchema,
  name: z.string().optional(),
});

export const roadSchema = z.object({
  name: z.string(),
  kind: z.enum(ROAD_KINDS),
  width: int.positive(),
  points: z.array(pointSchema).min(2),
});

export const buildingSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  kind: z.enum(BUILDING_KINDS),
  rect: rectSchema,
  door: z.enum(SIDES).default('s'),
});

/** A row of identical units (terraces, shoplots) expanded into individual buildings. */
export const rowSchema = z.object({
  id: z.string(),
  kind: z.enum(BUILDING_KINDS),
  x: int,
  y: int,
  count: int.positive(),
  w: int.positive(),
  h: int.positive(),
  gap: int.nonnegative().default(0),
  axis: z.enum(['x', 'y']).default('x'),
  door: z.enum(SIDES).default('s'),
  name: z.string().optional(),
});

export const decorSchema = z.object({ kind: z.enum(DECOR_KINDS), x: int, y: int });

export const mapLayoutSchema = z.object({
  width: int.positive(),
  height: int.positive(),
  tileSize: int.positive(),
  spawn: pointSchema,
  districts: z.array(districtSchema),
  areas: z.array(areaSchema),
  roads: z.array(roadSchema),
  crossings: z.array(rectSchema),
  buildings: z.array(buildingSchema),
  rows: z.array(rowSchema),
  decor: z.array(decorSchema),
});
export type MapLayout = z.input<typeof mapLayoutSchema>;
export type ParsedMapLayout = z.output<typeof mapLayoutSchema>;
