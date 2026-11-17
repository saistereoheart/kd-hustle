// Starter jobs from the Jobs Board (spec §8.1). The server picks the locations / mini-game
// layout, keeps the timer, checks proximity and grades the inputs; the client just plays.
import { districtAt, gridIndexAt, type BuiltBuilding, type BuiltMap, type JobProgress, type JobsConfig, type JobState, type RandInt } from '@kh/shared';
import type { ServerConfig } from '../../config/loadConfig';
import type { OnlinePlayer, ServerJob } from '../../game/world';
import { GameError, type Economy } from '../economy/economy';

// ------------------------------------------------------------------ pure helpers (unit tested)
export function jobLevel(cfg: JobsConfig, done: number): number {
  return Math.min(cfg.maxLevel, 1 + Math.floor(done / cfg.levelUpEvery));
}

export function levelMult(cfg: JobsConfig, level: number): number {
  return 1 + (level - 1) * cfg.payPerLevel;
}

/** Delivery pay in sen: base + distance, × level; tip for arriving early; 30% cut if late. */
export function deliveryPay(cfg: JobsConfig, meters: number, level: number, elapsedMs: number, budgetMs: number) {
  const d = cfg.delivery;
  const base = Math.round((d.baseSen + d.perMeterSen * meters) * levelMult(cfg, level));
  if (elapsedMs > budgetMs) return { paySen: Math.round(base * 0.7), tipSen: 0, late: true };
  const remaining = 1 - elapsedMs / budgetMs;
  return { paySen: base, tipSen: Math.round(base * d.maxTip * remaining), late: false };
}

export type CarwashJob = Extract<JobState, { kind: 'carwash' }>;
export interface CarwashInput {
  soap: number[];
  rinse: number[];
  polish: number[];
  polishStartMs: number;
}
export interface CarwashGrade {
  soap: number;
  rinse: number;
  polish: number;
  /** Weighted total, 0..1. */
  cleaned: number;
  durationMs: number;
  valid: boolean;
}

/** Scrubbing movements in a stream [x, y, t, ...]: each point that moved since the last one. */
function moves(points: number[], fn: (x: number, y: number, t: number) => void) {
  for (let i = 3; i + 2 < points.length; i += 3) {
    const x = points[i], y = points[i + 1];
    if (Math.hypot(x - points[i - 3], y - points[i - 2]) < 0.004) continue; // a tap, not a scrub
    fn(x, y, points[i + 2]);
  }
}

/**
 * Car wash grading, from the raw pointer streams of the three stages (flat [x, y, tMs, ...]
 * lists, x/y in 0..1 car coordinates, t from the start of the mini-game):
 *  1. soap: a dirt spot is clean after its number of scrubbing movements over it;
 *  2. rinse: every cell of a grid over the car body needs a few passes of the hose;
 *  3. polish: shine marks appear one at a time and must be buffed while they're showing.
 * Impossible input (too fast, from the future, out of order) scores zero.
 */
