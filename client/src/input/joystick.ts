// On-screen virtual joystick for touch devices (pointer events, multi-touch safe).
import { el } from '../ui/dom';

export class Joystick {
  readonly element: HTMLDivElement;
  private knob: HTMLDivElement;
  private pointerId: number | null = null;
  private vec = { x: 0, y: 0 };

  constructor() {
    this.knob = el('div', { class: 'knob' });
    this.element = el('div', { class: 'joystick', 'data-testid': 'joystick' }, this.knob);
    this.element.addEventListener('pointerdown', (e) => {
      if (this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      try {
        this.element.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone (e.g. very quick tap); moves still arrive on the element */
      }
      this.update(e);
    });
    this.element.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pointerId) this.update(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.vec = { x: 0, y: 0 };
      this.knob.style.transform = '';
    };
    this.element.addEventListener('pointerup', end);
    this.element.addEventListener('pointercancel', end);
  }

  private update(e: PointerEvent) {
    const r = this.element.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = e.clientX - (r.left + radius);
    let dy = e.clientY - (r.top + radius);
    const len = Math.hypot(dx, dy);
    const max = radius - 20;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const n = Math.min(1, len / max);
    // Dead zone so a resting thumb doesn't drift.
    this.vec = n < 0.2 ? { x: 0, y: 0 } : { x: dx / max, y: dy / max };
  }

  vector() {
    return this.vec;
  }
}
