// Loads and validates every balance/config JSON at startup. Files are read from disk (not
// bundled) so they can be tweaked without rebuilding; restart the server to apply.
import fs from 'node:fs';
import path from 'node:path';
import type { ZodType } from 'zod';
import {
  authConfigSchema, buildMap, characterConfigSchema, chatConfigSchema, movementConfigSchema, netConfigSchema,
  osmMapDataSchema, overridesSchema, saveConfigSchema, terrainConfigSchema,
  cratesConfigSchema, economyConfigSchema, itemsConfigSchema, jobsConfigSchema, raritiesConfigSchema, validateEconomyConfigs,
  vehiclesConfigSchema, skillsConfigSchema, type SkillsConfig,
  type CrateDef, type CratesConfig, type EconomyConfig, type ItemDef, type ItemsConfig, type JobsConfig,
  type RaritiesConfig, type VehiclesConfig,
  type AuthConfig, type BuiltMap, type CharacterConfig, type ChatConfig, type MapSource, type MovementConfig,
  type NetConfig, type PublicConfig, type SaveConfig, type TerrainConfig,
} from '@kh/shared';

export interface ServerConfig {
  character: CharacterConfig;
  movement: MovementConfig;
  net: NetConfig;
  chat: ChatConfig;
  auth: AuthConfig;
  save: SaveConfig;
  terrain: TerrainConfig;
  mapSource: MapSource;
  map: BuiltMap;
  rarities: RaritiesConfig;
  items: ItemsConfig;
  crates: CratesConfig;
  economy: EconomyConfig;
  jobs: JobsConfig;
  vehicles: VehiclesConfig;
  skills: SkillsConfig;
  /** Lookups built from the configs above. */
  itemById: Map<string, ItemDef>;
  crateById: Map<string, CrateDef>;
  crateOfItem: Map<string, CrateDef>;
}

function readJson<T>(file: string, schema: ZodType<T>): T {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read config ${file}: ${(err as Error).message}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid config ${path.basename(file)}:\n${issues}`);
  }
  return parsed.data;
}

export function loadConfig(configDir: string, mapDir: string): ServerConfig {
  const j = (name: string) => path.join(configDir, name);
  const terrain = readJson(j('terrain.json'), terrainConfigSchema);
  // Keep the raw JSON for clients (schema defaults are re-applied by buildMap on both sides).
  const mapSource: MapSource = {
    data: readJson(path.join(mapDir, 'kd.osm.json'), osmMapDataSchema),
    overrides: JSON.parse(fs.readFileSync(path.join(mapDir, 'town.overrides.json'), 'utf8')),
  };
  readJson(path.join(mapDir, 'town.overrides.json'), overridesSchema); // validate
  const rarities = readJson(j('rarities.json'), raritiesConfigSchema);
  const items = readJson(j('items.json'), itemsConfigSchema);
  const crates = readJson(j('crates.json'), cratesConfigSchema);
  const problems = validateEconomyConfigs(rarities, items, crates);
  if (problems.length) throw new Error(`Invalid economy config:\n  - ${problems.slice(0, 8).join('\n  - ')}`);
  const crateOfItem = new Map<string, CrateDef>();
  for (const c of crates.crates) for (const id of c.pool) crateOfItem.set(id, c);
  return {
    rarities,
    items,
    crates,
    economy: readJson(j('economy.json'), economyConfigSchema),
    jobs: readJson(j('jobs.json'), jobsConfigSchema),
    vehicles: readJson(j('vehicles.json'), vehiclesConfigSchema),
    skills: readJson(j('skills.json'), skillsConfigSchema),
    itemById: new Map(items.items.map((i) => [i.id, i])),
    crateById: new Map(crates.crates.map((c) => [c.id, c])),
    crateOfItem,
    character: readJson(j('character.json'), characterConfigSchema),
    movement: readJson(j('movement.json'), movementConfigSchema),
    net: readJson(j('net.json'), netConfigSchema),
    chat: readJson(j('chat.json'), chatConfigSchema),
    auth: readJson(j('auth.json'), authConfigSchema),
    save: readJson(j('save.json'), saveConfigSchema),
    terrain,
    mapSource,
    map: buildMap(mapSource, terrain),
  };
}

export function toPublicConfig(cfg: ServerConfig): PublicConfig {
  return {
    character: cfg.character,
    movement: cfg.movement,
    net: cfg.net,
    chat: cfg.chat,
    save: { autosaveIntervalMs: cfg.save.autosaveIntervalMs },
    auth: { username: cfg.auth.username, passwordMin: cfg.auth.passwordMin, passwordMax: cfg.auth.passwordMax },
    terrain: cfg.terrain,
    map: cfg.mapSource,
    rarities: cfg.rarities,
    items: cfg.items,
    crates: cfg.crates,
    economy: cfg.economy,
    jobs: cfg.jobs,
    vehicles: cfg.vehicles,
    skills: cfg.skills,
  };
}
