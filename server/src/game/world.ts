// In-memory state of everyone currently connected. Gameplay reads/writes these objects;
// position/appearance are persisted by the SaveManager, while money, items and other economy
// state are written to the DB immediately inside transactions (see systems/economy).
import type {
  Appearance, Cosmetics, Direction, EquipSlot, HotbarRef, InventoryItem, JobProgress, JobState, PityState, PlayerPublic, SelfState,
} from '@kh/shared';
import type { MoveState } from '../systems/movement/moveValidator';

/** Server-side job state: what the client sees plus private grading data. */
export type ServerJob = JobState & { budgetMs?: number };

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
  /** Changed since the last save? (position/appearance) */
  dirty: boolean;
  lastSavedAt: number | null;
  mapVersion: number;
  move: MoveState;
  /** Continuous emote currently playing (see systems/emotes). */
  emote: string | null;

  // --- economy (Phase 2) ---
  walletSen: number;
  shards: number;
  inventory: InventoryItem[];
  equipped: Partial<Record<EquipSlot, number>>;
  /** What other players see equipped (derived from `equipped` + inventory). */
  cosmetics: Cosmetics;
  index: Set<string>;
  pages: Set<string>;
  pity: Record<string, PityState>;
  jobs: Record<string, JobProgress>;
  job: ServerJob | null;
  vehicle: string | null;
  skills: Record<string, number>;
  /** Manifest earnings (sen, fractional) not yet paid out. */
  manifestBank: number;
  manifestSecs: number;
  hotbar: Array<HotbarRef | null>;
  /** A vehicle ordered from the phone (returned when you hop off), or null. */
  rental: string | null;
}

export class World {
  readonly players = new Map<number, OnlinePlayer>();

  /** Vehicles everyone owns from the start (set from vehicles.json at startup). */
  starterVehicles: string[] = [];

  /** Vehicles this player can ride right now. */
  vehiclesOf(p: OnlinePlayer): string[] {
    return p.rental && !this.starterVehicles.includes(p.rental) ? [...this.starterVehicles, p.rental] : [...this.starterVehicles];
  }

  get(id: number) {
    return this.players.get(id);
  }

  byName(name: string) {
    const lower = name.toLowerCase();
    return [...this.players.values()].find((p) => p.name.toLowerCase() === lower);
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
      emote: p.emote,
      cosmetics: p.cosmetics,
      vehicle: p.vehicle,
    };
  }

  toSelf(p: OnlinePlayer): SelfState {
    let job: JobState | null = null;
    if (p.job) {
      const { budgetMs: _hidden, ...rest } = p.job;
      job = rest as JobState;
    }
    return {
      ...this.toPublic(p),
      isAdmin: p.isAdmin,
      lastSavedAt: p.lastSavedAt,
      walletSen: p.walletSen,
      shards: p.shards,
      inventory: p.inventory,
      equipped: p.equipped,
      index: [...p.index],
      pagesClaimed: [...p.pages],
      pity: p.pity,
      jobs: p.jobs,
      job,
      skills: p.skills,
      hotbar: p.hotbar,
      vehicles: this.vehiclesOf(p),
    };
  }
}
