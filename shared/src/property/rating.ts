// The Airbnb star rating (spec §9.3) and the suggestions panel (§9.4). Pure maths, shared by the
// server (what guests see), the client (live stars while decorating) and the tests.
//
//   stars = 0.5 + 4.5 × (25% comfort + 20% style + 15% rarity + 15% amenities + 15% clean + 10% space)
//   then, for each missing essential (bed, toilet, shower, kitchen, aircond, wifi), −0.5★ and a
//   cap of 2.5★ (0.4 lower per extra one missing).
//
// Every factor is 0..1. Suggestions are found by trying a change (buy a piece, clean, remove
// one) and re-rating, so the predicted gain is exactly what the change would do.
import type { FurnitureConfig, FurniturePiece, Placed, PropertiesConfig } from './schemas';
import { doorwayCells, openPlan, planForType, roomIndex, wallBetween, type FloorPlan, type RoomKind } from './floorPlan';

export interface RatingCfg {
  furniture: FurnitureConfig;
  properties: PropertiesConfig;
  /** Item id → rarity index (0 common, 1 uncommon, 2 rare...). */
  rarityIndex: (item: string) => number;
}

export interface Factors {
  comfort: number;
  style: number;
  rarity: number;
  amenities: number;
  clean: number;
  space: number;
  /** Things in the right rooms (beds in bedrooms, the toilet in the bathroom...). */
  rooms: number;
}

export interface Rating {
  stars: number;
  /** The uncapped score (0..1) and each factor. */
  score: number;
  factors: Factors;
  missing: string[];
  /** Pieces per theme. */
  themes: Record<string, number>;
  /** Share of the floor covered by furniture (rugs don't count). */
  fill: number;
  /** Some floor can't be reached from the door (blocked walkway). */
  blocked: boolean;
  /** Pieces in a room they don't belong in (and where they'd fit). */
  misplaced: Array<{ iid: number; item: string; want: RoomKind[] }>;
  /** How complete each room is. */
  rooms: RoomStatus[];
}

/** What the rating needs from a layout, so "what if I add X" is cheap to try. */
interface Agg {
  comfort: number;
  styleSum: number;
  n: number;
  themes: Record<string, number>;
  raritySum: number;
  amenities: Set<string>;
  essentials: Set<string>;
  covered: number;
}

export function footprint(p: Pick<FurniturePiece, 'w' | 'h'>, rot: number): [number, number] {
  return rot % 2 ? [p.h, p.w] : [p.w, p.h];
}

function aggregate(cfg: RatingCfg, placed: Array<Pick<Placed, 'item' | 'rot'>>): Agg {
  const a: Agg = { comfort: 0, styleSum: 0, n: 0, themes: {}, raritySum: 0, amenities: new Set(), essentials: new Set(), covered: 0 };
  for (const pl of placed) addPiece(cfg, a, pl.item);
  return a;
}

function addPiece(cfg: RatingCfg, a: Agg, item: string) {
  const p = cfg.furniture.pieces[item];
  if (!p) return;
  a.n++;
  a.comfort += p.comfort;
  a.styleSum += p.style;
  if (p.theme) a.themes[p.theme] = (a.themes[p.theme] ?? 0) + 1;
  a.raritySum += cfg.rarityIndex(item);
  if (p.amenity) a.amenities.add(p.amenity);
  if (p.essential) a.essentials.add(p.essential);
  if (!p.floor && !p.wall) a.covered += p.w * p.h;
}

