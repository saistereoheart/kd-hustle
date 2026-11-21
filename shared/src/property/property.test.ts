import { describe, expect, it } from 'vitest';
import furnitureJson from '../../config/furniture.json';
import propertiesJson from '../../config/properties.json';
import itemsJson from '../../config/items.json';
import raritiesJson from '../../config/rarities.json';
import osmJson from '../../map/kd.osm.json';
import overridesJson from '../../map/town.overrides.json';
import terrainJson from '../../config/terrain.json';
import { terrainConfigSchema } from '../config/schemas';
import { buildMap } from '../map/build';
import type { MapSource } from '../map/types';
import { furnitureConfigSchema, propertiesConfigSchema, type Placed } from './schemas';
import { bookingChance, fairNightSen, layoutProblem, rateUnit, suggestions, tenantHappiness, type RatingCfg } from './rating';
import { buildListings } from './listings';

const furniture = furnitureConfigSchema.parse(furnitureJson);
const properties = propertiesConfigSchema.parse(propertiesJson);
const tiers = (raritiesJson as { tiers: Array<{ id: string }> }).tiers.map((t) => t.id);
const rarityOf = new Map((itemsJson as { items: Array<{ id: string; rarity: string }> }).items.map((i) => [i.id, tiers.indexOf(i.rarity)]));
const cfg: RatingCfg = { furniture, properties, rarityIndex: (id) => rarityOf.get(id) ?? 0 };
const studio = { w: properties.types.studio.w, h: properties.types.studio.h };

let iid = 1;
const at = (item: string, x: number, y: number, rot = 0): Placed => ({ iid: iid++, item, x, y, rot });

/** A tidy studio with every essential. */
function essentials(): Placed[] {
  return [at('basic_bed', 0, 1), at('toilet', 6, 1), at('shower', 6, 2), at('kitchenette', 3, 1), at('aircond', 2, 0), at('wifi_router', 0, 0)];
}

describe('furniture config', () => {
  it('every piece is an item of type furniture, and store prices beat the pawn value', () => {
    const items = new Map((itemsJson as { items: Array<{ id: string; type: string; valueSen?: number }> }).items.map((i) => [i.id, i]));
    for (const [id, p] of Object.entries(furniture.pieces)) {
      expect(items.get(id)?.type, id).toBe('furniture');
      if (p.storeSen) expect(items.get(id)?.valueSen, id).toBe(p.storeSen);
    }
    // Each essential can be bought.
    for (const e of furniture.essentials) expect(Object.values(furniture.pieces).some((p) => p.essential === e && p.storeSen), e).toBe(true);
  });
});

describe('star rating (spec §9.3)', () => {
  it('an empty unit is the minimum; every missing essential caps the stars', () => {
    expect(rateUnit(cfg, studio, [], 100).stars).toBeLessThanOrEqual(1.5);
    const all = rateUnit(cfg, studio, essentials(), 100);
    expect(all.missing).toEqual([]);
    const noWifi = rateUnit(cfg, studio, essentials().filter((p) => p.item !== 'wifi_router'), 100);
    expect(noWifi.missing).toEqual(['wifi']);
    expect(noWifi.stars).toBeLessThanOrEqual(properties.rating.missingCap);
  });

  it('better and matching furniture visibly raises the stars', () => {
    const plain = rateUnit(cfg, studio, essentials(), 100);
    // Swap in a Japandi set: queen bed, sofa, low table, lantern, bonsai.
    const japandi = [...essentials().filter((p) => p.item !== 'basic_bed'), at('queen_bed', 0, 1), at('japandi_sofa', 2, 4), at('low_table', 3, 3), at('paper_lantern', 5, 4), at('bonsai', 6, 4)];
    const nice = rateUnit(cfg, studio, japandi, 100);
    expect(nice.themes.japandi).toBe(5); // queen bed, sofa, table, lantern, bonsai
    expect(nice.stars).toBeGreaterThan(plain.stars + 0.4);
    // Rare gacha pieces matter.
    const luxe = [...japandi, at('gold_chandelier', 4, 0)];
    expect(rateUnit(cfg, studio, luxe, 100).factors.rarity).toBeGreaterThan(nice.factors.rarity);
  });

  it('cleanliness and a blocked walkway cost stars', () => {
    const clean = rateUnit(cfg, studio, essentials(), 100);
    const dirty = rateUnit(cfg, studio, essentials(), 30);
    expect(dirty.stars).toBeLessThan(clean.stars);
    // A wall of wardrobes across the room cuts the back off from the door.
    const wall = [...essentials(), ...Array.from({ length: Math.ceil(studio.w / 2) }, (_, k) => at('wardrobe', Math.min(studio.w - 2, k * 2), 3))];
    expect(rateUnit(cfg, studio, wall, 100).blocked).toBe(true);
  });

  it('checks layouts: inside the room, no overlap, doorway clear, wall items on a wall', () => {
    expect(layoutProblem(cfg, studio, essentials())).toBeNull();
    expect(layoutProblem(cfg, studio, [at('basic_bed', studio.w - 1, 1)])).toMatch(/sticks out/);
    expect(layoutProblem(cfg, studio, [at('basic_bed', 0, 1), at('scandi_sofa', 1, 1)])).toMatch(/overlap/);
    expect(layoutProblem(cfg, studio, [at('toilet', Math.floor(studio.w / 2) - 1, studio.h - 1)])).toMatch(/doorway/);
    expect(layoutProblem(cfg, studio, [at('smart_tv', 2, 3)])).toMatch(/wall/);
    // A rug can sit under a sofa; a rotated sofa is 1×3.
    expect(layoutProblem(cfg, studio, [at('big_rug', 2, 2), at('scandi_sofa', 2, 2, 1)])).toBeNull();
  });
});

