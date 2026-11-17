// Resolve repo paths from this file's location. Works both from source (server/src) and
// from the production bundle (server/dist) because both are two levels below the root.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');

export function getPaths() {
  return {
    root: ROOT,
    sharedConfig: path.join(ROOT, 'shared', 'config'),
    mapFile: path.join(ROOT, 'shared', 'map', 'town.json'),
    clientRoot: path.join(ROOT, 'client'),
    clientDist: path.join(ROOT, 'client', 'dist'),
    dataDir: path.resolve(ROOT, process.env.KH_DATA_DIR || 'server/data'),
    backupDir: path.resolve(ROOT, process.env.KH_BACKUP_DIR || 'server/backups'),
  };
}
