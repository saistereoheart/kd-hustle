// The shared radio, client side: plays the server's current track from the shared position
// (so everyone hears the same thing at the same moment), re-syncs if it drifts, and shows a
// small "now playing" pill next to the phone (tap it for the Radio app: skip / genre votes).
// Browsers only allow sound after you've touched the page, so the first tap/key starts it.
import type { MusicView } from '@kh/shared';
import type { App } from '../app';
import { el, uiRoot } from './dom';
import { loadPrefs } from './settings';
import { lofi } from './lofi';
import { musicDucked } from './battleMusic';

export class Radio {
  readonly audio = new Audio();
  private pill: HTMLElement;
  private label: HTMLElement;
  private votes: HTMLElement;
  private trackId: string | null = null;
  private blobUrl: string | null = null;
  private startedAt = 0;
  private unlocked = false;
  private timer: number;
  private off: () => void;

  constructor(private app: App) {
    this.audio.preload = 'auto';
    this.label = el('span', { class: 'radio-title' }, '📻');
    this.votes = el('span', { class: 'radio-votes' });
    this.pill = el('button', { class: 'radio-pill hidden', type: 'button', 'data-action': 'radio', title: 'Radio (tap for votes)' }, this.label, this.votes);
    this.pill.addEventListener('click', () => {
      this.unlock();
      app.openPhone('radio');
    });
    uiRoot().append(this.pill);
    this.audio.addEventListener('loadedmetadata', () => {
      const v = this.app.store.music;
      if (v?.track && v.track.id === this.trackId && !v.durationMs && Number.isFinite(this.audio.duration)) {
        this.app.socket?.emit('music:duration', { track: v.track.id, ms: Math.round(this.audio.duration * 1000) }, () => {});
      }
      this.seek();
    });
    // The first touch / key anywhere allows sound.
    const first = () => this.unlock();
    window.addEventListener('pointerdown', first, { once: true, capture: true });
    window.addEventListener('keydown', first, { once: true, capture: true });
    window.addEventListener('kh-prefs', () => this.applyPrefs());
    this.off = app.store.on(() => this.update());
    this.timer = window.setInterval(() => this.drift(), 5000);
    this.applyPrefs();
    this.update();
  }

  /** Where the shared track is right now (seconds). */
  private position(): number {
    const v = this.app.store.music;
    return v ? Math.max(0, (this.app.store.serverNow() - v.startedAt) / 1000) : 0;
  }

  private seek() {
    const pos = this.position();
    if (Number.isFinite(this.audio.duration) && pos >= this.audio.duration) return; // the server will move on
    try {
      this.audio.currentTime = pos;
    } catch {
      /* not seekable yet */
    }
  }

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.applyPrefs();
  }

  private applyPrefs() {
    const p = loadPrefs();
    this.audio.volume = Math.max(0, Math.min(1, p.musicVolume / 100));
    const want = p.musicOn && !musicDucked() && this.unlocked && !!this.trackId && !!this.audio.getAttribute('src');
    if (want && this.audio.paused) {
      this.seek();
      void this.audio.play().catch(() => {});
    } else if (!want && !this.audio.paused) this.audio.pause();
    this.paint();
  }

  /** A new view from the server: change track if needed. */
  private update() {
    const v: MusicView | null = this.app.store.music;
    const id = v?.track?.id ?? null;
    if (id !== this.trackId) {
      this.trackId = id;
      if (v?.track) {
        // Download the whole track first and play it from memory (not streamed: a busy WiFi
        // can't make it stutter mid-song).
        const want = v.track.id;
        if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
        this.blobUrl = null;
        this.audio.pause();
        void fetch(v.track.url)
          .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
          .then((b) => {
            if (this.trackId !== want) return; // moved on while downloading
            this.blobUrl = URL.createObjectURL(b);
            this.audio.src = this.blobUrl;
            this.audio.load();
            this.applyPrefs();
          })
          .catch(() => {
            if (this.trackId !== want) return;
            this.audio.src = v.track!.url; // fall back to streaming
            this.audio.load();
            this.applyPrefs();
          });
      } else {
        this.audio.pause();
        this.audio.removeAttribute('src');
      }
      this.applyPrefs();
      lofi.yieldTo(!!id); // the built-in lofi plays only when the radio has nothing on
    } else if (v && v.startedAt !== this.startedAt) this.seek(); // same track, restarted (skipped with only one in the genre)
    this.startedAt = v?.startedAt ?? 0;
    this.paint();
  }

  /** Every few seconds: back in step if we've drifted (tab in the background, slow phone...). */
  private drift() {
    if (this.audio.paused || !this.trackId) return;
    const off = Math.abs(this.audio.currentTime - this.position()) * 1000;
    // Only jump for a real drift (each jump is an audible skip).
    if (off > Math.max(4000, this.app.cfg.music.resyncMs)) this.seek();
  }

  private paint() {
    const v = this.app.store.music;
    this.pill.classList.toggle('hidden', !v?.track);
    if (!v?.track) return;
    const on = loadPrefs().musicOn;
    this.label.textContent = `${on && this.unlocked ? '🎵' : '🔇'} ${v.track.title}${v.track.artist ? ` · ${v.track.artist}` : ''}`;
    this.votes.textContent = v.skip.votes ? `⏭ ${v.skip.votes}/${v.needed}` : '';
    this.pill.title = on && !this.unlocked ? 'Tap to start the music' : `${v.genre ?? ''}: ${v.track.title}`;
  }

  destroy() {
    this.off();
    clearInterval(this.timer);
    this.audio.pause();
    this.pill.remove();
  }
}
