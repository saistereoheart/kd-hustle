// npm run seed: creates test accounts (password "test123") with random characters.
// Run while the server is STOPPED, or restart it afterwards.
import path from 'node:path';
import bcrypt from 'bcrypt';
import { characterConfigSchema, mapLayoutSchema, buildMap, randomAppearance } from '../shared/src/index';
import { openDatabase } from '../server/src/db/db';
import { createRepos } from '../server/src/db/repos';
import { getPaths } from '../server/src/paths';
import fs from 'node:fs';
import '../server/src/env';

const paths = getPaths();
const readJson = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const character = characterConfigSchema.parse(readJson(path.join(paths.sharedConfig, 'character.json')));
const map = buildMap(mapLayoutSchema.parse(readJson(paths.mapFile)));
const db = openDatabase(path.join(paths.dataDir, 'game.db'));
const repos = createRepos(db);
const hash = bcrypt.hashSync('test123', 10);

for (const name of ['tester1', 'tester2', 'tester3', 'tester4']) {
  if (repos.accounts.byName(name)) {
    console.log(`= ${name} already exists`);
    continue;
  }
  const id = repos.accounts.create(name, hash, false, map.spawnPx);
  repos.players.saveMany([{ accountId: id, appearance: randomAppearance(character), hasCharacter: true, scene: 'town', x: map.spawnPx.x + Math.random() * 64 - 32, y: map.spawnPx.y, dir: 'down', lastSavedAt: null }]);
  console.log(`+ ${name} / test123`);
}
db.close();
