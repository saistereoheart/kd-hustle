import type { ChatMsg } from '@kh/shared';
import { el, toast, uiRoot } from './dom';
import { starName } from './stars';

/** Global chat box. Lines fade after a while; opening the chat shows the full history. */
export class Chat {
  private root: HTMLElement;
  private log: HTMLElement;
  private input: HTMLInputElement;
  private seen = new Set<number>();

  constructor(private send: (text: string) => Promise<string | null>, maxLength: number) {
    this.log = el('div', { class: 'chat-log', id: 'chat-log', 'aria-live': 'polite' });
    this.input = el('input', { id: 'chat-input', maxlength: String(maxLength), placeholder: 'Say something…', autocomplete: 'off', enterkeyhint: 'send' });
    const sendBtn = el('button', { class: 'btn', type: 'button' }, 'Send');
    const row = el('div', { class: 'chat-input-row' }, this.input, sendBtn);
    this.root = el('div', { class: 'chat' }, this.log, row);

    const submit = async () => {
      const text = this.input.value.trim();
      if (!text) {
        this.close();
        return;
      }
      this.input.value = '';
      const err = await this.send(text);
      if (err) toast(err, 'bad');
      this.close();
    };
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        void submit();
      } else if (e.key === 'Escape') {
        this.input.value = '';
        this.close();
      }
    });
    sendBtn.addEventListener('click', () => void submit());
    uiRoot().append(this.root);
  }

  get isOpen() {
    return this.root.classList.contains('open');
  }

  open() {
    this.root.classList.add('open');
    this.input.focus();
    this.log.scrollTop = this.log.scrollHeight;
  }

  close() {
    this.root.classList.remove('open');
    this.input.blur();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  add(m: ChatMsg) {
    if (this.seen.has(m.id)) return;
    this.seen.add(m.id);
    const line = m.system
      ? el('div', { class: 'chat-line system' }, m.text)
      : el('div', { class: 'chat-line' }, el('b', {}, `${starName(m.fromName)}: `), m.text);
    this.log.append(line);
    while (this.log.children.length > 60) this.log.firstElementChild?.remove();
    setTimeout(() => line.classList.add('faded'), 15_000);
    this.log.scrollTop = this.log.scrollHeight;
  }

  /** All visible chat text (used by tests). */
  lines(): string[] {
    return [...this.log.children].map((c) => c.textContent ?? '');
  }

  destroy() {
    this.root.remove();
  }
}
