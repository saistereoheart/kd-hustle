// npm run admin -- <command>
//   list                         show every account and who is admin
//   promote <username>           make an account admin (takes effect when they refresh)
//   demote <username>            remove admin
//   password <username> [new]    reset a password (a random one is generated if you leave it out);
//                                logs that account out everywhere
// Works while the server is running (SQLite WAL), but stopping it first is safest.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcrypt';
import { openDatabase } from '../server/src/db/db';
import { createRepos } from '../server/src/db/repos';
import { getPaths } from '../server/src/paths';
import '../server/src/env';

const paths = getPaths();
const auth = JSON.parse(fs.readFileSync(path.join(paths.sharedConfig, 'auth.json'), 'utf8')) as {
  bcryptCost: number;
  passwordMin: number;
  passwordMax: number;
};
const dbFile = path.join(paths.dataDir, 'game.db');
if (!fs.existsSync(dbFile)) {
  console.error(`No database at ${dbFile}. Start the server once (npm run dev) to create it.`);
  process.exit(1);
}
const db = openDatabase(dbFile);
const repos = createRepos(db);
const [cmd, name, arg] = process.argv.slice(2);

function account() {
  if (!name) fail('Give a username.');
  const row = repos.accounts.byName(name);
  if (!row) fail(`No account called "${name}". Try: npm run admin -- list`);
  return row;
}
function fail(msg: string): never {
  console.error(msg);
  db.close();
  process.exit(1);
}

switch (cmd) {
  case 'list': {
    const rows = db.prepare('SELECT id, username, is_admin FROM accounts ORDER BY id').all() as Array<{ id: number; username: string; is_admin: number }>;
    if (!rows.length) console.log('No accounts yet.');
    for (const r of rows) console.log(`${String(r.id).padStart(4)}  ${r.username.padEnd(16)} ${r.is_admin ? '★ admin' : ''}`);
    break;
  }
  case 'promote':
  case 'demote': {
    const row = account();
    db.prepare('UPDATE accounts SET is_admin = ? WHERE id = ?').run(cmd === 'promote' ? 1 : 0, row.id);
    console.log(`${row.username} is ${cmd === 'promote' ? 'now an admin' : 'no longer an admin'}. They need to refresh the game.`);
    break;
  }
  case 'password': {
    const row = account();
    const pw = arg ?? crypto.randomBytes(6).toString('base64url');
    if (pw.length < auth.passwordMin || pw.length > auth.passwordMax) fail(`Password must be ${auth.passwordMin}–${auth.passwordMax} characters.`);
    db.transaction(() => {
      db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(pw, auth.bcryptCost), row.id);
      db.prepare('DELETE FROM sessions WHERE account_id = ?').run(row.id);
    })();
    console.log(`Password for ${row.username} reset. New password: ${pw}`);
    console.log('They have been logged out everywhere; log in again with the new password.');
    break;
  }
  default:
    console.log('Usage: npm run admin -- list | promote <user> | demote <user> | password <user> [newPassword]');
}
db.close();
