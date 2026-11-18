// Socket.IO protocol. Every client→server payload has a zod schema; the server parses it
// before doing anything. Server→client payloads are plain typed objects.
import { z } from 'zod';
import { DIRECTIONS, type Appearance, type Direction } from '../character/appearance';
import { EQUIP_SLOTS, type EquipSlot } from '../economy/schemas';
import type { PityState } from '../luck';
import type { ActiveBuff, QuestState } from '../progression/progression';
import { STALL_UPGRADES, type StallState } from '../cooking/stall';
import type { StepParams } from '../cooking/cooking';
import type { Placed, PropertyMode } from '../property/schemas';
import type { Rating, Suggestion } from '../property/rating';
import type { Checkout, Ventures } from '../business/business';
import type { BankView, Loan } from '../business/loans';

export const C2S = {
  characterSave: z.object({ appearance: z.unknown() }),
  move: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    dir: z.enum(DIRECTIONS),
    moving: z.boolean(),
    seq: z.number().int().nonnegative(),
  }),
  chatSend: z.object({ text: z.string().min(1).max(500) }),
  emote: z.object({ emote: z.string().min(1).max(32) }),
  // --- businesses and the shop (Phase 6) ---
  bizBuy: z.object({ type: z.string().min(1).max(32), n: z.number().int().min(1).max(1000) }),
  bizType: z.object({ type: z.string().min(1).max(32) }),
  bizCollect: z.object({ type: z.string().min(1).max(32).optional() }),
  bizRush: z.object({ type: z.string().min(1).max(32), taps: z.array(z.number().finite()).max(60) }),
  shopStock: z.object({ product: z.string().min(1).max(32), qty: z.number().int().min(1).max(1000) }),
  shopPrice: z.object({ product: z.string().min(1).max(32), priceSen: z.number().int().positive().max(1e9) }),
  shopCashier: z.object({ on: z.boolean() }),
  checkoutFinish: z.object({ id: z.number().int().positive(), changeSen: z.number().int().min(0).max(1e9) }),
  loanTake: z.object({ kind: z.enum(['personal', 'business', 'property', 'ahlong']), amountSen: z.number().int().positive().max(1e15), collateral: z.string().min(1).max(60).optional() }),
  loanRepay: z.object({ id: z.number().int().positive(), amountSen: z.number().int().positive().max(1e15).optional() }),
  // --- property (Phase 5) ---
  propUnit: z.object({ unit: z.string().min(3).max(40) }),
  propMode: z.object({ unit: z.string().min(3).max(40), mode: z.enum(['none', 'rent', 'airbnb', 'home']) }),
  propPrices: z.object({ unit: z.string().min(3).max(40), rentSen: z.number().int().positive().max(1e12).optional(), nightSen: z.number().int().positive().max(1e12).optional() }),
  propStaff: z.object({ unit: z.string().min(3).max(40), role: z.enum(['manager', 'cleaner']), on: z.boolean() }),
  propLayout: z.object({
    unit: z.string().min(3).max(40),
    layout: z.array(z.object({ iid: z.number().int().positive(), item: z.string().max(40), x: z.number().int().min(0).max(40), y: z.number().int().min(0).max(40), rot: z.number().int().min(0).max(3) })).max(80),
  }),
  propFix: z.object({ unit: z.string().min(3).max(40), req: z.number().int().positive(), how: z.enum(['contractor', 'diy-start', 'diy-finish']) }),
  propClean: z.object({ unit: z.string().min(3).max(40), phase: z.enum(['start', 'finish']) }),
  furnitureBuy: z.object({ item: z.string().max(40), qty: z.number().int().min(1).max(50) }),
  /** Talk to / take an errand from a wandering NPC (by id). */
  npc: z.object({ npc: z.number().int().nonnegative().max(1000) }),
  /** Vote to skip the night (a yes starts a vote if none is running). */
  timeVote: z.object({ yes: z.boolean() }),
  /** Go into a building (its OSM id) or come back out (null). */
  interior: z.object({ building: z.string().max(40).nullable() }),
  /** `remote`: a quick roll from the phone (anywhere, for a small fee: economy.json → phoneRollFee). */
  crateRoll: z.object({ crateId: z.string().max(32), count: z.union([z.literal(1), z.literal(5), z.literal(10)]), remote: z.boolean().optional() }),
  equip: z.object({ iid: z.number().int().positive() }),
  unequip: z.object({ slot: z.enum(EQUIP_SLOTS) }),
  stack: z.object({ itemId: z.string().max(40), variant: z.string().max(16), grade: z.string().max(2).optional(), count: z.number().int().min(1).max(10000) }),
  /** Merge N copies of an item at one tier into one at the next tier. */
  invMerge: z.object({ itemId: z.string().max(40), grade: z.string().max(2) }),
  /** Spend shards on a chance at a better tier or variant for one item. */
  invReroll: z.object({ iid: z.number().int().positive(), what: z.enum(['grade', 'variant']) }),
  shardBuy: z.object({ itemId: z.string().max(40) }),
  /** `remote`: a delivery taken from the phone instead of a Jobs Board. */
  jobStart: z.object({ kind: z.enum(['delivery', 'carwash']), remote: z.boolean().optional() }),
  skillUpgrade: z.object({ skill: z.string().min(1).max(32) }),
  itemUse: z.object({ iid: z.number().int().positive() }),
  titleEquip: z.object({ title: z.string().max(32).nullable() }),
  questClaim: z.object({ id: z.string().min(1).max(32) }),
  stallBuy: z.object({ tier: z.number().int().positive().max(10) }),
  stallOpen: z.object({ open: z.boolean() }),
  stallCook: z.object({ customerId: z.number().int().nonnegative().optional(), token: z.boolean().optional() }),
  stallServe: z.object({
    dishId: z.string().max(40),
    inputs: z.array(z.object({ startMs: z.number().finite(), ev: z.array(z.number().finite()).max(6000) })).max(12),
  }),
  stallUpgrade: z.object({ key: z.enum(STALL_UPGRADES) }),
  stallStock: z.object({ recipe: z.string().max(32), qty: z.number().int().positive().max(1000), delivery: z.boolean() }),
  carwashSubmit: z.object({
    jobId: z.string().max(40),
    soap: z.array(z.number().finite()).max(20000),
    rinse: z.array(z.number().finite()).max(20000),
    polish: z.array(z.number().finite()).max(20000),
    /** When the polish stage began (ms from the start of the mini-game). */
    polishStartMs: z.number().finite().nonnegative(),
  }),
  hotbarSet: z.object({
    slot: z.number().int().min(0).max(9),
    ref: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('vehicle'), id: z.string().max(24) }),
        z.object({ kind: z.literal('item'), itemId: z.string().max(40), variant: z.string().max(16) }),
      ])
      .nullable(),
  }),
  vehicleRide: z.object({ vehicle: z.string().max(24).nullable() }),
  /** Ronda: where to (tile coords). */
  rideQuote: z.object({ x: z.number().finite(), y: z.number().finite() }),
  rideBook: z.object({ quoteId: z.string().max(40) }),
};

