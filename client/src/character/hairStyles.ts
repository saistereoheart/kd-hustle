// Hairstyles are built from a few parametric pieces instead of 23 hand-drawn sprites:
//   cap    = the hair mass on top of the head
//   fringe = the hairline shape across the forehead
//   back   = how far hair hangs down behind (0 none … 5 waist)
//   extra  = buns, tails, braids, quiffs
// To add a style: add an entry here and its id to shared/config/character.json.

export type HairCap = 'none' | 'buzz' | 'normal' | 'volume' | 'spiky' | 'curly' | 'afro' | 'mohawk' | 'undercut';
export type HairFringe = 'none' | 'straight' | 'side' | 'curtain' | 'spiky' | 'messy' | 'swoop';
export type HairExtra = 'bun' | 'topknot' | 'ponytail' | 'pigtails' | 'braid' | 'quiff' | 'mullet';

export interface HairStyle {
  cap: HairCap;
  fringe: HairFringe;
  back: 0 | 1 | 2 | 3 | 4 | 5;
  wavy?: boolean;
  extra?: HairExtra;
}

export const HAIR_STYLES: Record<string, HairStyle> = {
  bald: { cap: 'none', fringe: 'none', back: 0 },
  crew: { cap: 'normal', fringe: 'none', back: 1 },
  buzz: { cap: 'buzz', fringe: 'none', back: 0 },
  spiky: { cap: 'spiky', fringe: 'spiky', back: 1 },
  sidepart: { cap: 'normal', fringe: 'side', back: 1 },
  quiff: { cap: 'normal', fringe: 'swoop', back: 1, extra: 'quiff' },
  undercut: { cap: 'undercut', fringe: 'swoop', back: 0 },
  mohawk: { cap: 'mohawk', fringe: 'none', back: 0 },
  afro: { cap: 'afro', fringe: 'none', back: 1 },
  curly: { cap: 'curly', fringe: 'messy', back: 1 },
  curtain: { cap: 'volume', fringe: 'curtain', back: 2 },
  messy: { cap: 'volume', fringe: 'messy', back: 1 },
  mullet: { cap: 'normal', fringe: 'messy', back: 3, extra: 'mullet' },
  wolf: { cap: 'spiky', fringe: 'messy', back: 3, wavy: true },
  bob: { cap: 'volume', fringe: 'straight', back: 2 },
  wavy: { cap: 'volume', fringe: 'side', back: 3, wavy: true },
  long: { cap: 'normal', fringe: 'curtain', back: 4 },
  longwavy: { cap: 'volume', fringe: 'side', back: 4, wavy: true },
  ponytail: { cap: 'normal', fringe: 'side', back: 0, extra: 'ponytail' },
  bun: { cap: 'normal', fringe: 'none', back: 0, extra: 'bun' },
  topknot: { cap: 'undercut', fringe: 'none', back: 0, extra: 'topknot' },
  pigtails: { cap: 'normal', fringe: 'straight', back: 0, extra: 'pigtails' },
  braid: { cap: 'normal', fringe: 'side', back: 0, extra: 'braid' },
};

export const CAP_VOLUME: Record<HairCap, number> = {
  none: 0, buzz: 0.6, normal: 1.6, volume: 3, spiky: 2, curly: 2.6, afro: 7, mohawk: 0.6, undercut: 1.4,
};
