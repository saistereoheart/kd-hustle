// The server event running now (Lucky Hour, Rush Hour...): a pill at the top with a countdown.
// Tap it for what it does; the Durian Crate opens Quick Rolls.
import type { App } from '../app';
import { el, toast, uiRoot } from './dom';

export class EventBanner {
  private root: HTMLElement;
  private off: () => void;
  private timer: number;

  constructor(private app: App) {
    this.root = el('button', { class: 'event-banner hidden', type: 'button', 'data-testid': 'event-banner' });
    this.root.addEventListener('click', () => {
      const def = this.def();
      if (!def) return;
      toast(`${def.icon} ${def.name}: ${def.desc}`, 'info', 5000);
      if (def.crate) app.openPhone('rolls');
    });
    uiRoot().append(this.root);
    this.off = app.store.on(() => this.render());
    this.timer = window.setInterval(() => this.render(), 1000);
    this.render();
  }

  private def() {
    const e = this.app.store.event;
    return e ? this.app.cfg.events.events.find((d) => d.id === e.id) : undefined;
  }

  private render() {
    const e = this.app.store.event;
    const def = this.def();
    const left = e ? Math.max(0, Math.round((e.endsAt - this.app.store.serverNow()) / 1000)) : 0;
    this.root.classList.toggle('hidden', !def || left <= 0);
    if (!def) return;
    this.root.textContent = `${def.icon} ${def.name} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  }

  destroy() {
    this.off();
    clearInterval(this.timer);
    this.root.remove();
  }
}
