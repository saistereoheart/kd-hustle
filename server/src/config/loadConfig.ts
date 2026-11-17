// Loads and validates every balance/config JSON at startup. Files are read from disk (not
// bundled) so they can be tweaked without rebuilding; restart the server to apply.
import fs from 'node:fs';
import path from 'node:path';
import type { ZodType } from 'zod';
import {
  authConfigSchema, buildMap, characterConfigSchema, chatConfigSchema, mapLayoutSchema, movementConfigSchema,
  netConfigSchema, saveConfigSchema,
  type AuthConfig, type BuiltMap, type CharacterConfig, type ChatConfig, type MapLayout, type MovementConfig,
  type NetConfig, type PublicConfig, type SaveConfig,
} from '@kh/shared';

export interface ServerConfig {
  character: CharacterConfig;
  movement: MovementConfig;
  net: NetConfig;
  chat: ChatConfig;
  auth: AuthConfig;
  save: SaveConfig;
  mapLayout: MapLayout;
  map: BuiltMap;
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

export function loadConfig(configDir: string, mapFile: string): ServerConfig {
  const j = (name: string) => path.join(configDir, name);
  const mapLayout = readJson(mapFile, mapLayoutSchema) as MapLayout;
  return {
    character: readJson(j('character.json'), characterConfigSchema),
    movement: readJson(j('movement.json'), movementConfigSchema),
    net: readJson(j('net.json'), netConfigSchema),
    chat: readJson(j('chat.json'), chatConfigSchema),
    auth: readJson(j('auth.json'), authConfigSchema),
    save: readJson(j('save.json'), saveConfigSchema),
    mapLayout,
    map: buildMap(mapLayout),
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
    map: cfg.mapLayout,
  };
}
