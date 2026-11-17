// DB backups via SQLite's online backup API (safe while the game is running in WAL mode).
// Files are named game-YYYYMMDD-HHmmss.db so sorting by name = sorting by age.
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/db';

const BACKUP_RE = /^game-\d{8}-\d{6}(-\d+)?\.db$/;

function stamp(d = new Date()): string {
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function backupDatabase(db: DB, dir: string, keep: number): Promise<string> {
  fs.mkdirSync(dir, { recursive: true });
  const base = `game-${stamp()}`;
  let file = path.join(dir, `${base}.db`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${base}-${i}.db`);
  await db.backup(file);
  rotateBackups(dir, keep);
  return file;
}

/** Deletes the oldest backups so only `keep` remain. Returns the deleted file names. */
export function rotateBackups(dir: string, keep: number): string[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => BACKUP_RE.test(f)).sort();
  const remove = files.slice(0, Math.max(0, files.length - keep));
  for (const f of remove) fs.rmSync(path.join(dir, f), { force: true });
  return remove;
}
