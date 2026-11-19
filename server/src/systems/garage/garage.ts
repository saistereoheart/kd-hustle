// 🚗 Motor Kota, server side: buying from the showroom, and your garage (engine / torque / tyre
// upgrades, paint, wheel colour, exhausts). Kept in player_data 'garage'. The top speed the
// movement check allows comes from here (rideSpeed); acceleration and tyre grip only change how
// it feels on the client, never above that top speed.
import {
  emptyGarage, lookOf, newSetup, partCostSen, rideAccelSec, rideSpeed,
  type GaragePart, type GarageState, type GarageView, type VehicleLook, type VehicleSetup,
} from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { Repos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { GameError, type Economy } from '../economy/economy';

export interface GarageHooks {
  wallet: (p: OnlinePlayer, delta: number, reason: string) => void;
  /** The ridden vehicle's look changed (repaint while riding): tell everyone. */
  look: (p: OnlinePlayer) => void;
}

export class GarageSystem {
  private cache = new Map<number, GarageState>();

  constructor(
    private cfg: ServerConfig,
    private repos: Repos,
    private econ: Economy,
    private hooks: GarageHooks,
  ) {}

  private gc() {
    return this.cfg.garage;
  }

  state(p: OnlinePlayer): GarageState {
    let s = this.cache.get(p.id);
    if (!s) {
      s = this.repos.playerData.load<GarageState>(p.id, 'garage') ?? emptyGarage();
      s.owned ??= {};
      // Models taken out of the config are dropped.
      for (const k of Object.keys(s.owned)) if (!this.gc().models[k] || !this.cfg.vehicles.vehicles[k]) delete s.owned[k];
      this.cache.set(p.id, s);
    }
    return s;
  }

  private save(p: OnlinePlayer) {
    this.repos.playerData.save(p.id, 'garage', this.state(p));
  }

  owned(p: OnlinePlayer): string[] {
    return Object.keys(this.state(p).owned);
  }

  setup(p: OnlinePlayer, model: string): VehicleSetup | null {
    return this.state(p).owned[model] ?? null;
  }

  /** Top speed (px/s) of a vehicle for this player (with upgrades if it's one of theirs). */
  speedOf(p: OnlinePlayer, vehicle: string): number {
    const v = this.cfg.vehicles.vehicles[vehicle];
    const s = this.setup(p, vehicle);
    return v ? (s ? rideSpeed(this.gc(), v.speed, s) : v.speed) : this.cfg.movement.walkSpeed;
  }

  lookOf(p: OnlinePlayer, vehicle: string | null): VehicleLook | null {
    const s = vehicle ? this.setup(p, vehicle) : null;
    return s ? lookOf(s) : null;
  }

  view(p: OnlinePlayer): GarageView {
    const out: GarageView['owned'] = {};
    for (const [k, s] of Object.entries(this.state(p).owned)) {
      out[k] = { ...s, exhausts: [...s.exhausts], speed: this.speedOf(p, k), accelSec: rideAccelSec(this.gc(), k, s) };
    }
    return { owned: out };
  }

  private model(id: string) {
    const m = this.gc().models[id];
    if (!m || !this.cfg.vehicles.vehicles[id]) throw new GameError("That one isn't in the showroom.");
    return m;
  }

  private mine(p: OnlinePlayer, id: string): VehicleSetup {
    this.model(id);
    const s = this.setup(p, id);
    if (!s) throw new GameError("You don't own that one.");
    return s;
  }

  private pay(p: OnlinePlayer, sen: number, ref: string) {
    if (sen <= 0) return;
    if (p.walletSen < sen) throw new GameError('Not enough money.');
    this.econ.run(p, () => this.econ.change(p, -sen, 0, 'garage', ref));
    this.hooks.wallet(p, -sen, 'garage');
  }

  buy(p: OnlinePlayer, id: string): GarageView {
    const m = this.model(id);
    if (this.setup(p, id)) throw new GameError('You already own one. Upgrade it in the 🚗 Garage.');
    this.pay(p, m.priceSen, `buy:${id}`);
    this.state(p).owned[id] = newSetup(this.gc(), id);
    this.save(p);
    return this.view(p);
  }

  upgrade(p: OnlinePlayer, id: string, part: GaragePart): GarageView {
    const s = this.mine(p, id);
    const cost = partCostSen(this.gc(), id, part, s[part]);
    if (cost === null) throw new GameError("That's maxed out.");
    this.pay(p, cost, `${part}:${id}`);
    s[part]++;
    this.save(p);
    return this.view(p);
  }

  /** Repaint, new wheel colour, or fit an exhaust (an exhaust you bought before is free to swap back). */
  style(p: OnlinePlayer, id: string, kind: 'paint' | 'wheel' | 'exhaust', choice: string): GarageView {
    const s = this.mine(p, id);
    const gc = this.gc();
    if (kind === 'paint') {
      const c = gc.paints[choice];
      if (!c) throw new GameError('Unknown paint.');
      if (s.paint === choice) return this.view(p);
      this.pay(p, c.priceSen, `paint:${id}:${choice}`);
      s.paint = choice;
    } else if (kind === 'wheel') {
      const c = gc.wheels[choice];
      if (!c) throw new GameError('Unknown wheels.');
      if (s.wheel === choice) return this.view(p);
      this.pay(p, c.priceSen, `wheel:${id}:${choice}`);
      s.wheel = choice;
    } else {
      const c = gc.exhausts[choice];
      if (!c) throw new GameError('Unknown exhaust.');
      if (!s.exhausts.includes(choice)) {
        this.pay(p, c.priceSen, `exhaust:${id}:${choice}`);
        s.exhausts.push(choice);
      }
      s.exhaust = choice;
    }
    this.save(p);
    if (p.vehicle === id) {
      p.vehicleLook = lookOf(s);
      this.hooks.look(p);
    }
    return this.view(p);
  }

  unload(p: OnlinePlayer) {
    this.cache.delete(p.id);
  }
}
