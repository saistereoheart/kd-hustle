// 🏍️ The gearbox and engine for showroom cars and bikes (client-side feel; the server still only
// checks the tuned top speed).
//
// Each gear tops out at its own speed (the engine hits the redline there), from first (about a
// quarter to a third of top speed) up to the last gear (top speed), spaced geometrically like real
// ratios. Pull depends on the revs (a torque curve: peaky for an inline-4 bike, flatter for twins,
// cars and the turbo) and on the gear (a low gear multiplies the engine's torque, a high gear
// pulls weakly from low revs). Air drag grows with speed. The revs follow the wheels (and a
// slipping clutch when pulling away) but are rate-limited so they never jump.
//
// Automatic: shifts up near the redline and down when the revs drop low. Manual: you shift with
// R / F or the dashboard buttons; a downshift that would over-rev the engine is refused, and
// staying in a gear past its top bounces off the rev limiter (or holds a flat note with it off).
// Manual also has neutral (below first, gear −1): the throttle just revs the engine and the
// vehicle coasts. Pulling away hard from a stop spins the tyres for a moment (a burnout).
import type { GarageModel } from './garage';

export interface DriveSpec {
  /** Top speed (px/s). */
  top: number;
  /** Speed (px/s) at the redline in each gear. */
  gearTop: number[];
  /** How much each gear multiplies the pull (1 in top gear). */
  gearMult: number[];
  /** Pull at peak torque in top gear, before drag (px/s²). */
  accel: number;
  idle: number;
  redline: number;
  /** Revs (share of the redline) where torque peaks. */
  peak: number;
  /** Seconds the drive is cut while changing gear. */
  shiftSec: number;
  /** Revs (share of redline) where the automatic shifts up / down. */
  upAt: number;
  downAt: number;
  /** How fast the revs may climb / fall freely (rpm per second). */
  riseRate: number;
  fallRate: number;
  /** Revs a slipping clutch holds when pulling away. */
  launchRpm: number;
  bike: boolean;
}

export interface DriveState {
  speed: number;
  /** 0 = first gear. */
  gear: number;
  rpm: number;
  /** Seconds left of a gear change. */
  shiftLeft: number;
  auto: boolean;
  /** On the rev limiter right now. */
  limiter: boolean;
  /** Wheelspin / tyre smoke 0..1. */
  slip: number;
  /** Throttle as the engine sees it (0 while shifting). */
  load: number;
  /** Seconds of burnout left after a hard launch from a stop. */
  burn: number;
  /** Already launched since the last stop (one burnout per launch). */
  launched: boolean;
}

/** In neutral (manual only). */
export const NEUTRAL = -1;

export type ShiftEvent = 'up' | 'down' | null;

/** Where torque peaks (share of the redline), by engine type. */
function peakOf(m: GarageModel): number {
  const e = m.engine;
  if (e.turbo) return 0.45;
  if (m.kind === 'bike') return e.cylinders >= 4 ? 0.8 : e.cylinders === 2 && e.redline < 7000 ? 0.45 : 0.62;
  return 0.55;
}

/** Pull at these revs, 0..1 (1 at the peak). */
export function torqueShare(spec: Pick<DriveSpec, 'redline' | 'peak'>, rpm: number): number {
  const x = Math.max(0, Math.min(1.02, rpm / spec.redline));
  const p = spec.peak;
  if (x <= p) return 0.42 + 0.58 * Math.sin((x / p) * (Math.PI / 2));
  const after = (x - p) / Math.max(0.05, 1 - p);
  return 1 - 0.32 * after * after;
}

export function newDriveState(spec: DriveSpec, auto = true): DriveState {
  return { speed: 0, gear: 0, rpm: spec.idle, shiftLeft: 0, auto, limiter: false, slip: 0, load: 0, burn: 0, launched: false };
}

/** Revs the wheels turn the engine at in a gear. */
export function wheelRpm(spec: DriveSpec, speed: number, gear: number): number {
  return (spec.redline * speed) / spec.gearTop[Math.max(0, Math.min(spec.gearTop.length - 1, gear))];
}

