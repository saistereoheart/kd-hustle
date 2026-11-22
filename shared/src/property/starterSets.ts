// 🪑 A shop floor's starter tables (a table with a chair each side, down both side walls), shown until
// the owner has tables of their own. The owner can take them over as real furniture (feedback #17):
// then they can pick them up, move them, or swap in other tables and chairs. Same maths on the
// client (to draw them) and the server (to hand them over).
import type { Placed } from './schemas';

export interface StarterPiece {
  w: number;
  h: number;
  wall?: boolean;
  category: string;
}

export const STARTER_TABLE = 'kopitiam_table';
export const STARTER_CHAIR = 'plastic_chair';

/** Where the starter sets go (iids are negative placeholders); none once there's a table in. */
export function starterShopSets(o: { W: number; H: number; front: [number, number]; max: number; layout: Placed[]; piece: (id: string) => StarterPiece | undefined }): Placed[] {
  const { W, H, front, layout, piece } = o;
  if (layout.some((p) => piece(p.item)?.category === 'tables')) return [];
  const used = new Set<string>();
  for (const p of layout) {
    const f = piece(p.item);
    if (!f || f.wall) continue;
    const [w, h] = p.rot % 2 ? [f.h, f.w] : [f.w, f.h];
    for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) used.add(`${x},${y}`);
  }
  const out: Placed[] = [];
  let id = -1;
  for (let y = 2; y <= H - 4 && out.length / 3 < o.max; y += 3) {
    for (const x0 of [1, W - 4]) {
      if (out.length / 3 >= o.max) break;
      const cells = [x0, x0 + 1, x0 + 2];
      if (cells.some((x) => used.has(`${x},${y}`) || (x >= front[0] && x <= front[1]))) continue;
      out.push({ iid: id--, item: STARTER_CHAIR, x: x0, y, rot: 3 });
      out.push({ iid: id--, item: STARTER_TABLE, x: x0 + 1, y, rot: 0 });
      out.push({ iid: id--, item: STARTER_CHAIR, x: x0 + 2, y, rot: 1 });
    }
  }
  return out;
}
