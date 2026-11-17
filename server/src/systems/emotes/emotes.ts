// Emote state. One-shot emotes (wave, clap...) are just broadcast. Continuous emotes (sit,
// sleep, dance, cry) are remembered on the player so people who join later still see them,
// and they end when the player walks or stops them.
import type { ChatConfig } from '@kh/shared';
import { RateLimiter } from '../../auth/rateLimit';

export interface EmoteHolder {
  id: number;
  emote: string | null;
}

export type EmoteResult = { kind: 'played'; emote: string } | { kind: 'ignored'; reason: 'unknown' | 'rate' };

export class EmoteSystem {
  private limiter: RateLimiter;
  private defs: Map<string, ChatConfig['emotes'][number]>;

  constructor(cfg: ChatConfig, now: () => number = Date.now) {
    this.limiter = new RateLimiter(cfg.emoteRateLimit.count, cfg.emoteRateLimit.windowMs, now);
    this.defs = new Map(cfg.emotes.map((e) => [e.id, e]));
  }

  /** Player asks to play an emote. Spammable up to the burst limit. */
  play(p: EmoteHolder, emote: string): EmoteResult {
    const def = this.defs.get(emote);
    if (!def) return { kind: 'ignored', reason: 'unknown' };
    if (!this.limiter.hit(String(p.id))) return { kind: 'ignored', reason: 'rate' };
    p.emote = def.loop ? def.id : null;
    return { kind: 'played', emote: def.id };
  }

  /** Stop a continuous emote. Returns true if one was playing (so others must be told). */
  stop(p: EmoteHolder): boolean {
    if (!p.emote) return false;
    p.emote = null;
    return true;
  }

  /** Walking ends a continuous emote. */
  onMove(p: EmoteHolder, moving: boolean): boolean {
    return moving ? this.stop(p) : false;
  }
}
