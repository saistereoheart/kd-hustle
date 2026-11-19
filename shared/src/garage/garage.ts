// 🚗 Motor Kota: the showroom (buy a car or a superbike) and your garage (engine top speed and
// torque, tyres, paint, wheel colour, exhaust). Each model is a vehicle in vehicles.json (so
// riding, the hotbar and collisions work as before); this adds its price, its engine (for the
// sound: cylinders, firing order, rev range, gears) and the upgrades. Paint, wheels and the
// exhaust show to everyone (VehicleLook); the exhaust also changes the sound.
import { z } from 'zod';

export const GARAGE_PARTS = ['engine', 'torque', 'tires'] as const;
export type GaragePart = (typeof GARAGE_PARTS)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const exhaustSchema = z.object({
  name: z.string(),
  desc: z.string(),
  priceSen: z.number().int().nonnegative(),
  /** Top speed bonus (share). */
  speed: z.number().min(0).max(0.2),
  /** Sound: loudness ×, low-pass cutoff (Hz), resonance peak (Hz) and its gain (dB), distortion 0..1,
   *  pops & crackles when you let off the throttle 0..1, how much the pipe rings (0..0.8), and how far
   *  away other players still hear it (px). */
  sound: z.object({
    gain: z.number().positive(), cutoff: z.number().positive(), peak: z.number().positive(), peakDb: z.number(), drive: z.number().min(0).max(1), pops: z.number().min(0).max(1),
    ring: z.number().min(0).max(0.8).default(0.3),
    range: z.number().positive().default(380),
  }),
  /** Drawn tip: stock (small, tucked in), sport (round chrome), racing (big carbon can), straight (bare pipe). */
  tip: z.enum(['stock', 'sport', 'racing', 'straight']),
});

export const garageConfigSchema = z.object({
  name: z.string(),
  models: z.record(z.string(), z.object({
    kind: z.enum(['car', 'bike']),
    /** Parody maker + model, as shown. */
    maker: z.string(),
    model: z.string(),
    desc: z.string(),
    priceSen: z.number().int().positive(),
    /** Seconds from standing to top speed (before torque upgrades). */
    accelSec: z.number().positive(),
    paint: z.string(),
    wheel: z.string(),
    engine: z.object({
      cc: z.number().int().positive(),
      cylinders: z.number().int().min(1).max(12),
      /** Layout, for the spec sheet ("inline", "V", "L"...). */
      layout: z.string(),
      /** When each cylinder fires in the 720° cycle (uneven = the V-twin "potato-potato"). */
      firing: z.array(z.number().min(0).max(720)).min(1),
      idleRpm: z.number().positive(),
      redline: z.number().positive(),
      gears: z.number().int().min(1).max(8),
      /** Body of the exhaust note (Hz) and how rough it runs (0..1). */
      body: z.number().positive(),
      rough: z.number().min(0).max(1),
      turbo: z.boolean().default(false),
    }),
  })),
  paints: z.record(z.string(), z.object({ name: z.string(), color: hex, priceSen: z.number().int().nonnegative() })),
  wheels: z.record(z.string(), z.object({ name: z.string(), color: hex, priceSen: z.number().int().nonnegative() })),
  exhausts: z.record(z.string(), exhaustSchema),
  /** Upgrade levels: what each level adds, how many, and the price (a share of the model's price, growing). */
  upgrades: z.object({
    engine: z.object({ name: z.string(), per: z.number().positive(), maxLevel: z.number().int().positive(), costShare: z.number().positive(), growth: z.number().min(1) }),
    torque: z.object({ name: z.string(), per: z.number().positive(), maxLevel: z.number().int().positive(), costShare: z.number().positive(), growth: z.number().min(1) }),
    tires: z.object({ name: z.string(), per: z.number().positive(), maxLevel: z.number().int().positive(), costShare: z.number().positive(), growth: z.number().min(1) }),
  }),
});
export type GarageConfig = z.infer<typeof garageConfigSchema>;
export type GarageModel = GarageConfig['models'][string];

/** What others see of your ride. */
export interface VehicleLook {
  paint: string;
  wheel: string;
  exhaust: string;
}

/** One vehicle you own and how it's set up. */
export interface VehicleSetup extends VehicleLook {
  engine: number;
  torque: number;
  tires: number;
  /** Exhausts bought for it (switching between them is free). */
  exhausts: string[];
}

export interface GarageState {
  owned: Record<string, VehicleSetup>;
}

export function emptyGarage(): GarageState {
  return { owned: {} };
}

export function newSetup(cfg: GarageConfig, model: string): VehicleSetup {
  const m = cfg.models[model];
  return { paint: m.paint, wheel: m.wheel, exhaust: 'stock', engine: 0, torque: 0, tires: 0, exhausts: ['stock'] };
}

export function lookOf(s: VehicleSetup): VehicleLook {
  return { paint: s.paint, wheel: s.wheel, exhaust: s.exhaust };
}

/** Top speed (px/s) with the engine upgrades and the exhaust. */
export function rideSpeed(cfg: GarageConfig, baseSpeed: number, s: VehicleSetup): number {
  const ex = cfg.exhausts[s.exhaust];
  return Math.round(baseSpeed * (1 + cfg.upgrades.engine.per * s.engine) * (1 + (ex?.speed ?? 0)));
}

/** Seconds from standing to top speed, with the torque upgrades. */
export function rideAccelSec(cfg: GarageConfig, model: string, s: VehicleSetup | null): number {
  const m = cfg.models[model];
  if (!m) return 0;
  return m.accelSec / (1 + cfg.upgrades.torque.per * (s?.torque ?? 0));
}

/** Off-road grip: lifts a slow terrain's speed multiplier towards 1 with tyre upgrades. */
export function tireGrip(cfg: GarageConfig, terrainMult: number, s: VehicleSetup | null): number {
  if (!s || terrainMult >= 1 || terrainMult <= 0) return terrainMult;
  return terrainMult + (1 - terrainMult) * Math.min(0.9, cfg.upgrades.tires.per * s.tires);
}

/** Price of the next level of a part (null when maxed). */
export function partCostSen(cfg: GarageConfig, model: string, part: GaragePart, current: number): number | null {
  const u = cfg.upgrades[part];
  const m = cfg.models[model];
  if (!m || current >= u.maxLevel) return null;
  return Math.round((m.priceSen * u.costShare * u.growth ** current) / 100) * 100;
}

/** The engine's revs for a speed share (0..1), going up through the gears. */
export function engineRpm(m: GarageModel, speedShare: number): number {
  const e = m.engine;
  if (speedShare < 0.02) return e.idleRpm;
  const s = Math.min(1, speedShare);
  const g = Math.min(e.gears - 1, Math.floor(s * e.gears * 0.9999));
  const within = s * e.gears - g;
  const low = g === 0 ? 0.12 : 0.42; // first gear pulls from just above idle
  return e.idleRpm + (e.redline - e.idleRpm) * (low + (0.95 - low) * within);
}

/** Your garage, for the client (the showroom and the 🚗 Garage app). */
export interface GarageView {
  owned: Record<string, VehicleSetup & { speed: number; accelSec: number }>;
}