/** Advances the car/bike by dt. `cap` is the most the ground allows right now (grass is slower). */
export function stepDrive(spec: DriveSpec, st: DriveState, input: { throttle: boolean; cap: number; bounce?: boolean }, dt: number): ShiftEvent {
  const n = spec.gearTop.length;
  let ev: ShiftEvent = null;
  st.shiftLeft = Math.max(0, st.shiftLeft - dt);
  st.burn = Math.max(0, st.burn - dt);
  if (st.auto && st.gear < 0) st.gear = 0; // the automatic has no neutral
  if (st.gear < 0) return neutralStep(spec, st, input, dt);
  const shifting = st.shiftLeft > 0;
  // Automatic gearbox.
  if (st.auto && !shifting) {
    const w = wheelRpm(spec, st.speed, st.gear);
    if (input.throttle && st.gear < n - 1 && w >= spec.upAt * spec.redline) ev = shiftGear(spec, st, 1);
    else if (st.gear > 0 && w < spec.downAt * spec.redline && wheelRpm(spec, st.speed, st.gear - 1) < spec.upAt * 0.92 * spec.redline) ev = shiftGear(spec, st, -1);
  }
  if (st.speed < 2 && st.auto && st.gear > 0 && !input.throttle) st.gear = 0;

  const w = wheelRpm(spec, st.speed, st.gear);
  const launching = input.throttle && w < spec.launchRpm; // the clutch slips up to launch revs
  const effRpm = launching ? spec.launchRpm : w;
  const gearCap = spec.gearTop[st.gear];
  st.limiter = false;
  if (input.throttle && st.shiftLeft <= 0) {
    const drag = spec.accel * 0.3 * (st.speed / spec.top) ** 2;
    const a = spec.accel * torqueShare(spec, effRpm) * spec.gearMult[st.gear] - drag;
    st.speed += Math.max(0, a) * dt;
    if (st.speed >= gearCap) {
      st.speed = gearCap;
      st.limiter = true;
    }
  } else if (input.throttle) {
    st.speed = Math.max(0, st.speed - spec.accel * 0.05 * dt); // drive cut while shifting
  }
  if (st.speed > input.cap) st.speed = Math.max(input.cap, st.speed - spec.accel * 2.5 * dt);
  st.load = input.throttle && st.shiftLeft <= 0 ? 1 : 0;
  // Revs: follow the wheels (or the slipping clutch), never faster than the engine can spin up.
  let target = input.throttle ? Math.max(wheelRpm(spec, st.speed, st.gear), launching ? spec.launchRpm : spec.idle) : Math.max(spec.idle, wheelRpm(spec, st.speed, st.gear));
  // At the end of a gear: bounce off the rev limiter, or (limiter off in Settings) hold one flat high note.
  if (st.limiter) target = input.bounce === false ? spec.redline : spec.redline * (0.97 + 0.03 * Math.random());
  target = Math.min(spec.redline, target);
  const fast = st.shiftLeft > 0; // a gear change snaps the revs to the new gear quickly
  const up = fast ? spec.riseRate * 4 : spec.riseRate;
  const down = fast ? spec.fallRate * 4 : spec.fallRate;
  st.rpm = st.rpm < target ? Math.min(target, st.rpm + up * dt) : Math.max(target, st.rpm - down * dt);
  // Tyre smoke: a hard launch in the low gears, or spinning up on grass / dirt. Pulling away from
  // a stop (harder with the revs up, e.g. dropped in from neutral) spins the tyres for a moment.
  if (input.throttle && !st.launched && st.speed < 3 && st.gear === 0) {
    st.launched = true;
    const revved = Math.max(0, (st.rpm - spec.launchRpm) / (spec.redline - spec.launchRpm));
    st.burn = (spec.bike ? BURN.bikeSec : BURN.carSec) * (1 + revved);
  }
  if (st.speed < 1 && !input.throttle) st.launched = false;
  const lowGear = st.gear === 0 || (st.gear === 1 && spec.bike);
  const launchSlip = input.throttle && lowGear && st.speed < spec.gearTop[0] * 0.7 ? 1 - st.speed / (spec.gearTop[0] * 0.7) : 0;
  const groundSlip = input.throttle && input.cap < spec.top * 0.85 && st.speed < input.cap * 0.95 ? 0.5 : 0;
  const burnSlip = input.throttle && st.burn > 0 ? 0.65 + 0.35 * Math.min(1, st.burn) : 0;
  st.slip = Math.max(launchSlip * 0.9, groundSlip, burnSlip);
  return ev;
}