function score(cfg: RatingCfg, unit: { w: number; h: number; type?: string }, a: Agg, cleanliness: number, blocked: boolean, rooms = 1) {
  const r = cfg.properties.rating;
  const area = unit.w * unit.h;
  const comfort = Math.min(1, a.comfort / (area * r.comfortPerM2));
  const bestTheme = Math.max(0, ...Object.values(a.themes));
  let set = 0;
  for (const [n, v] of r.themeSets) if (bestTheme >= n) set = v;
  const avgStyle = a.n ? a.styleSum / a.n / 10 : 0;
  const style = Math.min(1, set * 0.7 + avgStyle * 0.5);
  const rarity = a.n ? Math.min(1, a.raritySum / a.n / r.rarityForMax) : 0;
  const amenities = Math.min(1, a.amenities.size / r.amenitiesForMax);
  const clean = Math.max(0, Math.min(1, cleanliness / 100));
  const fill = a.covered / area;
  const [lo, hi] = r.idealFill;
  let space = fill < lo ? fill / lo : fill <= hi ? 1 : Math.max(0, 1 - (fill - hi) / 0.3);
  if (blocked) space *= 0.4;
  const factors: Factors = { comfort, style, rarity, amenities, clean, space, rooms };
  const w = r.weights;
  const total = comfort * w.comfort + style * w.style + rarity * w.rarity + amenities * w.amenities + clean * w.clean + space * w.space + rooms * (w.rooms ?? 0);
  // A shop has its own must-haves (customers expect aircond, wifi and a toilet, not a bed).
  const must = (unit.type ? cfg.properties.types[unit.type]?.essentials : undefined) ?? cfg.furniture.essentials;
  const missing = must.filter((e) => !a.essentials.has(e));
  let stars = 0.5 + 4.5 * total;
  if (missing.length) stars = Math.min(stars - r.missingPenalty * missing.length, r.missingCap - r.missingCapStep * (missing.length - 1));
  stars = Math.max(cfg.properties.airbnb.minStars, Math.round(stars * 10) / 10);
  return { stars, score: total, factors, missing, fill };
}

/** The unit's floor plan: rooms for a known home type, else one open room. */
export function unitPlan(cfg: RatingCfg, unit: { w: number; h: number; type?: string }): FloorPlan {
  const t = unit.type ? cfg.properties.types[unit.type] : undefined;
  return t && t.w === unit.w && t.h === unit.h ? planForType(t, unit.type!) : openPlan(unit.w, unit.h);
}

/** Free floor cells that can't be reached from the front door (walls and doorways count). */
function walkwayBlocked(cfg: RatingCfg, plan: FloorPlan, placed: Placed[]): boolean {
  const W = plan.w, H = plan.h;
  const solid = new Uint8Array(W * H);
  for (const pl of placed) {
    const p = cfg.furniture.pieces[pl.item];
    if (!p || p.floor || p.wall) continue;
    const [w, h] = footprint(p, pl.rot);
    for (let y = pl.y; y < pl.y + h; y++) for (let x = pl.x; x < pl.x + w; x++) if (x >= 0 && y >= 0 && x < W && y < H) solid[y * W + x] = 1;
  }
  const start = (H - 1) * W + plan.front[1];
  if (solid[start]) return true;
  const seen = new Uint8Array(W * H);
  const q = [start];
  seen[start] = 1;
  while (q.length) {
    const i = q.pop()!;
    const x = i % W, y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || wallBetween(plan, x, y, nx, ny)) continue;
      const j = ny * W + nx;
      if (!seen[j] && !solid[j]) {
        seen[j] = 1;
        q.push(j);
      }
    }
  }
  let free = 0, reached = 0;
  for (let i = 0; i < W * H; i++) {
    if (solid[i]) continue;
    free++;
    if (seen[i]) reached++;
  }
  return free > 0 && reached / free < 0.85;
}

// ------------------------------------------------------------------ the right rooms
const ROOM_NAME: Record<RoomKind, string> = { living: 'the living room', bedroom: 'a bedroom', kitchen: 'the kitchen', bath: 'the bathroom', office: 'an office' };

/** The rooms a piece belongs in, or null if it's fine anywhere. */
export function roomKindsFor(cfg: Pick<RatingCfg, 'furniture'>, item: string): RoomKind[] | null {
  const p = cfg.furniture.pieces[item];
  if (!p) return null;
  return cfg.furniture.roomFor[item] ?? cfg.furniture.roomFor[p.category] ?? null;
}

