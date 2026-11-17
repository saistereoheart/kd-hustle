import { describe, expect, it } from 'vitest';
import osmJson from '../../map/kd.osm.json';
import overridesJson from '../../map/town.overrides.json';
import terrainJson from '../../config/terrain.json';
import { terrainConfigSchema } from '../config/schemas';
import { buildMap, districtAt, gridIndexAt, pointInPoly, Tile, vehicleSpeedGrid } from './build';
import { buildPolyIndex, collides, moveWithCollision, pathClear } from './collision';
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

  it('highways block walking but not vehicles; buildings block both', () => {
    let highway = 0;
    for (let i = 0; i < map.terrain.length; i++) {
      if (map.terrain[i] === Tile.Highway) {
        highway++;
        expect(map.solid[i]).toBe(1);
        expect(map.driveSolid[i]).toBe(0);
      }
      if (map.terrain[i] === Tile.Building) expect(map.driveSolid[i]).toBe(1);
    }
    expect(highway).toBeGreaterThan(1000);
  });

  it('places every interactable on reachable ground', () => {
    const seen = floodFromSpawn();
    for (const it of map.interactables) {
      const i = gridIndexAt(map, it.x * map.tileSize, it.y * map.tileSize);
      expect(seen[i], it.id).toBe(1);
    }
    expect(map.interactables.map((i) => i.id).sort()).toEqual(['capsule_machine', 'carwash', 'jobsboard', 'kedai_pajak', 'luckybag_stall', 'mallbox_counter']);
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

describe('exact (polygon) building collision', () => {
  // A triangle with a 45° wall from (0,0) to (4,4) tiles; the open side is above/right of it.
  const grid = { width: 10, height: 10, tileSize: 32, originTx: -2, originTy: -2, solid: new Uint8Array(100), polys: buildPolyIndex([[0, 0, 0, 4, 4, 4]]) };

  it('blocks inside the outline and allows standing right next to an angled wall', () => {
    // Deep inside the triangle (bottom-left corner area).
    expect(collides(grid, 0.6 * 32, 3.6 * 32, hb)).toBe(true);
    // Just above the diagonal at x=2.5 tiles: the wall is at y=2.5; feet at y=2.2 are clear.
    // A tile grid would have blocked this whole tile (its centre is inside the triangle).
    expect(collides(grid, 2.6 * 32, 2.2 * 32, hb)).toBe(false);
  });

  it('slides smoothly along the diagonal instead of catching on tile steps', () => {
    // Walk right along the wall: x keeps increasing, y gets pushed up by the slope.
    let pos = { x: 1.5 * 32, y: 1.2 * 32 };
    const start = pos.x;
    for (let i = 0; i < 40; i++) pos = moveWithCollision(grid, pos.x, pos.y, 2, 0, hb);
    expect(pos.x - start).toBeGreaterThan(0); // never stuck behind a step
  });

  it('glides along an angled wall when pushing straight into it', () => {
    // Press "down" onto the 45° wall: instead of stopping dead, slide down-right along it.
    let pos = { x: 1.6 * 32, y: 1.3 * 32 };
    for (let i = 0; i < 30; i++) pos = moveWithCollision(grid, pos.x, pos.y, 0, 2, hb);
    const stuckAt = { ...pos };
    for (let i = 0; i < 30; i++) pos = moveWithCollision(grid, pos.x, pos.y, 0, 2, hb);
    expect(pos.x - stuckAt.x).toBeGreaterThan(15);
    expect(pos.y - stuckAt.y).toBeGreaterThan(15);
    expect(collides(grid, pos.x, pos.y, hb)).toBe(false);
    // ...and the server accepts that sliding path.
    expect(pathClear(grid, stuckAt.x, stuckAt.y, pos.x, pos.y, hb)).toBe(true);
  });

  it('still stops dead against a wall hit head-on', () => {
    // Flat wall on the triangle's bottom edge (y = 4 tiles), approached from below, pressing up.
    let pos = { x: 1.5 * 32, y: 4.6 * 32 };
    for (let i = 0; i < 40; i++) pos = moveWithCollision(grid, pos.x, pos.y, 0, -2, hb);
    const x0 = pos.x;
    for (let i = 0; i < 20; i++) pos = moveWithCollision(grid, pos.x, pos.y, 0, -2, hb);
    expect(Math.abs(pos.x - x0)).toBeLessThan(0.01);
  });
});

describe('elevated decks (the DASH above The Strand)', () => {
  it('vehicles ride on the deck at road speed while walkers pass underneath', () => {
    const speed = vehicleSpeedGrid(map, terrain);
    let overGrass = 0;
    for (let i = 0; i < map.deck.length; i++) {
      if (!map.deck[i] || map.terrain[i] !== Tile.Grass) continue;
      overGrass++;
      expect(speed[i]).toBe(terrain.terrains.road.vehicle);
      expect(map.driveSolid[i]).toBe(0);
      expect(map.solid[i]).toBe(0);
    }
    expect(overGrass).toBeGreaterThan(1000);
    // Nothing grows under a deck (trees are drawn above everything, so they'd sit on the road).
    for (let i = 0; i < map.deck.length; i++) if (map.deck[i]) expect(map.decor[i]).toBe(0);
    // Elevated highways over a ground highway or river are drivable too.
    for (let i = 0; i < map.deck.length; i++) if (map.deck[i] && map.terrain[i] === Tile.Water) expect(map.driveSolid[i]).toBe(0);
  });
});

