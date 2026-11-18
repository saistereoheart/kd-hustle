// Lucky Strand Casino (Phase 7, spec §7.6): config schema and the pure maths shared by server
// and client. The server resolves every game with crypto RNG; the client only shows results.
// Each game has a configurable house edge (2–5%); tests check the expected return.
import { z } from 'zod';

export const CASINO_GAMES = ['slots', 'roulette', 'blackjack', 'crash', 'wheel', 'highlow'] as const;
export type CasinoGame = (typeof CASINO_GAMES)[number];

export const casinoConfigSchema = z.object({
  /** Min and max bet (sen) by wealth stage (index 0 = stage 1). */
  betLimits: z.array(z.tuple([z.number().int().positive(), z.number().int().positive()])).min(1),
  /** A win this many times the bet (or this much money) is announced to everyone. */
  announceMult: z.number().positive(),
  announceSen: z.number().int().positive(),
  slots: z.object({
    /** Symbols on every reel, with how often they come up (weight). */
    symbols: z.array(z.object({ id: z.string(), icon: z.string(), name: z.string(), weight: z.number().int().positive(), three: z.number().nonnegative() })).min(3),
    /** Pays for exactly two / at least one of the first symbol (cherries), × bet. */
    twoOfFirst: z.number().nonnegative(),
    bets: z.array(z.number().int().positive()).min(1),
  }),
  roulette: z.object({ bettingMs: z.number().int().positive(), spinMs: z.number().int().positive(), resultMs: z.number().int().positive() }),
  blackjack: z.object({
    seats: z.number().int().min(1).max(7),
    decks: z.number().int().min(1).max(8),
    /** Blackjack pays this × bet (3:2 = 1.5). */
    blackjackPays: z.number().positive(),
    bettingMs: z.number().int().positive(),
    turnMs: z.number().int().positive(),
    resultMs: z.number().int().positive(),
  }),
  crash: z.object({
    houseEdge: z.number().min(0).max(0.2),
    /** Multiplier growth: m(t) = e^(growthPerSec × t). */
    growthPerSec: z.number().positive(),
    maxMult: z.number().gt(1),
    bettingMs: z.number().int().positive(),
    crashedMs: z.number().int().positive(),
  }),
  wheel: z.object({
    everyMs: z.number().int().positive(),
    spinMs: z.number().int().positive(),
    /** Segments: how many slots on the wheel, and what a winning bet returns (× bet, stake included). */
    segments: z.array(z.object({ id: z.string(), label: z.string(), color: z.string(), count: z.number().int().positive(), returns: z.number().gt(1) })).min(2),
  }),
  highlow: z.object({ houseEdge: z.number().min(0).max(0.2), maxStreak: z.number().int().positive() }),
  /** The daily free spin (outside the casino, for everyone): prizes and their weights. */
  dailySpin: z.object({
    prizes: z.array(z.object({ id: z.string(), label: z.string(), weight: z.number().int().positive(), sen: z.number().int().nonnegative().default(0), shards: z.number().int().nonnegative().default(0), item: z.string().optional() })).min(1),
    /** Money prizes × this by wealth stage (index 0 = stage 1). */
    stageMult: z.array(z.number().positive()).min(1),
  }),
});
export type CasinoConfig = z.infer<typeof casinoConfigSchema>;

export function betLimits(cfg: CasinoConfig, stage: number): [number, number] {
  return cfg.betLimits[Math.min(cfg.betLimits.length - 1, Math.max(0, stage - 1))];
}

// ------------------------------------------------------------------ slots
/** What a spin of three symbols pays (× bet). */
export function slotsPayout(cfg: CasinoConfig, reels: readonly string[]): number {
  const s = cfg.slots;
  if (reels[0] === reels[1] && reels[1] === reels[2]) return s.symbols.find((x) => x.id === reels[0])?.three ?? 0;
  const first = s.symbols[0].id;
  if (reels.filter((r) => r === first).length === 2) return s.twoOfFirst;
  return 0;
}

/** Expected return per RM bet (for tests and the odds screen). */
export function slotsRtp(cfg: CasinoConfig): number {
  const s = cfg.slots;
  const W = s.symbols.reduce((a, x) => a + x.weight, 0);
  let rtp = 0;
  for (const x of s.symbols) rtp += (x.weight / W) ** 3 * x.three;
  const c = s.symbols[0].weight / W;
  rtp += 3 * c * c * (1 - c) * s.twoOfFirst;
  return rtp;
}

