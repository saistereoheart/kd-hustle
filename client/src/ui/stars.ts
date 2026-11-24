// ⭐ Rebirth stars by player names, everywhere a name shows (chat, signs, lists, nameplates, fights).
// The server sends everyone's count once (init) and again when someone is reborn.
import { rebirthStars } from '@kh/shared';

const counts = new Map<string, number>();
const fns = new Set<() => void>();

export function setAllStars(all: Record<string, number> | undefined) {
  counts.clear();
  for (const [name, n] of Object.entries(all ?? {})) counts.set(name, n);
  for (const f of fns) f();
}

export function setStars(name: string, n: number) {
  counts.set(name, n);
  for (const f of fns) f();
}

export function starsOf(name: string | null | undefined): number {
  return name ? (counts.get(name) ?? 0) : 0;
}

/** '⭐⭐ Name' for a reborn player, else just the name. */
export function starName(name: string | null | undefined): string {
  return name ? rebirthStars(starsOf(name)) + name : '';
}

/** Be told when anyone's stars change; returns the unsubscribe. */
export function onStars(fn: () => void): () => void {
  fns.add(fn);
  return () => fns.delete(fn);
}
