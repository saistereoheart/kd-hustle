import { describe, expect, it } from 'vitest';
import propertiesJson from '../../config/properties.json';
import furnitureJson from '../../config/furniture.json';
import { furnitureConfigSchema, propertiesConfigSchema, type Placed } from './schemas';
import { doorwayCells, planForType, roomAtCell, wallBetween } from './floorPlan';
import { layoutProblem, rateUnit, type RatingCfg } from './rating';

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
});