/** A Ronda fare quote: the route the rider will take (tile coords, flat) and the price. */
export interface RideQuote {
  quoteId: string;
  fareSen: number;
  meters: number;
  /** Pickup wait + riding time. */
  etaSec: number;
  route: number[];
  /** Where you'll be dropped off (a landmark/street name), if known. */
  destName: string | null;
}

export const HOTBAR_SLOTS = 10;
/** What a hotbar slot holds: a vehicle you own, or an item (stack) from your bag. */
export type HotbarRef = { kind: 'vehicle'; id: string } | { kind: 'item'; itemId: string; variant: string };
export type MoveMsg = z.infer<typeof C2S.move>;

/** An equipped cosmetic as other players see it. */
export interface CosmeticRef {
  itemId: string;
  variant: string;
}
export type Cosmetics = Partial<Record<EquipSlot, CosmeticRef>>;

export interface InventoryItem {
  iid: number;
  itemId: string;
  variant: string;
  /** Tier D..S (old items: D). */
  grade: string;
  serial: number | null;
  obtainedAt: number;
}

export interface RollResult {
  iid: number;
  itemId: string;
  tier: string;
  variant: string;
  grade: string;
  serial: number | null;
  oneIn: number;
  pity: boolean;
  isNew: boolean;
}

export type JobState =
  | {
      kind: 'delivery';
      jobId: string;
      stage: 'pickup' | 'dropoff';
      pickup: { x: number; y: number; name: string };
      dropoff: { x: number; y: number; name: string };
      meters: number;
      startedAt: number;
      deadline: number;
      baseSen: number;
    }
  | {
      kind: 'carwash';
      jobId: string;
      /** Stage 1: dirt spots [x, y, scrubs needed], 0..1 in the car picture. */
      spots: Array<[number, number, number]>;
      spotRadius: number;
      /** Stage 2: rinse every cell of a cols × rows grid over `area` [x0, y0, x1, y1]. */
      rinse: { cols: number; rows: number; hitsPerCell: number; area: [number, number, number, number] };
      /** Stage 3: shine marks; mark k shows from polishStart + k × intervalMs for windowMs. */
      polish: { spots: Array<[number, number]>; intervalMs: number; windowMs: number; hits: number; radius: number };
      /** Car paint colour (just for looks). */
      color: string;
      startedAt: number;
      timeLimitSec: number;
    };

