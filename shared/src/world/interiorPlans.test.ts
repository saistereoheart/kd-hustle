import { describe, expect, it } from 'vitest';
import interiorsJson from '../../config/interiors.json';
import { interiorsConfigSchema } from './interiors';
import { mallLots, planInterior, type Plan, type PlanInput } from './interiorPlans';

const cfg = interiorsConfigSchema.parse(interiorsJson);
const content = cfg.content;
const SIDES = ['bottom', 'top', 'left', 'right'] as const;

/** Walk from the door on a fine grid (the player's feet are ~0.56 × 0.32 tiles) and see what's in reach. */
function check(inp: Omit<PlanInput, 'door'>, side: (typeof SIDES)[number], at = 0.5) {
  const { w: W, h: H } = inp;
  const along = side === 'top' || side === 'bottom' ? W : H;
  const lo = side === 'left' || side === 'right' ? 3.4 : 1.8;
  const pos = Math.max(lo, Math.min(along - 1.8, at * along));
  const plan: Plan = planInterior({ ...inp, door: { side, pos } });
  const solids = [
    ...plan.props.filter((p) => p.solid).map((p) => ({ x0: p.x - p.w / 2, y0: p.y - p.h / 2, x1: p.x + p.w / 2, y1: p.y + p.h / 2 })),
    ...plan.stations.map((s) => {
      const st = inp.stations.find((x) => x.id === s.id)!;
      return { x0: s.x - st.w / 2, y0: s.y - st.h / 2, x1: s.x + st.w / 2, y1: s.y + st.h / 2 };
    }),
    ...plan.npcs.map((n) => ({ x0: n.x - 0.4, y0: n.y - 0.3, x1: n.x + 0.4, y1: n.y + 0.25 })),
  ];
  // Nothing sticks out of the room or overlaps.
  for (const p of plan.props) {
    expect(p.x - p.w / 2, `${p.kind} out left`).toBeGreaterThanOrEqual(0);
    expect(p.x + p.w / 2, `${p.kind} out right`).toBeLessThanOrEqual(W);
    expect(p.y - p.h / 2, `${p.kind} in the back wall`).toBeGreaterThanOrEqual(2);
    expect(p.y + p.h / 2, `${p.kind} out the bottom`).toBeLessThanOrEqual(H);
  }
  const hw = 0.28, hh = 0.16, S = 0.25;
  const free = (x: number, y: number) =>
    x - hw > 0.12 && x + hw < W - 0.12 && y - hh > 2 && y + hh < H - 0.06 && !solids.some((r) => x + hw > r.x0 && x - hw < r.x1 && y + hh > r.y0 && y - hh < r.y1);
  const start = { bottom: [pos, H - 0.9], top: [pos, 2.9], left: [0.9, pos], right: [W - 0.9, pos] }[side];
  const key = (i: number, j: number) => i * 10000 + j;
  const seen = new Set<number>();
  const q: Array<[number, number]> = [[Math.round(start[0] / S), Math.round(start[1] / S)]];
  expect(free(start[0], start[1]), 'the doorway is blocked').toBe(true);
  seen.add(key(q[0][0], q[0][1]));
  while (q.length) {
    const [i, j] = q.shift()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (seen.has(key(ni, nj)) || !free(ni * S, nj * S)) continue;
      seen.add(key(ni, nj));
      q.push([ni, nj]);
    }
  }
  const cells = [...seen].map((k) => [Math.floor(k / 10000) * S, (k % 10000) * S]);
  const reach = (r: { x0: number; y0: number; x1: number; y1: number }, d: number) => cells.some(([x, y]) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.y0 - y, 0, y - r.y1)) < d);
  for (const p of plan.props.filter((x) => x.act)) expect(reach({ x0: p.x - p.w / 2, y0: p.y - p.h / 2, x1: p.x + p.w / 2, y1: p.y + p.h / 2 }, 1.2), `${inp.kind} ${side}: can't reach ${p.kind} ${p.label ?? ''}`).toBe(true);
  for (const s of plan.stations) expect(reach({ x0: s.x - 1, y0: s.y - 0.8, x1: s.x + 1, y1: s.y + 0.8 }, 1.2), `${inp.kind} ${side}: can't reach station ${s.id}`).toBe(true);
  for (const n of plan.npcs.filter((x) => x.act)) expect(reach({ x0: n.x - 0.4, y0: n.y - 0.3, x1: n.x + 0.4, y1: n.y + 0.25 }, 1.4), `${inp.kind} ${side}: can't reach ${n.name}`).toBe(true);
  return plan;
}

