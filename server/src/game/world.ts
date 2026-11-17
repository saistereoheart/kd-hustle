// In-memory state of everyone currently connected. The DB is only touched by the
// SaveManager; gameplay reads/writes these objects and flags them dirty.
import type { Appearance, Direction, PlayerPublic, SelfState } from '@kh/shared';
import type { MoveState } from '../systems/movement/moveValidator';

export interface OnlinePlayer {
  id: number;
  name: string;
  isAdmin: boolean;
  socketId: string;
  appearance: Appearance | null;
  hasCharacter: boolean;
  scene: string;
  x: number;
  y: number;
  dir: Direction;
  moving: boolean;
  /** Changed since the last save? */
  dirty: boolean;
  lastSavedAt: number | null;
  mapVersion: number;
  move: MoveState;
  lastEmoteAt: number;
}

export class World {
  readonly players = new Map<number, OnlinePlayer>();

  get(id: number) {
    return this.players.get(id);
  }

  add(p: OnlinePlayer) {
    this.players.set(p.id, p);
  }

  remove(id: number) {
    this.players.delete(id);
  }

  /** Players with a finished character in a scene (others are still in the creator). */
  inScene(scene: string): OnlinePlayer[] {
    return [...this.players.values()].filter((p) => p.scene === scene && p.hasCharacter);
  }

  scenes(): string[] {
    return [...new Set([...this.players.values()].filter((p) => p.hasCharacter).map((p) => p.scene))];
  }

  toPublic(p: OnlinePlayer): PlayerPublic {
    return {
      id: p.id,
      name: p.name,
      appearance: p.appearance!,
      x: p.x,
      y: p.y,
      dir: p.dir,
      moving: p.moving,
      level: 1, // levels arrive in Phase 3
      title: null,
    };
  }

  toSelf(p: OnlinePlayer): SelfState {
    return { ...this.toPublic(p), isAdmin: p.isAdmin, lastSavedAt: p.lastSavedAt };
  }
}
