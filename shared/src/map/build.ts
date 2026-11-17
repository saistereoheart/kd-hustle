// Turns map data (OSM import + our overrides) into a terrain grid. The SAME function runs
// on the server (collision for move validation) and on the client (rendering, prediction),
// so both always agree on which tiles are walls.
//
// Coordinates: "tile coords" are relative to the fixed world origin (Menara Mitraland) and
// may be negative. "Grid coords" index the arrays: gx = tx - originTx. World pixels are
// tile coords × tileSize.
import type { TerrainConfig } from '../config/schemas';
import {
  osmMapDataSchema, overridesSchema,
  type AreaKind, type BuildingKind, type InteractType, type MapSource, type OsmMapData, type OsmRoad, type ParsedOverrides,
} from './types';
import { buildPolyIndex, type CollisionGrid } from './collision';

/** Terrain ids. The order matches TERRAIN_NAMES (used to look up terrain.json). */
export const Tile = {
  Grass: 0, Road: 1, Sidewalk: 2, Crossing: 3, Plaza: 4, Water: 5, Highway: 6, Forest: 7, Field: 8, Building: 9,
  Parking: 10, Golf: 11, Bridge: 12, Path: 13, Park: 14, Construction: 15, Roof: 16,
} as const;
export const TERRAIN_NAMES = [
  'grass', 'road', 'sidewalk', 'crossing', 'plaza', 'water', 'highway', 'forest', 'field', 'building',
  'parking', 'golf', 'bridge', 'path', 'park', 'construction', 'roof',
] as const;

/** Decor ids (0 = none). Visual only, never solid. Trees are drawn above characters. */
export const Decor = {
  None: 0, Tree: 1, Palm: 2, Bush: 3, Lamp: 4, Bench: 5, Flowers: 6, Fountain: 10, Pine: 11, JobsBoard: 12, Lookout: 13, BusStop: 14, Stall: 15,
} as const;
export const CANOPY_DECOR: ReadonlySet<number> = new Set([Decor.Tree, Decor.Palm, Decor.Pine]);

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface BuiltRoad extends OsmRoad {
  /** Asphalt width in tiles. */
  width: number;
  /** Sidewalk width on each side in tiles (0 for highways/service roads). */
  sidewalk: number;
  bbox: Box;
}

export interface BuiltBuilding {
  id: string;
  name?: string;
  kind: BuildingKind;
  levels: number | null;
  poly: number[];
  bbox: Box;
  /** Door position (tile coords, on the wall) and the walkable tile in front of it. */
  door: { x: number; y: number; frontX: number; frontY: number } | null;
}

export interface BuiltArea {
  id: string;
  kind: AreaKind;
  poly: number[];
  bbox: Box;
  name?: string;
}

export interface BuiltMap {
  width: number;
  height: number;
  tileSize: number;
  metersPerTile: number;
  /** Tile coords of grid cell (0, 0). */
  originTx: number;
  originTy: number;
  terrain: Uint8Array;
  /** Blocked for walking. */
  solid: Uint8Array;
  /** Blocked for vehicles (highways are drivable, footbridges and grass-only paths are not). */
  driveSolid: Uint8Array;
  /** 1 under an elevated road deck (the DASH viaduct, flyovers). Walkers pass underneath;
   *  vehicles ride on the deck, so they get road speed there and can cross what's below. */
  deck: Uint8Array;
  /** What movement actually collides with: tiles for water/highways + exact building outlines. */
  collision: CollisionGrid;
  driveCollision: CollisionGrid;
  decor: Uint8Array;
  roads: BuiltRoad[];
  paths: Array<{ id: string; kind: string; bridge: boolean; width: number; pts: number[]; bbox: Box }>;
  areas: BuiltArea[];
  waterways: Array<{ id: string; width: number; pts: number[]; bbox: Box }>;
  rails: Array<{ id: string; elevated: boolean; pts: number[]; bbox: Box }>;
  buildings: BuiltBuilding[];
  crossings: Array<{ x: number; y: number; angle: number; width: number }>;
  overrides: ParsedOverrides;
  attribution: string;
  /** Resolved interactables: where players stand to use them (tile coords of the spot). */
  interactables: Array<{ id: string; type: InteractType; name: string; crate?: string; x: number; y: number }>;
  /** Food stall spots (tile coords): where the stall stands, and where its queue forms. */
  stallPlots: Array<{ id: string; tier: number; x: number; y: number; queueFrom: [number, number]; queueStep: [number, number]; building?: string }>;
  /** Spawn point in world pixels (feet). */
  spawnPx: { x: number; y: number };
}

