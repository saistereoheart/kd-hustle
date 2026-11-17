// Keyboard state tracked on window (not Phaser) so typing in chat never moves the player.
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

export class Keyboard {
  private down = new Set<string>();
  private handlers = new Map<string, Array<(e: KeyboardEvent) => void>>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e.target)) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) for (const h of this.handlers.get(e.code) ?? []) h(e);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    document.addEventListener('visibilitychange', () => this.down.clear());
  }

  /** Register a one-shot key press handler (ignored while typing in an input). */
  onPress(code: string, fn: (e: KeyboardEvent) => void) {
    const list = this.handlers.get(code) ?? [];
    list.push(fn);
    this.handlers.set(code, list);
  }

  clear() {
    this.down.clear();
  }

  vector(): { x: number; y: number } {
    if (isTyping(document.activeElement)) return { x: 0, y: 0 };
    const d = (c: string) => (this.down.has(c) ? 1 : 0);
    const x = d('KeyD') + d('ArrowRight') - d('KeyA') - d('ArrowLeft');
    const y = d('KeyS') + d('ArrowDown') - d('KeyW') - d('ArrowUp');
    return { x: Math.sign(x), y: Math.sign(y) };
  }
}
