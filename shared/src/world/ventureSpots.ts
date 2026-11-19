// Where each Venture (the idle businesses, the Kedai Runcit, the Butik) "is" in town. They're
// run from the phone, but owning one should show on the map and in the street: each gets its own
// building, picked the same way on every device (shops and offices with a door, nearest the
// spawn first, skipping buildings that are already something else: signposted places, homes for
// sale, kopitiam shoplots). Purely for show: the server doesn't care where they are.
import type { BuiltMap } from '../map/build';

export interface VentureSpot {
  building: string;
  /** Tile coords of the main door's front (where the sign and the map pin go). */
  x: number;
  y: number;
}

const KINDS_FIRST = ['shop', 'office'];
const KINDS_THEN = ['shoplot', 'tower', 'roof'];

export function ventureSpots(map: Pick<BuiltMap, 'buildings' | 'spawnPx' | 'tileSize'>, ids: readonly string[], taken: ReadonlySet<string>): Map<string, VentureSpot> {
  const T = map.tileSize;
  const sx = map.spawnPx.x / T, sy = map.spawnPx.y / T;
  const cands = (kinds: string[]) =>
    map.buildings
      .filter((b) => b.door && kinds.includes(b.kind) && !taken.has(b.id))
      .map((b) => ({ b, d: Math.hypot(b.door!.frontX - sx, b.door!.frontY - sy) }))
      .sort((a, z) => a.d - z.d || a.b.id.localeCompare(z.b.id));
  // Every other candidate, so neighbouring businesses aren't all in one row.
  const pool = [...cands(KINDS_FIRST), ...cands(KINDS_THEN)].filter((_, i) => i % 2 === 0);
  const out = new Map<string, VentureSpot>();
  ids.forEach((id, i) => {
    const c = pool[i];
    if (c) out.set(id, { building: c.b.id, x: c.b.door!.frontX + 0.5, y: c.b.door!.frontY + 0.5 });
  });
  return out;
}
