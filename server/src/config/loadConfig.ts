// Loads and validates every balance/config JSON at startup. Files are read from disk (not
// bundled) so they can be tweaked without rebuilding; restart the server to apply.
import fs from 'node:fs';
import path from 'node:path';
import type { ZodType } from 'zod';
import {
  authConfigSchema, buildMap, gradesConfigSchema, characterConfigSchema, chatConfigSchema, movementConfigSchema, netConfigSchema,
  osmMapDataSchema, overridesSchema, saveConfigSchema, terrainConfigSchema,
  cratesConfigSchema, economyConfigSchema, itemsConfigSchema, jobsConfigSchema, raritiesConfigSchema, validateEconomyConfigs,
  vehiclesConfigSchema, ridesConfigSchema, type RidesConfig,
  upgradesConfigSchema, levelsConfigSchema, stagesConfigSchema, titlesConfigSchema, questsConfigSchema, goalsConfigSchema,
  validateProgressionConfigs, type ProgCfg, type UpgradesConfig, type LevelsConfig, type StagesConfig, type TitlesConfig,
  type QuestsConfig, type GoalsConfig,
  timeConfigSchema, recipesConfigSchema, stallsConfigSchema, type TimeConfig, type RecipesConfig, type StallsConfig, type RecipeDef,
  interiorsConfigSchema, type InteriorsConfig, guideConfigSchema, type GuideConfig, npcsConfigSchema, type NpcsConfig, furnitureConfigSchema, propertiesConfigSchema, type FurnitureConfig, type PropertiesConfig,
  businessesConfigSchema, loansConfigSchema, casinoConfigSchema, musicConfigSchema, eventsConfigSchema, type EventsConfig, marketConfigSchema, type MarketConfig, rebirthConfigSchema, type RebirthConfig, type BusinessesConfig, type LoansConfig, type CasinoConfig, type MusicConfig,
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
  businesses: BusinessesConfig;
  loans: LoansConfig;
  casino: CasinoConfig;
  music: MusicConfig;
  events: EventsConfig;
  market: MarketConfig;
  rebirth: RebirthConfig;
  recipeById: Map<string, RecipeDef>;
  /** The configs progression needs, in one bundle (shared with the client's maths). */
  prog: ProgCfg;
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
  // An item's home crate (event crates reuse items; they don't change what an item is worth).
  for (const c of crates.crates) if (!c.event) for (const id of c.pool) crateOfItem.set(id, c);
  const economy = readJson(j('economy.json'), economyConfigSchema);
  const itemById = new Map(items.items.map((i) => [i.id, i]));
  const prog: ProgCfg = {
    rarities, items, itemById, crates, crateOfItem, pawnRate: economy.pawnRate, grades: readJson(j('grades.json'), gradesConfigSchema),
    levels: readJson(j('levels.json'), levelsConfigSchema),
    stages: readJson(j('stages.json'), stagesConfigSchema),
    titles: readJson(j('titles.json'), titlesConfigSchema),
    upgrades: readJson(j('upgrades.json'), upgradesConfigSchema),
    quests: readJson(j('quests.json'), questsConfigSchema),
    goals: readJson(j('goals.json'), goalsConfigSchema),
  };
  const time = readJson(j('time.json'), timeConfigSchema);
  const recipes = readJson(j('recipes.json'), recipesConfigSchema);
  const stalls = readJson(j('stalls.json'), stallsConfigSchema);
  const recipeById = new Map(recipes.recipes.map((r) => [r.id, r]));
  for (const r of recipes.recipes) if (r.unlock && !recipeById.has(r.unlock.recipe)) throw new Error(`recipes.json: ${r.id} unlocks from unknown recipe ${r.unlock.recipe}`);
  const furniture = readJson(j('furniture.json'), furnitureConfigSchema);
  for (const id of Object.keys(furniture.pieces)) {
    const def = itemById.get(id);
    if (!def || def.type !== 'furniture') throw new Error(`furniture.json: ${id} must be an item of type "furniture" in items.json`);
  }
  const progProblems = validateProgressionConfigs(prog);
  if (progProblems.length) throw new Error(`Invalid progression config:\n  - ${progProblems.slice(0, 8).join('\n  - ')}`);
  return {
    rarities,
    items,
    crates,
    economy,
    jobs: readJson(j('jobs.json'), jobsConfigSchema),
    vehicles: readJson(j('vehicles.json'), vehiclesConfigSchema),
    rides: readJson(j('rides.json'), ridesConfigSchema),
    upgrades: prog.upgrades,
    levels: prog.levels,
    stages: prog.stages,
    titles: prog.titles,
    quests: prog.quests,
    goals: prog.goals,
    time,
    recipes,
    stalls,
    interiors: readJson(j('interiors.json'), interiorsConfigSchema),
    guide: readJson(j('guide.json'), guideConfigSchema),
    npcs: readJson(j('npcs.json'), npcsConfigSchema),
    furniture,
    properties: readJson(j('properties.json'), propertiesConfigSchema),
    businesses: readJson(j('businesses.json'), businessesConfigSchema),
    loans: readJson(j('loans.json'), loansConfigSchema),
    casino: readJson(j('casino.json'), casinoConfigSchema),
    music: readJson(j('music.json'), musicConfigSchema),
    events: readJson(j('events.json'), eventsConfigSchema),
    market: readJson(j('market.json'), marketConfigSchema),
    rebirth: readJson(j('rebirth.json'), rebirthConfigSchema),
    recipeById,
    prog,
    itemById,
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
    grades: cfg.prog.grades,
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
    rides: cfg.rides,
    upgrades: cfg.upgrades,
    levels: cfg.levels,
    stages: cfg.stages,
    titles: cfg.titles,
    quests: cfg.quests,
    goals: cfg.goals,
    time: cfg.time,
    recipes: cfg.recipes,
    stalls: cfg.stalls,
    interiors: cfg.interiors,
    guide: cfg.guide,
    npcs: cfg.npcs,
    furniture: cfg.furniture,
    properties: cfg.properties,
    businesses: cfg.businesses,
    loans: cfg.loans,
    casino: cfg.casino,
    music: cfg.music,
    events: cfg.events,
    market: cfg.market,
    rebirth: cfg.rebirth,
  };
}
