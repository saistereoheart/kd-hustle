// Cooking (spec §8.2): recipes are a few short timing/precision STEPS. The server builds each
// dish (random zones, beats, orders) with `makeDish`, the client plays it and sends back the
// raw inputs (timestamps, pointer paths), and the server grades them with `gradeStep`. The client
// runs the same graders to show instant feedback, but only the server's grade pays.
//
// Step kinds:
//   hold      hold to fill a meter, release inside the green zone        (scoop rice)
//   timing    press once at the right moment                             (flip the egg)
//   rhythm    tap on each beat                                           (stretch dough, tarik)
//   sequence  pick ingredients in the order the customer asked           (sides, curry)
//   path      drag through numbered points in order                     (sambal swirl, fold)
//   meter     hold to raise / release to drop; keep it in the zone       (teh tarik foam)
//   assemble  tap the ingredient boxes the customer's order needs          (pack a nasi lemak)
//             (the base sides plus any paid add-ons, e.g. ayam goreng, which have their own stock)
import { z } from 'zod';
import type { RandInt } from '../luck';

const range = z.tuple([z.number(), z.number()]);
const base = { label: z.string(), hint: z.string(), art: z.string() };

export const stepTemplateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hold'), ...base, fillMs: z.number().positive(), zoneWidth: z.number().positive(), zoneCenter: range }),
  z.object({ kind: z.literal('timing'), ...base, targetMs: range, maxMs: z.number().positive() }),
  z.object({ kind: z.literal('rhythm'), ...base, beats: z.number().int().positive(), intervalMs: range, leadMs: z.number().nonnegative() }),
  z.object({
    kind: z.literal('sequence'), ...base,
    options: z.array(z.object({ id: z.string(), name: z.string(), icon: z.string() })).min(2),
    pick: z.number().int().positive(),
  }),
  z.object({ kind: z.literal('path'), ...base, shape: z.enum(['spiral', 'fold', 'corners']), points: z.number().int().min(2), radius: z.number().positive() }),
  z.object({ kind: z.literal('meter'), ...base, durationMs: z.number().positive(), zoneWidth: z.number().positive(), zoneCenter: range, rise: z.number().positive(), fall: z.number().positive() }),
  z.object({
    kind: z.literal('assemble'), ...base,
    /** The base sides (part of the dish's own stock). The recipe's add-ons are added as boxes too. */
    options: z.array(z.object({ id: z.string(), name: z.string(), icon: z.string() })).min(2),
    /** How many base sides an order asks for [min, max]. */
    pick: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    /** All correct within this long = Perfect (slower = Great). */
    fastMs: z.number().positive(),
    maxMs: z.number().positive(),
  }),
]);
export type StepTemplate = z.infer<typeof stepTemplateSchema>;

const grades = z.object({ perfect: z.number(), great: z.number(), good: z.number() });
export const recipesConfigSchema = z.object({
  recipes: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9_]+$/),
      name: z.string(),
      icon: z.string(),
      basePriceSen: z.number().int().positive(),
      /** Ingredients for one dish (bought as stock). */
      ingredientCostSen: z.number().int().positive(),
      /** Needs this mastery of another recipe to go on the menu. */
      unlock: z.object({ recipe: z.string(), mastery: z.number().int().positive() }).optional(),
      steps: z.array(stepTemplateSchema).min(1),
      /** Paid extras a customer may ask for (separate stock, bought like a dish's ingredients). */
      addons: z
        .array(z.object({ id: z.string().regex(/^[a-z0-9_]+$/), name: z.string(), icon: z.string(), basePriceSen: z.number().int().positive(), ingredientCostSen: z.number().int().positive() }))
        .default([]),
      /** Chance a customer adds each add-on that's in stock, and the most per order. */
      addonChance: z.number().min(0).max(1).default(0.45),
      maxAddons: z.number().int().nonnegative().default(2),
    }),
  ),
  /** Grading windows (× the stall's equipment bonus, so better gear is more forgiving). */
  windows: z.object({
    /** hold: distance from the zone centre, in zone half-widths. */
    hold: grades,
    /** timing + rhythm: ms from the target. */
    timingMs: grades,
    rhythmMs: grades,
    /** rhythm/path/meter: share of the step done well → grade. */
    share: grades,
    /** path: checkpoint radius multiplier is the step's own `radius`. */
  }),
  /** Points per step grade; the dish quality comes from the average. */
  gradeScore: z.object({ perfect: z.number(), great: z.number(), good: z.number(), miss: z.number() }),
  /** Dish quality from the average step score (highest `min` first). */
  quality: z.array(z.object({ id: z.enum(['perfect', 'great', 'good', 'ok', 'burnt']), name: z.string(), min: z.number(), mult: z.number() })).length(5),
});
export type RecipesConfig = z.infer<typeof recipesConfigSchema>;
export type RecipeDef = RecipesConfig['recipes'][number];
export type AddonDef = RecipeDef['addons'][number];
export type Grade = 'perfect' | 'great' | 'good' | 'miss';
export type Quality = RecipesConfig['quality'][number]['id'];