export function gradeCarwash(cfg: JobsConfig['carwash'], job: CarwashJob, input: CarwashInput, serverElapsedMs: number): CarwashGrade {
  const zero = (valid: boolean, durationMs = 0): CarwashGrade => ({ soap: 0, rinse: 0, polish: 0, cleaned: 0, durationMs, valid });
  const limitMs = cfg.timeLimitSec * 1000;
  const streams = [input.soap, input.rinse, input.polish];
  let firstT = Infinity;
  let lastT = -1;
  let n = 0;
  const bounds: Array<[number, number]> = [];
  for (const s of streams) {
    let prev = -1;
    let first = Infinity;
    for (let i = 0; i + 2 < s.length; i += 3) {
      const x = s[i], y = s[i + 1], t = s[i + 2];
      if (x < -0.1 || x > 1.1 || y < -0.1 || y > 1.1 || t < prev || t < 0 || t > limitMs + 500) return zero(false);
      prev = t;
      first = Math.min(first, t);
      n++;
    }
    bounds.push([first, prev]);
    if (prev >= 0) {
      firstT = Math.min(firstT, first);
      lastT = Math.max(lastT, prev);
    }
  }
  if (n === 0) return zero(true);
  // Stages happen in order: soap, then rinse, then polish (50 ms of slack for event timing).
  const [soapB, rinseB, polishB] = bounds;
  if (rinseB[1] >= 0 && soapB[1] > rinseB[0] + 50) return zero(false);
  if (polishB[1] >= 0 && (input.polishStartMs + 50 < Math.max(soapB[1], rinseB[1]) || polishB[0] + 50 < input.polishStartMs)) return zero(false);
  // Can't have played for longer than the server says the game has been running.
  if (lastT > serverElapsedMs + 1500 || input.polishStartMs > serverElapsedMs + 1500) return zero(false);
  const durationMs = Math.max(1, lastT - firstT);
  if (n > 30 && n / Math.max(1, durationMs / 1000) > cfg.maxPointsPerSec * 1.2) return zero(false, durationMs);

  // 1. Soap
  const spotHits = job.spots.map(() => 0);
  moves(input.soap, (x, y) => {
    job.spots.forEach(([sx, sy], k) => {
      if (Math.hypot(x - sx, y - sy) <= job.spotRadius) spotHits[k]++;
    });
  });
  const soap = job.spots.length ? spotHits.filter((h, k) => h >= job.spots[k][2]).length / job.spots.length : 1;

  // 2. Rinse
  const r = job.rinse;
  const [x0, y0, x1, y1] = r.area;
  const cellHits = new Array(r.cols * r.rows).fill(0);
  moves(input.rinse, (x, y) => {
    if (x < x0 || x >= x1 || y < y0 || y >= y1) return;
    const cx = Math.floor(((x - x0) / (x1 - x0)) * r.cols);
    const cy = Math.floor(((y - y0) / (y1 - y0)) * r.rows);
    cellHits[cy * r.cols + cx]++;
  });
  const rinse = cellHits.filter((h) => h >= r.hitsPerCell).length / cellHits.length;

  // 3. Polish
  const p = job.polish;
  const markHits = p.spots.map(() => 0);
  moves(input.polish, (x, y, t) => {
    p.spots.forEach(([sx, sy], k) => {
      const from = input.polishStartMs + k * p.intervalMs;
      if (t >= from && t <= from + p.windowMs && Math.hypot(x - sx, y - sy) <= p.radius) markHits[k]++;
    });
  });
  const polish = p.spots.length ? markHits.filter((h) => h >= p.hits).length / p.spots.length : 1;

  const w = cfg.weights;
  const cleaned = Math.min(1, soap * w.soap + rinse * w.rinse + polish * w.polish);
  return { soap, rinse, polish, cleaned, durationMs, valid: true };
}

/** The car wash layout for one job (positions in 0..1 car-picture coordinates). */
export function makeCarwashJob(cfg: JobsConfig['carwash'], rand: RandInt, jobId: string, now: number): CarwashJob {
  const r01 = () => rand(1000) / 1000;
  const stubborn = new Set<number>();
  while (stubborn.size < Math.min(cfg.stubbornSpots, cfg.spots)) stubborn.add(rand(cfg.spots));
  const spots: Array<[number, number, number]> = [];
  for (let i = 0; i < cfg.spots; i++) spots.push([0.15 + r01() * 0.7, 0.32 + r01() * 0.4, stubborn.has(i) ? cfg.stubbornHits : cfg.hitsPerSpot]);
  const marks: Array<[number, number]> = [];
  for (let i = 0; i < cfg.polishSpots; i++) marks.push([0.18 + r01() * 0.64, 0.32 + r01() * 0.36]);
  return {
    kind: 'carwash',
    jobId,
    spots,
    spotRadius: cfg.spotRadius,
    rinse: { cols: cfg.rinseCols, rows: cfg.rinseRows, hitsPerCell: cfg.rinseHitsPerCell, area: cfg.rinseArea },
    polish: { spots: marks, intervalMs: cfg.polishIntervalMs, windowMs: cfg.polishWindowMs, hits: cfg.polishHits, radius: cfg.polishRadius },
    color: CAR_COLORS[rand(CAR_COLORS.length)],
    startedAt: now,
    timeLimitSec: cfg.timeLimitSec,
  };
}
const CAR_COLORS = ['#e03131', '#1971c2', '#f8f9fa', '#212529', '#f59f00', '#2f9e44', '#868e96', '#ae3ec9'];

export function carwashPay(cfg: JobsConfig, cleaned: number, durationMs: number, level: number): number {
  const c = cfg.carwash;
  if (cleaned < c.minCleanToPay) return 0;
  const fast = cleaned >= 1 ? 1 + c.speedBonus * Math.max(0, 1 - durationMs / (c.timeLimitSec * 1000)) : 1;
  return Math.round(c.baseSen * cleaned * fast * levelMult(cfg, level));
}

