// 🅿️ Vehicles put down in the world. You place a vehicle you own next to you, get in to drive it,
// get out to park it where you stopped, and put it away when you're done. Other players can get
// in as passengers while there's a free seat (a bike carries 2, a car 4). Seat 0 is the driver's
// and only the owner drives. This file is the bookkeeping only (no sockets, no map).
import type { Direction, ParkedPublic, VehicleLook } from '@kh/shared';

export class ParkingError extends Error {}

export interface Parked {
  vid: string;
  scene: string;
  ownerId: number;
  ownerName: string;
  vehicle: string;
  look: VehicleLook | null;
  x: number;
  y: number;
  dir: Direction;
  seats: Array<number | null>;
}

export class Parking {
  private byVid = new Map<string, Parked>();
  private seatOf = new Map<number, { vid: string; seat: number }>();
  private next = 1;

  all(scene?: string): Parked[] {
    return [...this.byVid.values()].filter((p) => scene === undefined || p.scene === scene);
  }
  get(vid: string): Parked | undefined {
    return this.byVid.get(vid);
  }
  ofOwner(ownerId: number): Parked[] {
    return [...this.byVid.values()].filter((p) => p.ownerId === ownerId);
  }
  /** Where a player sits (if they're in a vehicle). */
  seatOfPlayer(pid: number): { vid: string; seat: number } | null {
    return this.seatOf.get(pid) ?? null;
  }
  /** The vehicle this player is driving. */
  drivenBy(pid: number): Parked | null {
    const s = this.seatOf.get(pid);
    return s && s.seat === 0 ? (this.byVid.get(s.vid) ?? null) : null;
  }
  occupants(p: Parked): number[] {
    return p.seats.filter((s): s is number => s !== null);
  }

  place(o: { scene: string; ownerId: number; ownerName: string; vehicle: string; look: VehicleLook | null; seats: number; x: number; y: number; dir: Direction }): Parked {
    const p: Parked = {
      vid: `v${this.next++}`,
      scene: o.scene,
      ownerId: o.ownerId,
      ownerName: o.ownerName,
      vehicle: o.vehicle,
      look: o.look,
      x: o.x,
      y: o.y,
      dir: o.dir,
      seats: Array.from({ length: Math.max(1, o.seats) }, () => null),
    };
    this.byVid.set(p.vid, p);
    return p;
  }

  /** Takes a seat: the owner drives (seat 0), anyone else gets the first free passenger seat. */
  enter(vid: string, pid: number): number {
    const p = this.byVid.get(vid);
    if (!p) throw new ParkingError('That vehicle has gone.');
    if (this.seatOf.has(pid)) throw new ParkingError("You're already in a vehicle.");
    let seat: number;
    if (pid === p.ownerId) {
      if (p.seats[0] !== null) throw new ParkingError('Someone is already driving it.');
      seat = 0;
    } else {
      seat = p.seats.findIndex((s, i) => i > 0 && s === null);
      if (seat < 0) throw new ParkingError(p.seats.length === 1 ? `Only ${p.ownerName} fits on that.` : "It's full.");
    }
    p.seats[seat] = pid;
    this.seatOf.set(pid, { vid, seat });
    return seat;
  }

  /** Leaves the seat. Returns the vehicle and the seat they had, or null if they weren't in one. */
  exit(pid: number): { parked: Parked; seat: number } | null {
    const s = this.seatOf.get(pid);
    if (!s) return null;
    this.seatOf.delete(pid);
    const p = this.byVid.get(s.vid);
    if (!p) return null;
    p.seats[s.seat] = null;
    return { parked: p, seat: s.seat };
  }

  /** Moves a vehicle (with whoever is in it). */
  moveTo(vid: string, x: number, y: number, dir: Direction) {
    const p = this.byVid.get(vid);
    if (!p) return;
    p.x = x;
    p.y = y;
    p.dir = dir;
  }

  /** Puts a vehicle away. Returns who was in it (they need to be let out). */
  remove(vid: string): number[] {
    const p = this.byVid.get(vid);
    if (!p) return [];
    const out = this.occupants(p);
    for (const pid of out) this.seatOf.delete(pid);
    this.byVid.delete(vid);
    return out;
  }

  toPublic(p: Parked): ParkedPublic {
    return { vid: p.vid, ownerId: p.ownerId, ownerName: p.ownerName, vehicle: p.vehicle, look: p.look, x: p.x, y: p.y, dir: p.dir, seats: [...p.seats] };
  }
}
