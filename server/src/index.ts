import './env';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { AuthService } from './auth/authService';
import { backupDatabase } from './backup/backup';
import { loadConfig, toPublicConfig } from './config/loadConfig';
import { musicDirOf } from './game/musicHandlers';
import { openDatabase } from './db/db';
import { createRepos } from './db/repos';
import { attachGame, type GameIO } from './game/gameServer';
import { World } from './game/world';
import { createHttpApp, errorHandler } from './http/app';
import { log } from './log';
import { lanAddresses } from './net/lanUrls';
import { isPortFree } from './net/ports';
import { getPaths } from './paths';
import { SaveManager } from './save/saveManager';

const isDev = process.env.NODE_ENV !== 'production';

async function main() {
  const paths = getPaths();
  const port = Number(process.env.PORT) || 3000;

  const cfg = loadConfig(paths.sharedConfig, paths.mapDir);
  const dbFile = path.join(paths.dataDir, 'game.db');
  const db = openDatabase(dbFile);
  const repos = createRepos(db);

  // Backup on start (and every N hours below).
  try {
    const file = await backupDatabase(db, paths.backupDir, cfg.save.backupsToKeep);
    log.info(`Backup written: ${path.relative(paths.root, file)}`);
  } catch (err) {
    log.warn('Startup backup failed', err);
  }

  const auth = new AuthService(repos, cfg.auth, {
    adminUsername: process.env.ADMIN_USERNAME?.trim() || undefined,
    spawn: cfg.map.spawnPx,
    mapVersion: cfg.map.overrides.version,
    startingWalletSen: cfg.economy.startingWalletSen,
  });
  const world = new World();
  const saves = new SaveManager(repos, world);

  const app = createHttpApp({ auth, cfg, publicConfig: toPublicConfig(cfg) });
  // The shared radio's music files (your own, in one folder per genre; never in the repo).
  app.use('/music', express.static(musicDirOf(cfg), { maxAge: '1h', fallthrough: false }));
  const server = http.createServer(app);
  const io: GameIO = new Server(server, { serveClient: false, destroyUpgrade: false });
  const game = attachGame(io, { cfg, auth, repos, world, saves });

  // Client: Vite middleware in dev (one port, HMR works from phones), static build in prod.
  let closeVite: (() => Promise<void>) | undefined;
  if (isDev) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: path.join(paths.clientRoot, 'vite.config.ts'),
      root: paths.clientRoot,
      server: { middlewareMode: true, ws: { server } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    closeVite = () => vite.close();
  } else {
    const index = path.join(paths.clientDist, 'index.html');
    if (!fs.existsSync(index)) log.warn('client/dist not found. Run "npm run build" first.');
    app.use(express.static(paths.clientDist, { maxAge: '1h', index: 'index.html' }));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && fs.existsSync(index)) res.sendFile(index);
      else next();
    });
  }
  app.use(errorHandler);

  saves.start(cfg.save.autosaveIntervalMs);
  const backupTimer = setInterval(() => {
    backupDatabase(db, paths.backupDir, cfg.save.backupsToKeep)
      .then((f) => log.info(`Backup written: ${path.basename(f)}`))
      .catch((err) => log.warn('Scheduled backup failed', err));
  }, cfg.save.backupIntervalMs);

  // Bind to 0.0.0.0 so phones on the LAN can connect. If PORT isn't set in .env and 3000
  // is taken by another program, try the next few ports instead of crashing.
  const portFixed = Boolean(process.env.PORT);
  let boundPort = port;
  for (let attempt = 0; ; attempt++) {
    try {
      if (!(await isPortFree(boundPort))) {
        throw Object.assign(new Error('busy'), { code: 'EADDRINUSE' });
      }
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(boundPort, '0.0.0.0', () => {
          server.off('error', reject);
          resolve();
        });
      });
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' || portFixed || attempt >= 10) {
        if (code === 'EADDRINUSE') {
          throw new Error(`Port ${boundPort} is already in use by another program. Close it or set PORT=<number> in .env.`);
        }
        throw err;
      }
      log.warn(`Port ${boundPort} is busy (another program is using it). Trying ${boundPort + 1}...`);
      boundPort++;
    }
  }

  const addrs = lanAddresses();
  console.log('');
  console.log(`  Kota Hustle server running (${isDev ? 'development' : 'production'})`);
  console.log(`  Local:            http://localhost:${boundPort}`);
  if (addrs.length === 0) console.log('  No LAN address found. Are you connected to WiFi?');
  for (const a of addrs) {
    const label = a.likely ? 'Players join at:' : a.overlay ? 'Remote players: ' : 'Also try:       ';
    console.log(`  ${label}  http://${a.address}:${boundPort}   (${a.name})`);
  }
  if (addrs.some((a) => a.overlay)) console.log('  Remote players must be members of the same ZeroTier/Tailscale network (see README).');
  console.log('  Phones can\'t connect? Allow Node.js through Windows Firewall on Private networks.');
  console.log('');

  // --- graceful shutdown: save everyone, then exit (save trigger 4) -------------------
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received: saving and shutting down...`);
    const force = setTimeout(() => process.exit(1), 5000);
    try {
      saves.stop();
      clearInterval(backupTimer);
      game.stop();
      const n = saves.saveAll();
      log.info(`Saved ${n} online player(s).`);
      io.close();
      await closeVite?.();
      server.close();
      db.close();
    } catch (err) {
      log.error('Error during shutdown', err);
    }
    clearTimeout(force);
    process.exit(0);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
    process.on(sig, () => void shutdown(sig));
  }
  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', err);
    try {
      saves.saveAll();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
