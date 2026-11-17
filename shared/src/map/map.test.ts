import { describe, expect, it } from 'vitest';
import osmJson from '../../map/kd.osm.json';
import overridesJson from '../../map/town.overrides.json';
import terrainJson from '../../config/terrain.json';
import { terrainConfigSchema } from '../config/schemas';
import { buildMap, districtAt, gridIndexAt, pointInPoly, Tile } from './build';
import { collides, moveWithCollision, pathClear } from './collision';
import type { MapSource } from './types';

const source = { data: osmJson, overrides: overridesJson } as unknown as MapSource;
const terrain = terrainConfigSchema.parse(terrainJson);
const map = buildMap(source, terrain);
const hb = { w: 16, h: 10 };

function floodFromSpawn() {
  const W = map.width;
  const seen = new Uint8Array(W * map.height);
  const start = gridIndexAt(map, map.spawnPx.x, map.spawnPx.y);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % W;
    const y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= map.height) continue;
      const j = ny * W + nx;
      if (!seen[j] && !map.solid[j]) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  return seen;
}

describe('town map v2 (OSM, real scale)', () => {
  it('is 768×576 tiles at 2 m per tile with Menara Mitraland at the origin', () => {
    expect(map.width).toBe(768);
    expect(map.height).toBe(576);
    expect(map.metersPerTile).toBe(2);
    const menara = map.buildings.find((b) => b.name === 'Menara Mitraland')!;
    expect(menara).toBeTruthy();
    expect(pointInPoly(0, 0, menara.poly) || Math.hypot((menara.bbox.x0 + menara.bbox.x1) / 2, (menara.bbox.y0 + menara.bbox.y1) / 2) < 3).toBe(true);
  });

  it('every landmark override points at a real OSM building', () => {
    const ids = new Set(map.buildings.map((b) => b.id));
    const missing = Object.keys(overridesJson.buildings).filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });

  it('carries no shop or brand names from OSM (only street names)', () => {
    const data = osmJson as unknown as { buildings: object[]; areas: object[]; roads: Array<{ cls: string; name?: string }> };
    expect(data.buildings.some((b) => 'name' in b)).toBe(false);
    expect(data.areas.some((a) => 'name' in a)).toBe(false);
    expect(data.roads.some((r) => r.cls === 'service' && r.name)).toBe(false);
  });

  it('has real lanes: arterial roads are wider than residential streets', () => {
    const arterial = map.roads.filter((r) => r.name === 'Persiaran Surian').sort((a, b) => b.width - a.width)[0];
    const street = map.roads.find((r) => r.cls === 'street' && r.lanes === 2)!;
    expect(arterial.width).toBeGreaterThan(street.width);
    expect(street.width).toBeCloseTo(3.5, 1); // 2 lanes × 3.5 m / 2 m per tile
  });

  it('spawns on a walkable tile', () => {
    expect(collides(map, map.spawnPx.x, map.spawnPx.y, hb)).toBe(false);
  });

  it('can walk from spawn to almost all walkable ground, every door and every district', () => {
    const seen = floodFromSpawn();
    let walk = 0, reach = 0;
    for (let i = 0; i < seen.length; i++) {
      if (map.solid[i]) continue;
      walk++;
      if (seen[i]) reach++;
    }
    expect(reach / walk).toBeGreaterThan(0.98);
    const unreachable = map.buildings
      .filter((b) => b.door && !seen[gridIndexAt(map, (b.door.frontX + 0.5) * map.tileSize, (b.door.frontY + 0.5) * map.tileSize)])
      .map((b) => b.id);
    expect(unreachable).toEqual([]);
    for (const d of map.overrides.districts) {
      const [x, y, w, h] = d.rect;
      let ok = false;
      for (let ty = y; ty < y + h && !ok; ty += 2)
        for (let tx = x; tx < x + w && !ok; tx += 2) {
          const i = gridIndexAt(map, tx * map.tileSize, ty * map.tileSize);
          if (i >= 0 && seen[i] && districtAt(map, tx, ty)?.id === d.id) ok = true;
        }
      expect(ok, `district ${d.id}`).toBe(true);
    }
  });

  it('highways block walking but footbridges/flyovers cross them', () => {
    let highway = 0, bridge = 0;
    for (let i = 0; i < map.terrain.length; i++) {
      if (map.terrain[i] === Tile.Highway) {
        highway++;
        expect(map.solid[i]).toBe(1);
      }
      if (map.terrain[i] === Tile.Bridge) bridge++;
    }
    expect(highway).toBeGreaterThan(1000);
    expect(bridge).toBeGreaterThan(0);
  });

  it('builds identical maps every time (client and server agree)', () => {
    const again = buildMap(source, terrain);
    expect(Array.from(again.solid)).toEqual(Array.from(map.solid));
    expect(Array.from(again.decor)).toEqual(Array.from(map.decor));
  });
});

describe('collision with a world origin', () => {
  // 4×4 grid whose cell (0,0) is at tile (-2,-2); wall at grid (1,1) = tile (-1,-1).
  const solid = new Uint8Array(16);
  solid[1 * 4 + 1] = 1;
  const grid = { width: 4, height: 4, tileSize: 32, originTx: -2, originTy: -2, solid };

  it('detects solid tiles and map edges in origin-relative coordinates', () => {
    expect(collides(grid, -16, -4, hb)).toBe(true); // inside tile (-1,-1)
    expect(collides(grid, -48, -40, hb)).toBe(false); // tile (-2,-2)
    expect(collides(grid, -60, -40, hb)).toBe(true); // pokes off the left edge
  });

  it('slides along walls and stops flush', () => {
    const r = moveWithCollision(grid, -48, -4, 20, 0, hb);
    expect(r.x).toBeLessThanOrEqual(-32 - hb.w / 2);
    const d = moveWithCollision(grid, -41, -4, 10, 10, hb);
    expect(d.y).toBeCloseTo(6);
  });

  it('pathClear rejects walking through walls', () => {
    expect(pathClear(grid, -48, -4, 16, -4, hb)).toBe(false);
    expect(pathClear(grid, -48, -40, 16, -40, hb)).toBe(true);
  });
});
