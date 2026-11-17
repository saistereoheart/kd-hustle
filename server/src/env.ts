// Loads .env from the repo root. Imported first by index.ts so env vars exist before
// anything else reads them.
import path from 'node:path';
import dotenv from 'dotenv';
import { ROOT } from './paths';

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
