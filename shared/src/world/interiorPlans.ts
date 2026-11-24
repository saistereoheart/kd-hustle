// 🏬 Designed interiors: a pawn shop, a capsule-toy shop, malls (shop lots, a food court, an atrium) and
// supermarkets (aisles, frozen, butcher, bakery, checkouts), laid out the way real ones are, with almost
// everything usable (signs, price boards, sale notices, shop lots, staff). Pure: the client draws the
// result and the tests check every usable thing can be walked up to from the door.
//
// Layouts are planned facing the door ("u" along the door's wall, "v" from the far wall towards the door)
// and turned to the real room, so they work whichever wall the door is in.
import { z } from 'zod';

/** What a planned prop does when you press E at it. */
export type PlanAct =
  | { kind: 'info'; title: string; lines: string[] }
  | { kind: 'food'; lot: string }
  | { kind: 'potions'; title: string }
  | { kind: 'directory' }
  | { kind: 'odds'; crate: string; title: string }
  | { kind: 'sample' }
  | { kind: 'balloon' };

export type PropKind =
  | 'counter' | 'grille' | 'glasscase' | 'safe' | 'board' | 'notice' | 'ticket' | 'bench' | 'plant' | 'fountain'
  | 'gacha' | 'changer' | 'poster' | 'bin' | 'display'
  | 'lot' | 'escalator' | 'directory' | 'kiosk' | 'banner'
  | 'shelf' | 'aislesign' | 'freezer' | 'butcher' | 'fish' | 'bakery' | 'produce' | 'checkout' | 'divider' | 'trolleys' | 'sampletable';

/** A prop in room tiles (its centre and size). */
export interface PlanProp {
  kind: PropKind;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  icon?: string;
  color?: string;
  act?: PlanAct;
  /** Blocks walking (most do; a sign on the floor doesn't). */
  solid: boolean;
  /** Which way its front faces (shop lots: towards the shoppers). */
  face?: 'up' | 'down' | 'left' | 'right';
}

export interface PlanNpc {
  role: 'keeper' | 'balloon' | 'sample' | 'butcher' | 'fish' | 'cashier';
  name: string;
  x: number;
  y: number;
  dir: 'up' | 'down' | 'left' | 'right';
  lines: string[];
  act?: PlanAct;
}

export interface Plan {
  stations: Array<{ id: string; x: number; y: number }>;
  props: PlanProp[];
  npcs: PlanNpc[];
  /** Where shoppers walk to (in front of counters, lots, shelves). */
  spots: Array<{ x: number; y: number }>;
}

// ------------------------------------------------------------------ config (interiors.json → content)
const menuItem = z.object({
  id: z.string(), name: z.string(), icon: z.string(), priceSen: z.number().int().positive(), xp: z.number().int().min(0).default(0),
  /** A small timed buff (like a weak potion). */
  buff: z.object({ kind: z.enum(['xp', 'passive', 'jobPay', 'customers', 'staffSpeed']), mult: z.number().min(1).max(1.5), durationSec: z.number().int().positive() }).optional(),
});
const info = z.object({ title: z.string(), lines: z.array(z.string()).min(1) });
export const interiorContentSchema = z.object({
  /** Mall shop lots: food and drinks (buy them: a little XP, some a small buff), the potion shop (💎), and shops
   *  to look around (sale notices). Each mall picks its own mix (always with food, drinks and the potion shop). */
  lots: z.array(z.object({
    id: z.string(), name: z.string(), icon: z.string(), color: z.string(), kind: z.enum(['food', 'drink', 'potion', 'retail']),
    menu: z.array(menuItem).default([]), sale: z.string().optional(), lines: z.array(z.string()).default([]),
  })).min(1),
  pawn: z.object({ goldBoard: info, cases: z.array(info).min(1), notice: info, ticket: info }),
  capsule: z.object({ series: z.array(z.string()).min(1), changer: info, bin: info, keeperLines: z.array(z.string()).min(1) }),
  mall: z.object({ escalator: info, kiosks: z.array(info).min(1), infoLines: z.array(z.string()).min(1), balloonLines: z.array(z.string()).min(1) }),
  grocery: z.object({
    aisles: z.array(info).min(1), frozen: z.array(info).min(1), butcher: info, fish: info, bakery: info, produce: z.array(info).min(1),
    checkout: info, butcherLines: z.array(z.string()).min(1), sampleLines: z.array(z.string()).min(1),
  }),
  /** The free food sample: XP, once every `cooldownSec`. */
  sample: z.object({ xp: z.number().int().min(0), cooldownSec: z.number().int().positive() }),
});
export type InteriorContent = z.infer<typeof interiorContentSchema>;
export type MallLot = InteriorContent['lots'][number];
export type MenuItem = MallLot['menu'][number];