/** "a bedroom", "the kitchen or the living room". */
export function roomNames(kinds: RoomKind[]): string {
  const n = kinds.map((k) => ROOM_NAME[k]);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} or ${n[n.length - 1]}` : n[0];
}

/** Does a room of this kind suit the piece? (A home with no bedroom sleeps in its main room.) */
export function roomSuits(plan: FloorPlan, kind: RoomKind, want: RoomKind[]): boolean {
  if (want.includes(kind)) return true;
  if (kind === 'living' && want.includes('bedroom') && !plan.rooms.some((r) => r.kind === 'bedroom')) return true;
  return false;
}

/** Does a placed piece meet a room need's token (id, category, essential or amenity)? */
function meets(cfg: RatingCfg, item: string, any: string[]): boolean {
  const p = cfg.furniture.pieces[item];
  return !!p && any.some((t) => t === item || t === p.category || t === p.essential || t === p.amenity);
}

export interface RoomStatus {
  room: number;
  /** Needs met / needs (1 = complete). */
  done: number;
  missing: Array<{ name: string; any: string[] }>;
}

/** How complete each room is (rooms whose kind has no list don't count). */
export function roomStatus(cfg: RatingCfg, plan: FloorPlan, placed: Placed[]): RoomStatus[] {
  const out: RoomStatus[] = [];
  plan.rooms.forEach((r, i) => {
    const needs = cfg.furniture.roomSets[r.kind];
    if (!needs?.length) return;
    const inRoom = placed.filter((pl) => roomIndex(plan, pl.x, pl.y) === i);
    const missing = needs.filter((n) => !inRoom.some((pl) => meets(cfg, pl.item, n.any)));
    out.push({ room: i, done: (needs.length - missing.length) / needs.length, missing });
  });
  return out;
}

/**
 * The Rooms factor: 60% the right things in the right rooms, 40% how complete the rooms are.
 * (One open room, e.g. an unknown home type, has nothing to judge: full marks.)
 */
function roomsFit(cfg: RatingCfg, plan: FloorPlan, placed: Placed[]): { factor: number; fit: number; complete: number; misplaced: Rating['misplaced']; status: RoomStatus[] } {
  if (plan.rooms.length < 2) return { factor: 1, fit: 1, complete: 1, misplaced: [], status: [] };
  let n = 0, ok = 0;
  const misplaced: Rating['misplaced'] = [];
  for (const pl of placed) {
    const want = roomKindsFor(cfg, pl.item);
    if (!want) continue;
    const i = roomIndex(plan, pl.x, pl.y);
    if (i < 0) continue;
    n++;
    if (roomSuits(plan, plan.rooms[i].kind, want)) ok++;
    else misplaced.push({ iid: pl.iid, item: pl.item, want });
  }
  const fit = n ? ok / n : 1;
  const status = roomStatus(cfg, plan, placed);
  const complete = status.length ? status.reduce((a, s) => a + s.done, 0) / status.length : 1;
  return { factor: 0.6 * fit + 0.4 * complete, fit, complete, misplaced, status };
}

export function rateUnit(cfg: RatingCfg, unit: { w: number; h: number; type?: string }, placed: Placed[], cleanliness: number): Rating {
  const a = aggregate(cfg, placed);
  const blocked = walkwayBlocked(cfg, unitPlan(cfg, unit), placed);
  const plan = unitPlan(cfg, unit);
  const rf = roomsFit(cfg, plan, placed);
  return { ...score(cfg, unit, a, cleanliness, blocked, rf.factor), themes: a.themes, blocked, misplaced: rf.misplaced, rooms: rf.status };
}

// ------------------------------------------------------------------ layout rules
/** Why a layout is invalid (out of the home, across a wall, overlapping, blocking a doorway, a
 *  wall item not on a wall), or null. */
export function layoutProblem(cfg: RatingCfg, unit: { w: number; h: number; type?: string }, placed: Placed[]): string | null {
  const plan = unitPlan(cfg, unit);
  const W = plan.w, H = plan.h;
  const grid = new Int32Array(W * H).fill(-1);
  const wallGrid = new Int32Array(W * H).fill(-1);
  const keepClear = new Set(doorwayCells(plan).map(([x, y]) => y * W + x));
  const iids = new Set<number>();
  for (let k = 0; k < placed.length; k++) {
    const pl = placed[k];
    const p = cfg.furniture.pieces[pl.item];
    if (!p) return `${pl.item} isn't furniture.`;
    if (iids.has(pl.iid)) return 'The same item is placed twice.';
    iids.add(pl.iid);
    const [w, h] = footprint(p, pl.rot);
    if (pl.x < 0 || pl.y < 0 || pl.x + w > W || pl.y + h > H) return 'Something sticks out of the room.';
    // One room only (it can't go through a wall).
    const room = roomIndex(plan, pl.x, pl.y);
    for (let y = pl.y; y < pl.y + h; y++) for (let x = pl.x; x < pl.x + w; x++) if (roomIndex(plan, x, y) !== room) return `It can't go through a wall: keep it inside one room.`;
    if (p.wall) {
      // Must hang on a wall: the back or side walls of its room (not the front wall you look from).
      let onWall = false;
      for (let y = pl.y; y < pl.y + h && !onWall; y++)
        for (let x = pl.x; x < pl.x + w && !onWall; x++)
          for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
            if (dy === 1 && y === H - 1) continue; // the outside front wall
            if (wallBetween(plan, x, y, x + dx, y + dy)) onWall = true;
          }
      if (!onWall) return 'Wall items have to touch a wall.';
    }
    if (p.floor) continue;
    const g = p.wall ? wallGrid : grid;
    for (let y = pl.y; y < pl.y + h; y++)
      for (let x = pl.x; x < pl.x + w; x++) {
        if (g[y * W + x] >= 0) return 'Two pieces overlap.';
        g[y * W + x] = k;
        if (!p.wall && keepClear.has(y * W + x)) return 'Keep the doorway clear.';
      }
  }
  return null;
}

