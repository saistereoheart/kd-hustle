// Rasterises the authored map layout into tile layers. The SAME function runs on the server
// (collision for move validation) and the client (rendering + prediction), so both agree
// on exactly which tiles are walls.
import { mapLayoutSchema, type BuildingKind, type MapLayout, type ParsedMapLayout, type Point, type Side } from './types';

/** Ground tile ids. Order matters: the client tileset is drawn in this order. */
export const Tile = {
  Grass: 0,
  Street: 1,
  Sidewalk: 2,
  Zebra: 3,
  Plaza: 4,
  Water: 5,
  Highway: 6,
  Forest: 7,
  Field: 8,
  Building: 9,
  Parking: 10,
  Golf: 11,
  Bridge: 12,
  Trail: 13,
  Park: 14,
} as const;
export const GROUND_TILE_COUNT = 15;

/** Decor ids (0 = none). Purely visual; never solid. */
export const Decor = {
  None: 0,
  Tree: 1,
  Palm: 2,
  Bush: 3,
  Lamp: 4,
  Bench: 5,
  Flowers: 6,
  CarRed: 7,
  CarBlue: 8,
  CarWhite: 9,
  Fountain: 10,
  Pine: 11,
  JobsBoard: 12,
  Lookout: 13,
  BusStop: 14,
} as const;
export const DECOR_TILE_COUNT = 15;
/** Decor drawn above characters (tree canopies). */
export const CANOPY_DECOR: ReadonlySet<number> = new Set([Decor.Tree, Decor.Palm, Decor.Pine]);

const SOLID_TILES: ReadonlySet<number> = new Set([Tile.Water, Tile.Highway, Tile.Building]);

export interface BuiltBuilding {
  id: string;
  name?: string;
  kind: BuildingKind;
  x: number;
  y: number;
  w: number;
  h: number;
  door: { side: Side; x: number; y: number; frontX: number; frontY: number };
  /** Index within its row (for alternating roof colours); 0 for standalone buildings. */
  unit: number;
}

export interface BuiltMap {
  width: number;
  height: number;
  tileSize: number;
  ground: Uint8Array;
  solid: Uint8Array;
  decor: Uint8Array;
  buildings: BuiltBuilding[];
  layout: ParsedMapLayout;
  /** Spawn point in world pixels (feet position). */
  spawnPx: { x: number; y: number };
}

