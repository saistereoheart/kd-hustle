// Socket.IO protocol. Every client→server payload has a zod schema; the server parses it
// before doing anything. Server→client payloads are plain typed objects.
import { z } from 'zod';
import { DIRECTIONS, type Appearance, type Direction } from '../character/appearance';

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
};
export type MoveMsg = z.infer<typeof C2S.move>;

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
}

export interface SelfState extends PlayerPublic {
  isAdmin: boolean;
  lastSavedAt: number | null;
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

export interface ClientToServerEvents {
  'character:save': (msg: { appearance: unknown }, ack: Ack<SimpleResult>) => void;
  move: (msg: MoveMsg) => void;
  'chat:send': (msg: { text: string }, ack: Ack<SimpleResult>) => void;
  emote: (msg: { emote: string }) => void;
  logout: (ack: Ack<SimpleResult>) => void;
}

export interface ServerToClientEvents {
  init: (p: InitPayload) => void;
  'player:joined': (p: PlayerPublic) => void;
  'player:left': (p: { id: number }) => void;
  'player:updated': (p: { id: number; appearance: Appearance }) => void;
  snapshot: (p: SnapshotPayload) => void;
  'move:correct': (p: { x: number; y: number; seq: number }) => void;
  'chat:msg': (m: ChatMsg) => void;
  'emote:played': (p: { id: number; emote: string }) => void;
  saved: (p: { at: number }) => void;
  kicked: (p: { reason: string }) => void;
}

export const DIR_INDEX: Record<Direction, number> = { down: 0, up: 1, left: 2, right: 3 };
