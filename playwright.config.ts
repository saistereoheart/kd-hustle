import { defineConfig } from '@playwright/test';

// `npm run e2e` starts its own server on port 3101 with a throwaway database in
// test-results/, so it never touches your real save data.
const port = 3101;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  outputDir: 'test-results/e2e-artifacts',
  reporter: 'list',
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // Starts from an empty database every run (stall plots etc. don't pile up between runs).
        command: `node -e "require('fs').rmSync('test-results/e2e-data',{recursive:true,force:true})" && npx cross-env NODE_ENV=development KH_TEST_ALL_ADMIN=1 PORT=${port} KH_DATA_DIR=test-results/e2e-data KH_BACKUP_DIR=test-results/e2e-backups tsx server/src/index.ts`,
        url: `http://localhost:${port}/api/health`,
        reuseExistingServer: false,
        timeout: 90_000,
      },
});
