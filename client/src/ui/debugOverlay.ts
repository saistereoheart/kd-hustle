// Dev / admin debug overlay (spec §17): F3 toggles FPS, ping, position, map chunks, players
// and how many objects the scene draws. Cheap: it only updates twice a second while shown.
import type { App } from '../app';
import { el, uiRoot } from './dom';

export class DebugOverlay {
  private root = el('pre', { class: 'debug-overlay hidden', 'data-testid': 'debug-overlay' });
  private timer = 0;
  private ping: number | null = null;
  private frames = 0;
  private fps = 0;
  private lastFps = performance.now();
  private raf = 0;

  constructor(private app: App) {
    uiRoot().append(this.root);
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'F3') return;
      e.preventDefault();
      this.toggle();
    });
  }

  toggle() {
    const on = this.root.classList.toggle('hidden') === false;
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    if (!on) return;
    const count = () => {
      this.frames++;
      const now = performance.now();
      if (now - this.lastFps >= 1000) {
        this.fps = Math.round((this.frames * 1000) / (now - this.lastFps));
        this.frames = 0;
        this.lastFps = now;
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
    this.root.textContent = [
      `FPS ${this.fps}   ping ${this.ping ?? '?'} ms`,
      self ? `pos ${(self.x / T).toFixed(1)}, ${(self.y / T).toFixed(1)} tiles${self.moving ? ' (moving)' : ''}` : 'pos -',
      `chunks ${self?.chunks ?? 0}   objects ${visible}/${objects}`,
      `players ${(town?.debugRemotes().length ?? 0) + 1}   ${this.app.interior ? 'inside a building' : this.app.home ? 'at home' : 'in town'}`,
      'F3 to hide',
    ].join('\n');
  }
}