export type PlanKind = 'pawn' | 'capsule' | 'mall' | 'market';

/** Tiny seeded random (a building's layout is the same every visit). */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** Which shop lots a mall has (by its id: the same for everyone, and the server checks orders with it). */
export function mallLots(content: InteriorContent, buildingId: string, n: number): MallLot[] {
  const r = rng(`lots:${buildingId}`);
  const shuffled = [...content.lots].map((l) => ({ l, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.l);
  const pick: MallLot[] = [];
  // Always: the potion shop, two food places and two drink places; then the rest.
  const need: Array<MallLot['kind']> = ['potion', 'food', 'food', 'drink', 'drink'];
  for (const k of need) {
    const l = shuffled.find((x) => x.kind === k && !pick.includes(x));
    if (l) pick.push(l);
  }
  for (const l of shuffled) if (pick.length < n && !pick.includes(l)) pick.push(l);
  return pick.slice(0, Math.max(n, 0));
}

/** How many lots a mall of this size has room for (far wall + side walls). */
export function mallLotCount(w: number, h: number, side: 'top' | 'bottom' | 'left' | 'right', grocery: boolean): number {
  const along = side === 'top' || side === 'bottom' ? w : h - 2;
  const depth = side === 'top' || side === 'bottom' ? h - 2 : w;
  const gw = grocery ? Math.round(along * 0.42) : 0;
  const far = Math.max(0, Math.floor((along - gw - 2) / 6));
  const sides = Math.max(0, Math.floor((depth - 11) / 6));
  return far + sides * (grocery ? 1 : 2);
}

export interface PlanInput {
  kind: PlanKind;
  grocery?: boolean;
  buildingId: string;
  /** Room size in tiles (the back wall takes the top 2 rows). */
  w: number;
  h: number;
  door: { side: 'top' | 'bottom' | 'left' | 'right'; pos: number };
  /** This building's counters / machines and their sizes (tiles). */
  stations: Array<{ id: string; w: number; h: number }>;
  content: InteriorContent;
  /** For the capsule shop's machines and posters: the crate it sells, and its items' names. */
  crate?: { id: string; itemNames: string[] };
  keeper?: string | null;
  greeting?: string;
}

export function planInterior(inp: PlanInput): Plan {
  const { w: W, h: H, door } = inp;
  const side = door.side;
  // Facing the door: A along the door's wall, B deep (far wall at v = 0, the door at v = B).
  const A = side === 'top' || side === 'bottom' ? W : H - 2;
  const B = side === 'top' || side === 'bottom' ? H - 2 : W;
  const dU = side === 'top' || side === 'bottom' ? door.pos : door.pos - 2;
  const toRoom = (u: number, v: number): [number, number] =>
    side === 'bottom' ? [u, 2 + v] : side === 'top' ? [u, H - v] : side === 'left' ? [W - v, 2 + u] : [v, 2 + u];
  const swap = side === 'left' || side === 'right';
  const faceDoor = ({ bottom: 'down', top: 'up', left: 'left', right: 'right' } as const)[side];
  /** A facing direction (canonical du / dv) in the real room. */
  const dirOf = (du: number, dv: number): 'up' | 'down' | 'left' | 'right' => {
    const [x0, y0] = toRoom(0, 0), [x1, y1] = toRoom(du, dv);
    const dx = x1 - x0, dy = y1 - y0;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  };

  const plan: Plan = { stations: [], props: [], npcs: [], spots: [] };
  const solids: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  /** Kept clear: the walk in from the door (canonical rects). */
  const clear: Array<{ u0: number; v0: number; u1: number; v1: number }> = [{ u0: dU - 1.4, v0: B - 4.5, u1: dU + 1.4, v1: B + 1 }];
  const hits = (a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const rectOf = (u: number, v: number, cw: number, ch: number) => {
    const [x, y] = toRoom(u, v);
    const w = swap ? ch : cw, h = swap ? cw : ch;
    return { x, y, w, h, r: { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 } };
  };
  const fits = (u: number, v: number, cw: number, ch: number, solid: boolean) => {
    const { r } = rectOf(u, v, cw, ch);
    if (r.x0 < 0.05 || r.x1 > W - 0.05 || r.y0 < 2.0 || r.y1 > H - 0.05) return false;
    if (!solid) return true;
    if (clear.some((c) => u + cw / 2 > c.u0 && u - cw / 2 < c.u1 && v + ch / 2 > c.v0 && v - ch / 2 < c.v1)) return false;
    return !solids.some((s) => hits(s, { x0: r.x0 - 0.05, y0: r.y0 - 0.05, x1: r.x1 + 0.05, y1: r.y1 + 0.05 }));
  };
  /** Adds a prop (canonical centre and size) if it fits; returns whether it did. */
  const add = (kind: PropKind, u: number, v: number, cw: number, ch: number, o: Partial<PlanProp> = {}): boolean => {
    const solid = o.solid ?? true;
    if (!fits(u, v, cw, ch, solid)) return false;
    const { x, y, w, h, r } = rectOf(u, v, cw, ch);
    plan.props.push({ kind, x, y, w, h, solid, ...o });
    if (solid) solids.push(r);
    return true;
  };
  const npc = (role: PlanNpc['role'], name: string, u: number, v: number, lines: string[], act?: PlanAct, dir: PlanNpc['dir'] = faceDoor) => {
    const [x, y] = toRoom(u, v);
    plan.npcs.push({ role, name, x, y, dir, lines, act });
    solids.push({ x0: x - 0.4, y0: y - 0.3, x1: x + 0.4, y1: y + 0.25 });
  };
  const spot = (u: number, v: number) => {
    const [x, y] = toRoom(u, v);
    plan.spots.push({ x, y });
  };
  const station = (id: string, u: number, v: number) => {
    const s = inp.stations.find((x) => x.id === id);
    if (!s) return;
    // (Drawn the same way round whatever the door: its real footprint, not turned.)
    const [x, y] = toRoom(u, v);
    plan.stations.push({ id, x, y });
    solids.push({ x0: x - s.w / 2, y0: y - s.h / 2, x1: x + s.w / 2, y1: y + s.h / 2 });
    spot(u, v + s.h / 2 + 0.8);
  };
  const r = rng(`plan:${inp.buildingId}`);
  const c = inp.content;

  if (inp.kind === 'pawn') {
    // 🏪 A pawn shop: the service counter with its grille across the back (Ah Seng behind it, the safe
    // behind him), glass cases of jewellery and watches down both walls, the gold price board, the
    // auction notice and the ticket machine by the door.
    const st = inp.stations[0];
    const sw = st ? st.w : 2.8;
    if (st) station(st.id, A / 2, 2.4);
    const wing = (A - sw) / 2 - 0.3;
    if (wing > 0.6) {
      add('grille', wing / 2 + 0.1, 2.4, wing, 1.2, { color: '#7a5c3c' });
      add('grille', A - wing / 2 - 0.1, 2.4, wing, 1.2, { color: '#7a5c3c' });
    }
    if (inp.keeper) npc('keeper', inp.keeper, A / 2, 1.0, [inp.greeting ?? 'Selamat datang!']);
    add('safe', A - 1.0, 0.8, 1.2, 1.1, { solid: true });
    add('board', 1.4, 0.55, 2.2, 0.5, { label: 'KAMI BELI EMAS', color: '#fcc419', solid: true });
    add('board', 1.4, 4.4, 1.8, 0.6, { label: '📈 Harga Emas', color: '#ffd43b', act: { kind: 'info', ...c.pawn.goldBoard } });
    // By the door: the auction notice and the ticket machine (first in a deep shop, so the glass cases
    // don't crowd them out; a shallow shop keeps its cases first).
    const byDoor = () => {
      add('notice', 1.3, B - 1.6, 1.4, 0.5, { label: '🔖 LELONG', color: '#e03131', act: { kind: 'info', ...c.pawn.notice } });
      add('ticket', A - 1.2, B - 1.5, 0.7, 0.7, { label: '🎟️', act: { kind: 'info', ...c.pawn.ticket } });
    };
    if (B >= 10) byDoor();
    let k = 0;
    for (let v = 4.8; v <= B - 2.2; v += 2.7) {
      for (const u of [0.65, A - 0.65]) {
        const cs = c.pawn.cases[k++ % c.pawn.cases.length];
        if (add('glasscase', u, v, 1.0, 2.3, { label: cs.title.split(' ')[0], act: { kind: 'info', ...cs } })) spot(u < A / 2 ? u + 1.3 : u - 1.3, v);
      }
    }
    if (B < 10) byDoor();
    add('plant', A - 0.6, B - 0.6, 0.8, 0.8);
  } else if (inp.kind === 'capsule') {
    // 🎰 A capsule-toy shop: the big Capsule Machine in front, rows of small gacha machines down both walls
    // (each a different series), the change machine and the counter at the back, a "new & rare" poster and
    // a capsule recycling bin by the door.
    const st = inp.stations[0];
    if (st) station(st.id, A / 2, 3.6);
    if (inp.keeper) {
      add('counter', A - 1.8, 1.5, 2.8, 1.0, { color: '#c92a2a' });
      npc('keeper', inp.keeper, A - 1.8, 0.55, c.capsule.keeperLines);
    }
    add('changer', 1.1, 1.1, 1.2, 1.2, { label: '💱', act: { kind: 'info', ...c.capsule.changer } });
    if (inp.crate) add('display', A / 2 - 0.2, 0.8, 2.6, 1.0, { label: '✨ Rare pulls', act: { kind: 'odds', crate: inp.crate.id, title: '✨ The rarest in the Capsule Machine' } });
    const colors = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#cc5de8', '#ff922b', '#20c997', '#f783ac'];
    let k = 0;
    for (let v = 4.7; v <= B - 1.6; v += 1.35) {
      for (const u of [0.65, A - 0.65]) {
        const series = c.capsule.series[k % c.capsule.series.length];
        const prize = inp.crate?.itemNames.length ? inp.crate.itemNames[Math.floor(r() * inp.crate.itemNames.length)] : '';
        add('gacha', u, v, 1.1, 1.1, {
          color: colors[k++ % colors.length], label: '',
          act: { kind: 'info', title: `🎰 ${series}`, lines: [`Mini capsules: ${series}. This one's sold out!`, prize ? `The big Capsule Machine has the real prizes (like the ${prize}).` : 'The big Capsule Machine has the real prizes.'] },
        });
      }
    }
    // A middle island when the shop is wide enough.
    if (A >= 11) for (let v = 6.5; v <= B - 5; v += 1.3) add('gacha', A / 2 + (dU < A / 2 ? 2.4 : -2.4), v, 1.1, 1.1, { color: colors[k++ % colors.length], act: { kind: 'info', title: '🎰 Mystery series', lines: ['Every capsule a surprise. Mostly keychains.'] } });
    if (inp.crate) add('poster', A - 1.2, B - 1.6, 1.4, 0.5, { label: '🆕 NEW!', color: '#f03e3e', act: { kind: 'odds', crate: inp.crate.id, title: '🆕 New & rare in the Capsule Machine' } });
    add('bin', 1.0, B - 1.4, 0.8, 0.8, { label: '♻️', act: { kind: 'info', ...c.capsule.bin } });
  } else {
    // 🏬 A mall (shop lots, an atrium with the fountain, escalators, kiosks) and/or a 🛒 supermarket.
    const gw = inp.kind === 'market' ? A : inp.grocery ? Math.round(A * 0.42) : 0;
    const groceryOnLeft = dU > A / 2 || inp.kind === 'market';
    const g0 = groceryOnLeft ? 0 : A - gw, g1 = groceryOnLeft ? gw : A;
    const m0 = groceryOnLeft ? gw : 0, m1 = groceryOnLeft ? A : A - gw;
    if (gw) {
      // ---- the supermarket wing
      const gc = c.grocery;
      const inWing = (u: number) => u > g0 && u < g1;
      // Frozen section along the far wall.
      let k = 0;
      for (let u = g0 + 1.8; u + 1.3 <= g1 - 0.4; u += 2.9) {
        const f = gc.frozen[k++ % gc.frozen.length];
        if (add('freezer', u, 0.8, 2.6, 1.2, { label: '🧊', act: { kind: 'info', ...f } })) spot(u, 2.2);
      }
      // Butcher, fish and bakery down the outer wall.
      const outer = groceryOnLeft ? g0 + 1.0 : g1 - 1.0;
      const behind = groceryOnLeft ? g0 + 0.35 : g1 - 0.35;
      const inward = groceryOnLeft ? 1.4 : -1.4;
      if (add('butcher', outer, 4.6, 1.3, 3.0, { label: '🥩', act: { kind: 'info', ...gc.butcher } })) {
        npc('butcher', 'Pak Daging', behind, 4.6, gc.butcherLines, undefined, groceryOnLeft ? 'right' : 'left');
        spot(outer + inward, 4.6);
      }
      if (add('fish', outer, 8.4, 1.3, 3.0, { label: '🐟', act: { kind: 'info', ...gc.fish } })) spot(outer + inward, 8.4);
      add('bakery', outer, 12.2, 1.3, 3.0, { label: '🥐', act: { kind: 'info', ...gc.bakery } });
      // Aisles: long shelves from the back towards the front, a numbered sign at the top of each.
      const len = Math.max(4, B - 14);
      const first = groceryOnLeft ? g0 + 4.6 : g1 - 4.6;
      const step = groceryOnLeft ? 3.4 : -3.4;
      let n = 0;
      for (let u = first; inWing(u - 0.6) && inWing(u + 0.6) && Math.abs(u - (groceryOnLeft ? g1 : g0)) > 2.6; u += step) {
        const a = gc.aisles[n % gc.aisles.length];
        n++;
        if (add('shelf', u, 4.4 + len / 2, 1.1, len, { color: ['#4dabf7', '#69db7c', '#ffa94d', '#da77f2', '#ff8787', '#ffd43b'][n % 6] })) {
          add('aislesign', u, 3.3, 1.6, 0.5, { label: `${n}`, solid: false, act: { kind: 'info', title: `Aisle ${n} · ${a.title}`, lines: a.lines } });
          spot(u + 1.6 * Math.sign(step), 4.4 + len / 2);
        }
      }
      // Fruit and veg by the way in, the sample table, trolleys, and the checkouts across the front.
      const front = B - 3.4;
      let p = 0;
      for (let u = (groceryOnLeft ? g0 + 4.5 : g1 - 4.5); inWing(u) && p < 3; u += step * 1.1) {
        const pr = gc.produce[p++ % gc.produce.length];
        add('produce', u, B - 7.4, 2.2, 1.2, { label: pr.title.split(' ')[0], act: { kind: 'info', ...pr } });
      }
      const sampleU = groceryOnLeft ? g1 - 3.2 : g0 + 3.2;
      if (add('sampletable', sampleU, B - 8.6, 1.4, 0.8, { label: '🍢' })) npc('sample', 'Kak Rasa', sampleU, B - 9.4, gc.sampleLines, { kind: 'sample' });
      if (inp.kind === 'market') {
        // A hypermarket: the service counter (this building's own station) by the checkouts.
        for (const s of inp.stations) station(s.id, A / 2 + (dU < A / 2 ? 6 : -6), front - 2.2);
      }
      let cks = 0;
      for (let u = (groceryOnLeft ? g1 - 2.6 : g0 + 2.6); inWing(u) && cks < (inp.kind === 'market' ? 6 : 3); u -= step * 1.05) {
        if (Math.abs(u - dU) < 2.2) continue;
        if (add('checkout', u, front, 2.2, 1.0, { label: `🧾${cks + 1}`, act: { kind: 'info', ...gc.checkout } })) {
          if (cks === 0) npc('cashier', 'Juruwang', u, front - 0.9, ['Kad ahli ada?', 'Next, please!'], undefined, faceDoor);
          cks++;
        }
      }
      add('trolleys', groceryOnLeft ? g1 - 1.4 : g0 + 1.4, B - 1.2, 2.0, 1.0, { act: { kind: 'info', title: '🛒 Trolleys', lines: ['Put a coin in to unlock one. Don\'t leave it in the car park!'] } });
      // The wing's wall towards the mall, with the way in at the front.
      if (inp.kind !== 'market') add('divider', groceryOnLeft ? g1 - 0.2 : g0 + 0.2, (B - 6) / 2, 0.4, B - 6, { color: '#ced4da' });
    }
    if (inp.kind === 'mall') {
      // ---- shop lots along the far wall and the side wall(s)
      const lots = mallLots(c, inp.buildingId, mallLotCount(W, H, side, !!inp.grocery));
      let li = 0;
      const lotAt = (u: number, v: number, cw: number, ch: number, along: 'far' | 'left' | 'right') => {
        const l = lots[li];
        if (!l) return;
        const act: PlanAct = l.kind === 'potion' ? { kind: 'potions', title: `${l.icon} ${l.name}` } : l.kind === 'retail' ? { kind: 'info', title: `${l.icon} ${l.name}`, lines: [...(l.sale ? [`🔖 ${l.sale}`] : []), ...l.lines] } : { kind: 'food', lot: l.id };
        const face = along === 'far' ? dirOf(0, 1) : along === 'left' ? dirOf(1, 0) : dirOf(-1, 0);
        if (add('lot', u, v, cw, ch, { label: `${l.icon} ${l.name}`, color: l.color, icon: l.icon, act, face })) {
          li++;
          spot(along === 'far' ? u : along === 'left' ? u + cw / 2 + 0.9 : u - cw / 2 - 0.9, along === 'far' ? v + ch / 2 + 0.9 : v);
          if (l.sale) add('banner', along === 'far' ? u + 1.6 : along === 'left' ? u + cw / 2 + 0.5 : u - cw / 2 - 0.5, along === 'far' ? v + ch / 2 + 0.5 : v + 2, 1.2, 0.4, { label: l.sale, color: '#e03131', solid: false, act: { kind: 'info', title: `🔖 ${l.name}`, lines: [l.sale, ...l.lines] } });
        }
      };
      for (let u = m0 + 3.8; u + 2.8 <= m1 - 0.9; u += 6) lotAt(u, 2.2, 5.6, 4.2, 'far');
      const sideV = (v0: number) => Array.from({ length: Math.max(0, Math.floor((B - 11) / 6)) }, (_, i) => v0 + i * 6);
      if (m0 === 0) for (const v of sideV(8.5)) lotAt(2.2, v, 4.2, 5.4, 'left');
      if (m1 === A) for (const v of sideV(8.5)) lotAt(A - 2.2, v, 4.2, 5.4, 'right');
      // ---- the atrium: the fountain in the middle, the mall's own counters around it, benches, plants.
      const cu = (m0 + m1) / 2, cv = B / 2 + 1.5;
      add('fountain', cu, cv, 2.8, 2.8, { act: { kind: 'info', title: '⛲ The fountain', lines: ['Throw a coin and make a wish. (Your coin stays in your pocket. This is a game.)'] } });
      const ring: Array<[number, number]> = [[cu - 5.2, cv], [cu + 5.2, cv], [cu, cv - 4.4], [cu - 5.2, cv - 4.4], [cu + 5.2, cv - 4.4]];
      inp.stations.forEach((s, i) => station(s.id, ring[i % ring.length][0], ring[i % ring.length][1]));
      add('bench', cu, cv + 2.8, 2.4, 0.8);
      add('bench', cu - 2.6, cv - 2.4, 2.4, 0.8);
      add('plant', cu + 2.2, cv + 2.6, 0.8, 0.8);
      add('plant', cu - 2.2, cv + 2.6, 0.8, 0.8);
      // 🎈 The balloon giver by the fountain.
      npc('balloon', 'Abang Belon', cu + 2.9, cv - 0.2, c.mall.balloonLines, { kind: 'balloon' });
      // Escalators up (level 2 comes later), kiosks, and the info counter + directory by the way in.
      add('escalator', cu - 9, cv - 3.5, 2.0, 4.2, { label: '⬆️', act: { kind: 'info', ...c.mall.escalator } });
      add('escalator', cu + 9, cv - 3.5, 2.0, 4.2, { label: '⬇️', act: { kind: 'info', ...c.mall.escalator } });
      c.mall.kiosks.slice(0, 2).forEach((kz, i) => add('kiosk', cu + (i ? 9 : -9), cv + 3.6, 2.2, 1.4, { label: kz.title.split(' ')[0], act: { kind: 'info', ...kz } }));
      const iu = dU + (dU < (m0 + m1) / 2 ? 4.2 : -4.2);
      if (add('counter', iu, B - 3.0, 2.8, 1.0, { label: 'ℹ️ Info', color: '#1c7ed6' })) npc('keeper', inp.keeper ?? 'Info counter', iu, B - 3.9, c.mall.infoLines);
      add('directory', dU + (dU < (m0 + m1) / 2 ? -3.2 : 3.2), B - 2.2, 1.6, 0.6, { label: '🗺️ Directory', act: { kind: 'directory' } });
      spot(cu, cv + 4);
    }
  }
  return plan;
}
