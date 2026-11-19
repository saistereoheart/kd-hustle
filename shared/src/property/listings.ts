// Which homes are for sale: every flat, condo, terrace, semi-D and bungalow building on the map
// becomes one or more units. Unit ids are "<OSM building id>#<n>", so ownership survives map
// changes (spec rule 10). Prices depend on the type and the location (near the MRT, The Strand
// and Dataran Sunway is worth more), with a small fixed per-unit variation.
import type { BuiltMap } from '../map/build';
import { locationMult } from './rating';
import type { PropertiesConfig } from './schemas';

export interface Unit {
  id: string;
  building: string;
  /** Unit number within the building (1-based). */
  n: number;
  type: string;
  priceSen: number;
  /** Location demand multiplier (1 … 1 + locationBonus). */
  loc: number;
  /** Door front (tile coords): where you stand to buy or go in. */
  x: number;
  y: number;
}

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Plain shoplots become homes (lofts), but never one that's a shop, has a counter or machine
 * inside, or holds a stall (named buildings are landmarks).
 */
export function buildListings(map: Pick<BuiltMap, 'buildings'> & Partial<Pick<BuiltMap, 'interactables' | 'stallPlots' | 'metersPerTile'>>, cfg: PropertiesConfig): Unit[] {
  const busy = new Set<string>([...(map.interactables ?? []).map((i) => i.building ?? ''), ...(map.stallPlots ?? []).filter((p) => !p.auto).map((p) => p.building ?? '')]);
  const mpt = map.metersPerTile ?? 2;
  const spots: Array<[number, number]> = [];
  for (const h of cfg.hotspots) {
    if (h.point) spots.push(h.point);
    else if (h.building) {
      const d = map.buildings.find((b) => b.id === h.building)?.door;
      if (d) spots.push([d.frontX, d.frontY]);
    }
  }
  const out: Unit[] = [];
  for (const b of map.buildings) {
    const rule = cfg.byKind[b.kind];
    if (!rule || !b.door) continue;
    // A building with a counter, machine or stall inside is a landmark, not a home (Menara
    // Mitraland has the vaults). Named shoplots too.
    if (busy.has(b.id) || (b.kind === 'shoplot' && b.name)) continue;
    const area = (b.bbox.x1 - b.bbox.x0) * (b.bbox.y1 - b.bbox.y0) * mpt * mpt;
    const units = rule.perM2 ? Math.max(1, Math.min(rule.units, Math.floor(area / rule.perM2))) : rule.units;
    const x = b.door.frontX + 0.5, y = b.door.frontY + 0.5;
    const dist = Math.min(1e9, ...spots.map(([sx, sy]) => Math.hypot(sx - x, sy - y)));
    const loc = locationMult(cfg, dist);
    for (let n = 1; n <= units; n++) {
      const type = rule.types ? rule.types[(n - 1) % rule.types.length] : rule.type!;
      const t = cfg.types[type];
      if (!t) continue;
      const id = `${b.id}#${n}`;
      const jitter = 1 + (hash01(id) * 2 - 1) * cfg.priceJitter;
      // Round to RM 1,000.
      const priceSen = Math.round((t.priceSen * loc * jitter) / 100_000) * 100_000;
      out.push({ id, building: b.id, n, type, priceSen, loc, x, y });
    }
  }
  return out;
}