describe('🏬 designed interiors', () => {
  const pawn = { kind: 'pawn' as const, buildingId: 'w1275938587', stations: [{ id: 'kedai_pajak', w: 2.8, h: 1.3 }], content, keeper: 'Ah Seng', greeting: 'hi' };
  const capsule = { kind: 'capsule' as const, buildingId: 'w1275938588', stations: [{ id: 'capsule_machine', w: 1.8, h: 1.4 }], content, keeper: 'Pak Abu', crate: { id: 'capsule', itemNames: ['Rubber Duck', 'Halo'] } };
  const mall = { kind: 'mall' as const, buildingId: 'w328914587', stations: [{ id: 'strand_crate', w: 1.8, h: 1.4 }], content, keeper: 'Info counter' };
  const market = { kind: 'market' as const, buildingId: 'w366614388', stations: [{ id: 'gergasi', w: 3.4, h: 1.4 }], content, keeper: 'Cashier' };

  for (const side of SIDES) {
    it(`pawn shop, capsule shop (9 × 15 and 15 × 9), door ${side}: everything in reach from the door`, () => {
      for (const [w, h] of [[9, 15], [15, 9], [11, 10]]) {
        const p = check({ ...pawn, w, h }, side);
        expect(p.stations).toHaveLength(1);
        expect(p.props.filter((x) => x.kind === 'glasscase').length).toBeGreaterThan(0);
        const c = check({ ...capsule, w, h }, side);
        expect(c.props.filter((x) => x.kind === 'gacha').length).toBeGreaterThanOrEqual((side === 'left' || side === 'right' ? w : h - 2) >= 11 ? 8 : 2); // deep from the door: rows down both walls
      }
    });
    it(`malls and supermarkets (46 × 32), door ${side}`, () => {
      for (const at of [0.5, 0.2, 0.8]) {
        const m = check({ ...mall, w: 46, h: 32 }, side, at);
        const lots = m.props.filter((x) => x.kind === 'lot');
        expect(lots.length).toBeGreaterThanOrEqual(6);
        expect(lots.some((l) => l.act?.kind === 'potions')).toBe(true);
        expect(lots.filter((l) => l.act?.kind === 'food').length).toBeGreaterThanOrEqual(3);
        expect(m.npcs.some((n) => n.role === 'balloon')).toBe(true);
        const g = check({ ...mall, buildingId: 'w366614398', grocery: true, w: 46, h: 32 }, side, at);
        for (const k of ['freezer', 'butcher', 'shelf', 'checkout', 'lot'] as const) expect(g.props.some((x) => x.kind === k), `grocery mall has ${k}`).toBe(true);
        expect(g.npcs.some((n) => n.role === 'sample')).toBe(true);
        const s = check({ ...market, w: 46, h: 32 }, side, at);
        expect(s.props.filter((x) => x.kind === 'shelf').length).toBeGreaterThanOrEqual(6);
        expect(s.stations).toHaveLength(1);
      }
    });
  }

  it('each mall has its own mix of lots, always with the potion shop and food and drinks', () => {
    const a = mallLots(content, 'w328914587', 10).map((l) => l.id);
    const b = mallLots(content, 'w366614398', 10).map((l) => l.id);
    expect(a).not.toEqual(b);
    for (const ids of [a, b]) {
      expect(ids).toContain('ramuan');
      expect(ids.filter((id) => content.lots.find((l) => l.id === id)!.kind === 'food').length).toBeGreaterThanOrEqual(2);
    }
  });
});