/** How long a launch from a stop spins the tyres (seconds, before revving it up first). */
const BURN = { carSec: 1.4, bikeSec: 0.9 };

/** Neutral: the throttle revs the free engine (up to the limiter); the vehicle just coasts. */
function neutralStep(spec: DriveSpec, st: DriveState, input: { throttle: boolean; cap: number; bounce?: boolean }, dt: number): ShiftEvent {
  st.load = input.throttle ? 1 : 0;
  st.slip = 0;
  st.launched = false;
  st.limiter = input.throttle && st.rpm >= spec.redline * 0.985;
  let target = input.throttle ? spec.redline : spec.idle;
  if (st.limiter) target = input.bounce === false ? spec.redline : spec.redline * (0.95 + 0.05 * Math.random());
  // A free engine spins up faster than one turning the wheels.
  st.rpm = st.rpm < target ? Math.min(target, st.rpm + spec.riseRate * 1.6 * dt) : Math.max(target, st.rpm - spec.fallRate * dt);
  if (st.speed > input.cap) st.speed = Math.max(input.cap, st.speed - spec.accel * 2.5 * dt);
  return null;
}

/**
 * Off the throttle (or in neutral): the vehicle rolls on and slows gently (engine braking and drag,
 * about `coastSec` from top speed to a stop), or hard when braking (`brakeSec`).
 */
export function coast(spec: DriveSpec, st: DriveState, dt: number, o: { brake: boolean; coastSec: number; brakeSec: number }) {
  const sec = o.brake ? o.brakeSec : o.coastSec;
  // A little more drag at speed, so it settles rather than sliding for ever.
  const drag = 0.6 + 0.4 * (st.speed / spec.top);
  st.speed = Math.max(0, st.speed - (spec.top / sec) * drag * dt);
}

/** Changes gear (manual, or the automatic). Returns the event, or null if refused. */
export function shiftGear(spec: DriveSpec, st: DriveState, dir: 1 | -1): ShiftEvent {
  const g = st.gear + dir;
  if (g < (st.auto ? 0 : NEUTRAL) || g >= spec.gearTop.length) return null;
  // Into a gear that would throw the engine past the redline (a downshift, or neutral → first at
  // speed): refused (no money shifts).
  if (g >= 0 && (dir < 0 || st.gear < 0) && wheelRpm(spec, st.speed, g) > spec.redline * 1.01) return null;
  st.gear = g;
  st.shiftLeft = g < 0 ? 0 : dir > 0 ? spec.shiftSec : spec.shiftSec * 0.7;
  return dir > 0 ? 'up' : 'down';
}

/**
 * For other riders we only know how fast they go: pick the gear an automatic would be in and
 * smooth the revs the same way, so their engine sounds (and shifts) like it's really driving.
 */