// ------------------------------------------------------------------ roulette (European)
export const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const ROULETTE_BETS = ['red', 'black', 'odd', 'even', 'low', 'high', 'dozen1', 'dozen2', 'dozen3', 'col1', 'col2', 'col3'] as const;
/** A bet: one of ROULETTE_BETS, or "n:<0-36>" for a single number. */
export const rouletteBetSchema = z.string().regex(/^(red|black|odd|even|low|high|dozen[123]|col[123]|n:([0-9]|[12][0-9]|3[0-6]))$/);

/** What a bet returns on this number (× bet, stake included; 0 = lost). */
export function rouletteReturn(bet: string, n: number): number {
  if (bet.startsWith('n:')) return Number(bet.slice(2)) === n ? 36 : 0;
  if (n === 0) return 0;
  const red = ROULETTE_RED.has(n);
  switch (bet) {
    case 'red': return red ? 2 : 0;
    case 'black': return red ? 0 : 2;
    case 'odd': return n % 2 ? 2 : 0;
    case 'even': return n % 2 ? 0 : 2;
    case 'low': return n <= 18 ? 2 : 0;
    case 'high': return n >= 19 ? 2 : 0;
    case 'dozen1': return n <= 12 ? 3 : 0;
    case 'dozen2': return n >= 13 && n <= 24 ? 3 : 0;
    case 'dozen3': return n >= 25 ? 3 : 0;
    case 'col1': return n % 3 === 1 ? 3 : 0;
    case 'col2': return n % 3 === 2 ? 3 : 0;
    case 'col3': return n % 3 === 0 ? 3 : 0;
  }
  return 0;
}

// ------------------------------------------------------------------ cards (blackjack, high-low)
/** A card: rank 1 (A) … 13 (K), suit 0..3 (♠♥♦♣). Encoded as rank*4+suit. */
export type Card = number;
export const cardRank = (c: Card) => Math.floor(c / 4);
export const cardSuit = (c: Card) => c % 4;
export function cardLabel(c: Card): string {
  const r = cardRank(c);
  return `${r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : r}${'♠♥♦♣'[cardSuit(c)]}`;
}

/** Blackjack hand value (aces count 11 when that doesn't bust) and whether it's soft. */
export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0, aces = 0;
  for (const c of cards) {
    const r = cardRank(c);
    total += r === 1 ? 1 : Math.min(10, r);
    if (r === 1) aces++;
  }
  let soft = false;
  if (aces && total + 10 <= 21) {
    total += 10;
    soft = true;
  }
  return { total, soft };
}
export const isBlackjack = (cards: readonly Card[]) => cards.length === 2 && handValue(cards).total === 21;

/** A fresh, unshuffled shoe of `decks` decks. */
export function newShoe(decks: number): Card[] {
  const out: Card[] = [];
  for (let d = 0; d < decks; d++) for (let r = 1; r <= 13; r++) for (let s = 0; s < 4; s++) out.push(r * 4 + s);
  return out;
}

export type BjResult = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';
/** Settle one player hand against the dealer's final hand. Returns the result and what it pays back (× hand bet, stake included). */
export function settleBlackjack(cfg: CasinoConfig, player: readonly Card[], dealer: readonly Card[], fromSplit: boolean): { result: BjResult; returns: number } {
  const p = handValue(player).total, d = handValue(dealer).total;
  if (p > 21) return { result: 'bust', returns: 0 };
  const pBj = !fromSplit && isBlackjack(player), dBj = isBlackjack(dealer);
  if (pBj && !dBj) return { result: 'blackjack', returns: 1 + cfg.blackjack.blackjackPays };
  if (dBj && !pBj) return { result: 'lose', returns: 0 };
  if (d > 21 || p > d) return { result: 'win', returns: 2 };
  if (p === d) return { result: 'push', returns: 1 };
  return { result: 'lose', returns: 0 };
}

