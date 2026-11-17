import compression from 'compression';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { PublicConfig } from '@kh/shared';
import type { AuthService } from '../auth/authService';
import { RateLimiter } from '../auth/rateLimit';
import type { ServerConfig } from '../config/loadConfig';

export function createHttpApp(deps: { auth: AuthService; cfg: ServerConfig; publicConfig: PublicConfig }) {
  const { auth, cfg, publicConfig } = deps;
  const loginLimiter = new RateLimiter(cfg.auth.loginRateLimit.count, cfg.auth.loginRateLimit.windowMs);
  const registerLimiter = new RateLimiter(cfg.auth.registerRateLimit.count, cfg.auth.registerRateLimit.windowMs);

  const app = express();
  app.disable('x-powered-by');
  app.use(compression()); // the map JSON is a few hundred KB; gzip makes phone joins faster
  app.use('/api', express.json({ limit: '32kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/config/public', (_req, res) => {
    res.json(publicConfig);
  });

  const ipOf = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown';

  app.post('/api/register', async (req, res, next) => {
    try {
      if (!registerLimiter.hit(ipOf(req))) {
        res.status(429).json({ ok: false, error: 'Too many sign-ups from this device. Try again in a minute.' });
        return;
      }
      const result = await auth.register(req.body);
      res.status(result.ok ? 200 : 400).json(result.ok ? { ok: true, token: result.token, username: result.account.username } : result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/login', async (req, res, next) => {
    try {
      const ip = ipOf(req);
      if (!loginLimiter.hit(ip)) {
        const secs = Math.ceil(loginLimiter.retryAfter(ip) / 1000);
        res.status(429).json({ ok: false, error: `Too many login attempts. Try again in ${secs}s.` });
        return;
      }
      const result = await auth.login(req.body);
      res.status(result.ok ? 200 : 401).json(result.ok ? { ok: true, token: result.token, username: result.account.username } : result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/logout', (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (token) auth.logout(token);
    res.json({ ok: true });
  });

  return app;
}

/** Final error handler: bad JSON → 400, everything else → 500 without leaking details. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ ok: false, error: 'Bad request' });
    return;
  }
  console.error(err);
  res.status(500).json({ ok: false, error: 'Server error' });
}