export interface JobProgress {
  level: number;
  done: number;
}

/** Your progression (Phase 3): XP, level, wealth stage, titles, stats, buffs, daily stuff. */
export interface ProgressState {
  /** Total XP ever earned. */
  xp: number;
  level: number;
  /** Highest wealth stage reached (1 = Budak Baru). */
  stage: number;
  /** Title worn (id), or null. */
  title: string | null;
  /** Titles earned (ids). */
  titles: string[];
  /** Lifetime counters (rolls, jobs, manifestSecs, ...), used by titles, goals and quests. */
  stats: Record<string, number>;
  /** Active potion buffs (time left counts down only while you're online). */
  buffs: ActiveBuff[];
  /** Daily login reward: can it be claimed now, and which streak day (1–7) it is. */
  daily: { canClaim: boolean; nextDay: number; streak: number };
  /** Today's quests. */
  quests: QuestState[];
  /** Index of the first Hustle Path goal not done yet (= number of goals when the path is done). */
  path: number;
  /** Hustle Path goals done (any order). */
  goalsDone: string[];
}

/** Something to celebrate, sent with a progress update. */
export type ProgressEvent =
  | { kind: 'level'; level: number; rewardSen: number; items: string[] }
  | { kind: 'stage'; stage: number }
  | { kind: 'title'; id: string }
  | { kind: 'goal'; id: string; rewardSen: number; items: string[] }
  | { kind: 'questReady'; id: string };

/** A customer at a stall (everyone sees them queue). */
export interface StallCustomer {
  id: number;
  /** Seeds the customer's look (same on every screen). */
  seed: number;
  recipe: string;
  /** Paid extras they asked for (ayam goreng, telur mata...). */
  addons?: string[];
  /** Server ms they arrived, and how long they'll wait. */
  arrivedAt: number;
  patienceMs: number;
  blogger: boolean;
  /** Being cooked for right now (by the owner, or a cook). */
  serving: 'owner' | 'staff' | null;
}

/** A food stall as everyone sees it. */
export interface StallPublic {
  owner: number;
  ownerName: string;
  plot: string;
  tier: number;
  /** Owner online and the stall open for business (within its hours). */
  open: boolean;
  rep: number;
  staff: number;
  queue: StallCustomer[];
}

/** Your stall, with the private bits (stock, upgrades, mastery...). */
export type StallSelf = StallState & { earnedToday: number };

/** A dish you're cooking: the steps the server built for it. */
export interface DishState {
  dishId: string;
  recipe: string;
  customerId: number;
  steps: StepParams[];
  /** Equipment widens the windows (the client's instant feedback uses it too). */
  windowMult: number;
  blogger: boolean;
}

export interface ServeResult {
  quality: string;
  grades: string[];
  paidSen: number;
  tipSen: number;
  combo: number;
  rep: number;
}

/** Who owns a home (what everyone sees). */
export interface PropPublic {
  unit: string;
  owner: number;
  ownerName: string;
  mode: PropertyMode;
  stars: number;
}

