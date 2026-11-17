// Starter jobs from the Jobs Board (spec §8.1). The server picks the locations / mini-game
// layout, keeps the timer, checks proximity and grades the inputs; the client just plays.
import { districtAt, gridIndexAt, type BuiltBuilding, type BuiltMap, type JobProgress, type JobsConfig, type RandInt } from '@kh/shared';
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

/**
 * Car wash grading. `points` is a flat list [x, y, tMs, x, y, tMs, ...] with x/y in 0..1 car
 * coordinates and t measured from the start of the mini-game. A dirt spot is clean after
 * `hitsPerSpot` scrubbing movements over it. Impossible input (too fast, from the future,
 * out of order) scores zero.
 */
export function gradeCarwash(
  cfg: JobsConfig['carwash'],
  spots: Array<[number, number]>,
  points: number[],
  serverElapsedMs: number,
): { cleaned: number; durationMs: number; valid: boolean } {
  const n = Math.floor(points.length / 3);
  if (n === 0) return { cleaned: 0, durationMs: 0, valid: true };
  const limitMs = cfg.timeLimitSec * 1000;
  let lastT = -1;
  for (let i = 0; i < n; i++) {
    const x = points[i * 3], y = points[i * 3 + 1], t = points[i * 3 + 2];
    if (x < -0.1 || x > 1.1 || y < -0.1 || y > 1.1 || t < lastT || t < 0 || t > limitMs + 500) return { cleaned: 0, durationMs: 0, valid: false };
    lastT = t;
  }
  // Can't have scrubbed for longer than the server says the game has been running.
  if (lastT > serverElapsedMs + 1500) return { cleaned: 0, durationMs: 0, valid: false };
  const durationMs = Math.max(1, lastT - points[2]);
  if (n / Math.max(1, durationMs / 1000) > cfg.maxPointsPerSec * 1.2 && n > 30) return { cleaned: 0, durationMs, valid: false };
  const hits = new Array(spots.length).fill(0);
  for (let i = 1; i < n; i++) {
    const x = points[i * 3], y = points[i * 3 + 1];
    const px = points[(i - 1) * 3], py = points[(i - 1) * 3 + 1];
    if (Math.hypot(x - px, y - py) < 0.004) continue; // must be a scrubbing movement, not a tap
    spots.forEach(([sx, sy], k) => {
      if (Math.hypot(x - sx, y - sy) <= cfg.spotRadius) hits[k]++;
    });
  }
  const cleaned = hits.filter((h) => h >= cfg.hitsPerSpot).length / spots.length;
  return { cleaned, durationMs, valid: true };
}

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

export interface JobHooks {
  mount(p: OnlinePlayer, vehicle: string): void;
  dismount(p: OnlinePlayer): void;
}

export class JobSystem {
  private pickups: BuiltBuilding[] = [];
  private dropoffs: BuiltBuilding[] = [];

  constructor(
    private readonly cfg: ServerConfig,
    private readonly econ: Economy,
    private readonly rand: RandInt,
    private readonly hooks: JobHooks,
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
      const c = this.cfg.jobs.carwash;
      const spots: Array<[number, number]> = [];
      for (let i = 0; i < c.spots; i++) spots.push([0.15 + (this.rand(1000) / 1000) * 0.7, 0.3 + (this.rand(1000) / 1000) * 0.45]);
      p.job = { kind, jobId, spots, hitsPerSpot: c.hitsPerSpot, spotRadius: c.spotRadius, startedAt: now, timeLimitSec: c.timeLimitSec };
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
    const bikeMps = (this.cfg.vehicles.vehicles[d.vehicle]?.speed ?? 400) / T * mpt;
    const budgetMs = Math.round((meters / bikeMps) * d.timeBudgetFactor * 1000 + d.timeBudgetSlackSec * 1000);
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
    this.hooks.mount(p, d.vehicle);
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
    this.hooks.dismount(p);
    return { job: null, paidSen: paySen, tipSen, levelUp };
  }

  submitCarwash(p: OnlinePlayer, jobId: string, points: number[], now = Date.now()) {
    const job = p.job;
    if (!job || job.kind !== 'carwash' || job.jobId !== jobId) throw new GameError('That car wash job has ended.');
    const grade = gradeCarwash(this.cfg.jobs.carwash, job.spots, points, now - job.startedAt);
    const prog = this.progress(p, 'carwash');
    const pay = grade.valid ? carwashPay(this.cfg.jobs, grade.cleaned, grade.durationMs, prog.level) : 0;
    const levelUp = this.complete(p, 'carwash', pay, job.jobId, pay > 0);
    return { cleaned: grade.cleaned, paidSen: pay, levelUp };
  }

  cancel(p: OnlinePlayer) {
    const job = p.job;
    p.job = null;
    if (job?.kind === 'delivery') this.hooks.dismount(p);
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
