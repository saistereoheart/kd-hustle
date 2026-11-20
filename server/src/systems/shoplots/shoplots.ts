// 🏪 Shoplots: each player's Venture occupies a real ground-floor shoplot in town, like a home
// (the same shoplots a kopitiam can take: one business per shoplot). This keeps the index of who
// has which (a DB table, so offline owners keep theirs) and finds free ones.
import type { ShoplotPublic } from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { Repos } from '../../db/repos';
import { GameError } from '../economy/economy';

interface Row {
  building: string;
  owner: number;
  ownerName: string;
  kind: string;
  ref: string;
}

export class ShoplotSystem {
  private rows = new Map<string, Row>();
  /** Shoplot building → its door front (tiles). */
  readonly spots = new Map<string, { x: number; y: number }>();
  /** Buildings a kopitiam stands in right now (set by the stall system's owner). */
  stallBuildings: () => Set<string> = () => new Set();

  constructor(private cfg: ServerConfig, private repos: Repos) {
    for (const p of cfg.map.stallPlots) if (p.tier >= cfg.stalls.cashierFromTier && p.building) this.spots.set(p.building, { x: p.x, y: p.y });
    for (const r of repos.shoplots.all()) this.rows.set(r.building, r);
  }

  /** Is this a shoplot nobody (no Venture, no kopitiam) is using? */
  isFree(building: string): boolean {
    return this.spots.has(building) && !this.rows.has(building) && !this.stallBuildings().has(building);
  }
  /** Taken by a Venture (the kopitiam picker skips these). */
  takenByVenture(building: string): boolean {
    return this.rows.has(building);
  }

  /** Where this player's Venture of `ref` is, or null. */
  of(owner: number, kind: string, ref: string): string | null {
    for (const r of this.rows.values()) if (r.owner === owner && r.kind === kind && r.ref === ref) return r.building;
    return null;
  }

  /** The free shoplot nearest to (x, y) in tiles. */
  nearestFree(x: number, y: number): string | null {
    let best: string | null = null;
    let bd = Infinity;
    const busy = this.stallBuildings();
    for (const [b, s] of this.spots) {
      if (this.rows.has(b) || busy.has(b)) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  /** Takes a shoplot (the one asked for, or the nearest free one to (x, y)). */
  claim(owner: number, ownerName: string, kind: string, ref: string, near: { x: number; y: number }, building?: string): string {
    const had = this.of(owner, kind, ref);
    if (had) return had;
    const b = building ?? this.nearestFree(near.x, near.y);
    if (!b) throw new GameError('Every shoplot in town is taken.');
    if (!this.isFree(b)) throw new GameError('That shoplot is taken.');
    this.repos.shoplots.claim(b, owner, kind, ref);
    this.rows.set(b, { building: b, owner, ownerName, kind, ref });
    return b;
  }

  /** Moves this player's Venture to another free shoplot. */
  move(owner: number, kind: string, ref: string, building: string): string {
    const from = this.of(owner, kind, ref);
    if (!from) throw new GameError("That business isn't anywhere yet.");
    if (from === building) throw new GameError("It's already there.");
    if (!this.isFree(building)) throw new GameError('That shoplot is taken.');
    const row = this.rows.get(from)!;
    this.repos.shoplots.move(building, owner, kind, ref);
    this.rows.delete(from);
    this.rows.set(building, { ...row, building });
    return building;
  }

  release(owner: number, kind: string, ref: string) {
    const b = this.of(owner, kind, ref);
    if (!b) return;
    this.repos.shoplots.release(owner, kind, ref);
    this.rows.delete(b);
  }

  releaseAll(owner: number, kind: string) {
    for (const r of [...this.rows.values()]) if (r.owner === owner && r.kind === kind) this.release(owner, kind, r.ref);
  }

  public(): ShoplotPublic[] {
    return [...this.rows.values()].map((r) => ({ building: r.building, ownerId: r.owner, ownerName: r.ownerName, kind: 'venture', ref: r.ref }));
  }
}