describe('suggestions (spec §9.4)', () => {
  it('names the missing essential first, with its predicted gain', () => {
    const s = suggestions(cfg, { ...studio, type: 'studio', loc: 1 }, essentials().filter((p) => p.item !== 'aircond'), 100, []);
    expect(s[0].action).toMatchObject({ kind: 'buy', item: 'aircond' });
    expect(s[0].gain).toBeGreaterThan(0);
    expect(s[0].nightGainSen).toBeGreaterThan(0);
    // The prediction is exact: doing it gives that rating.
    const after = rateUnit(cfg, studio, essentials(), 100).stars;
    const before = rateUnit(cfg, studio, essentials().filter((p) => p.item !== 'aircond'), 100).stars;
    expect(s[0].gain).toBeCloseTo(after - before, 5);
  });

  it('prefers placing furniture you already own, and suggests cleaning', () => {
    const s = suggestions(cfg, { ...studio, type: 'studio', loc: 1 }, essentials().filter((p) => p.item !== 'wifi_router'), 40, ['wifi_router']);
    expect(s.map((x) => x.action.kind)).toContain('clean');
    expect(s.find((x) => x.action.kind !== 'clean')?.action).toMatchObject({ kind: 'place', item: 'wifi_router' });
  });
});

describe('Airbnb money', () => {
  it('more stars → a higher fair price and more bookings; overpricing empties the unit', () => {
    const f2 = fairNightSen(properties, 'studio', 2, 1), f5 = fairNightSen(properties, 'studio', 5, 1);
    expect(f5).toBeGreaterThan(f2 * 2);
    expect(bookingChance(properties, 5, f5, f5, 1, false, false)).toBeGreaterThan(bookingChance(properties, 2, f2, f2, 1, false, false));
    expect(bookingChance(properties, 5, f5 * 2, f5, 1, false, false)).toBeLessThan(bookingChance(properties, 5, f5, f5, 1, false, false) / 2);
    expect(bookingChance(properties, 5, f5, f5, 1, true, false)).toBeGreaterThan(bookingChance(properties, 5, f5, f5, 1, false, false));
  });

  it('tenants are happier with fair rent, a good condition and furniture', () => {
    expect(tenantHappiness(100, 4, 1000, 1000, 1)).toBeGreaterThan(tenantHappiness(100, 4, 1800, 1000, 1));
    expect(tenantHappiness(100, 4, 1000, 1000, 1)).toBeGreaterThan(tenantHappiness(40, 4, 1000, 1000, 1));
    expect(tenantHappiness(100, 4, 1000, 1000, 1)).toBeGreaterThan(tenantHappiness(100, 1, 1000, 1000, 1));
  });
});

describe('listings', () => {
  const map = buildMap({ data: osmJson, overrides: overridesJson } as unknown as MapSource, terrainConfigSchema.parse(terrainJson));
  const units = buildListings(map, properties);
  it('sells condo units in Ant Palms, with stable ids and location pricing', () => {
    const antA = units.filter((u) => u.building === 'w607053390');
    expect(antA).toHaveLength(properties.byKind.condo.units);
    expect(antA[0].id).toBe('w607053390#1');
    expect(new Set(units.map((u) => u.id)).size).toBe(units.length);
    for (const u of units) expect(u.loc).toBeGreaterThanOrEqual(1);
    expect(units.some((u) => u.type === 'terrace')).toBe(true);
    expect(units.some((u) => u.type === 'studio')).toBe(true);
  });
});

describe('shop floors with the door in the top wall', () => {
  const t = properties.types.shop_floor;
  // A row of wardrobes (2×1) across the row in front of the door: top row (y 0) or bottom row.
  const wall = (y: number): Placed[] => Array.from({ length: Math.floor(t.w / 2) }, (_, i) => ({ iid: i + 1, item: 'wardrobe', x: i * 2, y, rot: 0 }));
  it('checks the walkway from the door it actually has', () => {
    const shop = { w: t.w, h: t.h, type: 'shop_floor' };
    expect(rateUnit(cfg, shop, wall(0), 100).blocked).toBe(false); // a bottom door: the top row is just a wall of wardrobes
    expect(rateUnit(cfg, { ...shop, frontTop: true }, wall(0), 100).blocked).toBe(true); // a top door: they block it
    expect(rateUnit(cfg, { ...shop, frontTop: true }, wall(t.h - 1), 100).blocked).toBe(false);
  });
  it('keeps the top doorway clear, not the bottom one', () => {
    const shop = { w: t.w, h: t.h, type: 'shop_floor', frontTop: true };
    const mid = Math.floor(t.w / 2) - 1;
    expect(layoutProblem(cfg, shop, [{ iid: 1, item: 'toilet', x: mid, y: 0, rot: 0 }])).not.toBeNull();
    expect(layoutProblem(cfg, shop, [{ iid: 1, item: 'toilet', x: mid, y: t.h - 1, rot: 0 }])).toBeNull();
  });
});
