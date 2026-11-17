// Where to put a player when they log in. Positions are stored relative to the fixed world
// origin, so growing the map never moves anyone. But if the map data changed (a new building
// now stands where someone logged out) we nudge them to the nearest walkable spot, and if the
// saved position belongs to an incompatible map version we send them to spawn.
import { collides, type CollisionGrid, type Hitbox } from '@kh/shared';

export interface Placement {
  x: number;
  y: number;
  moved: boolean;
  reason: 'ok' | 'nudged' | 'map-version' | 'invalid' | 'no-space';
}

export function placePlayer(
  grid: CollisionGrid,
  hb: Hitbox,
  saved: { x: number; y: number; mapVersion: number },
  current: { mapVersion: number; spawn: { x: number; y: number } },
  maxRadiusTiles = 40,
): Placement {
  const { spawn } = current;
  if (saved.mapVersion !== current.mapVersion) return { ...spawn, moved: true, reason: 'map-version' };
  if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return { ...spawn, moved: true, reason: 'invalid' };
  if (!collides(grid, saved.x, saved.y, hb)) return { x: saved.x, y: saved.y, moved: false, reason: 'ok' };
  // Search outward in rings of tiles for the closest free spot.
  const T = grid.tileSize;
  const cx = Math.floor(saved.x / T);
  const cy = Math.floor(saved.y / T);
  for (let r = 1; r <= maxRadiusTiles; r++) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = (cx + dx + 0.5) * T;
        const y = (cy + dy + 0.5) * T + 6;
        if (collides(grid, x, y, hb)) continue;
        const d = Math.hypot(x - saved.x, y - saved.y);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    if (best) return { x: best.x, y: best.y, moved: true, reason: 'nudged' };
  }
  return { ...spawn, moved: true, reason: 'no-space' };
}