// ------------------------------------------------------------------ money
/** Location demand: up to +30% near the MRT, The Strand and Dataran Sunway. */
export function locationMult(cfg: PropertiesConfig, distTiles: number): number {
  return 1 + cfg.locationBonus * Math.max(0, 1 - distTiles / cfg.locationRangeTiles);
}

/** A fair nightly price for this rating; the recommended range is ±10%. */
export function fairNightSen(cfg: PropertiesConfig, type: string, stars: number, loc: number): number {
  const t = cfg.types[type];
  return Math.round(t.nightBaseSen * (0.25 + 0.75 * Math.pow(stars / 5, 1.6)) * loc);
}

/** Chance a night gets booked: better stars and a fair price fill up; overpricing empties it. */
export function bookingChance(cfg: PropertiesConfig, stars: number, priceSen: number, fairSen: number, loc: number, weekend: boolean, event: boolean): number {
  const a = cfg.airbnb;
  const r = priceSen / Math.max(1, fairSen);
  const priceF = r <= 0.7 ? 1.3 : Math.max(0.05, 1.3 - (r - 0.7) * 1.0);
  const p = (a.bookingBase + a.bookingPerStar * stars) * priceF * (weekend ? a.weekendBoost : 1) * (event ? a.eventBoost : 1) * Math.sqrt(loc);
  return Math.max(0, Math.min(0.97, p));
}

/** Fair long-term rent per in-game day (furnishing adds up to +20%). */
export function fairRentSen(cfg: PropertiesConfig, type: string, loc: number, stars: number): number {
  return Math.round(cfg.types[type].rentPerDaySen * loc * (1 + 0.2 * Math.min(1, stars / 5)));
}

/** Tenant happiness 0..100 from the unit's condition, furnishing and how fair the rent is. */
export function tenantHappiness(condition: number, stars: number, rentSen: number, fairSen: number, tolerance: number): number {
  const fairness = Math.max(0, Math.min(1, 1 - (rentSen / Math.max(1, fairSen * tolerance) - 1) / 0.5));
  return Math.round(0.35 * Math.max(0, Math.min(100, condition)) + 25 * Math.min(1, stars / 5) + 40 * fairness);
}

