// One order for every list of things you own (the bag, Teman, chefs & cashiers, the pawn shop):
// the item's rarity first (rarest on top), then its tier (S before D), then how many variants it
// has (Shiny+Golden before plain), then by name.
import { gradeIndex, variantParts } from '@kh/shared';
import type { App } from '../app';
import { tierOf } from './panel';

export interface Sortable {
  itemId: string;
  grade?: string | null;
  variant?: string | null;
}

/** Rarest first. Pass `then` to break ties after rarity, tier and variant (e.g. by level). */
export function byRarity<T extends Sortable>(app: App, then?: (a: T, b: T) => number): (a: T, b: T) => number {
  const rar = app.cfg.rarities;
  const tier = (t: T) => {
    const def = app.items.get(t.itemId);
    return def ? tierOf(rar, def.rarity).index : -1;
  };
  return (a, b) =>
    tier(b) - tier(a) ||
    gradeIndex(app.cfg.grades, b.grade ?? undefined) - gradeIndex(app.cfg.grades, a.grade ?? undefined) ||
    variantParts(b.variant).length - variantParts(a.variant).length ||
    (then ? then(a, b) : 0) ||
    (app.items.get(a.itemId)?.name ?? a.itemId).localeCompare(app.items.get(b.itemId)?.name ?? b.itemId);
}
