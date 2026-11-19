import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { engineRpm, partCostSen, rideAccelSec, rideSpeed, tireGrip, newSetup } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import { World, type OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { Economy } from '../economy/economy';
import { GarageSystem } from './garage';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const gc = cfg.garage;

function setup(walletSen = 50_000_000) {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const id = repos.accounts.create('racer', 'h', false, { x: 0, y: 0 }, 2, walletSen);
  const p = { id, name: 'racer', hasCharacter: true, walletSen, shards: 0, inventory: [], equipped: {}, cosmetics: {}, index: new Set<string>(), pages: new Set<string>(), pity: {}, jobs: {}, skills: {}, vehicle: null } as unknown as OnlinePlayer;
  const world = new World();
  world.add(p);
  const econ = new Economy(repos, cfg);
  const looks: number[] = [];
  const garage = new GarageSystem(cfg, repos, econ, { wallet: () => {}, look: (q) => looks.push(q.id) });
  world.ownedVehicles = (q) => garage.owned(q);
  return { repos, p, world, garage, looks };
}

describe('garage config', () => {
  it('every showroom model is a drivable vehicle with known paint and wheels', () => {
    for (const [id, m] of Object.entries(gc.models)) {
      const v = cfg.vehicles.vehicles[id];
      expect(v, id).toBeTruthy();
      expect(v.grid).toBe('drive');
      expect(v.kind).toBe(m.kind);
      expect(gc.paints[m.paint], `${id} paint`).toBeTruthy();
      expect(gc.wheels[m.wheel], `${id} wheel`).toBeTruthy();
      expect(m.engine.firing).toHaveLength(m.engine.cylinders);
      expect(m.engine.redline).toBeGreaterThan(m.engine.idleRpm);
    }
    expect(gc.exhausts.stock.priceSen).toBe(0);
  });

  it('upgrades raise speed, cut the 0-to-top time, add grip; revs climb through the gears', () => {
    const s = newSetup(gc, 'car_sega');
    const base = rideSpeed(gc, 470, s);
    expect(base).toBe(470);
    expect(rideSpeed(gc, 470, { ...s, engine: 5 })).toBeGreaterThan(base);
    expect(rideSpeed(gc, 470, { ...s, exhaust: 'racing' })).toBeGreaterThan(base);
    expect(rideAccelSec(gc, 'car_sega', { ...s, torque: 3 })).toBeLessThan(rideAccelSec(gc, 'car_sega', s));
    expect(tireGrip(gc, 0.5, { ...s, tires: 2 })).toBeGreaterThan(0.5);
    expect(tireGrip(gc, 1, { ...s, tires: 2 })).toBe(1);
    expect(tireGrip(gc, 0, { ...s, tires: 4 })).toBe(0); // walls stay walls
    const m = gc.models.bike_zx25;
    expect(engineRpm(m, 0)).toBe(m.engine.idleRpm);
    expect(engineRpm(m, 1)).toBeLessThanOrEqual(m.engine.redline);
    expect(engineRpm(m, 1)).toBeGreaterThan(engineRpm(m, 0.05));
    // Costs grow per level and stop at the max.
    const c0 = partCostSen(gc, 'car_sega', 'engine', 0)!;
    expect(partCostSen(gc, 'car_sega', 'engine', 1)!).toBeGreaterThan(c0);
    expect(partCostSen(gc, 'car_sega', 'engine', gc.upgrades.engine.maxLevel)).toBeNull();
  });
});

describe('garage (server)', () => {
  it('buy once, ride it, upgrade, repaint, and swap exhausts (bought ones are free to swap back)', () => {
    const s = setup();
    const price = gc.models.car_mivy.priceSen;
    const w = s.p.walletSen;
    s.garage.buy(s.p, 'car_mivy');
    expect(s.p.walletSen).toBe(w - price);
    expect(s.world.vehiclesOf(s.p)).toContain('car_mivy');
    expect(() => s.garage.buy(s.p, 'car_mivy')).toThrow(/already/);
    expect(() => s.garage.buy(s.p, 'nope')).toThrow();

    const top = s.garage.speedOf(s.p, 'car_mivy');
    const cost = partCostSen(gc, 'car_mivy', 'engine', 0)!;
    const w2 = s.p.walletSen;
    const v = s.garage.upgrade(s.p, 'car_mivy', 'engine');
    expect(s.p.walletSen).toBe(w2 - cost);
    expect(v.owned.car_mivy.engine).toBe(1);
    expect(s.garage.speedOf(s.p, 'car_mivy')).toBeGreaterThan(top);

    s.p.vehicle = 'car_mivy';
    s.garage.style(s.p, 'car_mivy', 'paint', 'emas');
    expect(s.garage.setup(s.p, 'car_mivy')!.paint).toBe('emas');
    expect(s.p.vehicleLook?.paint).toBe('emas');
    expect(s.looks).toContain(s.p.id); // others told about the new look

    const w3 = s.p.walletSen;
    s.garage.style(s.p, 'car_mivy', 'exhaust', 'racing');
    expect(s.p.walletSen).toBe(w3 - gc.exhausts.racing.priceSen);
    s.garage.style(s.p, 'car_mivy', 'exhaust', 'stock');
    const w4 = s.p.walletSen;
    s.garage.style(s.p, 'car_mivy', 'exhaust', 'racing'); // already bought: free
    expect(s.p.walletSen).toBe(w4);
    expect(() => s.garage.style(s.p, 'car_mivy', 'paint', 'nope')).toThrow();
  });

  it("can't buy without the money, can't tune a car you don't own, and maxed parts stop", () => {
    const s = setup(100);
    expect(() => s.garage.buy(s.p, 'car_sega')).toThrow(/money/);
    expect(s.p.walletSen).toBe(100);
    expect(() => s.garage.upgrade(s.p, 'car_sega', 'engine')).toThrow(/own/);
    const r = setup();
    r.garage.buy(r.p, 'bike_zx25');
    for (let i = 0; i < gc.upgrades.tires.maxLevel; i++) r.garage.upgrade(r.p, 'bike_zx25', 'tires');
    expect(() => r.garage.upgrade(r.p, 'bike_zx25', 'tires')).toThrow(/maxed/);
  });

  it('keeps what you own across logins', () => {
    const s = setup();
    s.garage.buy(s.p, 'bike_harlee');
    s.garage.style(s.p, 'bike_harlee', 'wheel', 'emas');
    s.garage.unload(s.p);
    expect(s.garage.owned(s.p)).toEqual(['bike_harlee']);
    expect(s.garage.setup(s.p, 'bike_harlee')!.wheel).toBe('emas');
  });
});
