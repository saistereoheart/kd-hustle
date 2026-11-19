// Items can carry several variants at once (e.g. Shiny + Golden), stored as one string with the
// variants joined by "+", rarest last ("shiny+golden"); a plain item is "normal". Every variant
// multiplies the item's value and its buff. The art shows the rarest one.
export const PLAIN = 'normal';

/** The special variants on an item ([] for a plain one). */
export function variantParts(v: string | undefined | null): string[] {
  return !v || v === PLAIN ? [] : v.split('+').filter((x) => x && x !== PLAIN);
}

/** Puts variants together (no repeats, in rarity `order`, rarest last). */
export function joinVariants(order: readonly string[], parts: readonly string[]): string {
  const set = [...new Set(parts.filter((x) => x && x !== PLAIN))];
  if (!set.length) return PLAIN;
  return set.sort((a, b) => order.indexOf(a) - order.indexOf(b)).join('+');
}

/** The rarest variant on an item (what its art shows), or "normal". */
export function topVariant(v: string | undefined | null): string {
  const p = variantParts(v);
  return p.length ? p[p.length - 1] : PLAIN;
}

/** Has this variant? */
export function hasVariant(v: string | undefined | null, id: string): boolean {
  return variantParts(v).includes(id);
}

/** All the variants' multipliers multiplied (`mults`: id → multiplier). */
export function variantProduct(mults: Readonly<Record<string, number>>, v: string | undefined | null): number {
  return variantParts(v).reduce((m, id) => m * (mults[id] ?? 1), 1);
}

/** "Shiny + Golden" (names from `names`), or "" for a plain item. */
export function variantLabel(names: ReadonlyArray<{ id: string; name: string }>, v: string | undefined | null): string {
  return variantParts(v).map((id) => names.find((n) => n.id === id)?.name ?? id).join(' + ');
}
