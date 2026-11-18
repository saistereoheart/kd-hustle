// The shared radio, server side. Music lives in folders on the server PC (one per genre); the
// server picks the track, owns the clock (when it started), and runs the votes: more than half
// of the players online skips the track or switches the genre. Clients play the file from the
// shared position. Files are never in the repo (see .gitignore): bring your own (CC0 / CC-BY).
import fs from 'node:fs';
import path from 'node:path';
import { parseTrackName, votesNeeded, type MusicConfig, type MusicTrack, type MusicView, type RandInt } from '@kh/shared';
import { GameError } from '../economy/economy';

export class MusicSystem {
  private tracks = new Map<string, MusicTrack[]>();
  private queue: MusicTrack[] = [];
  private genre: string | null = null;
  private track: MusicTrack | null = null;
  private startedAt = 0;
  private durationMs: number | null = null;
  private skipVotes = new Set<number>();
  private genreVotes = new Map<number, string>();

  constructor(
    private cfg: MusicConfig,
    readonly dir: string,
    private rand: RandInt,
    /** Players online right now (for the majority). */
    private online: () => number[],
    private changed: (v: MusicView) => void,
    private clock: () => number = Date.now,
  ) {
    this.scan();
    this.next();
  }

  /** (Re)read the genre folders. Returns how many tracks were found. */
  scan(): number {
    this.tracks.clear();
    let n = 0;
    let genres: string[] = [];
    try {
      genres = fs.readdirSync(this.dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    } catch {
      return 0; // no music folder yet
    }
    const exts = new Set(this.cfg.extensions.map((e) => e.toLowerCase()));
    for (const g of genres) {
      const files = fs.readdirSync(path.join(this.dir, g)).filter((f) => exts.has(path.extname(f).toLowerCase())).sort();
      if (!files.length) continue;
      this.tracks.set(
        g,
        files.map((f) => ({ id: `${g}/${f}`, genre: g, ...parseTrackName(f), url: `/music/${encodeURIComponent(g)}/${encodeURIComponent(f)}` })),
      );
      n += files.length;
    }
    return n;
  }

  view(): MusicView {
    const voters: Record<string, number[]> = {};
    for (const [p, g] of this.genreVotes) (voters[g] ??= []).push(p);
    return {
      genres: [...this.tracks].map(([id, list]) => ({ id, count: list.length, votes: voters[id]?.length ?? 0 })),
      genre: this.genre,
      track: this.track,
      startedAt: this.startedAt,
      durationMs: this.durationMs,
      skip: { votes: this.skipVotes.size, voters: [...this.skipVotes] },
      needed: votesNeeded(this.online().length, this.cfg.majority),
      genreVoters: voters,
    };
  }

  /** Next track: a shuffled pass through the genre (rescanned each pass, so new files show up). */
  private next(genre = this.genre) {
    if (!genre || !this.tracks.has(genre)) genre = [...this.tracks.keys()][0] ?? null;
    if (genre !== this.genre || !this.queue.length) {
      if (!this.queue.length) this.scan();
      const list = [...(this.tracks.get(genre ?? '') ?? [])];
      for (let i = list.length - 1; i > 0; i--) {
        const j = this.rand(i + 1);
        [list[i], list[j]] = [list[j], list[i]];
      }
      // Don't repeat the track that just played.
      if (list.length > 1 && list[0].id === this.track?.id) list.push(list.shift()!);
      this.queue = list;
    }
    this.genre = genre;
    this.track = this.queue.shift() ?? null;
    this.startedAt = this.clock();
    this.durationMs = null;
    this.skipVotes.clear();
    this.changed(this.view());
  }

  /** Called every second: move on when the track has finished. */
  tick() {
    if (!this.track) {
      if (this.scan()) this.next(); // music was added
      return;
    }
    const played = this.clock() - this.startedAt;
    if ((this.durationMs !== null && played >= this.durationMs + 1500) || played >= this.cfg.maxTrackMs) this.next();
  }

  /** A client loaded the track: now we know when it ends. */
  reportDuration(trackId: string, ms: number) {
    if (this.track?.id !== trackId || this.durationMs !== null) return;
    if (ms < 5000 || ms > this.cfg.maxTrackMs) return;
    this.durationMs = ms;
    this.changed(this.view());
  }

  /** Vote to skip (again: take it back). More than half of everyone online skips. */
  voteSkip(playerId: number) {
    if (!this.track) throw new GameError('Nothing is playing.');
    if (this.skipVotes.has(playerId)) this.skipVotes.delete(playerId);
    else this.skipVotes.add(playerId);
    this.recount();
  }

  /** Vote for a genre (voting for the one playing clears your vote). */
  voteGenre(playerId: number, genre: string) {
    if (!this.tracks.has(genre)) throw new GameError('No such genre.');
    if (genre === this.genre || this.genreVotes.get(playerId) === genre) this.genreVotes.delete(playerId);
    else this.genreVotes.set(playerId, genre);
    this.recount();
  }

  /** Someone left: their votes go, and the majority may now be reached. */
  leave(playerId: number) {
    const had = this.skipVotes.delete(playerId) || this.genreVotes.delete(playerId);
    if (had) this.recount();
    else this.changed(this.view()); // the number needed changed
  }

  private recount() {
    const online = new Set(this.online());
    for (const p of [...this.skipVotes]) if (!online.has(p)) this.skipVotes.delete(p);
    for (const p of [...this.genreVotes.keys()]) if (!online.has(p)) this.genreVotes.delete(p);
    const needed = votesNeeded(online.size, this.cfg.majority);
    const tally = new Map<string, number>();
    for (const g of this.genreVotes.values()) tally.set(g, (tally.get(g) ?? 0) + 1);
    const winner = [...tally].find(([, n]) => n >= needed)?.[0];
    if (winner) {
      this.genreVotes.clear();
      this.queue = [];
      this.next(winner);
    } else if (this.skipVotes.size >= needed) this.next();
    else this.changed(this.view());
  }
}
