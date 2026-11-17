// Socket.IO protocol. Every client→server payload has a zod schema; the server parses it
// before doing anything. Server→client payloads are plain typed objects.
import { z } from 'zod';
import { DIRECTIONS, type Appearance, type Direction } from '../character/appearance';
import { EQUIP_SLOTS, type EquipSlot } from '../economy/schemas';
import type { PityState } from '../luck';
import type { ActiveBuff, QuestState } from '../progression/progression';
import { STALL_UPGRADES, type StallState } from '../cooking/stall';
import type { StepParams } from '../cooking/cooking';

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
  crateRoll: z.object({ crateId: z.string().max(32), count: z.union([z.literal(1), z.literal(5), z.literal(10)]) }),
  equip: z.object({ iid: z.number().int().positive() }),
  unequip: z.object({ slot: z.enum(EQUIP_SLOTS) }),
  stack: z.object({ itemId: z.string().max(40), variant: z.string().max(16), count: z.number().int().min(1).max(10000) }),
  shardBuy: z.object({ itemId: z.string().max(40) }),
  jobStart: z.object({ kind: z.enum(['delivery', 'carwash']) }),
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
  serial: number | null;
  obtainedAt: number;
}

export interface RollResult {
  iid: number;
  itemId: string;
  tier: string;
  variant: string;
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
  'crate:roll': (msg: { crateId: string; count: 1 | 5 | 10 }, ack: Ack<Result<{ results: RollResult[]; walletSen: number; pity: PityState; pageReward?: { crateId: string; sen: number } }>>) => void;
  'inv:equip': (msg: { iid: number }, ack: Ack<SimpleResult>) => void;
  'inv:unequip': (msg: { slot: EquipSlot }, ack: Ack<SimpleResult>) => void;
  'pawn:sell': (msg: { itemId: string; variant: string; count: number }, ack: Ack<Result<{ removed: number[]; gainedSen: number }>>) => void;
  'pawn:scrap': (msg: { itemId: string; variant: string; count: number }, ack: Ack<Result<{ removed: number[]; gainedShards: number }>>) => void;
  'shard:buy': (msg: { itemId: string }, ack: Ack<Result<{ item: InventoryItem; isNew: boolean }>>) => void;
  'job:start': (msg: { kind: 'delivery' | 'carwash' }, ack: Ack<Result<{ job: JobState }>>) => void;
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
  logout: (ack: Ack<SimpleResult>) => void;
}

export interface ServerToClientEvents {
  init: (p: InitPayload) => void;
  'player:joined': (p: PlayerPublic) => void;
  'player:left': (p: { id: number }) => void;
  'player:updated': (p: { id: number; appearance?: Appearance; cosmetics?: Cosmetics; vehicle?: string | null; level?: number; title?: string | null }) => void;
  /** Your progression changed (XP, level, quests, buffs...), with anything worth celebrating. */
  progress: (p: { progress: ProgressState; events: ProgressEvent[] }) => void;
  /** Stalls changed (customers came or went, opened, closed...). Only the changed ones. */
  stalls: (p: { stalls: StallPublic[]; removed?: string[] }) => void;
  /** An admin moved the in-game clock (the new offset, in game minutes). */
  'time:offset': (p: { offsetGameMinutes: number }) => void;
  /** Your stall's private state changed. */
  'stall:self': (p: { stall: StallSelf | null }) => void;
  /** Something happened at your stall that's worth a toast (a cook served a dish, a customer left...). */
  'stall:event': (p: { kind: 'staffServed' | 'lost' | 'blogger' | 'closed' | 'spoiled' | 'wagesUnpaid'; text: string; sen?: number }) => void;
  snapshot: (p: SnapshotPayload) => void;
  'move:correct': (p: { x: number; y: number; seq: number }) => void;
  'chat:msg': (m: ChatMsg) => void;
  'emote:played': (p: { id: number; emote: string }) => void;
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
