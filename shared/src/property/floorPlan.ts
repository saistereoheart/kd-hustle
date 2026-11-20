// Floor plans: a home's floor (w × h cells, 1 cell = 1 m) divided into rooms with doorways. The
// front door is always the bottom middle of the living room. Plans are worked out from the home's
// size (and how many bedrooms its type has), the same way everywhere, so the server and every
// client agree; saved furniture keeps its coordinates (rooms only add inner walls).
//
// Layouts:
//  - small homes (no bedrooms listed): the living room, with the bathroom and a kitchenette in a
//    strip down the right-hand side.
//  - bigger homes: bedrooms and the bathroom across the back, the living room and the kitchen
//    across the front; every back room opens onto the front (the living room if it can).

export type RoomKind = 'living' | 'bedroom' | 'kitchen' | 'bath' | 'office';

export interface Room {
  id: string;
  kind: RoomKind;
  name: string;
  icon: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A doorway in an inner wall. 'h': in the horizontal wall along the TOP edge of cell (x, y)
 *  (between (x, y-1) and (x, y)); 'v': in the vertical wall along the LEFT edge of (x, y). */
export interface Doorway {
  x: number;
  y: number;
  side: 'h' | 'v';
}

export interface FloorPlan {
  w: number;
  h: number;
  rooms: Room[];
  /** Room index of every cell (y * w + x). */
  roomAt: Int8Array;
  doors: Doorway[];
  /** The front door's two cells along the bottom wall. */
  front: [number, number];
}

const ICON: Record<RoomKind, string> = { living: '🛋️', bedroom: '🛏️', kitchen: '🍳', bath: '🚿', office: '💼' };

function names(office: boolean): Record<RoomKind, string> {
  return office
    ? { living: 'Open office', bedroom: 'Office', kitchen: 'Pantry', bath: 'Restroom', office: 'Office' }
    : { living: 'Living room', bedroom: 'Bedroom', kitchen: 'Kitchen', bath: 'Bathroom', office: 'Study' };
}

/** One open room (no inner walls): used when the home type isn't known. */
export function openPlan(w: number, h: number): FloorPlan {
  const rooms: Room[] = [{ id: 'living', kind: 'living', name: 'Living room', icon: ICON.living, x: 0, y: 0, w, h }];
  return { w, h, rooms, roomAt: new Int8Array(w * h), doors: [], front: [Math.floor(w / 2) - 1, Math.floor(w / 2)] };
}

/**
 * The plan for a home of `w × h` with `bedrooms` bedrooms (0 = a small home: living room plus a
 * bathroom and kitchenette). `office`: an office suite (rooms named for work).
 */
export function floorPlan(w: number, h: number, bedrooms: number, office = false): FloorPlan {
  const N = names(office);
  const rooms: Room[] = [];
  const doors: Doorway[] = [];
  const add = (kind: RoomKind, x: number, y: number, rw: number, rh: number, name = N[kind], id: string = kind) =>
    rooms.push({ id, kind, name, icon: ICON[kind], x, y, w: rw, h: rh }) - 1;
  const front: [number, number] = [Math.floor(w / 2) - 1, Math.floor(w / 2)];

  if (bedrooms <= 0 || h < 6) {
    // Small: living room on the left, a strip on the right (bathroom at the back, kitchenette at the front).
    const sw = w >= 8 ? 3 : 2;
    const lw = w - sw;
    const bh = Math.max(2, Math.floor(h / 2));
    add('living', 0, 0, lw, h, office ? N.living : 'Main room');
    add('bath', lw, 0, sw, bh);
    add('kitchen', lw, bh, sw, h - bh, office ? N.kitchen : 'Kitchenette');
    doors.push({ x: lw, y: Math.floor(bh / 2), side: 'v' }, { x: lw, y: bh + Math.floor((h - bh) / 2), side: 'v' });
  } else {
    const hb = Math.max(3, Math.round(h * 0.45)); // the back band (bedrooms, bathroom)
    const hf = h - hb;
    const bathW = w >= 9 ? 3 : 2;
    // Bedrooms at least 3 m wide: as many as fit, up to what the type has.
    const bedSpace = w - bathW;
    const n = Math.max(1, Math.min(bedrooms, Math.floor(bedSpace / 3)));
    // Front: the kitchen on the right, if the living room stays wide enough for the front door.
    const kw = w >= 12 ? 4 : 3;
    const hasKitchen = w - kw >= Math.floor(w / 2) + 2;
    const lw = hasKitchen ? w - kw : w;
    const living = add('living', 0, hb, lw, hf);
    if (hasKitchen) {
      add('kitchen', lw, hb, kw, hf);
      doors.push({ x: lw, y: hb + Math.floor(hf / 2), side: 'v' });
    }
    void living;
    // Back: bedrooms left to right, then the bathroom.
    let x = 0;
    for (let i = 0; i < n; i++) {
      const bw = Math.floor(bedSpace / n) + (i < bedSpace % n ? 1 : 0);
      const name = office ? `${N.bedroom} ${i + 1}` : n === 1 ? N.bedroom : i === 0 ? `Master ${N.bedroom.toLowerCase()}` : `${N.bedroom} ${i + 1}`;
      add(office ? 'office' : 'bedroom', x, 0, bw, hb, name, `bed${i + 1}`);
      x += bw;
    }
    add('bath', x, 0, bathW, hb);
    // Every back room has a doorway in the wall between the bands: into the living room if it
    // reaches that far, else into the kitchen. Not right above the front door's line.
    for (const r of rooms.filter((r) => r.y === 0)) {
      const lo = r.x, hi = r.x + r.w - 1;
      const want = Math.round(r.x + (r.w - 1) / 2);
      let dx = want;
      if (hasKitchen && want >= lw && lo < lw) dx = lw - 1; // reach the living room if any of it overlaps
      dx = Math.max(lo, Math.min(hi, dx));
      doors.push({ x: dx, y: hb, side: 'h' });
    }
  }
  const roomAt = new Int8Array(w * h);
  rooms.forEach((r, i) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) roomAt[y * w + x] = i;
  });
  return { w, h, rooms, roomAt, doors, front };
}