type Base = { label: string; hint: string; art: string; maxMs: number };
export type StepParams =
  | (Base & { kind: 'hold'; fillMs: number; zone: [number, number] })
  | (Base & { kind: 'timing'; targetMs: number })
  | (Base & { kind: 'rhythm'; beats: number[] })
  | (Base & { kind: 'sequence'; options: Array<{ id: string; name: string; icon: string }>; order: string[] })
  | (Base & { kind: 'path'; points: Array<[number, number]>; radius: number })
  | (Base & { kind: 'meter'; durationMs: number; zone: [number, number]; rise: number; fall: number })
  | (Base & { kind: 'assemble'; options: Array<{ id: string; name: string; icon: string; addon?: boolean }>; want: string[]; fastMs: number });

/** What the player did in one step. `startMs` is when the step began (ms since the dish began);
 *  `ev` times are ms since the step began:
 *  hold [down, up] · timing [press] · rhythm [tap...] · sequence [optionIndex, t, ...] ·
 *  path [x, y, t, ...] (x/y 0..1) · meter [down, up, down, up...] · assemble [optionIndex, t, ...] */
export interface StepInput {
  startMs: number;
  ev: number[];
}

// ------------------------------------------------------------------ building a dish
const between = (rand: RandInt, [a, b]: [number, number]) => a + (rand(1_000_000) / 1_000_000) * (b - a);

function pathPoints(shape: 'spiral' | 'fold' | 'corners', n: number, rand: RandInt): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const flip = rand(2) === 1;
  const fx = (x: number) => (flip ? 1 - x : x);
  if (shape === 'spiral') {
    const a0 = (rand(360) * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1);
      const a = a0 + t * Math.PI * 3.2 * (flip ? -1 : 1);
      const r = 0.07 + t * 0.3;
      pts.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r]);
    }
  } else if (shape === 'fold') {
    // Wrapping: zig-zag across the leaf, top to bottom.
    for (let i = 0; i < n; i++) pts.push([fx(i % 2 === 0 ? 0.18 : 0.82), 0.2 + (0.6 * i) / Math.max(1, n - 1)]);
  } else {
    // Folding roti: each corner into the middle.
    const corners: Array<[number, number]> = [[0.15, 0.15], [0.85, 0.15], [0.85, 0.85], [0.15, 0.85]];
    const start = rand(4);
    for (let i = 0; pts.length < n; i++) {
      const c = corners[(start + i) % 4];
      pts.push([fx(c[0]), c[1]]);
      if (pts.length < n) pts.push([0.5, 0.5]);
    }
  }
  return pts.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
}

/** Builds one dish's steps (zones, targets, beats, the customer's order...). `addons`: the paid
 *  extras this customer ordered (they go into the assemble step's order). */
export function makeDish(recipe: RecipeDef, rand: RandInt, addons: string[] = []): StepParams[] {
  return recipe.steps.map((s): StepParams => {
    const b = { label: s.label, hint: s.hint, art: s.art };
    switch (s.kind) {
      case 'hold': {
        const c = between(rand, s.zoneCenter);
        return { ...b, kind: 'hold', fillMs: s.fillMs, zone: [c - s.zoneWidth / 2, c + s.zoneWidth / 2], maxMs: s.fillMs * 2.2 + 3000 };
      }
      case 'timing': {
        const t = Math.round(between(rand, s.targetMs));
        return { ...b, kind: 'timing', targetMs: t, maxMs: s.maxMs };
      }
      case 'rhythm': {
        const iv = Math.round(between(rand, s.intervalMs));
        const beats = Array.from({ length: s.beats }, (_, i) => s.leadMs + i * iv);
        return { ...b, kind: 'rhythm', beats, maxMs: beats[beats.length - 1] + 1500 };
      }
      case 'sequence': {
        const pool = s.options.map((o) => o.id);
        const order: string[] = [];
        const want = Math.min(s.pick, pool.length);
        while (order.length < want) order.push(pool.splice(rand(pool.length), 1)[0]);
        return { ...b, kind: 'sequence', options: s.options, order, maxMs: 9000 };
      }
      case 'path':
        return { ...b, kind: 'path', points: pathPoints(s.shape, s.points, rand), radius: s.radius, maxMs: 9000 };
      case 'meter': {
        const c = between(rand, s.zoneCenter);
        return { ...b, kind: 'meter', durationMs: s.durationMs, zone: [c - s.zoneWidth / 2, c + s.zoneWidth / 2], rise: s.rise, fall: s.fall, maxMs: s.durationMs + 2500 };
      }
      case 'assemble': {
        // The customer wants some of the base sides (e.g. "no timun") plus their add-ons.
        const pool = s.options.map((o) => o.id);
        const [lo, hi] = [Math.min(s.pick[0], pool.length), Math.min(s.pick[1], pool.length)];
        const n = lo + rand(Math.max(1, hi - lo + 1));
        const want: string[] = [];
        while (want.length < n) want.push(pool.splice(rand(pool.length), 1)[0]);
        const known = new Set(recipe.addons.map((a) => a.id));
        for (const a of addons) if (known.has(a) && !want.includes(a)) want.push(a);
        const options = [...s.options, ...recipe.addons.map((a) => ({ id: a.id, name: a.name, icon: a.icon, addon: true }))];
        return { ...b, kind: 'assemble', options, want, fastMs: s.fastMs, maxMs: s.maxMs };
      }
    }
  });
}

