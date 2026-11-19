// 🐞 In-game bug reports, suggestions and feedback. Players write a note; the server stores it
// with who sent it and where they were (taken from the server's own state, not the client's),
// plus what the client saw (district, screen size, device, recent script errors). The host reads
// them in the in-game inbox (admins) or with `npm run admin -- feedback`.
import fs from 'node:fs';
import path from 'node:path';
import type { FeedbackKind } from '@kh/shared';
import { log } from '../../log';
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
    /** Where attached pictures are saved (next to the database; never committed). */
    private imageDir: string | null = null,
  ) {
    this.burst = new RateLimiter(FEEDBACK_LIMITS.perMinute, 60_000, now);
  }

  send(p: FeedbackSender, kind: FeedbackKind, rawText: string, client: FeedbackClientInfo, image?: string): FeedbackResult {
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
    const pic = image ? /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(image) : null;
    if (pic && this.imageDir) context.image = pic[1] === 'jpeg' ? 'jpg' : pic[1];
    const id = this.repos.feedback.add(p.id, p.name, kind, text, context, t);
    if (pic && this.imageDir) {
      try {
        fs.mkdirSync(this.imageDir, { recursive: true });
        fs.writeFileSync(this.imagePath(id, context.image as string), Buffer.from(pic[2], 'base64'));
      } catch (err) {
        log.warn(`Couldn't save the picture for report #${id}`, err);
      }
    }
    return { ok: true, id };
  }

  imagePath(id: number, ext: string): string {
    return path.join(this.imageDir ?? '.', `${id}.${ext.replace(/[^a-z]/g, '')}`);
  }

  /** A report's picture as a data URL (null if it has none). */
  image(id: number): string | null {
    const r = this.repos.feedback.list(1000).find((x) => x.id === id);
    const ext = r?.context.image;
    if (!r || typeof ext !== 'string' || !this.imageDir) return null;
    try {
      const b = fs.readFileSync(this.imagePath(id, ext));
      return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${b.toString('base64')}`;
    } catch {
      return null;
    }
  }
}
