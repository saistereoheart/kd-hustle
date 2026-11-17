// Sliding-window rate limiter keyed by any string (IP, player id). In-memory is fine for a
// single LAN server.
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly count: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records an attempt; returns false if the key is over the limit (attempt not counted). */
  hit(key: string): boolean {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (list.length >= this.count) {
      this.hits.set(key, list);
      return false;
    }
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.prune(t);
    return true;
  }

  /** Milliseconds until the key may try again (0 if allowed now). */
  retryAfter(key: string): number {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (list.length < this.count) return 0;
    return this.windowMs - (t - list[0]);
  }

  private prune(t: number) {
    for (const [k, v] of this.hits) if (v.every((x) => t - x >= this.windowMs)) this.hits.delete(k);
  }
}
