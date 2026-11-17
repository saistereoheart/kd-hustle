// Player appearance: a flat JSON object of part ids + colours. Validated on the server
// against character.json so a modified client can't save parts that don't exist.
import { z } from 'zod';
import { hexColor, type CharacterConfig } from '../config/schemas';

export const DIRECTIONS = ['down', 'up', 'left', 'right'] as const;
export type Direction = (typeof DIRECTIONS)[number];

const partId = z.string().min(1).max(32);

export const appearanceSchema = z
  .object({
    skin: hexColor,
    face: partId,
    height: partId,
    build: partId,
    eyes: partId,
    eyeColor: hexColor,
    brows: partId,
    /** null = brows follow the hair colour */
    browColor: hexColor.nullable(),
    nose: partId,
    mouth: partId,
    blush: z.boolean(),
    freckles: z.boolean(),
    beautyMark: z.boolean(),
    glasses: partId,
    hair: partId,
    hairColor: hexColor,
    highlight: hexColor.nullable(),
    headwear: partId,
    headwearColor: hexColor,
    facialHair: partId,
    top: partId,
    topColor: hexColor,
    bottom: partId,
    bottomColor: hexColor,
    shoes: partId,
    shoesColor: hexColor,
  })
  .strict();
export type Appearance = z.infer<typeof appearanceSchema>;

/** Which config list each part id must come from. */
const PART_LISTS: Array<[keyof Appearance, keyof CharacterConfig]> = [
  ['face', 'faceShapes'],
  ['height', 'heights'],
  ['build', 'builds'],
  ['eyes', 'eyes'],
  ['brows', 'eyebrows'],
  ['nose', 'noses'],
  ['mouth', 'mouths'],
  ['glasses', 'glasses'],
  ['hair', 'hair'],
  ['headwear', 'headwear'],
  ['facialHair', 'facialHair'],
  ['top', 'tops'],
  ['bottom', 'bottoms'],
  ['shoes', 'shoes'],
];

export type AppearanceResult = { ok: true; value: Appearance } | { ok: false; error: string };

export function validateAppearance(input: unknown, cfg: CharacterConfig): AppearanceResult {
  const parsed = appearanceSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue?.path.join('.') || 'appearance'}: ${issue?.message ?? 'invalid'}` };
  }
  for (const [field, list] of PART_LISTS) {
    const options = cfg[list] as Array<{ id: string }>;
    const value = parsed.data[field] as string;
    if (!options.some((o) => o.id === value)) return { ok: false, error: `${field}: unknown option "${value}"` };
  }
  return { ok: true, value: parsed.data };
}

const pick = <T>(arr: readonly T[], rand: () => number): T => arr[Math.floor(rand() * arr.length) % arr.length];

/** Random look for the "Randomise" button (cosmetic, so Math.random is fine). */
export function randomAppearance(cfg: CharacterConfig, rand: () => number = Math.random): Appearance {
  const headwear = rand() < 0.75 ? cfg.headwear[0] : pick(cfg.headwear, rand);
  return {
    skin: pick(cfg.skinTones, rand),
    face: pick(cfg.faceShapes, rand).id,
    height: pick(cfg.heights, rand).id,
    build: pick(cfg.builds, rand).id,
    eyes: pick(cfg.eyes, rand).id,
    eyeColor: pick(cfg.palettes.eyes, rand),
    brows: pick(cfg.eyebrows, rand).id,
    browColor: null,
    nose: pick(cfg.noses, rand).id,
    mouth: pick(cfg.mouths, rand).id,
    blush: rand() < 0.4,
    freckles: rand() < 0.2,
    beautyMark: rand() < 0.15,
    glasses: rand() < 0.7 ? cfg.glasses[0].id : pick(cfg.glasses, rand).id,
    hair: pick(cfg.hair, rand).id,
    hairColor: pick(cfg.palettes.hair, rand),
    highlight: rand() < 0.2 ? pick(cfg.palettes.hair, rand) : null,
    headwear: headwear.id,
    headwearColor: pick(cfg.palettes.clothes, rand),
    facialHair: rand() < 0.75 ? cfg.facialHair[0].id : pick(cfg.facialHair, rand).id,
    top: pick(cfg.tops, rand).id,
    topColor: pick(cfg.palettes.clothes, rand),
    bottom: pick(cfg.bottoms, rand).id,
    bottomColor: pick(cfg.palettes.clothes, rand),
    shoes: pick(cfg.shoes, rand).id,
    shoesColor: pick(cfg.palettes.clothes, rand),
  };
}

export function defaultAppearance(cfg: CharacterConfig): Appearance {
  return {
    skin: cfg.skinTones[Math.min(4, cfg.skinTones.length - 1)],
    face: cfg.faceShapes[0].id,
    height: cfg.heights[Math.floor(cfg.heights.length / 2)].id,
    build: cfg.builds[Math.floor(cfg.builds.length / 2)].id,
    eyes: cfg.eyes[0].id,
    eyeColor: cfg.palettes.eyes[0],
    brows: cfg.eyebrows[0].id,
    browColor: null,
    nose: cfg.noses[0].id,
    mouth: cfg.mouths[1]?.id ?? cfg.mouths[0].id,
    blush: true,
    freckles: false,
    beautyMark: false,
    glasses: cfg.glasses[0].id,
    hair: cfg.hair[1]?.id ?? cfg.hair[0].id,
    hairColor: cfg.palettes.hair[0],
    highlight: null,
    headwear: cfg.headwear[0].id,
    headwearColor: cfg.palettes.clothes[0],
    facialHair: cfg.facialHair[0].id,
    top: cfg.tops[0].id,
    topColor: cfg.palettes.clothes[1] ?? cfg.palettes.clothes[0],
    bottom: cfg.bottoms[0].id,
    bottomColor: cfg.palettes.clothes[2] ?? cfg.palettes.clothes[0],
    shoes: cfg.shoes[0].id,
    shoesColor: cfg.palettes.clothes[0],
  };
}

/** Stable short hash of an appearance (texture cache key). */
export function appearanceKey(a: Appearance): string {
  const s = JSON.stringify(a);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