// ------------------------------------------------------------------ grading
export interface StepGrade {
  grade: Grade;
  /** 0..1 how well it went (for feedback). */
  accuracy: number;
}

const byWindow = (d: number, w: { perfect: number; great: number; good: number }, mult: number): Grade =>
  d <= w.perfect * mult ? 'perfect' : d <= w.great * mult ? 'great' : d <= w.good * mult ? 'good' : 'miss';
const byShare = (s: number, w: { perfect: number; great: number; good: number }): Grade =>
  s >= w.perfect ? 'perfect' : s >= w.great ? 'great' : s >= w.good ? 'good' : 'miss';

/** Meter level over time from hold presses (shared by the grader and the client's drawing). */
export function meterLevel(step: Extract<StepParams, { kind: 'meter' }>, ev: number[], atMs: number): number {
  let v = 0.15;
  let t = 0;
  const holding = (ms: number) => {
    for (let i = 0; i < ev.length; i += 2) {
      const down = ev[i], up = ev[i + 1] ?? Infinity;
      if (ms >= down && ms < up) return true;
    }
    return false;
  };
  const dt = 20;
  while (t + dt <= atMs) {
    v += ((holding(t) ? step.rise : -step.fall) * dt) / 1000;
    v = Math.max(0, Math.min(1, v));
    t += dt;
  }
  return v;
}

/** Grades one step. `windowMult` > 1 widens every window (stall equipment). */
export function gradeStep(cfg: RecipesConfig, step: StepParams, ev: number[], windowMult = 1): StepGrade {
  const w = cfg.windows;
  switch (step.kind) {
    case 'hold': {
      if (ev.length < 2 || ev[1] < ev[0]) return { grade: 'miss', accuracy: 0 };
      const v = (ev[1] - ev[0]) / step.fillMs;
      const c = (step.zone[0] + step.zone[1]) / 2;
      const half = (step.zone[1] - step.zone[0]) / 2;
      const d = Math.abs(v - c) / half;
      return { grade: byWindow(d, w.hold, windowMult), accuracy: Math.max(0, 1 - d / (w.hold.good * windowMult)) };
    }
    case 'timing': {
      if (!ev.length) return { grade: 'miss', accuracy: 0 };
      const d = Math.abs(ev[0] - step.targetMs);
      return { grade: byWindow(d, w.timingMs, windowMult), accuracy: Math.max(0, 1 - d / (w.timingMs.good * windowMult)) };
    }
    case 'rhythm': {
      const taps = [...ev].sort((a, b) => a - b);
      if (taps.length > step.beats.length * 2 + 2) return { grade: 'miss', accuracy: 0 }; // button mashing
      const used = new Set<number>();
      let sum = 0;
      for (const beat of step.beats) {
        let best = -1, bd = Infinity;
        taps.forEach((t, i) => {
          if (!used.has(i) && Math.abs(t - beat) < bd) {
            bd = Math.abs(t - beat);
            best = i;
          }
        });
        const g = best >= 0 ? byWindow(bd, w.rhythmMs, windowMult) : 'miss';
        if (g !== 'miss') used.add(best);
        sum += cfg.gradeScore[g];
      }
      const share = sum / step.beats.length;
      return { grade: byShare(share, w.share), accuracy: share };
    }
    case 'sequence': {
      const picks: string[] = [];
      for (let i = 0; i + 1 < ev.length; i += 2) picks.push(step.options[ev[i]]?.id ?? '?');
      let right = 0;
      step.order.forEach((id, i) => {
        if (picks[i] === id) right++;
      });
      const extra = Math.max(0, picks.length - step.order.length);
      const share = Math.max(0, (right - extra) / step.order.length);
      return { grade: share >= 1 ? 'perfect' : share >= 0.66 ? 'good' : 'miss', accuracy: share };
    }
    case 'assemble': {
      // Right boxes count, wrong (or repeated) boxes count against you; all right and quick = Perfect.
      const want = new Set(step.want);
      const got = new Set<string>();
      let wrong = 0, lastT = 0;
      for (let i = 0; i + 1 < ev.length; i += 2) {
        const id = step.options[ev[i]]?.id;
        lastT = Math.max(lastT, ev[i + 1]);
        if (id && want.has(id) && !got.has(id)) got.add(id);
        else wrong++;
      }
      const share = Math.max(0, (got.size - wrong) / Math.max(1, want.size));
      const all = got.size === want.size && wrong === 0;
      const grade: Grade = all ? (lastT <= step.fastMs * windowMult ? 'perfect' : 'great') : share >= 0.6 ? 'good' : 'miss';
      return { grade, accuracy: share };
    }
    case 'path': {
      let next = 0;
      const r = step.radius * windowMult;
      for (let i = 0; i + 2 < ev.length && next < step.points.length; i += 3) {
        const [px, py] = step.points[next];
        if (Math.hypot(ev[i] - px, ev[i + 1] - py) <= r) next++;
      }
      const share = next / step.points.length;
      return { grade: byShare(share, w.share), accuracy: share };
    }
    case 'meter': {
      // Replay the meter from the presses and count the time spent in the (widened) zone, from the
      // earliest moment it could have got there (the climb up from empty doesn't count against you).
      const c = (step.zone[0] + step.zone[1]) / 2;
      const half = ((step.zone[1] - step.zone[0]) / 2) * windowMult;
      const leadMs = (Math.max(0, c - half - 0.15) / step.rise) * 1000;
      let inZone = 0, n = 0;
      let v = 0.15;
      const dt = 20;
      let k = 0; // index into ev (pairs)
      for (let t = 0; t < step.durationMs; t += dt) {
        while (k + 1 < ev.length && ev[k + 1] <= t) k += 2;
        const holding = k < ev.length && t >= ev[k] && t < (ev[k + 1] ?? Infinity);
        v = Math.max(0, Math.min(1, v + ((holding ? step.rise : -step.fall) * dt) / 1000));
        if (t < leadMs) continue;
        if (Math.abs(v - c) <= half) inZone++;
        n++;
      }
      const share = inZone / Math.max(1, n);
      return { grade: byShare(share, w.share), accuracy: share };
    }
  }
}

