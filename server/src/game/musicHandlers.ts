// The shared radio's socket handlers (see systems/music): the current state on request and on
// every change, skip / genre votes, and clients reporting track lengths.
import path from 'node:path';
import { C2S } from '@kh/shared';
import type { Socket } from 'socket.io';
import type { ServerConfig } from '../config/loadConfig';
import { log } from '../log';
import { ROOT } from '../paths';
import { cryptoRand } from '../systems/gacha/gacha';
import { MusicSystem } from '../systems/music/music';
import type { GameIO } from './gameServer';
import type { OnlinePlayer, World } from './world';

type Handle = <A, R>(socket: Socket, event: string, schema: { safeParse: (v: unknown) => { success: true; data: A } | { success: false } } | null, fn: (args: A) => R) => void;

/** Where the music folders are: MUSIC_DIR, else music.json → dir (relative to the project). */
export function musicDirOf(cfg: Pick<ServerConfig, 'music'>): string {
  return path.resolve(ROOT, process.env.MUSIC_DIR?.trim() || cfg.music.dir);
}

export function createMusic(d: { cfg: ServerConfig; io: GameIO; world: World }) {
  const dir = musicDirOf(d.cfg);
  const online = () => [...d.world.players.values()].filter((p) => p.hasCharacter).map((p) => p.id);
  const music = new MusicSystem(d.cfg.music, dir, cryptoRand, online, (v) => d.io.emit('music', v));
  const v = music.view();
  if (v.genres.length) log.info(`Radio: ${v.genres.reduce((a, g) => a + g.count, 0)} tracks in ${v.genres.length} genres (${v.genres.map((g) => g.id).join(', ')})`);
  else log.info(`Radio: no music yet. Put files in ${path.relative(ROOT, dir) || dir}/<genre>/ (e.g. lofi/Artist - Title.mp3)`);
  const timer = setInterval(() => {
    try {
      music.tick();
    } catch (err) {
      log.error('radio tick failed', err);
    }
  }, 1000);

  function register(socket: Socket, me: OnlinePlayer, handle: Handle) {
    handle(socket, 'music:view', null, () => ({ view: music.view() }));
    handle(socket, 'music:skip', null, () => (music.voteSkip(me.id), {}));
    handle(socket, 'music:genre', C2S.musicGenre, ({ genre }) => (music.voteGenre(me.id, genre), {}));
    handle(socket, 'music:duration', C2S.musicDuration, ({ track, ms }) => (music.reportDuration(track, ms), {}));
  }

  return {
    music,
    register,
    // After they've left the world, so the majority is counted without them.
    leave: (p: OnlinePlayer) => setTimeout(() => music.leave(p.id), 0),
    /** /music rescan */
    rescan: () => music.scan(),
    stop: () => clearInterval(timer),
  };
}
