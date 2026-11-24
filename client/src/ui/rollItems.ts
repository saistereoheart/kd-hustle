// Items a crate roll gave you (each result, and its 🧪 bonus potion if one came with it).
import type { InventoryItem, RollResult } from '@kh/shared';

export function rollItems(results: RollResult[]): InventoryItem[] {
  const now = Date.now();
  const out: InventoryItem[] = [];
  for (const r of results) {
    out.push({ iid: r.iid, itemId: r.itemId, variant: r.variant, grade: r.grade, serial: r.serial, obtainedAt: now });
    if (r.bonus) out.push({ iid: r.bonus.iid, itemId: r.bonus.itemId, variant: r.bonus.variant, grade: r.bonus.grade, serial: null, obtainedAt: now });
  }
  return out;
}