// ------------------------------------------------------------------ crash
/** The crash point from a uniform u in [0, 1): P(crash ≥ x) = (1 − edge) / x. */
export function crashPoint(cfg: CasinoConfig, u: number): number {
  const c = cfg.crash;
  const x = (1 - c.houseEdge) / Math.max(1e-9, 1 - u);
  return Math.max(1, Math.min(c.maxMult, Math.floor(x * 100) / 100));
}
/** The multiplier `ms` after the round took off. */
export function crashMultAt(cfg: CasinoConfig, ms: number): number {
  return Math.floor(Math.exp(cfg.crash.growthPerSec * Math.max(0, ms) / 1000) * 100) / 100;
}
/** When (ms after take-off) the multiplier reaches `m`. */
export function crashMsFor(cfg: CasinoConfig, m: number): number {
  return (Math.log(Math.max(1, m)) / cfg.crash.growthPerSec) * 1000;
}

// ------------------------------------------------------------------ wheel of fortune
export function wheelRtp(cfg: CasinoConfig, segment: string): number {
  const segs = cfg.wheel.segments;
  const total = segs.reduce((a, s) => a + s.count, 0);
  const s = segs.find((x) => x.id === segment);
  return s ? (s.count / total) * s.returns : 0;
}
/** The wheel's slots in order (segments spread around it). */
export function wheelLayout(cfg: CasinoConfig): string[] {
  const out: string[] = [];
  const left = cfg.wheel.segments.map((s) => ({ id: s.id, n: s.count }));
  const total = left.reduce((a, s) => a + s.n, 0);
  // Interleave so the big ones aren't bunched together.
  for (let i = 0; i < total; i++) {
    left.sort((a, b) => b.n - a.n);
    const pick = left.find((s) => s.n > 0 && s.id !== out[out.length - 1]) ?? left.find((s) => s.n > 0)!;
    out.push(pick.id);
    pick.n--;
  }
  return out;
}

// ------------------------------------------------------------------ high-low
/** Chance the next card (rank 1..13, uniformly) is strictly higher / lower than `rank`. */
export function highLowChance(rank: number, guess: 'higher' | 'lower'): number {
  return guess === 'higher' ? (13 - rank) / 13 : (rank - 1) / 13;
}
/** What a correct guess multiplies your pot by (fair odds minus the house edge). */
export function highLowMult(cfg: CasinoConfig, rank: number, guess: 'higher' | 'lower'): number {
  const p = highLowChance(rank, guess);
  return p > 0 ? Math.floor(((1 - cfg.highlow.houseEdge) / p) * 100) / 100 : 0;
}

// ------------------------------------------------------------------ shared table views (sent to clients)
export interface RouletteView {
  round: number;
  phase: 'betting' | 'spinning' | 'result';
  /** Server ms the current phase ends. */
  endsAt: number;
  bets: Array<{ player: number; name: string; bet: string; sen: number }>;
  /** The number (once spinning). */
  result: number | null;
  history: number[];
}

export interface BjHand {
  cards: Card[];
  bet: number;
  done: boolean;
  doubled: boolean;
  fromSplit: boolean;
  result?: BjResult;
  paid?: number;
}
export interface BjSeat {
  player: number;
  name: string;
  bet: number;
  hands: BjHand[];
}
export interface BlackjackView {
  round: number;
  phase: 'waiting' | 'betting' | 'playing' | 'dealer' | 'result';
  endsAt: number;
  seats: Array<BjSeat | null>;
  /** The dealer's cards; the hole card is -1 until the dealer plays. */
  dealer: Card[];
  /** Whose turn: seat and hand index. */
  turn: { seat: number; hand: number } | null;
}

export interface CrashView {
  round: number;
  phase: 'betting' | 'running' | 'crashed';
  endsAt: number;
  /** Server ms the multiplier started rising (running). */
  startedAt: number;
  /** Where it crashed (only once it has). */
  crashAt: number | null;
  bets: Array<{ player: number; name: string; sen: number; auto: number | null; cashedAt: number | null }>;
  history: number[];
}

export interface WheelView {
  round: number;
  phase: 'betting' | 'spinning';
  /** Server ms of the next spin (betting) or when the spin ends (spinning). */
  endsAt: number;
  bets: Array<{ player: number; name: string; segment: string; sen: number }>;
  /** The winning slot index on the wheel (once spinning). */
  result: number | null;
  history: string[];
}

export interface CasinoSession {
  /** Today (real day): what you bet and what came back. */
  day: string;
  wageredSen: number;
  returnedSen: number;
  biggestWinSen: number;
}