/** Your own home, everything about it. */
export interface PropSelf {
  unit: string;
  type: string;
  boughtSen: number;
  mode: PropertyMode;
  rentSen: number;
  tenant: { kind: string; since: number; owed: number } | null;
  condition: number;
  requests: Array<{ id: number; text: string; day: number }>;
  nightSen: number;
  cleanliness: number;
  layout: Placed[];
  guest: { until: number; paySen: number; vip: boolean } | null;
  reviews: Array<{ stars: number; text: string; day: number }>;
  fiveStars: number;
  superhost: boolean;
  manager: boolean;
  cleaner: boolean;
  earnedSen: number;
  work: { kind: 'diy' | 'clean'; req?: number; at: number } | null;
  rating: Rating;
  fairNightSen: number;
  fairRentSen: number;
  happiness: number | null;
  suggestions: Suggestion[];
  loc: number;
}

/** An errand for a wandering NPC: go to a place, then back to them. */
export interface ErrandState {
  npc: number;
  npcName: string;
  stage: 'go' | 'return';
  place: { x: number; y: number; name: string };
  rewardSen: number;
  xp: number;
  expiresAt: number;
  /** Shown when you reach the place ("Now bring it back to..."). */
  pickupText: string;
}

/** The skip-the-night vote, as everyone sees it. */
export interface SkipVoteState {
  active: boolean;
  yes: number;
  no: number;
  /** Yes votes needed to pass with this many players online. */
  needed: number;
  online: number;
  endsAt: number;
  startedBy: string | null;
  /** Can a new vote start right now? (it's night and not cooling down) */
  canStart: boolean;
  cooldownUntil: number;
}

export interface PlayerPublic {
  id: number;
  name: string;
  appearance: Appearance;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  level: number;
  title: string | null;
  /** Continuous emote currently playing (sit, sleep, dance...), or null. */
  emote: string | null;
  cosmetics: Cosmetics;
  /** Vehicle being ridden (e.g. 'motorbike'), or null. */
  vehicle: string | null;
  /** Inside this building (hidden outdoors, shown in its interior), or null. */
  interior: string | null;
  /** Late on an Ah Long loan: a red "OWES AH LONG" tag and debt collectors follow them around. */
  owesAhLong?: boolean;
}

export interface SelfState extends PlayerPublic {
  isAdmin: boolean;
  lastSavedAt: number | null;
  walletSen: number;
  shards: number;
  inventory: InventoryItem[];
  equipped: Partial<Record<EquipSlot, number>>;
  /** Item ids ever found (the Item Index). */
  index: string[];
  /** Crate ids whose Index page reward has been claimed. */
  pagesClaimed: string[];
  pity: Record<string, PityState>;
  jobs: Record<string, JobProgress>;
  job: JobState | null;
  /** Skill levels, e.g. { manifest: 3 }. */
  skills: Record<string, number>;
  /** 10 quick-use slots (keys 1–9, 0). */
  hotbar: Array<HotbarRef | null>;
  /** Vehicles you own and can ride yourself. */
  vehicles: string[];
  progress: ProgressState;
  /** Your food stall, or null if you don't own one. */
  stall: StallSelf | null;
  /** An NPC errand in progress (kept while you're online). */
  errand: ErrandState | null;
}

export interface ChatMsg {
  id: number;
  fromId: number | null;
  fromName: string;
  text: string;
  t: number;
  system?: boolean;
}

export interface InitPayload {
  you: SelfState;
  needsCharacter: boolean;
  players: PlayerPublic[];
  chat: ChatMsg[];
  serverTime: number;
  /** Every food stall on the map (owners' names, open or not, queues). */
  stalls: StallPublic[];
  /** Who owns which home. */
  props: PropPublic[];
}

/** Compact snapshot row: [id, x, y, dirIndex, moving(0|1)] */
export type SnapshotRow = [number, number, number, number, number];
export interface SnapshotPayload {
  t: number;
  p: SnapshotRow[];
}