// ------------------------------------------------------------------ the job system
const SHOP_NAMES = [
  'Nasi Lemak Pak Mat', 'Mamak Corner 24', 'Kedai Kopi Ah Hock', 'Burger Bakar Abang', 'Roti Canai Kak Ros',
  'Char Kuey Teow Uncle Lim', 'Satay Corner', 'Restoran Selera Kita', 'Bubble Tea Bro', 'Ayam Gepuk Mak Teh',
  'Kopitiam Lama', 'Laksa Penang Auntie', 'Pizza Pak Long', 'Sushi Kaki', 'Nasi Kandar Ali',
];
const PICKUP_KINDS = new Set(['shoplot', 'shop', 'mall', 'hypermarket']);
const DROPOFF_KINDS = new Set(['condo', 'flat', 'semid', 'terrace', 'bungalow']);

export class JobSystem {
  private pickups: BuiltBuilding[] = [];
  private dropoffs: BuiltBuilding[] = [];

  constructor(
    private readonly cfg: ServerConfig,
    private readonly econ: Economy,
    private readonly rand: RandInt,
  ) {
    // Only use doors a motorbike can actually get close to.
    const map = cfg.map;
    const driveReach = floodDrivable(map);
    const nearRoad = (b: BuiltBuilding) => {
      if (!b.door) return false;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const i = gridIndexAt(map, (b.door.frontX + dx + 0.5) * map.tileSize, (b.door.frontY + dy + 0.5) * map.tileSize);
          if (i >= 0 && driveReach[i]) return true;
        }
      return false;
    };
    this.pickups = map.buildings.filter((b) => PICKUP_KINDS.has(b.kind) && nearRoad(b));
    this.dropoffs = map.buildings.filter((b) => DROPOFF_KINDS.has(b.kind) && nearRoad(b));
  }

  get candidateCounts() {
    return { pickups: this.pickups.length, dropoffs: this.dropoffs.length };
  }

  private progress(p: OnlinePlayer, kind: string): JobProgress {
    return p.jobs[kind] ?? { level: 1, done: 0 };
  }

  start(p: OnlinePlayer, kind: 'delivery' | 'carwash', now = Date.now()): ServerJob {
    if (p.job) throw new GameError('Finish or cancel your current job first.');
    const T = this.cfg.map.tileSize;
    const jobId = `${kind}-${now.toString(36)}-${this.rand(1e6).toString(36)}`;
    if (kind === 'carwash') {
      p.job = makeCarwashJob(this.cfg.jobs.carwash, this.rand, jobId, now);
      return p.job;
    }
    // Delivery: a shop near the player, then a home a few hundred metres away.
    const d = this.cfg.jobs.delivery;
    const mpt = this.cfg.map.metersPerTile;
    const px = p.x / T, py = p.y / T;
    const dist = (b: BuiltBuilding, x: number, y: number) => Math.hypot(b.door!.frontX + 0.5 - x, b.door!.frontY + 0.5 - y) * mpt;
    const near = this.pickups.filter((b) => dist(b, px, py) > 30 && dist(b, px, py) < 260);
    const pool = near.length ? near : this.pickups;
    if (!pool.length || !this.dropoffs.length) throw new GameError('No deliveries available right now.');
    const pickup = pool[this.rand(pool.length)];
    const pxp = pickup.door!.frontX + 0.5, pyp = pickup.door!.frontY + 0.5;
    const homes = this.dropoffs.filter((b) => {
      const m = dist(b, pxp, pyp);
      return m >= d.minMeters && m <= d.maxMeters;
    });
    if (!homes.length) throw new GameError('No deliveries available right now.');
    const home = homes[this.rand(homes.length)];
    const straight = dist(home, pxp, pyp);
    const meters = Math.round(straight * 1.3); // streets aren't straight lines
    const district = districtAt(this.cfg.map, home.door!.frontX, home.door!.frontY)?.name ?? 'Kota Damansara';
    const unit = 1 + this.rand(40);
    const homeName = home.name ?? `${home.kind === 'condo' || home.kind === 'flat' ? `Unit ${unit}-${1 + this.rand(20)}` : `No. ${unit}`}, ${district}`;
    // The time budget assumes the starter bicycle (a paid Ronda ride gets there faster).
    const rideMps = ((this.cfg.vehicles.vehicles[d.budgetVehicle]?.speed ?? this.cfg.movement.walkSpeed) / T) * mpt;
    const budgetMs = Math.round((meters / rideMps) * d.timeBudgetFactor * 1000 + d.timeBudgetSlackSec * 1000);
    p.job = {
      kind,
      jobId,
      stage: 'pickup',
      pickup: { x: pxp, y: pyp, name: pickup.name ?? SHOP_NAMES[this.rand(SHOP_NAMES.length)] },
      dropoff: { x: home.door!.frontX + 0.5, y: home.door!.frontY + 0.5, name: homeName },
      meters,
      startedAt: now,
      deadline: 0,
      baseSen: Math.round((d.baseSen + d.perMeterSen * meters) * levelMult(this.cfg.jobs, this.progress(p, kind).level)),
      budgetMs,
    };
    return p.job;
  }

  /** Delivery: arrive at the pickup, then at the drop-off. */
  advance(p: OnlinePlayer, now = Date.now()) {
    const job = p.job;
    if (!job || job.kind !== 'delivery') throw new GameError('You have no delivery right now.');
    const T = this.cfg.map.tileSize;
    const r = this.cfg.jobs.delivery.pickupRadiusTiles;
    const here = (pt: { x: number; y: number }) => Math.hypot(p.x / T - pt.x, p.y / T - pt.y) <= r;
    if (job.stage === 'pickup') {
      if (!here(job.pickup)) throw new GameError(`Ride to ${job.pickup.name} to pick up the order.`);
      job.stage = 'dropoff';
      job.deadline = now + (job.budgetMs ?? 60000);
      return { job, paidSen: undefined, tipSen: undefined, levelUp: undefined };
    }
    if (!here(job.dropoff)) throw new GameError(`Deliver to ${job.dropoff.name}.`);
    const prog = this.progress(p, 'delivery');
    const budgetMs = job.budgetMs ?? 60000;
    const elapsed = now - (job.deadline - budgetMs);
    const { paySen, tipSen } = deliveryPay(this.cfg.jobs, job.meters, prog.level, elapsed, budgetMs);
    const levelUp = this.complete(p, 'delivery', paySen + tipSen, job.jobId);
    return { job: null, paidSen: paySen, tipSen, levelUp };
  }

  submitCarwash(p: OnlinePlayer, jobId: string, input: CarwashInput, now = Date.now()) {
    const job = p.job;
    if (!job || job.kind !== 'carwash' || job.jobId !== jobId) throw new GameError('That car wash job has ended.');
    const grade = gradeCarwash(this.cfg.jobs.carwash, job, input, now - job.startedAt);
    const prog = this.progress(p, 'carwash');
    const pay = grade.valid ? carwashPay(this.cfg.jobs, grade.cleaned, grade.durationMs, prog.level) : 0;
    const levelUp = this.complete(p, 'carwash', pay, job.jobId, pay > 0);
    return { cleaned: grade.cleaned, soap: grade.soap, rinse: grade.rinse, polish: grade.polish, paidSen: pay, levelUp };
  }

  cancel(p: OnlinePlayer) {
    p.job = null;
  }

  /** Pay, count the job, maybe level up. Returns the new level if it went up. */
  private complete(p: OnlinePlayer, kind: string, paySen: number, ref: string, counts = true): number | undefined {
    const before = this.progress(p, kind);
    const done = before.done + (counts ? 1 : 0);
    const level = jobLevel(this.cfg.jobs, done);
    this.econ.run(p, () => {
      if (paySen > 0) this.econ.change(p, paySen, 0, `job-${kind}`, ref);
      p.jobs = { ...p.jobs, [kind]: { level, done } };
      this.econ.saveState(p);
    });
    p.job = null;
    return level > before.level ? level : undefined;
  }
}

/** Tiles a vehicle can reach from the map's spawn (flood fill over non-driveSolid tiles). */
function floodDrivable(map: BuiltMap): Uint8Array {
  const W = map.width, H = map.height;
  const seen = new Uint8Array(W * H);
  // Start from every road tile next to spawn's district so we don't depend on one tile.
  const start = gridIndexAt(map, map.spawnPx.x, map.spawnPx.y);
  const stack: number[] = [];
  for (let r = 0; r < 12 && !stack.length; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const i = start + dy * W + dx;
        if (i >= 0 && i < W * H && !map.driveSolid[i]) stack.push(i);
      }
  for (const i of stack) seen[i] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % W, y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!seen[j] && !map.driveSolid[j]) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  return seen;
}
