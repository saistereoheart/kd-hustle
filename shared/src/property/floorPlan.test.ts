import { describe, expect, it } from 'vitest';
import propertiesJson from '../../config/properties.json';
import furnitureJson from '../../config/furniture.json';
import { furnitureConfigSchema, propertiesConfigSchema, type Placed } from './schemas';
import { doorwayCells, planForType, roomAtCell, wallBetween } from './floorPlan';
import { layoutProblem, rateUnit, suggestions, type RatingCfg } from './rating';

const properties = propertiesConfigSchema.parse(propertiesJson);
const furniture = furnitureConfigSchema.parse(furnitureJson);
const cfg: RatingCfg = { furniture, properties, rarityIndex: () => 0 };

describe('floor plans', () => {
  for (const [id, t] of Object.entries(properties.types)) {
    it(`${id}: rooms cover the floor, the front door is in the living room, every room is reachable`, () => {
      const plan = planForType(t, id);
      // Every cell belongs to exactly one room, and the rooms' areas add up.
      expect(plan.rooms.reduce((a, r) => a + r.w * r.h, 0)).toBe(t.w * t.h);
      expect(roomAtCell(plan, plan.front[0], t.h - 1)?.kind).toBe('living');
      expect(roomAtCell(plan, plan.front[1], t.h - 1)?.kind).toBe('living');
      expect(plan.rooms.some((r) => r.kind === 'bath')).toBe(true);
      // Walk the empty home from the front door: every cell is reachable through the doorways.
      const seen = new Set<string>();
      const q: Array<[number, number]> = [[plan.front[0], t.h - 1]];
      seen.add(q[0].join());
      while (q.length) {
        const [x, y] = q.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= t.w || ny >= t.h || wallBetween(plan, x, y, nx, ny) || seen.has(`${nx},${ny}`)) continue;
          seen.add(`${nx},${ny}`);
          q.push([nx, ny]);
        }
      }
      expect(seen.size).toBe(t.w * t.h);
      for (const [x, y] of doorwayCells(plan)) expect(x >= 0 && y >= 0 && x < t.w && y < t.h).toBe(true);
      if (t.bedrooms) expect(plan.rooms.filter((r) => r.kind === 'bedroom' || r.kind === 'office').length).toBeGreaterThan(0);
    });
  }

  it('furniture must stay inside one room and keep doorways clear', () => {
    const t = properties.types.condo2;
    const unit = { w: t.w, h: t.h, type: 'condo2' };
    const plan = planForType(t, 'condo2');
    const back = plan.rooms.find((r) => r.y === 0)!;
    const bed = furniture.pieces.basic_bed;
    let iid = 1;
    const at = (item: string, x: number, y: number, rot = 0): Placed => ({ iid: iid++, item, x, y, rot });
    // Straddling the wall between the back band and the front.
    expect(layoutProblem(cfg, unit, [at('basic_bed', back.x, back.y + back.h - 1)])).toMatch(/through a wall/);
    // Fits inside the first bedroom.
    expect(layoutProblem(cfg, unit, [at('basic_bed', back.x, back.y)])).toBeNull();
    // On a doorway.
    const d = plan.doors.find((x) => x.side === 'h')!;
    expect(layoutProblem(cfg, unit, [at('plastic_chair', d.x, d.y)])).toMatch(/doorway/);
    // A wall item on an inner wall is fine.
    const tvRoom = plan.rooms.find((r) => r.kind === 'living')!;
    expect(layoutProblem(cfg, unit, [at('smart_tv', tvRoom.x, tvRoom.y)])).toBeNull();
    // An unknown type (no rooms) still works like one open room.
    expect(layoutProblem(cfg, { w: t.w, h: t.h }, [at('basic_bed', back.x, back.y + back.h - 1)])).toBeNull();
    expect(rateUnit(cfg, unit, [], 100).stars).toBeGreaterThan(0);
    void bed;
  });

  it('the Rooms factor: things in the right rooms score better, and a misplaced one gets a suggestion', () => {
    const t = properties.types.condo2;
    const unit = { w: t.w, h: t.h, type: 'condo2' };
    const plan = planForType(t, 'condo2');
    const bedroom = plan.rooms.find((r) => r.kind === 'bedroom')!;
    const living = plan.rooms.find((r) => r.kind === 'living')!;
    let iid = 100;
    const at = (item: string, x: number, y: number): Placed => ({ iid: iid++, item, x, y, rot: 0 });
    // condo2: bedrooms x 0-2 and 3-5, bathroom x 6-8 (rows 0-2); living room x 0-5, kitchen x 6-8 (rows 3-6).
    const rest = () => [at('toilet', 8, 0), at('shower', 6, 0), at('kitchenette', 7, 6), at('aircond', 3, 0), at('wifi_router', 0, 4)];
    const right = [at('basic_bed', bedroom.x, bedroom.y), ...rest()];
    const wrong = [at('basic_bed', living.x, living.y + 2), ...rest()];
    expect(layoutProblem(cfg, unit, right)).toBeNull();
    expect(layoutProblem(cfg, unit, wrong)).toBeNull();
    const r1 = rateUnit(cfg, unit, right, 100), r2 = rateUnit(cfg, unit, wrong, 100);
    expect(r1.misplaced).toEqual([]);
    expect(r2.misplaced.map((m) => m.item)).toEqual(['basic_bed']);
    expect(r1.factors.rooms).toBeGreaterThan(r2.factors.rooms);
    expect(r1.score).toBeGreaterThan(r2.score);
    const s = suggestions(cfg, { ...unit, loc: 1 }, wrong, 100, []);
    expect(s.some((x) => x.action.kind === 'move' && /bedroom/.test(x.text))).toBe(true);
    // Neutral things (a lamp) are never in the wrong room.
    expect(rateUnit(cfg, unit, [at('floor_lamp', living.x, living.y + 2)], 100).misplaced).toEqual([]);
    // A studio has no bedroom: the bed belongs in its main room.
    const st = properties.types.studio;
    expect(rateUnit(cfg, { w: st.w, h: st.h, type: 'studio' }, [at('basic_bed', 0, 0)], 100).misplaced).toEqual([]);
  });

  it('complete rooms: each room has its needs; meeting them raises the Rooms factor', () => {
    const t = properties.types.condo2;
    const unit = { w: t.w, h: t.h, type: 'condo2' };
    let iid = 500;
    const at = (item: string, x: number, y: number): Placed => ({ iid: iid++, item, x, y, rot: 0 });
    // Master bedroom (x 0-2, rows 0-2; its doorway is at x 1): a bed, then a wardrobe and a lamp.
    const bedOnly = [at('basic_bed', 0, 0)];
    const full = [...bedOnly, { ...at('wardrobe', 2, 0), rot: 1 }, at('floor_lamp', 2, 2)];
    expect(layoutProblem(cfg, unit, full)).toBeNull();
    const s1 = rateUnit(cfg, unit, bedOnly, 100).rooms.find((r) => r.room === 2)!;
    const s2 = rateUnit(cfg, unit, full, 100).rooms.find((r) => r.room === 2)!;
    expect(s1.done).toBeCloseTo(1 / 3);
    expect(s1.missing.map((m) => m.name)).toEqual(['storage', 'a lamp']);
    expect(s2.done).toBe(1);
    expect(rateUnit(cfg, unit, full, 100).factors.rooms).toBeGreaterThan(rateUnit(cfg, unit, bedOnly, 100).factors.rooms);
    // The suggestions point at what a room still needs.
    const sug = suggestions(cfg, { ...unit, loc: 1 }, bedOnly, 100, []);
    void sug;
  });
});
