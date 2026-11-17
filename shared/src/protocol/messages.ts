// Socket.IO protocol. Every client→server payload has a zod schema; the server parses it
// before doing anything. Server→client payloads are plain typed objects.
import { z } from 'zod';
import { DIRECTIONS, type Appearance, type Direction } from '../character/appearance';
import { EQUIP_SLOTS, type EquipSlot } from '../economy/schemas';
import type { PityState } from '../luck';

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
  skillUpgrade: z.object({ skill: z.enum(['manifest']) }),
  carwashSubmit: z.object({ jobId: z.string().max(40), points: z.array(z.number().finite()).max(30000) }),
};
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
      /** Dirt spot centres, 0..1 in the car picture. */
      spots: Array<[number, number]>;
      hitsPerSpot: number;
      spotRadius: number;
      startedAt: number;
      timeLimitSec: number;
    };

export interface JobProgress {
  level: number;
  done: number;
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
  'skill:upgrade': (msg: { skill: 'manifest' }, ack: Ack<Result<{ level: number; walletSen: number }>>) => void;
  'carwash:submit': (msg: { jobId: string; points: number[] }, ack: Ack<Result<{ cleaned: number; paidSen: number; levelUp?: number }>>) => void;
  logout: (ack: Ack<SimpleResult>) => void;
}

export interface ServerToClientEvents {
  init: (p: InitPayload) => void;
  'player:joined': (p: PlayerPublic) => void;
  'player:left': (p: { id: number }) => void;
  'player:updated': (p: { id: number; appearance?: Appearance; cosmetics?: Cosmetics; vehicle?: string | null }) => void;
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
}

export const DIR_INDEX: Record<Direction, number> = { down: 0, up: 1, left: 2, right: 3 };
