// HustlePhone → Radio: what everyone is listening to, the skip vote (a majority of players
// online skips) and the genre vote (a majority switches to that genre straight away).
import type { App } from '../../app';
import { el, toast } from '../dom';
import { loadPrefs, savePrefs } from '../settings';
import { sfx } from '../sound';
import type { PhoneCtx } from './phone';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const nice = (g: string) => g.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function renderRadio({ app }: PhoneCtx): HTMLElement[] {
  const v = app.store.music;
  const me = app.lastInit?.you.id ?? -1;
  if (!v || !v.genres.length || !v.track) {
    return [
      el('div', { class: 'phone-soon' }, el('div', { class: 'phone-soon-icon' }, '📻'), el('h4', {}, 'No music yet'),
        el('p', {}, 'The host puts music files on the server PC, one folder per genre: server/music/lofi/Artist - Title.mp3. Then type /music rescan in chat (or restart).'),
        el('p', { class: 'muted small' }, 'Free sources: FreePD.com (public domain), OpenGameArt.org (CC0), Pixabay Music, Incompetech (credit the artist).')),
    ];
  }
  const ack = (err: Error | null, res: { ok: boolean; error?: string }) => {
    if (err || !res.ok) return (sfx.error(), toast(err ? 'No response.' : (res.error ?? ''), 'bad'));
    sfx.click();
  };
  const pos = Math.max(0, (app.store.serverNow() - v.startedAt) / 1000);
  const len = v.durationMs ? v.durationMs / 1000 : 0;
  const bar = el('div', { class: 'progress' }, el('i', {}));
  (bar.firstChild as HTMLElement).style.width = len ? `${Math.min(100, (pos / len) * 100)}%` : '0%';
  const iVoted = v.skip.voters.includes(me);
  const skip = el('button', { class: `btn${iVoted ? '' : ' primary'}`, type: 'button', 'data-action': 'radio-skip' }, iVoted ? '↩️ Take back my skip vote' : '⏭ Vote to skip', el('small', {}, `${v.skip.votes}/${v.needed} votes (majority)`));
  skip.addEventListener('click', () => app.socket?.timeout(5000).emit('music:skip', ack));
  const prefs = loadPrefs();
  const onOff = el('button', { class: 'btn small', type: 'button', 'data-action': 'radio-toggle' }, prefs.musicOn ? '🔇 Mute for me' : '🔊 Turn on for me');
  onOff.addEventListener('click', () => {
    const p = loadPrefs();
    p.musicOn = !p.musicOn;
    savePrefs(p);
    app.radio?.unlock();
    app.store.emit();
  });
  const vol = el('input', { type: 'range', min: '0', max: '100', value: String(prefs.musicVolume), 'aria-label': 'Music volume' });
  vol.addEventListener('input', () => {
    const p = loadPrefs();
    p.musicVolume = Number(vol.value);
    savePrefs(p);
  });
  const myGenre = Object.entries(v.genreVoters).find(([, ids]) => ids.includes(me))?.[0];
  const genres = v.genres.map((g) => {
    const playing = g.id === v.genre;
    const b = el('button', { class: `btn small${playing ? ' primary' : myGenre === g.id ? ' voted' : ''}`, type: 'button', 'data-genre': g.id, disabled: playing },
      `${playing ? '🎵 ' : myGenre === g.id ? '✅ ' : ''}${nice(g.id)}`, el('small', {}, playing ? 'playing now' : `${g.votes}/${v.needed} votes · ${g.count} tracks`));
    b.addEventListener('click', () => app.socket?.timeout(5000).emit('music:genre', { genre: g.id }, ack));
    return b;
  });
  return [
    el(
      'div',
      { class: 'job-card radio-card' },
      el('div', { class: 'job-icon' }, '📻'),
      el('div', { class: 'job-info' },
        el('h4', {}, v.track.title, el('span', { class: 'lv-badge' }, nice(v.genre ?? ''))),
        el('p', {}, v.track.artist ?? 'Unknown artist'),
        bar,
        el('div', { class: 'muted small' }, len ? `${fmt(pos)} / ${fmt(len)}` : fmt(pos)),
      ),
    ),
    skip,
    el('h4', { class: 'phone-section' }, 'Change the genre (majority vote)'),
    el('div', { class: 'biz-actions' }, ...genres),
    el('h4', { class: 'phone-section' }, 'Just for you'),
    el('div', { class: 'stall-actions' }, onOff, vol),
    el('p', { class: 'hint' }, 'Everyone hears the same track at the same time. Votes need more than half of the players online.'),
  ];
}
