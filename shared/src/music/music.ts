// Shared radio (spec addition): everyone in the game hears the same track at the same moment.
// The server owns the playlist (music files in folders on the server PC, one folder per genre)
// and the clock; clients play the file from the right position. A majority vote skips the track
// or switches the genre.
import { z } from 'zod';

export const musicConfigSchema = z.object({
  /** Folder with one subfolder per genre (relative to the project root; MUSIC_DIR overrides). */
  dir: z.string(),
  /** A vote passes with more than this share of the players online (0.5 = majority). */
  majority: z.number().min(0).max(1),
  extensions: z.array(z.string()).min(1),
  /** If no client reports a track's length, move on after this long. */
  maxTrackMs: z.number().int().positive(),
  /** Clients re-sync when they drift this far from the shared position. */
  resyncMs: z.number().int().positive(),
});
export type MusicConfig = z.infer<typeof musicConfigSchema>;

export interface MusicTrack {
  id: string;
  genre: string;
  title: string;
  artist: string | null;
  /** Where the file is served from (same server). */
  url: string;
}

export interface MusicView {
  genres: Array<{ id: string; count: number; votes: number }>;
  genre: string | null;
  track: MusicTrack | null;
  /** Server ms the track started (its position is now − startedAt). */
  startedAt: number;
  /** Known once a client has loaded it. */
  durationMs: number | null;
  skip: { votes: number; voters: number[] };
  /** Votes needed for a skip or a genre change (majority of players online). */
  needed: number;
  /** Who voted for which genre. */
  genreVoters: Record<string, number[]>;
}

/** "Artist - Title.mp3" → { artist, title }; anything else → the file name as the title. */
export function parseTrackName(file: string): { artist: string | null; title: string } {
  const base = file.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const m = /^(.+?)\s+[-–]\s+(.+)$/.exec(base);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: null, title: base };
}

/** Votes needed out of `online` players: more than `majority` of them (at least 1). */
export function votesNeeded(online: number, majority: number): number {
  return Math.max(1, Math.floor(online * majority) + 1);
}
