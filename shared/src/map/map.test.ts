import { describe, expect, it } from 'vitest';
import townJson from '../../map/town.json';
import { buildMap, districtAt, Tile } from './build';
import { collides, moveWithCollision, pathClear } from './collision';
import type { MapLayout } from './types';

const layout = townJson as unknown as MapLayout;
const map = buildMap(layout);
const hb = { w: 16, h: 10 };

describe('town map data', () => {
  it('is at least 256x192 tiles', () => {
    expect(map.width).toBeGreaterThanOrEqual(256);
    expect(map.height).toBeGreaterThanOrEqual(192);
  });

  it('has no building overlapping a road, water, bridge or another building', () => {
    const bare = buildMap({ ...layout, buildings: [], rows: [] });
    const blocked: ReadonlySet<number> = new Set([Tile.Street, Tile.Sidewalk, Tile.Zebra, Tile.Highway, Tile.Water, Tile.Bridge]);
    const owner = new Map<number, string>();
    const problems: string[] = [];
    for (const b of map.buildings) {
      for (let y = b.y; y < b.y + b.h; y++) {
        for (let x = b.x; x < b.x + b.w; x++) {
          const i = y * map.width + x;
          if (x < 0 || y < 0 || x >= map.width || y >= map.height) problems.push(`${b.id} out of bounds`);
          if (blocked.has(bare.ground[i])) problems.push(`${b.id} sits on tile ${bare.ground[i]} at ${x},${y}`);
          if (owner.has(i)) problems.push(`${b.id} overlaps ${owner.get(i)} at ${x},${y}`);
          owner.set(i, b.id);
        }
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it('spawns on a walkable tile', () => {
    expect(collides(map, map.spawnPx.x, map.spawnPx.y, hb)).toBe(false);
  });

  it('can reach every building door and every district from spawn', () => {
    // Flood fill over walkable tiles.
    const seen = new Uint8Array(map.width * map.height);
    const sx = Math.floor(map.spawnPx.x / map.tileSize);
    const sy = Math.floor(map.spawnPx.y / map.tileSize);
    const queue = [sy * map.width + sx];
    seen[queue[0]] = 1;
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % map.width;
      const y = (i - x) / map.width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        const j = ny * map.width + nx;
        if (!seen[j] && !map.solid[j]) {
          seen[j] = 1;
          queue.push(j);
        }
      }
    }
    const unreachable = map.buildings
      .filter((b) => {
        const { frontX, frontY } = b.door;
        if (frontX < 0 || frontY < 0 || frontX >= map.width || frontY >= map.height) return true;
        return !seen[frontY * map.width + frontX];
      })
      .map((b) => b.id);
    expect(unreachable).toEqual([]);

    for (const d of map.layout.districts) {
      const [x, y, w, h] = d.rect;
      let found = false;
      for (let ty = y; ty < y + h && !found; ty++)
        for (let tx = x; tx < x + w && !found; tx++)
          if (seen[ty * map.width + tx] && districtAt(map, tx, ty)?.id === d.id) found = true;
      expect(found, `district ${d.id} reachable`).toBe(true);
    }
  });

  it('puts Menara Mitraland near the centre of the map', () => {
    const m = map.buildings.find((b) => b.id === 'menara_mitraland')!;
    expect(Math.abs(m.x + m.w / 2 - map.width / 2)).toBeLessThan(4);
    expect(Math.abs(m.y + m.h / 2 - map.height / 2)).toBeLessThan(4);
  });

  it('builds identical maps every time (client and server agree)', () => {
    const again = buildMap(layout);
    expect(Array.from(again.solid)).toEqual(Array.from(map.solid));
    expect(Array.from(again.decor)).toEqual(Array.from(map.decor));
  });
});

describe('collision', () => {
  const grid = { width: 4, height: 4, tileSize: 32, solid: new Uint8Array([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) };

  it('detects solid tiles and map edges', () => {
    expect(collides(grid, 48, 60, hb)).toBe(true); // inside tile (1,1)
    expect(collides(grid, 16, 20, hb)).toBe(false);
    expect(collides(grid, 4, 20, hb)).toBe(true); // hitbox pokes off the left edge
  });

  it('slides along walls and stops flush', () => {
    // Walking right from x=16 in row 1 towards the wall at tile x=1.
    const r = moveWithCollision(grid, 16, 60, 20, 0, hb);
    expect(r.x).toBeLessThanOrEqual(32 - hb.w / 2);
    expect(r.x).toBeGreaterThan(22);
    // Diagonal into the wall: x is blocked but y still moves.
    const d = moveWithCollision(grid, 23, 60, 10, 10, hb);
    expect(d.y).toBeCloseTo(70);
  });

  it('pathClear rejects walking through walls', () => {
    expect(pathClear(grid, 16, 60, 80, 60, hb)).toBe(false);
    expect(pathClear(grid, 16, 20, 80, 20, hb)).toBe(true);
  });
});
