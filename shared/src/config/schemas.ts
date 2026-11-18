// Zod schemas for every JSON file in /shared/config. The server validates config at
// startup and refuses to boot if a balance file is malformed.
import { z } from 'zod';
import type { MapSource } from '../map/types';
import type { CratesConfig, EconomyConfig, ItemsConfig, JobsConfig, RaritiesConfig, RidesConfig, VehiclesConfig } from '../economy/schemas';
import type { GoalsConfig, LevelsConfig, QuestsConfig, StagesConfig, TitlesConfig, UpgradesConfig } from '../progression/schemas';
import type { TimeConfig } from '../time/clock';
import type { RecipesConfig } from '../cooking/cooking';
import type { StallsConfig } from '../cooking/stall';
import type { InteriorsConfig } from '../world/interiors';
import type { GuideConfig } from '../world/guide';
import type { NpcsConfig } from '../world/npcs';
import type { FurnitureConfig, PropertiesConfig } from '../property/schemas';

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb colour');

const option = z.object({ id: z.string().min(1).max(32), name: z.string().min(1) });

export const characterConfigSchema = z.object({
  skinTones: z.array(hexColor).min(1),
  faceShapes: z.array(option).min(1),
  heights: z.array(option.extend({ scale: z.number().positive() })).min(1),
  builds: z.array(option.extend({ width: z.number().positive() })).min(1),
  eyes: z.array(option).min(1),
  eyebrows: z.array(option).min(1),
  noses: z.array(option).min(1),
  mouths: z.array(option).min(1),
  glasses: z.array(option).min(1),
  hair: z.array(option).min(1),
  headwear: z.array(option.extend({ coversHair: z.boolean() })).min(1),
  facialHair: z.array(option).min(1),
  tops: z.array(option).min(1),
  bottoms: z.array(option).min(1),
  shoes: z.array(option).min(1),
  palettes: z.object({
    hair: z.array(hexColor).min(1),
    eyes: z.array(hexColor).min(1),
    clothes: z.array(hexColor).min(1),
  }),
});
export type CharacterConfig = z.infer<typeof characterConfigSchema>;

const rateLimit = z.object({ count: z.number().int().positive(), windowMs: z.number().int().positive() });

export const movementConfigSchema = z.object({
  /** Walking speed in world pixels per second. */
  walkSpeed: z.number().positive(),
  /** Multiplier on walkSpeed the server tolerates (network jitter). */
  speedTolerance: z.number().min(1),
  /** Extra pixels always allowed per move message (bursty packets). */
  slackPx: z.number().nonnegative(),
  /** Max seconds of unused movement a player can "bank" (prevents teleport after idling). */
  maxBudgetSeconds: z.number().positive(),
  /** Collision box at the character's feet, in pixels. */
  hitbox: z.object({ w: z.number().positive(), h: z.number().positive() }),
  /** How often the client sends its position. */
  sendRateHz: z.number().positive(),
});
export type MovementConfig = z.infer<typeof movementConfigSchema>;

export const netConfigSchema = z.object({
  snapshotRateHz: z.number().positive(),
  interpolationDelayMs: z.number().nonnegative(),
  /** A dropped connection keeps you in the world this long (server) and the game on screen
   *  (client) while it reconnects; after that you're back at the start screen. */
  reconnectGraceMs: z.number().int().nonnegative().default(20_000),
});
export type NetConfig = z.infer<typeof netConfigSchema>;

export const chatConfigSchema = z.object({
  maxLength: z.number().int().positive(),
  historySize: z.number().int().positive(),
  bubbleMs: z.number().int().positive(),
  rateLimit,
  /** Emotes are spammable within this burst limit (per player). */
  emoteRateLimit: rateLimit,
  emotes: z
    .array(
      z.object({
        id: z.string().min(1).max(32),
        name: z.string(),
        emoji: z.string(),
        /** Continuous emotes keep playing until the player moves or stops them. */
        loop: z.boolean(),
        /** How long a one-shot emote plays. */
        durationMs: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});
export type ChatConfig = z.infer<typeof chatConfigSchema>;

export const authConfigSchema = z.object({
  bcryptCost: z.number().int().min(4).max(15),
  tokenBytes: z.number().int().min(16),
  username: z.object({ min: z.number().int(), max: z.number().int(), pattern: z.string() }),
  passwordMin: z.number().int().positive(),
  passwordMax: z.number().int().positive(),
  loginRateLimit: rateLimit,
  registerRateLimit: rateLimit,
});
export type AuthConfig = z.infer<typeof authConfigSchema>;

export const saveConfigSchema = z.object({
  autosaveIntervalMs: z.number().int().positive(),
  backupIntervalMs: z.number().int().positive(),
  backupsToKeep: z.number().int().positive(),
});
export type SaveConfig = z.infer<typeof saveConfigSchema>;

const terrainEntry = z.object({ walk: z.number().min(0), vehicle: z.number().min(0) });
export const terrainConfigSchema = z.object({
  laneWidthMeters: z.number().positive(),
  sidewalkWidthMeters: z.number().positive(),
  highwayShoulderMeters: z.number().nonnegative(),
  /** Narrow roads are drawn at least this wide (OSM gives 1-lane back lanes at 3.5 m, which feels cramped). */
  minRoadWidthMeters: z.record(z.string(), z.number().positive()).default({}),
  /** Speed multipliers per terrain (0 = blocked). Keys must match TERRAIN_NAMES. */
  terrains: z.record(z.string(), terrainEntry),
});
export type TerrainConfig = z.infer<typeof terrainConfigSchema>;

/** Everything the client needs; served by GET /api/config/public. */
export interface PublicConfig {
  character: CharacterConfig;
  movement: MovementConfig;
  net: NetConfig;
  chat: ChatConfig;
  save: Pick<SaveConfig, 'autosaveIntervalMs'>;
  auth: Pick<AuthConfig, 'username' | 'passwordMin' | 'passwordMax'>;
  terrain: TerrainConfig;
  map: MapSource;
  rarities: RaritiesConfig;
  items: ItemsConfig;
  crates: CratesConfig;
  economy: EconomyConfig;
  jobs: JobsConfig;
  vehicles: VehiclesConfig;
  rides: RidesConfig;
  upgrades: UpgradesConfig;
  levels: LevelsConfig;
  stages: StagesConfig;
  titles: TitlesConfig;
  quests: QuestsConfig;
  goals: GoalsConfig;
  time: TimeConfig;
  recipes: RecipesConfig;
  stalls: StallsConfig;
  interiors: InteriorsConfig;
  guide: GuideConfig;
  npcs: NpcsConfig;
  furniture: FurnitureConfig;
  properties: PropertiesConfig;
}

