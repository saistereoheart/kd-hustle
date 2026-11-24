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
    mapDir: path.join(ROOT, 'shared', 'map'),
    clientRoot: path.join(ROOT, 'client'),
    // (Tests can serve a client built somewhere else, so a running game's build is left alone.)
    clientDist: path.resolve(ROOT, process.env.KH_CLIENT_DIST || 'client/dist'),
    dataDir: path.resolve(ROOT, process.env.KH_DATA_DIR || 'server/data'),
    // A test server with its own data dir backs up inside it, never into the real backups (whose
    // rotation would then delete real ones).
    backupDir: path.resolve(ROOT, process.env.KH_BACKUP_DIR || (process.env.KH_DATA_DIR ? path.join(process.env.KH_DATA_DIR, 'backups') : 'server/backups')),
  };
}