// ------------------------------------------------------------------ suggestions
export interface Suggestion {
  text: string;
  /** Star gain if you do it. */
  gain: number;
  /** Extra per night at the fair price. */
  nightGainSen: number;
  action: { kind: 'buy' | 'place'; item: string } | { kind: 'clean' } | { kind: 'remove'; iid: number } | { kind: 'move'; iid: number; item: string };
}

/**
 * The top 3 changes that would raise the rating most: missing essentials, completing a theme
 * set, cleaning, freeing a cramped room, better comfort. `owned` = furniture you have but
 * haven't placed (placing costs nothing, so it ranks above buying).
 */
export function suggestions(
  cfg: RatingCfg,
  unit: { w: number; h: number; type: string; loc: number },
  placed: Placed[],
  cleanliness: number,
  owned: string[],
): Suggestion[] {
  const base = rateUnit(cfg, unit, placed, cleanliness);
  const a0 = aggregate(cfg, placed);
  const fair0 = fairNightSen(cfg.properties, unit.type, base.stars, unit.loc);
  const out: Suggestion[] = [];
  const name = (item: string) => item.replace(/_/g, ' ');
  const tryAdd = (item: string) => {
    const a = { ...a0, themes: { ...a0.themes }, amenities: new Set(a0.amenities), essentials: new Set(a0.essentials) };
    addPiece(cfg, a, item);
    return score(cfg, unit, a, cleanliness, base.blocked, base.factors.rooms).stars;
  };
  const push = (text: string, stars: number, action: Suggestion['action'], keep = false) => {
    const gain = Math.max(0, Math.round((stars - base.stars) * 10) / 10);
    if (gain <= 0 && !keep) return; // `keep`: free moves stay even when the gain rounds to 0
    out.push({ text, gain, nightGainSen: fairNightSen(cfg.properties, unit.type, stars, unit.loc) - fair0, action });
  };
  const ownedSet = new Set(owned);
  const catalog = Object.entries(cfg.furniture.pieces);
  // Best candidate per idea: owned first (free), else the cheapest in the store.
  const pick = (want: (p: FurniturePiece, id: string) => boolean) => {
    const own = [...ownedSet].find((id) => cfg.furniture.pieces[id] && want(cfg.furniture.pieces[id], id));
    if (own) return { item: own, owned: true };
    const buy = catalog.filter(([id, p]) => p.storeSen && want(p, id)).sort((x, y) => x[1].storeSen! - y[1].storeSen!)[0];
    return buy ? { item: buy[0], owned: false } : null;
  };
  for (const e of base.missing) {
    const c = pick((p) => p.essential === e);
    if (c) push(`${c.owned ? 'Place your' : 'Add a'} ${name(c.item)} (missing essential)`, tryAdd(c.item), { kind: c.owned ? 'place' : 'buy', item: c.item });
  }
  if (cleanliness < 80) {
    const stars = score(cfg, unit, a0, 100, base.blocked, base.factors.rooms).stars;
    push(`Clean the unit (cleanliness ${Math.round(cleanliness)}%)`, stars, { kind: 'clean' });
  }
  // Theme sets: the theme you have most of, one piece closer to its next set.
  const sets = cfg.properties.rating.themeSets;
  const themesByCount = Object.entries(base.themes).sort((x, y) => y[1] - x[1]);
  for (const [theme, n] of themesByCount.slice(0, 2)) {
    const next = sets.find(([k]) => k > n);
    if (!next) continue;
    const c = pick((p) => p.theme === theme && !p.essential);
    if (!c) continue;
    const themeName = cfg.furniture.themes[theme]?.name ?? theme;
    push(`${next[0] - n} more ${themeName} piece${next[0] - n > 1 ? 's' : ''} complete${next[0] - n > 1 ? '' : 's'} a ${next[0]}-set (try ${name(c.item)})`, tryAdd(c.item), { kind: c.owned ? 'place' : 'buy', item: c.item });
  }
  // Missing amenities.
  for (const am of cfg.furniture.amenities) {
    if (a0.amenities.has(am)) continue;
    const c = pick((p) => p.amenity === am);
    if (c) push(`${c.owned ? 'Place your' : 'Add a'} ${name(c.item)} (amenity)`, tryAdd(c.item), { kind: c.owned ? 'place' : 'buy', item: c.item });
  }
  // Comfort.
  const comfy = pick((p) => !p.essential && p.comfort >= 5);
  if (comfy && base.factors.comfort < 0.9) push(`More comfort: ${name(comfy.item)}`, tryAdd(comfy.item), { kind: comfy.owned ? 'place' : 'buy', item: comfy.item });
  // Something in the wrong room: move it (worth what a perfect Rooms score would add, shared out).
  if (base.misplaced.length) {
    const m0 = base.misplaced[0];
    const a1 = aggregate(cfg, placed);
    const n = placed.filter((pl) => roomKindsFor(cfg, pl.item)).length || 1;
    // The Rooms factor is 60% "right rooms": one more piece in place adds 0.6 / n.
    const stars = score(cfg, unit, a1, cleanliness, base.blocked, Math.min(1, base.factors.rooms + 0.6 / n)).stars;
    push(`Move the ${name(m0.item)} into ${roomNames(m0.want)}`, stars, { kind: 'move', iid: m0.iid, item: m0.item }, true);
  }
  // A room that's almost there: add what it's missing.
  {
    const plan = unitPlan(cfg, unit);
    const todo = base.rooms.filter((r) => r.missing.length).sort((x, y) => y.done - x.done)[0];
    if (todo) {
      const need = todo.missing[0];
      const c = pick((p, id) => need.any.some((t) => t === id || t === p.category || t === p.essential || t === p.amenity));
      if (c) {
        // One more need met: its share of that room, of all the rooms.
        const per = 1 / Math.max(1, base.rooms.length) / (cfg.furniture.roomSets[plan.rooms[todo.room].kind]?.length ?? 1);
        const a1 = aggregate(cfg, [...placed, { iid: -1, item: c.item, x: 0, y: 0, rot: 0 }]);
        const stars = score(cfg, unit, a1, cleanliness, base.blocked, Math.min(1, base.factors.rooms + 0.4 * per)).stars;
        push(`Complete the ${plan.rooms[todo.room].name.toLowerCase()}: ${c.owned ? 'place your' : 'add a'} ${name(c.item)} (${need.name})`, stars, { kind: c.owned ? 'place' : 'buy', item: c.item });
      }
    }
  }
  // Cramped or blocked: take out the piece whose removal helps most.
  if (base.blocked || base.fill > cfg.properties.rating.idealFill[1]) {
    let best: { iid: number; stars: number; item: string } | null = null;
    for (const pl of placed) {
      const p = cfg.furniture.pieces[pl.item];
      if (!p || p.essential || p.wall || p.floor) continue;
      const rest = placed.filter((x) => x.iid !== pl.iid);
      const stars = rateUnit(cfg, unit, rest, cleanliness).stars;
      if (!best || stars > best.stars) best = { iid: pl.iid, stars, item: pl.item };
    }
    if (best) push(base.blocked ? `The walkway is blocked: move or remove the ${name(best.item)}` : `The room is cramped: remove the ${name(best.item)}`, best.stars, { kind: 'remove', iid: best.iid });
  }
  out.sort((x, y) => y.gain - x.gain || (x.action.kind === 'place' ? -1 : 1));
  // One suggestion per item/action.
  const seen = new Set<string>();
  const top = out.filter((s) => {
    const k = s.action.kind === 'clean' ? 'clean' : s.action.kind === 'remove' ? `rm${s.action.iid}` : s.action.kind === 'move' ? `mv${s.action.iid}` : s.action.item;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Moving something to the right room is free: always keep one slot for it.
  const best = top.slice(0, 3);
  const move = top.find((x) => x.action.kind === 'move');
  if (move && !best.includes(move)) best[Math.min(2, best.length - 1)] = move;
  return best;
}