type Ack<T> = (res: T) => void;
export type SimpleResult = { ok: true } | { ok: false; error: string };
export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface WalletUpdate {
  walletSen: number;
  shards: number;
  /** Change in sen (for floating +RM numbers). */
  delta?: number;
  reason?: string;
}

export interface Announcement {
  text: string;
  tier: string;
  /** Divine/Secret: a full-screen takeover with fireworks. */
  takeover: boolean;
  playerName: string;
  itemId: string;
  variant: string;
  oneIn: number;
}

export interface ClientToServerEvents {
  'character:save': (msg: { appearance: unknown }, ack: Ack<SimpleResult>) => void;
  move: (msg: MoveMsg) => void;
  'chat:send': (msg: { text: string }, ack: Ack<SimpleResult>) => void;
  emote: (msg: { emote: string }) => void;
  'emote:stop': () => void;
  interior: (msg: { building: string | null }, ack: Ack<SimpleResult>) => void;
  'time:vote': (msg: { yes: boolean }, ack: Ack<SimpleResult>) => void;
  'npc:talk': (msg: { npc: number }, ack: Ack<Result<{ line: string; offer?: { text: string; rewardSen: number; xp: number } }>>) => void;
  'npc:accept': (msg: { npc: number }, ack: Ack<Result<{ errand: ErrandState }>>) => void;
  'npc:progress': (ack: Ack<Result<{ errand: ErrandState | null; text?: string; paidSen?: number }>>) => void;
  'npc:cancel': (ack: Ack<SimpleResult>) => void;
  'prop:buy': (msg: { unit: string }, ack: Ack<SimpleResult>) => void;
  'prop:sell': (msg: { unit: string }, ack: Ack<Result<{ gainedSen: number }>>) => void;
  'prop:mode': (msg: { unit: string; mode: PropertyMode }, ack: Ack<SimpleResult>) => void;
  'prop:prices': (msg: { unit: string; rentSen?: number; nightSen?: number }, ack: Ack<SimpleResult>) => void;
  'prop:staff': (msg: { unit: string; role: 'manager' | 'cleaner'; on: boolean }, ack: Ack<SimpleResult>) => void;
  'prop:layout': (msg: { unit: string; layout: Placed[] }, ack: Ack<Result<{ stars: number }>>) => void;
  'prop:fix': (msg: { unit: string; req: number; how: 'contractor' | 'diy-start' | 'diy-finish' }, ack: Ack<Result<{ doneAt?: number }>>) => void;
  'prop:clean': (msg: { unit: string; phase: 'start' | 'finish' }, ack: Ack<Result<{ doneAt?: number }>>) => void;
  'furniture:buy': (msg: { item: string; qty: number }, ack: Ack<Result<{ items: InventoryItem[] }>>) => void;
  'welcome:spin': (ack: Ack<Result<{ bonusSen: number }>>) => void;
  'crate:roll': (msg: { crateId: string; count: 1 | 5 | 10 }, ack: Ack<Result<{ results: RollResult[]; walletSen: number; pity: PityState; pageReward?: { crateId: string; sen: number } }>>) => void;
  'inv:equip': (msg: { iid: number }, ack: Ack<SimpleResult>) => void;
  'inv:merge': (msg: { itemId: string; grade: string }, ack: Ack<Result<{ removed: number[]; item: InventoryItem }>>) => void;
  'inv:reroll': (msg: { iid: number; what: 'grade' | 'variant' }, ack: Ack<Result<{ item: InventoryItem; improved: boolean; shards: number }>>) => void;
  'inv:unequip': (msg: { slot: EquipSlot }, ack: Ack<SimpleResult>) => void;
  'pawn:sell': (msg: { itemId: string; variant: string; grade?: string; count: number }, ack: Ack<Result<{ removed: number[]; gainedSen: number }>>) => void;
  'pawn:scrap': (msg: { itemId: string; variant: string; grade?: string; count: number }, ack: Ack<Result<{ removed: number[]; gainedShards: number }>>) => void;
  'shard:buy': (msg: { itemId: string }, ack: Ack<Result<{ item: InventoryItem; isNew: boolean }>>) => void;
  'job:start': (msg: { kind: 'delivery' | 'carwash'; remote?: boolean }, ack: Ack<Result<{ job: JobState }>>) => void;
  'job:progress': (ack: Ack<Result<{ job: JobState | null; paidSen?: number; tipSen?: number; levelUp?: number }>>) => void;
  'job:cancel': (ack: Ack<SimpleResult>) => void;
  'skill:upgrade': (msg: { skill: string }, ack: Ack<Result<{ level: number; walletSen: number; skills: Record<string, number> }>>) => void;
  /** Drink a potion. */
  'item:use': (msg: { iid: number }, ack: Ack<Result<{ removed: number }>>) => void;
  'title:equip': (msg: { title: string | null }, ack: Ack<SimpleResult>) => void;
  /** Day 7 includes a free crate roll (`roll`), played with the normal reel. */
  'daily:claim': (ack: Ack<Result<{ day: number; roll?: { crateId: string; results: RollResult[] } }>>) => void;
  'quest:claim': (msg: { id: string }, ack: Ack<SimpleResult>) => void;
  'stall:buy': (msg: { tier: number }, ack: Ack<SimpleResult>) => void;
  'stall:open': (msg: { open: boolean }, ack: Ack<SimpleResult>) => void;
  /** Start cooking for the front customer (or a given one). `token` = use a Perfect Cook Token. */
  'stall:cook': (msg: { customerId?: number; token?: boolean }, ack: Ack<Result<{ dish: DishState | null; served?: ServeResult }>>) => void;
  'stall:serve': (msg: { dishId: string; inputs: Array<{ startMs: number; ev: number[] }> }, ack: Ack<Result<{ result: ServeResult }>>) => void;
  'stall:cancel': (ack: Ack<SimpleResult>) => void;
  /** Throw away the dish you're making and start it over (free: same customer, no more stock). */
  'stall:redo': (ack: Ack<Result<{ dish: DishState }>>) => void;
  'stall:upgrade': (msg: { key: string }, ack: Ack<SimpleResult>) => void;
  'stall:hire': (ack: Ack<SimpleResult>) => void;
  'stall:fire': (ack: Ack<SimpleResult>) => void;
  'stall:stock': (msg: { recipe: string; qty: number; delivery: boolean }, ack: Ack<SimpleResult>) => void;
  'carwash:submit': (
    msg: { jobId: string; soap: number[]; rinse: number[]; polish: number[]; polishStartMs: number },
    ack: Ack<Result<{ cleaned: number; soap: number; rinse: number; polish: number; paidSen: number; levelUp?: number }>>,
  ) => void;
  'hotbar:set': (msg: { slot: number; ref: HotbarRef | null }, ack: Ack<Result<{ hotbar: Array<HotbarRef | null> }>>) => void;
  'vehicle:ride': (msg: { vehicle: string | null }, ack: Ack<Result<{ vehicle: string | null; vehicles: string[] }>>) => void;
  'ride:quote': (msg: { x: number; y: number }, ack: Ack<Result<{ quote: RideQuote }>>) => void;
  'ride:book': (msg: { quoteId: string }, ack: Ack<Result<{ walletSen: number; route: number[]; pickupMs: number; durationMs: number; destName: string | null }>>) => void;
  /** Get off the Ronda right here. */
  'ride:stop': (ack: Ack<SimpleResult>) => void;
  // --- businesses and the shop (Phase 6) ---
  'biz:buy': (msg: { type: string; n: number }, ack: Ack<Result<{ level: number; costSen: number }>>) => void;
  'biz:manager': (msg: { type: string }, ack: Ack<SimpleResult>) => void;
  'biz:collect': (msg: { type?: string }, ack: Ack<Result<{ paidSen: number }>>) => void;
  /** The rush mini-game: the times (ms) of your taps. */
  'biz:rush': (msg: { type: string; taps: number[] }, ack: Ack<Result<{ rushUntil: number }>>) => void;
  'shop:open': (ack: Ack<SimpleResult>) => void;
  'shop:stock': (msg: { product: string; qty: number }, ack: Ack<SimpleResult>) => void;
  'shop:price': (msg: { product: string; priceSen: number }, ack: Ack<SimpleResult>) => void;
  'shop:cashier': (msg: { on: boolean }, ack: Ack<SimpleResult>) => void;
  /** Be the cashier: the next customer (their basket, the money they hand over, change options). */
  'checkout:start': (ack: Ack<Result<{ checkout: Omit<Checkout, 'at' | 'totalSen'> }>>) => void;
  'checkout:finish': (msg: { id: number; changeSen: number }, ack: Ack<Result<{ correct: boolean; onTime: boolean; gainSen: number; bonusSen: number }>>) => void;
  // --- loans (Phase 6) ---
  'bank:view': (ack: Ack<Result<{ bank: BankView }>>) => void;
  'loan:take': (msg: { kind: 'personal' | 'business' | 'property' | 'ahlong'; amountSen: number; collateral?: string }, ack: Ack<Result<{ loan: Loan }>>) => void;
  'loan:repay': (msg: { id: number; amountSen?: number }, ack: Ack<Result<{ paidSen: number; owedSen: number }>>) => void;
  logout: (ack: Ack<SimpleResult>) => void;
}

