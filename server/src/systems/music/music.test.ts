import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseTrackName, votesNeeded, type MusicView } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { ROOT } from '../../paths';
import { MusicSystem } from './music';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-music-'));
for (const [g, files] of Object.entries({ lofi: ['A - One.mp3', 'B - Two.mp3', 'C - Three.ogg'], rock: ['D - Four.mp3', 'notes.txt'] })) {
  fs.mkdirSync(path.join(dir, g));
  for (const f of files) fs.writeFileSync(path.join(dir, g, f), '');
}
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function setup(players: number[]) {
  let now = 1_000_000;
  const online = [...players];
  let last: MusicView | null = null;
  const m = new MusicSystem(cfg.music, dir, (n) => Math.floor(n / 2), () => online, (v) => (last = v), () => now);
  return { m, online, last: () => last!, advance: (ms: number) => ((now += ms), m.tick()) };
}

describe('the shared radio', () => {
  it('reads one genre per folder and names tracks from "Artist - Title"', () => {
    const { m } = setup([1]);
    const v = m.view();
    expect(v.genres.map((g) => [g.id, g.count])).toEqual([['lofi', 3], ['rock', 1]]); // notes.txt ignored
    expect(v.track?.genre).toBe('lofi');
    expect(v.track?.url).toMatch(/^\/music\/lofi\//);
    expect(parseTrackName('Kevin MacLeod - Sneaky Snitch.mp3')).toEqual({ artist: 'Kevin MacLeod', title: 'Sneaky Snitch' });
    expect(parseTrackName('chill_beat.mp3')).toEqual({ artist: null, title: 'chill beat' });
  });

  it('plays the next track when this one ends (once a client reports its length)', () => {
    const { m, advance } = setup([1]);
    const first = m.view().track!.id;
    m.reportDuration(first, 60_000);
    advance(30_000);
    expect(m.view().track!.id).toBe(first);
    advance(32_000);
    expect(m.view().track!.id).not.toBe(first);
  });

  it('skips on a majority: 2 of 3 players', () => {
    expect(votesNeeded(3, 0.5)).toBe(2);
    expect(votesNeeded(4, 0.5)).toBe(3);
    expect(votesNeeded(1, 0.5)).toBe(1);
    const { m } = setup([1, 2, 3]);
    const first = m.view().track!.id;
    m.voteSkip(1);
    expect(m.view().skip.votes).toBe(1);
    m.voteSkip(1); // take it back
    expect(m.view().skip.votes).toBe(0);
    m.voteSkip(1);
    m.voteSkip(2);
    expect(m.view().track!.id).not.toBe(first);
    expect(m.view().skip.votes).toBe(0);
  });

  it('switches genre on a majority, and a player leaving can tip the vote', () => {
    const { m, online } = setup([1, 2, 3]);
    m.voteGenre(1, 'rock');
    expect(m.view().genre).toBe('lofi');
    expect(m.view().genreVoters).toEqual({ rock: [1] });
    // Player 3 leaves: 1 of 2 isn't a majority yet (needs 2)…
    online.splice(2, 1);
    m.leave(3);
    expect(m.view().genre).toBe('lofi');
    m.voteGenre(2, 'rock');
    expect(m.view().genre).toBe('rock');
    expect(m.view().track!.genre).toBe('rock');
    expect(() => m.voteGenre(1, 'polka')).toThrow(/No such genre/);
  });
});
