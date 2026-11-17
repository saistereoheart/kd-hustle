// Ronda rides (the phone's ride-hailing app). Server-authoritative from start to finish:
//  1. quote: the server plans the route from where you stand to the picked spot and prices it;
//  2. book: you pay the quoted fare (only if you're still roughly where you asked);
//  3. ride: after a short pickup wait the server moves you along the route at a fixed speed
//     (your own move reports are ignored), and drops you off at the end, or where you get off.
import { districtAt, rideFareSen, vehicleSpeedGrid, type BuiltMap, type Direction, type RideQuote, type RidesConfig, type TerrainConfig } from '@kh/shared';
import { randomUUID } from 'node:crypto';
import { GameError } from '../economy/economy';
import { planRoute, polylineLength, type RouteGrid } from './route';

export interface PendingQuote extends RideQuote {
  /** Where the player stood when asking (world px). */
  fromX: number;
  fromY: number;
  expiresAt: number;
}

export interface ActiveRide {
  /** Route in world px, flat, plus the cumulative length at each point. */
  pts: number[];
  cum: number[];
  /** When the rider sets off (after the pickup wait). */
  departAt: number;
  speed: number;
  fareSen: number;
  destName: string | null;
}

/** What the ride system needs to know about (and does to) a player. */
export interface RidePlayer {
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  dirty: boolean;
  rideQuote: PendingQuote | null;
  ride: ActiveRide | null;
}

export class RideSystem {
  private grid: RouteGrid;
  private T: number;

  constructor(private cfg: RidesConfig, private map: BuiltMap, terrain: TerrainConfig) {
    this.T = map.tileSize;
    this.grid = {
      width: map.width,
      height: map.height,
      originTx: map.originTx,
      originTy: map.originTy,
      blocked: map.driveSolid,
      speed: vehicleSpeedGrid(map, terrain),
    };
  }

  /** A name for the drop-off: the nearest named building or street, else the district. */
  private placeName(tx: number, ty: number): string | null {
    let best: { name: string; d: number } | null = null;
    for (const b of this.map.buildings) {
      if (!b.name) continue;
      const cx = Math.max(b.bbox.x0, Math.min(b.bbox.x1, tx));
      const cy = Math.max(b.bbox.y0, Math.min(b.bbox.y1, ty));
      const d = Math.hypot(cx - tx, cy - ty);
      if (d < 25 && (!best || d < best.d)) best = { name: b.name, d };
    }
    if (best) return best.name;
    for (const r of this.map.roads) {
      if (!r.name || r.elevated) continue;
      for (let i = 0; i < r.pts.length; i += 2) {
        const d = Math.hypot(r.pts[i] - tx, r.pts[i + 1] - ty);
        if (d < 15 && (!best || d < best.d)) best = { name: r.name, d };
      }
    }
    if (best) return best.name;
    const d = districtAt(this.map, Math.floor(tx), Math.floor(ty));
    return d && d.rect[2] < this.map.width ? d.name : null;
  }

  quote(p: RidePlayer, tx: number, ty: number, now = Date.now()): RideQuote {
    if (p.ride) throw new GameError("You're already on a ride.");
    const m = this.map;
    if (tx < m.originTx || ty < m.originTy || tx >= m.originTx + m.width || ty >= m.originTy + m.height) throw new GameError("That's off the map.");
    const route = planRoute(this.grid, [p.x / this.T, p.y / this.T], [tx, ty], this.cfg);
    if (!route) throw new GameError(`${this.cfg.appName} can't get there. Pick a spot near a road.`);
    const meters = polylineLength(route) * m.metersPerTile;
    if (meters < this.cfg.minTripMeters) throw new GameError("That's just around the corner. Walk there!");
    const fareSen = rideFareSen(this.cfg, meters);
    const etaSec = Math.round((this.cfg.pickupMs + (polylineLength(route) * this.T * 1000) / this.cfg.speedPxPerSec) / 1000);
    const end: [number, number] = [route[route.length - 2], route[route.length - 1]];
    const q: PendingQuote = {
      quoteId: randomUUID(), fareSen, meters: Math.round(meters), etaSec, route, destName: this.placeName(...end),
      fromX: p.x, fromY: p.y, expiresAt: now + this.cfg.quoteTtlSec * 1000,
    };
    p.rideQuote = q;
    const { fromX: _x, fromY: _y, expiresAt: _e, ...visible } = q;
    return visible;
  }

  /** Checks the quote can be booked and returns it. The caller charges the fare, then calls start(). */
  checkBooking(p: RidePlayer, quoteId: string, now = Date.now()): PendingQuote {
    if (p.ride) throw new GameError("You're already on a ride.");
    const q = p.rideQuote;
    if (!q || q.quoteId !== quoteId) throw new GameError('That fare has expired. Pick your destination again.');
    if (now > q.expiresAt) {
      p.rideQuote = null;
      throw new GameError('That fare has expired. Pick your destination again.');
    }
    if (Math.hypot(p.x - q.fromX, p.y - q.fromY) > this.cfg.maxQuoteDriftTiles * this.T) {
      p.rideQuote = null;
      throw new GameError('You moved away from the pickup spot. Ask for a new fare.');
    }
    return q;
  }

  start(p: RidePlayer, q: PendingQuote, now = Date.now()): ActiveRide {
    const pts = q.route.map((v) => v * this.T);
    pts[0] = p.x;
    pts[1] = p.y;
    const cum = [0];
    for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
    p.rideQuote = null;
    p.ride = { pts, cum, departAt: now + this.cfg.pickupMs, speed: this.cfg.speedPxPerSec, fareSen: q.fareSen, destName: q.destName };
    p.moving = false;
    return p.ride;
  }

  /** Pickup wait + riding time. */
  durationMs(r: ActiveRide): number {
    return this.cfg.pickupMs + (r.cum[r.cum.length - 1] / r.speed) * 1000;
  }

  /**
   * Moves a riding player to where the ride is at `now`. Returns true when the ride has
   * reached the end (the caller then ends it).
   */
  step(p: RidePlayer, now = Date.now()): boolean {
    const r = p.ride;
    if (!r) return false;
    const total = r.cum[r.cum.length - 1];
    const dist = Math.max(0, ((now - r.departAt) / 1000) * r.speed);
    if (now < r.departAt) return false;
    if (dist >= total) {
      this.place(p, r.pts[r.pts.length - 2], r.pts[r.pts.length - 1], false);
      return true;
    }
    let k = 1;
    while (k < r.cum.length - 1 && r.cum[k] < dist) k++;
    const seg = r.cum[k] - r.cum[k - 1] || 1;
    const f = (dist - r.cum[k - 1]) / seg;
    const ax = r.pts[(k - 1) * 2], ay = r.pts[(k - 1) * 2 + 1], bx = r.pts[k * 2], by = r.pts[k * 2 + 1];
    const dx = bx - ax, dy = by - ay;
    p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    this.place(p, ax + dx * f, ay + dy * f, true);
    return false;
  }

  private place(p: RidePlayer, x: number, y: number, moving: boolean) {
    p.x = Math.round(x * 10) / 10;
    p.y = Math.round(y * 10) / 10;
    p.moving = moving;
    p.dirty = true;
  }

  /** Ends the ride (arrived or got off). The caller hops the player off and syncs the client. */
  end(p: RidePlayer) {
    p.ride = null;
    p.moving = false;
  }
}
