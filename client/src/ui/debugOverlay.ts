// Dev / admin debug overlay (spec §17): F3 toggles FPS, ping, position, map chunks, players
// and how many objects the scene draws. Cheap: it only updates twice a second while shown.
import type { App } from '../app';
import { el, uiRoot } from './dom';
import { governor } from '../perf/governor';
import { loadPrefs } from './settings';

export class DebugOverlay {
  private root = el('pre', { class: 'debug-overlay hidden', 'data-testid': 'debug-overlay' });
  private timer = 0;
  private ping: number | null = null;
  private frames = 0;
  private fps = 0;
  private lastFps = performance.now();
  private raf = 0;
  private last = performance.now();
  private worst = 0;
  private worstShown = 0;

  constructor(private app: App) {
    uiRoot().append(this.root);
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'F3') return;
      e.preventDefault();
      this.toggle();
    });
    // Settings → "Show FPS & ping" (phones have no F3).
    window.addEventListener('kh-debug', () => this.toggle());
  }

  toggle() {
    const on = this.root.classList.toggle('hidden') === false;
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    if (!on) return;
    const count = () => {
      this.frames++;
      const now = performance.now();
      this.worst = Math.max(this.worst, now - this.last);
      this.last = now;
      if (now - this.lastFps >= 1000) {
        this.fps = Math.round((this.frames * 1000) / (now - this.lastFps));
        this.frames = 0;
        this.lastFps = now;
        this.worstShown = Math.round(this.worst);
        this.worst = 0;
      }
      this.raf = requestAnimationFrame(count);
    };
    this.raf = requestAnimationFrame(count);
    this.timer = window.setInterval(() => this.paint(), 500);
    this.paint();
  }

  private paint() {
    const t0 = performance.now();
    this.app.socket?.timeout(3000).emit('net:ping', (err) => {
      this.ping = err ? null : Math.round(performance.now() - t0);
    });
    const town = this.app.town;
    const self = town?.debugSelf();
    const T = this.app.map?.tileSize ?? 32;
    const objects = town?.children.list.length ?? 0;
    const visible = town?.children.list.filter((o) => (o as { visible?: boolean }).visible !== false).length ?? 0;
    const net = town?.netStats();
    // A quick verdict: is it this device (drawing) or the WiFi?
    const deviceSlow = this.fps < 28 || this.worstShown > 120;
    // A device busy drawing also reads the network late (gaps, slow pings): only blame the WiFi when
    // the delays are much longer than the device's own worst frame.
    const lateBy = Math.max(this.worstShown, 1000 / Math.max(1, this.fps));
    // A gap in the server's own timestamps means the SERVER paused (not the WiFi, not this device).
    const serverBusy = (net?.serverGapMs ?? 0) > 300;
    const netBad = !serverBusy && ((this.ping ?? 0) > 150 + lateBy || (net?.maxGapMs ?? 0) > 400 + lateBy || (net?.snapbacks ?? 0) > 2);
    const verdict = [deviceSlow ? 'this device is slow to draw' : '', netBad ? 'WiFi / connection trouble' : '', serverBusy ? 'the server paused' : ''].filter(Boolean);
    const q = loadPrefs().quality;
    this.root.textContent = [
      `FPS ${this.fps}   worst frame ${this.worstShown} ms   ${governor.describe().replace(/^\d+ FPS · /, '')}   graphics: ${q === 'auto' ? 'Auto' : q === 'high' ? 'Sharpest (no auto-adjust)' : 'Battery saver'}`,
      `ping ${this.ping ?? '?'} ms   updates every ${net?.avgMs ?? '?'} ms, longest gap ${net?.maxGapMs ?? '?'} ms (at the server ${net?.serverGapMs ?? '?'} ms)`,
      `snap-backs ${net?.snapbacks ?? 0} (last 30 s)   ${verdict.length ? `⚠ ${verdict.join(' + ')}` : '✓ smooth'}`,
      self ? `pos ${(self.x / T).toFixed(1)}, ${(self.y / T).toFixed(1)} tiles${self.moving ? ' (moving)' : ''}` : 'pos -',
      `chunks ${self?.chunks ?? 0}   objects ${visible}/${objects}`,
      `players ${(town?.debugRemotes().length ?? 0) + 1}   ${this.app.interior ? 'inside a building' : this.app.home ? 'at home' : 'in town'}`,
      'F3 to hide',
    ].join('\n');
  }
}