/** Deterministic 0..1 hash of a tile coordinate (so decor is identical on every device). */
export function tileHash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function buildMap(input: MapLayout): BuiltMap {
  const layout = mapLayoutSchema.parse(input);
  const { width: W, height: H, tileSize } = layout;
  const ground = new Uint8Array(W * H).fill(Tile.Grass);
  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const set = (x: number, y: number, t: number) => {
    if (inBounds(x, y)) ground[y * W + x] = t;
  };
  const get = (x: number, y: number) => (inBounds(x, y) ? ground[y * W + x] : -1);
  const fillRect = (r: readonly number[], t: number) => {
    for (let y = r[1]; y < r[1] + r[3]; y++) for (let x = r[0]; x < r[0] + r[2]; x++) set(x, y, t);
  };

  const areaTile: Record<string, number> = {
    plaza: Tile.Plaza, park: Tile.Park, field: Tile.Field, forest: Tile.Forest, water: Tile.Water,
    parking: Tile.Parking, golf: Tile.Golf, bridge: Tile.Bridge, trail: Tile.Trail,
  };

  // 1. Areas (bridges come later so they sit on top of highways).
  for (const a of layout.areas) if (a.kind !== 'bridge') fillRect(a.rect, areaTile[a.kind]);

  // 2. Highways, then street sidewalks, then street asphalt. Streets drawn over a highway
  //    become an underpass, which keeps districts on both sides connected.
  const stamp = (points: Point[], width: number, fn: (x: number, y: number) => void) => {
    const half = Math.floor(width / 2);
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2));
      for (let s = 0; s <= steps; s++) {
        const cx = Math.round(x0 + ((x1 - x0) * s) / steps);
        const cy = Math.round(y0 + ((y1 - y0) * s) / steps);
        for (let dy = 0; dy < width; dy++) for (let dx = 0; dx < width; dx++) fn(cx - half + dx, cy - half + dy);
      }
    }
  };
  for (const r of layout.roads) if (r.kind === 'highway') stamp(r.points, r.width, (x, y) => set(x, y, Tile.Highway));
  for (const r of layout.roads)
    if (r.kind === 'street' || r.kind === 'avenue')
      stamp(r.points, r.width + 2, (x, y) => {
        if (get(x, y) !== Tile.Street) set(x, y, Tile.Sidewalk);
      });
  for (const r of layout.roads)
    if (r.kind === 'street' || r.kind === 'avenue') stamp(r.points, r.width, (x, y) => set(x, y, Tile.Street));
  for (const r of layout.roads) if (r.kind === 'trail') stamp(r.points, r.width, (x, y) => {
    const t = get(x, y);
    if (t !== Tile.Street && t !== Tile.Sidewalk && t !== Tile.Highway && t !== Tile.Water) set(x, y, Tile.Trail);
  });

  // 3. Zebra crossings (only over asphalt) and bridges (over anything).
  for (const c of layout.crossings)
    for (let y = c[1]; y < c[1] + c[3]; y++)
      for (let x = c[0]; x < c[0] + c[2]; x++) if (get(x, y) === Tile.Street) set(x, y, Tile.Zebra);
  for (const a of layout.areas) if (a.kind === 'bridge') fillRect(a.rect, Tile.Bridge);

  // 4. Buildings (rows expand into one building per unit).
  const buildings: BuiltBuilding[] = [];
  const addBuilding = (id: string, kind: BuildingKind, x: number, y: number, w: number, h: number, side: Side, unit: number, name?: string) => {
    let dx: number, dy: number, fx: number, fy: number;
    if (side === 's') { dx = x + Math.floor(w / 2); dy = y + h - 1; fx = dx; fy = dy + 1; }
    else if (side === 'n') { dx = x + Math.floor(w / 2); dy = y; fx = dx; fy = y - 1; }
    else if (side === 'e') { dx = x + w - 1; dy = y + Math.floor(h / 2); fx = dx + 1; fy = dy; }
    else { dx = x; dy = y + Math.floor(h / 2); fx = x - 1; fy = dy; }
    buildings.push({ id, name, kind, x, y, w, h, unit, door: { side, x: dx, y: dy, frontX: fx, frontY: fy } });
    fillRect([x, y, w, h], Tile.Building);
  };
  for (const b of layout.buildings) addBuilding(b.id, b.kind, b.rect[0], b.rect[1], b.rect[2], b.rect[3], b.door, 0, b.name);
  for (const r of layout.rows) {
    for (let i = 0; i < r.count; i++) {
      const x = r.axis === 'x' ? r.x + i * (r.w + r.gap) : r.x;
      const y = r.axis === 'y' ? r.y + i * (r.h + r.gap) : r.y;
      addBuilding(`${r.id}-${i + 1}`, r.kind, x, y, r.w, r.h, r.door, i, r.name);
    }
  }

  // 5. Solidity.
  const solid = new Uint8Array(W * H);
  for (let i = 0; i < ground.length; i++) solid[i] = SOLID_TILES.has(ground[i]) ? 1 : 0;

  // 6. Decor (deterministic, visual only).
  const decor = new Uint8Array(W * H);
  const frontTiles = new Set(buildings.map((b) => b.door.frontY * W + b.door.frontX));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (frontTiles.has(i)) continue;
      const t = ground[i];
      const h = tileHash(x, y);
      if (t === Tile.Forest) decor[i] = h < 0.3 ? Decor.Tree : h < 0.42 ? Decor.Pine : h < 0.47 ? Decor.Bush : 0;
      else if (t === Tile.Park) decor[i] = h < 0.07 ? Decor.Tree : h < 0.1 ? Decor.Palm : h < 0.13 ? Decor.Flowers : h < 0.15 ? Decor.Bench : 0;
      else if (t === Tile.Plaza) decor[i] = h < 0.025 ? Decor.Flowers : h < 0.04 ? Decor.Bench : h < 0.05 ? Decor.Palm : 0;
      else if (t === Tile.Golf) decor[i] = h < 0.02 ? Decor.Tree : 0;
      else if (t === Tile.Grass) decor[i] = h < 0.018 ? Decor.Tree : h < 0.026 ? Decor.Bush : 0;
      else if (t === Tile.Sidewalk) decor[i] = h < 0.035 ? Decor.Lamp : h < 0.05 ? Decor.Palm : 0;
      else if (t === Tile.Parking && x % 3 !== 2 && y % 3 === 1) {
        decor[i] = h < 0.25 ? Decor.CarRed : h < 0.5 ? Decor.CarBlue : h < 0.7 ? Decor.CarWhite : 0;
      }
    }
  }
  const decorIds: Record<string, number> = {
    fountain: Decor.Fountain, jobsboard: Decor.JobsBoard, lookout: Decor.Lookout, busstop: Decor.BusStop,
  };
  for (const d of layout.decor) if (inBounds(d.x, d.y)) decor[d.y * W + d.x] = decorIds[d.kind];

  return {
    width: W,
    height: H,
    tileSize,
    ground,
    solid,
    decor,
    buildings,
    layout,
    spawnPx: { x: (layout.spawn[0] + 0.5) * tileSize, y: (layout.spawn[1] + 0.5) * tileSize },
  };
}

/** Which district (by rect) contains a tile. Districts listed first win. */
export function districtAt(map: BuiltMap, tx: number, ty: number) {
  for (const d of map.layout.districts) {
    const [x, y, w, h] = d.rect;
    if (tx >= x && ty >= y && tx < x + w && ty < y + h) return d;
  }
  return undefined;
}
