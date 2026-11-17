// Emote picker. It stays open so you can spam emotes, and it doesn't block the rest of the
// screen (you can keep walking with it open). Continuous emotes are marked ↻; tapping
// the one that's playing stops it.
import { el, uiRoot } from './dom';

export class EmoteWheel {
  private root: HTMLElement;
  private buttons = new Map<string, HTMLButtonElement>();

  constructor(emotes: Array<{ id: string; name: string; emoji: string; loop: boolean }>, private onPick: (id: string) => void) {
    const closeBtn = el('button', { class: 'center', type: 'button', 'aria-label': 'Close emotes' }, '✕');
    closeBtn.addEventListener('click', () => this.close());
    const ring = el('div', { class: 'emote-ring' }, closeBtn);
    emotes.forEach((e, i) => {
      const a = (i / emotes.length) * Math.PI * 2 - Math.PI / 2;
      const key = i < 9 ? String(i + 1) : i === 9 ? '0' : i === 10 ? '−' : '';
      const b = el(
        'button',
        { type: 'button', 'data-emote': e.id, title: `${e.name}${e.loop ? ' (continuous: tap again to stop)' : ''}`, class: e.loop ? 'loop' : '' },
        e.emoji,
        el('small', {}, `${key ? `${key} ` : ''}${e.name}${e.loop ? ' ↻' : ''}`),
      );
      b.style.left = `${50 + Math.cos(a) * 37}%`;
      b.style.top = `${50 + Math.sin(a) * 37}%`;
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.onPick(e.id);
        b.classList.remove('pressed');
        void b.offsetWidth; // restart the press animation when spamming
        b.classList.add('pressed');
      });
      this.buttons.set(e.id, b);
      ring.append(b);
    });
    this.root = el('div', { class: 'emote-wheel hidden' }, ring);
    uiRoot().append(this.root);
  }

  get isOpen() {
    return !this.root.classList.contains('hidden');
  }

  toggle() {
    this.root.classList.toggle('hidden');
  }

  close() {
    this.root.classList.add('hidden');
  }

  /** Highlight the continuous emote that's currently playing. */
  setActive(id: string | null) {
    for (const [k, b] of this.buttons) b.classList.toggle('active', k === id);
  }

  destroy() {
    this.root.remove();
  }
}
