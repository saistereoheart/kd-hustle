// npm run backup: copy the live DB to server/backups/ with a timestamp (keeps the newest N).
// Safe to run while the server is running (uses SQLite's online backup API).
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { backupDatabase } from '../server/src/backup/backup';
import { getPaths } from '../server/src/paths';
import '../server/src/env';

const paths = getPaths();
const dbFile = path.join(paths.dataDir, 'game.db');
if (!fs.existsSync(dbFile)) {
  console.log(`No database yet at ${path.relative(paths.root, dbFile)}. Start the server once first.`);
  process.exit(0);
}
const keep = JSON.parse(fs.readFileSync(path.join(paths.sharedConfig, 'save.json'), 'utf8')).backupsToKeep ?? 14;
const db = new Database(dbFile, { readonly: true, fileMustExist: true });
const file = await backupDatabase(db, paths.backupDir, keep);
db.close();
console.log(`Backup written: ${path.relative(paths.root, file)} (keeping the newest ${keep})`);