export function followDrive(spec: DriveSpec, st: DriveState, speed: number, throttle: boolean, dt: number): ShiftEvent {
  const accelerating = speed > st.speed + 1;
  st.speed = Math.min(spec.top, Math.max(0, speed));
  let ev: ShiftEvent = null;
  st.shiftLeft = Math.max(0, st.shiftLeft - dt);
  const n = spec.gearTop.length;
  const w = wheelRpm(spec, st.speed, st.gear);
  if (st.shiftLeft <= 0) {
    if (st.gear < n - 1 && w >= spec.upAt * spec.redline) ev = shiftGear(spec, st, 1);
    else if (st.gear > 0 && w < spec.downAt * spec.redline) ev = shiftGear(spec, st, -1);
  }
  if (st.speed < 2) st.gear = 0;
  const wr = wheelRpm(spec, st.speed, st.gear);
  const launching = throttle && wr < spec.launchRpm;
  const target = Math.min(spec.redline, Math.max(launching ? spec.launchRpm : spec.idle, wr));
  const fast = st.shiftLeft > 0;
  st.rpm = st.rpm < target ? Math.min(target, st.rpm + (fast ? 4 : 1) * spec.riseRate * dt) : Math.max(target, st.rpm - (fast ? 4 : 1) * spec.fallRate * dt);
  st.load = throttle && (accelerating || st.speed > 5) && st.shiftLeft <= 0 ? (accelerating ? 1 : 0.6) : 0;
  st.slip = throttle && st.gear === 0 && st.speed < spec.gearTop[0] * 0.5 ? 0.6 : 0;
  return ev;
}

/** First gear's top (share of top speed) and how much a low gear multiplies the torque. */
const GEAR = { carFirst: 0.22, bikeFirst: 0.2, boost: 0.75, spread: 1 };
const specs = new Map<string, DriveSpec>();

/** Seconds from standing to 97% of top speed with full throttle and the automatic (a test drive). */
export function timeToTop(spec: DriveSpec): number {
  const st = newDriveState(spec, true);
  const dt = 1 / 120;
  let t = 0;
  while (st.speed < spec.top * 0.97 && t < 120) {
    stepDrive(spec, st, { throttle: true, cap: Infinity }, dt);
    t += dt;
  }
  return t;
}

/**
 * The gearbox for a model at this (tuned) top speed. `accelSec` is the 0-to-top time the
 * garage promises (with torque upgrades): the pull is calibrated so a full-throttle run with the
 * automatic takes that long.
 */
export function driveSpec(m: GarageModel, top: number, accelSec: number): DriveSpec {
  const key = `${m.maker}|${m.model}|${Math.round(top)}|${accelSec.toFixed(3)}`;
  const have = specs.get(key);
  if (have) return have;
  const e = m.engine;
  const bike = m.kind === 'bike';
  const n = e.gears;
  // Real-style ratios: geometric, so the low gears are short. Torque is multiplied most in first and
  // less in every gear after it: the low gears fly by and each higher gear takes longer (see the
  // garage tests).
  const first = bike ? GEAR.bikeFirst : GEAR.carFirst;
  const gearTop = Array.from({ length: n }, (_, i) => top * (first + (1 - first) * (i / Math.max(1, n - 1)) ** GEAR.spread));
  const gearMult = gearTop.map((g) => (gearTop[n - 1] / g) ** GEAR.boost);
  const range = e.redline - e.idleRpm;
  const spec: DriveSpec = {
    top, gearTop, gearMult, accel: 1,
    idle: e.idleRpm, redline: e.redline, peak: peakOf(m),
    shiftSec: bike ? 0.09 : e.turbo ? 0.16 : 0.24,
    upAt: bike ? 0.93 : 0.88,
    downAt: bike ? 0.5 : 0.42,
    // Free revving: a bike spins up in about 0.8 s, a car in about 1.3 s (never a jump).
    riseRate: range / (bike ? 0.8 : 1.3),
    fallRate: range / (bike ? 0.9 : 1.2),
    launchRpm: e.idleRpm + range * (bike ? 0.32 : 0.22),
    bike,
  };
  // Calibrate the pull so a full run takes accelSec (time scales ~1/accel, plus the fixed shift pauses).
  const shifts = (n - 1) * spec.shiftSec;
  const want = Math.max(accelSec, shifts + 0.5);
  for (let i = 0; i < 4; i++) {
    const t = timeToTop(spec);
    spec.accel *= Math.max(0.05, t - shifts) / Math.max(0.05, want - shifts);
  }
  specs.set(key, spec);
  return spec;
}
