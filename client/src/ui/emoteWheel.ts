import { el, uiRoot } from './dom';

export class EmoteWheel {
  private root: HTMLElement;

  constructor(emotes: Array<{ id: string; name: string; emoji: string }>, private onPick: (id: string) => void) {
    const ring = el('div', { class: 'emote-ring' }, el('div', { class: 'center' }, 'Pick an emote', el('br'), '(keys 1–5)'));
    emotes.forEach((e, i) => {
      const a = (i / emotes.length) * Math.PI * 2 - Math.PI / 2;
      const b = el('button', { type: 'button', 'data-emote': e.id, title: e.name }, e.emoji, el('small', {}, `${i + 1} ${e.name}`));
      b.style.left = `${50 + Math.cos(a) * 34}%`;
      b.style.top = `${50 + Math.sin(a) * 34}%`;
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.pick(e.id);
      });
      ring.append(b);
    });
    this.root = el('div', { class: 'emote-wheel hidden' }, ring);
    this.root.addEventListener('click', () => this.close());
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

  pick(id: string) {
    this.close();
    this.onPick(id);
  }

  destroy() {
    this.root.remove();
  }
}
