// 🐞 In-game bug reports, suggestions and feedback. Players write a note; the server stores it
// with who sent it and where they were (taken from the server's own state, not the client's),
// plus what the client saw (district, screen size, device, recent script errors). The host reads
// them in the in-game inbox (admins) or with `npm run admin -- feedback`.
import type { FeedbackKind } from '@kh/shared';
import { RateLimiter } from '../../auth/rateLimit';
import type { Repos } from '../../db/repos';

/** Spam guards (not game balance, so they live here rather than in /shared/config). */
export const FEEDBACK_LIMITS = { perMinute: 3, perDay: 40 };

/** Drops control characters (keeps line breaks and tabs) and squeezes long runs of blank lines. */
export function cleanFeedbackText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export interface FeedbackSender {
  id: number;
  name: string;
  scene: string;
  x: number;
  y: number;
  interior: string | null;
  walletSen: number;
  prog: { level: number; stage: number };
}

export interface FeedbackClientInfo {
  district?: string;
  screen?: string;
  device?: string;
  errors?: string[];
}

export type FeedbackResult = { ok: true; id: number } | { ok: false; error: string };

export class FeedbackDesk {
  private burst: RateLimiter;

  constructor(
    private repos: Repos,
    private tileSize: number,
    private now: () => number = Date.now,
  ) {
    this.burst = new RateLimiter(FEEDBACK_LIMITS.perMinute, 60_000, now);
  }

  send(p: FeedbackSender, kind: FeedbackKind, rawText: string, client: FeedbackClientInfo): FeedbackResult {
    const text = cleanFeedbackText(rawText);
    if (text.length < 5) return { ok: false, error: 'Write a little more so we know what happened.' };
    const t = this.now();
    if (this.repos.feedback.countSince(p.id, t - 86_400_000) >= FEEDBACK_LIMITS.perDay) return { ok: false, error: "That's a lot of reports today. Thank you! Try again tomorrow." };
    if (!this.burst.hit(String(p.id))) return { ok: false, error: `Slow down a little: try again in ${Math.ceil(this.burst.retryAfter(String(p.id)) / 1000)} s.` };
    const T = this.tileSize;
    const context: Record<string, unknown> = {
      scene: p.scene,
      tile: { x: Math.round(p.x / T), y: Math.round(p.y / T) },
      ...(p.interior ? { interior: p.interior } : {}),
      level: p.prog.level,
      stage: p.prog.stage,
      walletSen: p.walletSen,
      ...client,
    };
    const id = this.repos.feedback.add(p.id, p.name, kind, text, context, t);
    return { ok: true, id };
  }
}