export interface ServerToClientEvents {
  init: (p: InitPayload) => void;
  'player:joined': (p: PlayerPublic) => void;
  'player:left': (p: { id: number }) => void;
  'player:updated': (p: { id: number; appearance?: Appearance; cosmetics?: Cosmetics; vehicle?: string | null; level?: number; title?: string | null; interior?: string | null; owesAhLong?: boolean }) => void;
  /** Your progression changed (XP, level, quests, buffs...), with anything worth celebrating. */
  progress: (p: { progress: ProgressState; events: ProgressEvent[] }) => void;
  /** Stalls changed (customers came or went, opened, closed...). Only the changed ones. */
  stalls: (p: { stalls: StallPublic[]; removed?: string[] }) => void;
  /** An admin moved the in-game clock (the new offset, in game minutes). */
  'time:offset': (p: { offsetGameMinutes: number }) => void;
  /** Your stall's private state changed. */
  'stall:self': (p: { stall: StallSelf | null }) => void;
  /** Something happened at your stall that's worth a toast (a cook served a dish, a customer left...). */
  'stall:event': (p: { kind: 'staffServed' | 'staffSale' | 'lowStock' | 'lost' | 'blogger' | 'closed' | 'spoiled' | 'wagesUnpaid'; text: string; sen?: number }) => void;
  snapshot: (p: SnapshotPayload) => void;
  'move:correct': (p: { x: number; y: number; seq: number }) => void;
  'chat:msg': (m: ChatMsg) => void;
  'emote:played': (p: { id: number; emote: string }) => void;
  'time:vote': (s: SkipVoteState) => void;
  /** Who owns which home (everyone). */
  props: (p: { props: PropPublic[] }) => void;
  /** Your own homes, with ratings and suggestions. */
  'props:self': (p: { props: PropSelf[] }) => void;
  'prop:event': (e: { unit: string; text: string; kind: 'good' | 'bad' | 'info' }) => void;
  /** Your businesses and shop. */
  'ventures:self': (p: { ventures: Ventures }) => void;
  /** Your loans and credit (after any change, and each loan day). */
  'bank:self': (p: { bank: BankView }) => void;
  /** A loan event worth a toast (missed instalment, repossession, debt collectors...). */
  'loan:event': (e: { text: string; kind: 'good' | 'bad' | 'info' }) => void;
  /** "While you were away…" (offline income). */
  welcome: (w: { awayMs: number; earnedSen: number; lines: Array<{ label: string; sen: number }> }) => void;
  'emote:stopped': (p: { id: number }) => void;
  saved: (p: { at: number }) => void;
  kicked: (p: { reason: string }) => void;
  wallet: (p: WalletUpdate) => void;
  announce: (a: Announcement) => void;
  'inv:added': (p: { items: InventoryItem[]; index: string[] }) => void;
  'job:update': (p: { job: JobState | null; jobs: Record<string, JobProgress> }) => void;
  /** Your Ronda ride is over (arrived, or you got off). Position is where you were dropped. */
  'ride:ended': (p: { x: number; y: number; arrived: boolean }) => void;
}

export const DIR_INDEX: Record<Direction, number> = { down: 0, up: 1, left: 2, right: 3 };
