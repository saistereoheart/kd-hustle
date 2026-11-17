// Persists online players. Save triggers (CLAUDE.md rule 4 / spec §3):
//   1. autosave every N seconds for dirty players      → start()/saveDirty()
//   2. "Log out"                                       → saveNow() from the socket handler
//   3. socket disconnect                               → saveNow() from the socket handler
//   4. SIGINT/SIGTERM                                  → saveAll() from the shutdown handler
//   5. right after high-value events (character save now; rolls/purchases in later phases) → saveNow()
import type { PlayerRecord, Repos } from '../db/repos';
import { log } from '../log';
import type { OnlinePlayer, World } from '../game/world';

export class SaveManager {
  private timer: NodeJS.Timeout | undefined;
  /** Notified after an autosave so the client can show "Saved ✓". */
  onAutosaved: (p: OnlinePlayer, at: number) => void = () => {};

  constructor(
    private readonly repos: Repos,
    private readonly world: World,
    private readonly now: () => number = Date.now,
  ) {}

  private toRecord(p: OnlinePlayer): PlayerRecord {
    return {
      accountId: p.id,
      appearance: p.appearance,
      hasCharacter: p.hasCharacter,
      scene: p.scene,
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      dir: p.dir,
      lastSavedAt: p.lastSavedAt,
      mapVersion: p.mapVersion,
    };
  }

  private write(players: OnlinePlayer[]): number {
    if (players.length === 0) return 0;
    const at = this.now();
    this.repos.players.saveMany(players.map((p) => this.toRecord(p)), at);
    for (const p of players) {
      p.dirty = false;
      p.lastSavedAt = at;
    }
    return players.length;
  }

  saveNow(p: OnlinePlayer) {
    this.write([p]);
  }

  saveDirty(): number {
    const dirty = [...this.world.players.values()].filter((p) => p.dirty);
    const n = this.write(dirty);
    for (const p of dirty) this.onAutosaved(p, p.lastSavedAt!);
    return n;
  }

  saveAll(): number {
    return this.write([...this.world.players.values()]);
  }

  start(intervalMs: number) {
    this.stop();
    this.timer = setInterval(() => {
      try {
        const n = this.saveDirty();
        if (n > 0) log.info(`Autosaved ${n} player(s)`);
      } catch (err) {
        log.error('Autosave failed', err);
      }
    }, intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
