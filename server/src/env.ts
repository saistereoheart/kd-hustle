// Loads .env from the repo root. Imported first by index.ts so env vars exist before
// anything else reads them.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ROOT } from './paths';

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

// Started straight from the build (`node server/dist/index.js`, start.cmd) with no NODE_ENV:
// that's production. (No npm / cross-env processes in between: they cost ~80 MB of memory.)
if (!process.env.NODE_ENV && /[\\/]dist[\\/]/.test(fileURLToPath(import.meta.url))) process.env.NODE_ENV = 'production';