/** The dish's quality from its step grades (Burnt / OK / Good / Great / Perfect). */
export function dishQuality(cfg: RecipesConfig, stepGrades: Grade[]) {
  const score = stepGrades.reduce((a, g) => a + cfg.gradeScore[g], 0) / Math.max(1, stepGrades.length);
  const q = [...cfg.quality].sort((a, b) => b.min - a.min).find((x) => score >= x.min) ?? cfg.quality[cfg.quality.length - 1];
  return { quality: q.id, name: q.name, mult: q.mult, score };
}

/**
 * Plausibility checks on a submitted dish (so a modified client can't skip the waiting):
 * one input per step, steps in order, events inside each step's time budget, and the whole
 * thing can't have taken longer than the server says the dish has been cooking.
 */
export function validateDishInputs(steps: StepParams[], inputs: StepInput[], serverElapsedMs: number): string | null {
  if (inputs.length !== steps.length) return 'wrong number of steps';
  let prevStart = -1;
  let end = 0;
  for (let i = 0; i < steps.length; i++) {
    const { startMs, ev } = inputs[i];
    if (!(startMs >= 0) || startMs < prevStart) return 'steps out of order';
    prevStart = startMs;
    const step = steps[i];
    const pairs = step.kind === 'sequence' || step.kind === 'assemble';
    const stride = step.kind === 'path' ? 3 : pairs ? 2 : 1;
    const off = step.kind === 'path' ? 2 : pairs ? 1 : 0;
    for (let j = off; j < ev.length; j += stride) {
      const t = ev[j];
      if (!Number.isFinite(t) || t < 0 || t > step.maxMs + 300) return 'event outside the step';
      end = Math.max(end, startMs + t);
    }
    if (step.kind === 'path') for (let j = 0; j + 1 < ev.length; j += 3) if (ev[j] < -0.2 || ev[j] > 1.2 || ev[j + 1] < -0.2 || ev[j + 1] > 1.2) return 'point off the board';
    if (step.kind === 'assemble') {
      if (ev.length > step.options.length * 4) return 'too many taps';
      for (let j = 0; j < ev.length; j += 2) if (!Number.isInteger(ev[j]) || ev[j] < 0 || ev[j] >= step.options.length) return 'no such box';
    }
  }
  if (end > serverElapsedMs + 1500) return 'faster than real time';
  return null;
}
