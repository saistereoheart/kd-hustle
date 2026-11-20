// 🅿️ Socket glue for parked vehicles (see systems/parking): put a vehicle down, get in (drive it
// if it's yours, ride along if it isn't), get out, put it away. Passengers can't steer: the
// server moves them with their driver, the same way it moves a Ronda passenger.
import { C2S, collides, type CollisionGrid, type Direction, type MovementConfig, type SeatInfo, type VehicleLook } from '@kh/shared';
import type { Socket } from 'socket.io';
import type { ServerConfig } from '../config/loadConfig';
import { GameError } from '../systems/economy/economy';
import { newMoveState } from '../systems/movement/moveValidator';
import { placePlayer } from '../systems/movement/placement';
import { Parking, ParkingError, type Parked } from '../systems/parking/parking';
import type { GameIO } from './gameServer';
import type { OnlinePlayer, World } from './world';

type Handle = <A, R>(socket: Socket, event: string, schema: { safeParse: (v: unknown) => { success: true; data: A } | { success: false } } | null, fn: (args: A) => R) => void;

const DIR_VEC: Record<Direction, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export function createParking(deps: {
  cfg: ServerConfig;
  world: World;
  io: GameIO;
  socketOf: (p: OnlinePlayer) => Socket | undefined;
  setVehicle: (p: OnlinePlayer, vehicle: string | null) => void;
  moveRules: (p: OnlinePlayer) => { grid: CollisionGrid; movement: MovementConfig };
  gridFor: (grid: 'walk' | 'drive') => CollisionGrid;
  lookOf: (p: OnlinePlayer, vehicle: string) => VehicleLook | null;
}) {
  const { cfg, world, io, socketOf, setVehicle } = deps;
  const T = cfg.map.tileSize;
  const P = cfg.vehicles.parking;
  const parking = new Parking();

  const publish = (v: Parked) => io.to(v.scene).emit('parked:update', { parked: parking.toPublic(v) });
  const seatInfo = (p: OnlinePlayer): SeatInfo | null => {
    const s = parking.seatOfPlayer(p.id);
    if (!s || s.seat === 0) return null; // the driver shows as riding it
    const v = parking.get(s.vid);
    return v ? { vid: v.vid, vehicle: v.vehicle, seat: s.seat } : null;
  };
  world.seatInfo = seatInfo;

  /** The nearest free spot for this hitbox around (x, y), within a few tiles, or null. */
  function spotNear(grid: CollisionGrid, hb: { w: number; h: number }, x: number, y: number, mapVersion: number, from: { x: number; y: number }) {
    const s = placePlayer(grid, hb, { x, y, mapVersion }, { mapVersion, spawn: from }, 6);
    if (collides(grid, s.x, s.y, hb) || Math.hypot(s.x - x, s.y - y) > 6 * T) return null;
    return { x: s.x, y: s.y };
  }

  /** Lets someone out beside the vehicle (on foot), and tells everyone. */
  function letOut(p: OnlinePlayer, v: { x: number; y: number; dir: Direction }, wasDriver: boolean) {
    // Step out to the side (towards the camera when it points left/right, to the left otherwise).
    const side: [number, number] = v.dir === 'left' || v.dir === 'right' ? [0, 1] : [-1, 0];
    const tx = v.x + side[0] * T, ty = v.y + side[1] * T;
    const spot = spotNear(cfg.map.collision, cfg.movement.hitbox, tx, ty, p.mapVersion, { x: v.x, y: v.y }) ?? { x: v.x, y: v.y };
    p.x = spot.x;
    p.y = spot.y;
    p.moving = false;
    p.dirty = true;
    if (wasDriver) setVehicle(p, null); // also resets their move state
    else {
      p.move = newMoveState(p.x, p.y, Date.now(), deps.moveRules(p).movement);
      io.to(p.scene).emit('player:updated', { id: p.id, seat: null });
    }
    socketOf(p)?.emit('move:correct', { x: p.x, y: p.y, seq: 0 });
  }

  /** Puts a vehicle away, letting everyone out first. */
  function remove(v: Parked) {
    const driver = v.seats[0];
    const out = parking.remove(v.vid);
    for (const pid of out) {
      const q = world.get(pid);
      if (q) letOut(q, v, pid === driver);
    }
    io.to(v.scene).emit('parked:removed', { vid: v.vid });
  }

  /** Gets out of whatever they're in (driving parks it where they stopped). */
  function exit(p: OnlinePlayer): boolean {
    const r = parking.exit(p.id);
    if (!r) return false;
    const v = r.parked;
    if (r.seat === 0) parking.moveTo(v.vid, p.x, p.y, p.dir);
    letOut(p, v, r.seat === 0);
    publish(v);
    return true;
  }

  function register(socket: Socket, me: OnlinePlayer, handle: Handle) {
    handle(socket, 'vehicle:place', C2S.vehiclePlace, ({ vehicle }) => {
      if (!me.hasCharacter) throw new GameError('Create your character first.');
      if (me.ride) throw new GameError(`You're on a ${cfg.rides.appName} ride.`);
      if (parking.seatOfPlayer(me.id) || me.vehicle) throw new GameError('Get out first (E).');
      if (me.interior) throw new GameError('Go outside first.');
      if (me.job?.kind === 'carwash') throw new GameError('Finish washing the car first.');
      const def = cfg.vehicles.vehicles[vehicle];
      if (!def || def.passenger || !world.vehiclesOf(me).includes(vehicle)) throw new GameError("You don't have that ride.");
      // Room for it a little in front of you.
      const [dx, dy] = DIR_VEC[me.dir];
      const ahead = P.placeAheadTiles * T;
      const spot = spotNear(deps.gridFor(def.grid), def.hitbox, me.x + dx * ahead, me.y + dy * ahead, me.mapVersion, { x: me.x, y: me.y });
      if (!spot) throw new GameError('No room to put it down here. Try an open road or a car park.');
      // One out at a time (by default): the old one is put away.
      const mine = parking.ofOwner(me.id);
      while (mine.length >= P.maxParkedPerPlayer) remove(mine.shift()!);
      const v = parking.place({
        scene: me.scene, ownerId: me.id, ownerName: me.name, vehicle, look: deps.lookOf(me, vehicle),
        seats: def.seats, x: spot.x, y: spot.y, dir: me.dir,
      });
      publish(v);
      return { parked: parking.toPublic(v) };
    });

    handle(socket, 'vehicle:enter', C2S.vehicleEnter, ({ vid }) => {
      const v = parking.get(vid);
      if (!v || v.scene !== me.scene) throw new GameError('That vehicle has gone.');
      if (me.ride) throw new GameError(`You're on a ${cfg.rides.appName} ride.`);
      if (me.vehicle) throw new GameError('Get off your ride first.');
      if (me.interior) throw new GameError('Go outside first.');
      if (Math.hypot(me.x - v.x, me.y - v.y) > P.enterRangeTiles * T) throw new GameError('Walk up to it first.');
      let seat: number;
      try {
        seat = parking.enter(vid, me.id);
      } catch (e) {
        if (e instanceof ParkingError) throw new GameError(e.message);
        throw e;
      }
      if (me.emote) {
        me.emote = null;
        io.to(me.scene).emit('emote:stopped', { id: me.id });
      }
      me.x = v.x;
      me.y = v.y;
      me.dir = v.dir;
      me.moving = false;
      me.dirty = true;
      if (seat === 0) setVehicle(me, v.vehicle);
      else io.to(me.scene).emit('player:updated', { id: me.id, seat: seatInfo(me) });
      socketOf(me)?.emit('move:correct', { x: me.x, y: me.y, seq: 0 });
      publish(v);
      return { seat };
    });

    handle(socket, 'vehicle:exit', null, () => {
      if (exit(me)) return {};
      if (me.vehicle && !me.ride) {
        setVehicle(me, null);
        return {};
      }
      throw new GameError("You're not in a vehicle.");
    });

    handle(socket, 'vehicle:putAway', null, () => {
      const mine = parking.ofOwner(me.id);
      if (!mine.length) throw new GameError("You haven't put a vehicle down.");
      for (const v of mine) remove(v);
      return {};
    });
  }

  return {
    register,
    exit,
    /** The driver moved: their vehicle and passengers come along. */
    onMoved(p: OnlinePlayer) {
      const v = parking.drivenBy(p.id);
      if (!v) return;
      parking.moveTo(v.vid, p.x, p.y, p.dir);
      for (let i = 1; i < v.seats.length; i++) {
        const q = v.seats[i] !== null ? world.get(v.seats[i]!) : undefined;
        if (!q) continue;
        q.x = p.x;
        q.y = p.y;
        q.dir = p.dir;
        q.moving = p.moving;
        q.dirty = true;
      }
    },
    /** A passenger (not the driver): the server moves them. */
    isPassenger: (p: OnlinePlayer) => (parking.seatOfPlayer(p.id)?.seat ?? 0) > 0,
    isSeated: (p: OnlinePlayer) => parking.seatOfPlayer(p.id) !== null,
    /** Leaving the game: out of any vehicle, and their own vehicles are put away. */
    leave(p: OnlinePlayer) {
      exit(p);
      for (const v of parking.ofOwner(p.id)) remove(v);
    },
    all: (scene: string) => parking.all(scene).map((v) => parking.toPublic(v)),
  };
}
