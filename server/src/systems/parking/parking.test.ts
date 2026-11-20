import { describe, expect, it } from 'vitest';
import { Parking } from './parking';

const car = (pk: Parking, ownerId = 1, seats = 4) =>
  pk.place({ scene: 'town', ownerId, ownerName: 'Ali', vehicle: 'car_sega', look: null, seats, x: 10, y: 20, dir: 'left' });

describe('parking', () => {
  it('the owner drives; others fill the passenger seats in order', () => {
    const pk = new Parking();
    const v = car(pk);
    expect(pk.enter(v.vid, 2)).toBe(1);
    expect(pk.enter(v.vid, 1)).toBe(0);
    expect(pk.enter(v.vid, 3)).toBe(2);
    expect(pk.drivenBy(1)?.vid).toBe(v.vid);
    expect(pk.drivenBy(2)).toBeNull();
    expect(pk.seatOfPlayer(3)).toEqual({ vid: v.vid, seat: 2 });
  });

  it('refuses a full vehicle, a second seat and a one-seater', () => {
    const pk = new Parking();
    const bike = car(pk, 1, 2);
    pk.enter(bike.vid, 2);
    expect(() => pk.enter(bike.vid, 3)).toThrow(/full/);
    expect(() => pk.enter(bike.vid, 2)).toThrow(/already/);
    const basikal = car(pk, 5, 1);
    expect(() => pk.enter(basikal.vid, 6)).toThrow(/Only Ali/);
  });

  it('getting out frees the seat; putting it away lets everyone out', () => {
    const pk = new Parking();
    const v = car(pk);
    pk.enter(v.vid, 1);
    pk.enter(v.vid, 2);
    expect(pk.exit(2)?.seat).toBe(1);
    expect(pk.get(v.vid)?.seats).toEqual([1, null, null, null]);
    expect(pk.enter(v.vid, 3)).toBe(1);
    expect(pk.remove(v.vid).sort()).toEqual([1, 3]);
    expect(pk.seatOfPlayer(1)).toBeNull();
    expect(pk.get(v.vid)).toBeUndefined();
    expect(pk.exit(3)).toBeNull();
  });

  it('lists by owner and scene', () => {
    const pk = new Parking();
    car(pk, 1);
    car(pk, 2);
    expect(pk.ofOwner(1)).toHaveLength(1);
    expect(pk.all('town')).toHaveLength(2);
    expect(pk.all('home:1')).toHaveLength(0);
  });
});
