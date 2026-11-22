// 🏠 Player visits (feedback #18): who may look round your places. Everyone by default; you can block
// people, allow only the ones you pick, or close your doors altogether. Saved per player (playerData
// `visits`), so it works while you're offline too.
import type { VisitPrefs } from '@kh/shared';
import type { Repos } from '../../db/repos';

export const DEFAULT_VISITS: VisitPrefs = { mode: 'all', allow: [], block: [] };

/** May `visitor` look round `owner`'s places? (You may always look round your own.) */
export function mayVisit(prefs: VisitPrefs, owner: number, visitor: number): boolean {
  if (owner === visitor) return true;
  if (prefs.mode === 'none') return false;
  if (prefs.mode === 'only') return prefs.allow.includes(visitor);
  return !prefs.block.includes(visitor);
}

export function loadVisits(repos: Repos, id: number): VisitPrefs {
  const v = repos.playerData.load<Partial<VisitPrefs>>(id, 'visits');
  return { ...DEFAULT_VISITS, ...(v ?? {}), allow: [...(v?.allow ?? [])], block: [...(v?.block ?? [])] };
}

export function saveVisits(repos: Repos, id: number, prefs: VisitPrefs) {
  // (An id can't be on both lists.)
  const allow = [...new Set(prefs.allow)].filter((x) => x !== id);
  const block = [...new Set(prefs.block)].filter((x) => x !== id && !allow.includes(x));
  const clean: VisitPrefs = { mode: prefs.mode, allow, block };
  repos.playerData.save(id, 'visits', clean);
  return clean;
}