/** The plan for a home type (from properties.json: size and bedrooms). */
export function planForType(t: { w: number; h: number; bedrooms?: number; shop?: boolean }, typeId: string): FloorPlan {
  // A shop floor is one open room.
  if (t.shop) {
    const plan = openPlan(t.w, t.h);
    plan.rooms[0].name = 'Shop floor';
    return plan;
  }
  return floorPlan(t.w, t.h, t.bedrooms ?? 0, typeId === 'office');
}

export function roomIndex(plan: FloorPlan, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= plan.w || y >= plan.h) return -1;
  return plan.roomAt[y * plan.w + x];
}

export function roomAtCell(plan: FloorPlan, x: number, y: number): Room | null {
  const i = roomIndex(plan, x, y);
  return i >= 0 ? plan.rooms[i] : null;
}

/** Is there a wall (no doorway) between two neighbouring cells? Outside the floor counts as wall. */
export function wallBetween(plan: FloorPlan, ax: number, ay: number, bx: number, by: number): boolean {
  const a = roomIndex(plan, ax, ay), b = roomIndex(plan, bx, by);
  if (a < 0 || b < 0) return true;
  if (a === b) return false;
  if (ay === by) {
    const x = Math.max(ax, bx);
    return !plan.doors.some((d) => d.side === 'v' && d.x === x && d.y === ay);
  }
  const y = Math.max(ay, by);
  return !plan.doors.some((d) => d.side === 'h' && d.y === y && d.x === ax);
}

/** The two cells on either side of each doorway (keep them clear of furniture). */
export function doorwayCells(plan: FloorPlan): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const d of plan.doors) {
    if (d.side === 'v') out.push([d.x - 1, d.y], [d.x, d.y]);
    else out.push([d.x, d.y - 1], [d.x, d.y]);
  }
  for (const x of plan.front) out.push([x, plan.h - 1]);
  return out;
}