/** Deterministic 0..1 hash of a tile coordinate (identical decor on every device). */
export function tileHash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function boxOf(pts: number[], pad = 0): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] < x0) x0 = pts[i];
    if (pts[i] > x1) x1 = pts[i];
    if (pts[i + 1] < y0) y0 = pts[i + 1];
    if (pts[i + 1] > y1) y1 = pts[i + 1];
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

export function pointInPoly(px: number, py: number, poly: number[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function buildMap(source: MapSource, terrainCfg: TerrainConfig): BuiltMap {
  const data: OsmMapData = osmMapDataSchema.parse(source.data);
  const ov = overridesSchema.parse(source.overrides);
  const [originTx, originTy, W, H] = ov.bounds;
  const mpt = ov.metersPerTile;
  const terrain = new Uint8Array(W * H).fill(Tile.Grass);
  const idx = (tx: number, ty: number) => {
    const gx = tx - originTx, gy = ty - originTy;
    return gx < 0 || gy < 0 || gx >= W || gy >= H ? -1 : gy * W + gx;
  };

  // ------------------------------------------------------------ raster helpers (tile coords)
  /** Calls fn for every tile whose centre lies within `half` tiles of the polyline. */
  const stampLine = (pts: number[], half: number, fn: (i: number) => void) => {
    for (let s = 0; s + 3 < pts.length; s += 2) {
      const ax = pts[s], ay = pts[s + 1], bx = pts[s + 2], by = pts[s + 3];
      const x0 = Math.max(originTx, Math.floor(Math.min(ax, bx) - half));
      const x1 = Math.min(originTx + W - 1, Math.ceil(Math.max(ax, bx) + half));
      const y0 = Math.max(originTy, Math.floor(Math.min(ay, by) - half));
      const y1 = Math.min(originTy + H - 1, Math.ceil(Math.max(ay, by) + half));
      for (let ty = y0; ty <= y1; ty++)
        for (let tx = x0; tx <= x1; tx++)
          if (segDist(tx + 0.5, ty + 0.5, ax, ay, bx, by) <= half) fn((ty - originTy) * W + (tx - originTx));
    }
  };
  /** Calls fn for every tile whose centre is inside the polygon (scanline). */
  const fillPoly = (poly: number[], fn: (i: number) => void) => {
    const b = boxOf(poly);
    const y0 = Math.max(originTy, Math.floor(b.y0));
    const y1 = Math.min(originTy + H - 1, Math.ceil(b.y1));
    const xs: number[] = [];
    for (let ty = y0; ty <= y1; ty++) {
      const cy = ty + 0.5;
      xs.length = 0;
      for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
        const yi = poly[i + 1], yj = poly[j + 1];
        if (yi > cy !== yj > cy) xs.push(poly[i] + ((cy - yi) * (poly[j] - poly[i])) / (yj - yi));
      }
      xs.sort((a, b2) => a - b2);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(originTx, Math.ceil(xs[k] - 0.5));
        const xb = Math.min(originTx + W - 1, Math.floor(xs[k + 1] - 0.5));
        for (let tx = xa; tx <= xb; tx++) fn((ty - originTy) * W + (tx - originTx));
      }
    }
  };
  const setIf = (t: number, pred?: (cur: number) => boolean) => (i: number) => {
    if (!pred || pred(terrain[i])) terrain[i] = t;
  };

  // ------------------------------------------------------------ areas
  const AREA_TILE: Record<AreaKind, number> = {
    park: Tile.Park, grass: Tile.Park, forest: Tile.Forest, water: Tile.Water, parking: Tile.Parking, field: Tile.Field,
    golf: Tile.Golf, plaza: Tile.Plaza, construction: Tile.Construction,
  };
  const areaNames = new Map(ov.areas.filter((a) => a.id && a.name).map((a) => [a.id!, a.name!]));
  const areas: BuiltArea[] = data.areas.map((a) => ({ ...a, bbox: boxOf(a.poly), name: areaNames.get(a.id) }));
  for (const a of ov.areas) {
    if (!a.rect || !a.kind) continue;
    const [x, y, w, h] = a.rect;
    areas.push({ id: a.id ?? `ov-${x}-${y}`, kind: a.kind, poly: [x, y, x + w, y, x + w, y + h, x, y + h], bbox: { x0: x, y0: y, x1: x + w, y1: y + h }, name: a.name });
  }
  const ORDER: AreaKind[] = ['grass', 'golf', 'forest', 'park', 'field', 'construction', 'parking', 'plaza', 'water'];
  for (const kind of ORDER) for (const a of areas) if (a.kind === kind) fillPoly(a.poly, setIf(AREA_TILE[kind]));

  const waterways = data.waterways.map((w) => ({ ...w, bbox: boxOf(w.pts, w.width) }));
  for (const w of waterways) stampLine(w.pts, w.width / 2, setIf(Tile.Water));

  // ------------------------------------------------------------ roads
  const laneW = terrainCfg.laneWidthMeters / mpt;
  const sideW = terrainCfg.sidewalkWidthMeters / mpt;
  const shoulder = terrainCfg.highwayShoulderMeters / mpt;
  const elevate = new Set(ov.elevate);
  const roads: BuiltRoad[] = data.roads.map((src) => {
    const r = elevate.has(src.id) ? { ...src, elevated: true } : src;
    const width = r.lanes * laneW + (r.cls === 'highway' ? shoulder : 0);
    const sidewalk = r.cls === 'arterial' || r.cls === 'street' ? sideW : 0;
    return { ...r, width, sidewalk, bbox: boxOf(r.pts, width / 2 + sidewalk) };
  });
  // Elevated roads (flyovers, the DASH viaduct) don't block anything on the ground.
  const ground = roads.filter((r) => !r.elevated);
  for (const r of ground) if (r.cls === 'highway') stampLine(r.pts, r.width / 2, setIf(Tile.Highway));
  const notAsphalt = (c: number) => c !== Tile.Road && c !== Tile.Water;
  for (const r of ground) if (r.sidewalk > 0) stampLine(r.pts, r.width / 2 + r.sidewalk, setIf(Tile.Sidewalk, notAsphalt));
  // Streets drawn over highways become underpasses, keeping both sides connected.
  for (const r of ground) if (r.cls !== 'highway') stampLine(r.pts, r.width / 2, setIf(Tile.Road, (c) => c !== Tile.Water));
  // Flyovers: where an elevated road passes over a highway or river it acts as a bridge
  // (walkable); elsewhere it's overhead and doesn't affect the ground.
  for (const r of roads)
    if (r.elevated && r.cls !== 'highway')
      stampLine(r.pts, r.width / 2 + r.sidewalk, setIf(Tile.Road, (c) => c === Tile.Highway || c === Tile.Water));
  const deck = new Uint8Array(W * H);
  for (const r of roads) if (r.elevated) stampLine(r.pts, r.width / 2, (i) => (deck[i] = 1));

  // ------------------------------------------------------------ footpaths + bridges
  const paths: BuiltMap['paths'] = data.paths.map((p) => ({ ...p, width: p.kind === 'pedestrian' ? 3 : 1.2, bbox: boxOf(p.pts, 2) }));
  for (const p of ov.paths) {
    const pts = p.pts.flat();
    paths.push({ id: `ov-path-${paths.length}`, kind: p.kind === 'bridge' ? 'footway' : 'footway', bridge: p.kind === 'bridge', width: p.width, pts, bbox: boxOf(pts, p.width) });
  }
  for (const p of paths) {
    stampLine(p.pts, p.width / 2, (i) => {
      const c = terrain[i];
      if (c === Tile.Highway || c === Tile.Water) terrain[i] = p.bridge ? Tile.Bridge : c;
      else if (c !== Tile.Road && c !== Tile.Sidewalk && c !== Tile.Crossing) terrain[i] = Tile.Path;
    });
  }

  // ------------------------------------------------------------ zebra crossings
  // Spatial buckets of road segments for nearest-road queries.
  const BUCKET = 16;
  const buckets = new Map<string, Array<[BuiltRoad, number]>>();
  for (const r of ground) {
    for (let s = 0; s + 3 < r.pts.length; s += 2) {
      const b = boxOf([r.pts[s], r.pts[s + 1], r.pts[s + 2], r.pts[s + 3]]);
      for (let by = Math.floor(b.y0 / BUCKET); by <= Math.floor(b.y1 / BUCKET); by++)
        for (let bx = Math.floor(b.x0 / BUCKET); bx <= Math.floor(b.x1 / BUCKET); bx++) {
          const k = `${bx},${by}`;
          const list = buckets.get(k) ?? [];
          list.push([r, s]);
          buckets.set(k, list);
        }
    }
  }
  const nearestRoad = (x: number, y: number, maxD: number, filter: (r: BuiltRoad) => boolean) => {
    let best: { r: BuiltRoad; s: number; d: number } | null = null;
    for (let by = Math.floor((y - maxD) / BUCKET); by <= Math.floor((y + maxD) / BUCKET); by++)
      for (let bx = Math.floor((x - maxD) / BUCKET); bx <= Math.floor((x + maxD) / BUCKET); bx++)
        for (const [r, s] of buckets.get(`${bx},${by}`) ?? []) {
          if (!filter(r)) continue;
          const d = segDist(x, y, r.pts[s], r.pts[s + 1], r.pts[s + 2], r.pts[s + 3]);
          if (d <= maxD && (!best || d < best.d)) best = { r, s, d };
        }
    return best;
  };
  const crossings: BuiltMap['crossings'] = [];
  for (let i = 0; i + 1 < data.crossings.length; i += 2) {
    const x = data.crossings[i], y = data.crossings[i + 1];
    const hit = nearestRoad(x, y, 2, (r) => r.cls !== 'highway');
    if (!hit) continue;
    const { r, s } = hit;
    const angle = Math.atan2(r.pts[s + 3] - r.pts[s + 1], r.pts[s + 2] - r.pts[s]);
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const half = r.width / 2;
    for (let ty = Math.floor(y - half - 2); ty <= Math.ceil(y + half + 2); ty++)
      for (let tx = Math.floor(x - half - 2); tx <= Math.ceil(x + half + 2); tx++) {
        const dx = tx + 0.5 - x, dy = ty + 0.5 - y;
        const along = dx * ux + dy * uy;
        const perp = -dx * uy + dy * ux;
        const ii = idx(tx, ty);
        if (ii >= 0 && Math.abs(along) <= 1.1 && Math.abs(perp) <= half && terrain[ii] === Tile.Road) terrain[ii] = Tile.Crossing;
      }
    crossings.push({ x, y, angle, width: r.width });
  }

  // ------------------------------------------------------------ buildings
  const named = ov.buildings;
  const builtBuildings: BuiltBuilding[] = [];
  for (const b of data.buildings) {
    const o = named[b.id];
    if (o?.hidden) continue;
    const kind = o?.kind ?? b.kind;
    const bb: BuiltBuilding = { id: b.id, name: o?.name, kind, levels: b.levels, poly: b.poly, bbox: boxOf(b.poly), door: null };
    builtBuildings.push(bb);
    if (kind === 'roof') fillPoly(b.poly, setIf(Tile.Roof, (c) => c === Tile.Grass || c === Tile.Plaza || c === Tile.Park || c === Tile.Parking || c === Tile.Path));
    else fillPoly(b.poly, setIf(Tile.Building));
  }

  // ------------------------------------------------------------ solidity
  const walkByTerrain = TERRAIN_NAMES.map((n) => terrainCfg.terrains[n]?.walk ?? 1);
  const driveByTerrain = TERRAIN_NAMES.map((n) => terrainCfg.terrains[n]?.vehicle ?? 0);
  const solid = new Uint8Array(W * H);
  const driveSolid = new Uint8Array(W * H);
  for (let i = 0; i < terrain.length; i++) {
    solid[i] = walkByTerrain[terrain[i]] > 0 ? 0 : 1;
    // On a deck you ride above whatever is below (river, highway); buildings still block.
    driveSolid[i] = driveByTerrain[terrain[i]] > 0 || (deck[i] && terrain[i] !== Tile.Building) ? 0 : 1;
  }

  // ------------------------------------------------------------ doors
  // Use an OSM entrance if there is one, else the wall facing the nearest road.
  const walkable = (tx: number, ty: number) => {
    const i = idx(tx, ty);
    return i >= 0 && !solid[i];
  };
  for (const b of builtBuildings) {
    if (b.kind === 'roof') continue;
    const p = b.poly;
    const src = data.buildings.find((x) => x.id === b.id);
    const cands: Array<{ x: number; y: number; nx: number; ny: number; score: number }> = [];
    for (let i = 0; i < p.length; i += 2) {
      const j = (i + 2) % p.length;
      const ax = p[i], ay = p[i + 1], bx = p[j], by = p[j + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1.2) continue;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      let nx = (by - ay) / len, ny = -(bx - ax) / len;
      if (pointInPoly(mx + nx * 0.5, my + ny * 0.5, p)) { nx = -nx; ny = -ny; }
      // Prefer facing a real street; back lanes (service roads) only count half as much.
      const street = nearestRoad(mx, my, 40, (r) => r.cls === 'street' || r.cls === 'arterial');
      const lane = nearestRoad(mx, my, 40, (r) => r.cls === 'service');
      let score = Math.min(street ? street.d : 80, lane ? lane.d * 2 + 6 : 80);
      if (src?.entrances) {
        for (let e = 0; e < src.entrances.length; e += 2) {
          if (segDist(src.entrances[e], src.entrances[e + 1], ax, ay, bx, by) < 1) score -= 100;
        }
      }
      cands.push({ x: mx, y: my, nx, ny, score });
    }
    const manual = named[b.id]?.door;
    if (manual) cands.unshift({ x: manual[0], y: manual[1], nx: 0, ny: 1, score: -1e9 });
    cands.sort((a, c) => a.score - c.score);
    for (const c of cands) {
      const fx = Math.floor(c.x + c.nx * 1.2), fy = Math.floor(c.y + c.ny * 1.2);
      if (walkable(fx, fy)) {
        b.door = { x: c.x, y: c.y, frontX: fx, frontY: fy };
        break;
      }
    }
  }

  // ------------------------------------------------------------ decor
  const decor = new Uint8Array(W * H);
  const fronts = new Set(builtBuildings.filter((b) => b.door).map((b) => idx(b.door!.frontX, b.door!.frontY)));
  for (let i = 0; i + 1 < data.trees.length; i += 2) {
    const ii = idx(Math.floor(data.trees[i]), Math.floor(data.trees[i + 1]));
    if (ii >= 0 && !solid[ii] && !deck[ii] && terrain[ii] !== Tile.Road && terrain[ii] !== Tile.Crossing) decor[ii] = Decor.Tree;
  }
  for (let gy = 0; gy < H; gy++) {
    for (let gx = 0; gx < W; gx++) {
      const i = gy * W + gx;
      // Nothing grows under a viaduct deck (trees would be drawn on top of the road).
      if (decor[i] || fronts.has(i) || deck[i]) continue;
      const t = terrain[i];
      const tx = gx + originTx, ty = gy + originTy;
      const h = tileHash(tx, ty);
      // Space trees out: only on a sparse lattice so canopies (3-4 tiles wide) don't overlap too much.
      const lattice = tx % 3 === 0 && ty % 3 === 0;
      if (t === Tile.Forest) decor[i] = lattice && h < 0.75 ? (h < 0.5 ? Decor.Tree : Decor.Pine) : h < 0.04 ? Decor.Bush : 0;
      else if (t === Tile.Park) decor[i] = lattice && h < 0.25 ? (h < 0.17 ? Decor.Tree : Decor.Palm) : h < 0.012 ? Decor.Flowers : h < 0.02 ? Decor.Bench : 0;
      else if (t === Tile.Golf) decor[i] = lattice && h < 0.08 ? Decor.Tree : 0;
      else if (t === Tile.Grass) decor[i] = lattice && h < 0.07 ? Decor.Tree : h < 0.004 ? Decor.Bush : 0;
      else if (t === Tile.Plaza) decor[i] = h < 0.012 ? Decor.Flowers : h < 0.022 ? Decor.Bench : lattice && h < 0.08 ? Decor.Palm : 0;
      else if (t === Tile.Sidewalk) decor[i] = tx % 12 === 0 || ty % 12 === 0 ? (h < 0.22 ? Decor.Lamp : 0) : 0;
    }
  }
  const DECOR_IDS: Record<string, number> = { fountain: Decor.Fountain, jobsboard: Decor.JobsBoard, lookout: Decor.Lookout, busstop: Decor.BusStop, stall: Decor.Stall };
  for (const d of ov.decor) {
    const ii = idx(Math.floor(d.x), Math.floor(d.y));
    if (ii >= 0) decor[ii] = DECOR_IDS[d.kind];
  }

  // Interactables: at a building's door front, or at an explicit point.
  const interactables: BuiltMap['interactables'] = [];
  for (const it of ov.interactables) {
    let x = it.x, y = it.y;
    if (it.building) {
      const b = builtBuildings.find((bb) => bb.id === it.building);
      if (!b?.door) continue;
      x = b.door.frontX + 0.5;
      y = b.door.frontY + 0.5;
    }
    if (x === undefined || y === undefined) continue;
    interactables.push({ id: it.id, type: it.type, name: it.name, crate: it.crate, x, y });
  }

  // Stall plots: a point, or a shoplot's door (the queue forms outside, along the shopfront).
  const stallPlots: BuiltMap['stallPlots'] = [];
  for (const sp of ov.stallPlots) {
    if (sp.building) {
      const b = builtBuildings.find((bb) => bb.id === sp.building);
      if (!b?.door) continue;
      // Which way the door faces (dominant axis): the queue forms outside, along the shopfront.
      const dx = b.door.frontX - b.door.x, dy = b.door.frontY - b.door.y;
      const ox = Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : 0;
      const oy = ox === 0 ? Math.sign(dy) || 1 : 0;
      stallPlots.push({
        id: sp.id, tier: sp.tier, building: sp.building, x: b.door.frontX + 0.5, y: b.door.frontY + 0.5,
        queueFrom: sp.queueFrom ?? [ox * 1.2 - oy * 0.6, oy * 1.2 + ox * 0.6], queueStep: sp.queueStep ?? [oy !== 0 ? 0.75 : 0, ox !== 0 ? 0.75 : 0],
      });
    } else if (sp.x !== undefined && sp.y !== undefined) {
      stallPlots.push({ id: sp.id, tier: sp.tier, x: sp.x, y: sp.y, queueFrom: sp.queueFrom ?? [1.6, 1.4], queueStep: sp.queueStep ?? [0.75, 0] });
    }
  }

  // Exact collision: buildings collide by their real (often angled) outlines, so walls feel
  // smooth instead of tile-shaped staircases. Everything else stays tile-based.
  const polyIndex = buildPolyIndex(builtBuildings.filter((b) => b.kind !== 'roof').map((b) => b.poly));
  const walkTiles = solid.slice();
  const driveTiles = driveSolid.slice();
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] === Tile.Building) {
      walkTiles[i] = 0;
      driveTiles[i] = 0;
    }
  }
  const T = ov.tileSize;
  const gridBase = { width: W, height: H, tileSize: T, originTx, originTy };
  return {
    collision: { ...gridBase, solid: walkTiles, polys: polyIndex },
    driveCollision: { ...gridBase, solid: driveTiles, polys: polyIndex },
    interactables,
    stallPlots,
    driveSolid,
    deck,
    width: W,
    height: H,
    tileSize: T,
    metersPerTile: mpt,
    originTx,
    originTy,
    terrain,
    solid,
    decor,
    roads,
    paths,
    areas,
    waterways,
    rails: data.rails.map((r) => ({ ...r, bbox: boxOf(r.pts, 3) })),
    buildings: builtBuildings,
    crossings,
    overrides: ov,
    attribution: data.meta.attribution,
    spawnPx: { x: (ov.spawn[0] + 0.5) * T, y: (ov.spawn[1] + 0.5) * T },
  };
}

/**
 * Vehicle speed multiplier per grid cell (0..1) from terrain.json: roads 1.0, grass 0.4...
 * Under an elevated deck the vehicle is on the deck, so it gets road speed.
 */
export function vehicleSpeedGrid(map: Pick<BuiltMap, 'terrain' | 'deck'>, terrainCfg: TerrainConfig): Float32Array {
  const byTerrain = TERRAIN_NAMES.map((n) => terrainCfg.terrains[n]?.vehicle ?? 0.4);
  const road = terrainCfg.terrains.road?.vehicle ?? 1;
  const out = new Float32Array(map.terrain.length);
  for (let i = 0; i < out.length; i++) out[i] = map.deck[i] ? Math.max(road, byTerrain[map.terrain[i]]) : byTerrain[map.terrain[i]];
  return out;
}

/** Grid index for a world-pixel position, or -1 outside the map. */
export function gridIndexAt(map: BuiltMap, wx: number, wy: number): number {
  const gx = Math.floor(wx / map.tileSize) - map.originTx;
  const gy = Math.floor(wy / map.tileSize) - map.originTy;
  return gx < 0 || gy < 0 || gx >= map.width || gy >= map.height ? -1 : gy * map.width + gx;
}

/** Which district (by rect, tile coords) contains a tile. Districts listed first win. */
export function districtAt(map: BuiltMap, tx: number, ty: number) {
  for (const d of map.overrides.districts) {
    const [x, y, w, h] = d.rect;
    if (tx >= x && ty >= y && tx < x + w && ty < y + h) return d;
  }
  return undefined;
}
