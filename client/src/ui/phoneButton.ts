// The phone: a big glowing phone at the bottom left, labelled "Phone (P)", with a red badge
// when an app wants you (daily reward, quests ready, a vote...). Tap or press P to open.
import type { App } from '../app';
import { el, uiRoot } from './dom';
import { phoneBadgeCount } from './phone/phone';

export class PhoneButton {
  private root: HTMLElement;
  private badge: HTMLElement;
  private off: () => void;
  private timer: number;

  constructor(private app: App) {
    this.badge = el('span', { class: 'phone-btn-badge hidden' });
    const screen = el('span', { class: 'phone-btn-screen' }, ...Array.from({ length: 6 }, () => el('i', {})));
    this.root = el(
      'button',
      { class: 'phone-btn', type: 'button', 'data-action': 'phone', 'aria-label': 'Phone (P)', title: 'Phone (P)' },
      el('span', { class: 'phone-btn-body' }, el('span', { class: 'phone-btn-notch' }), screen, el('span', { class: 'phone-btn-home' })),
      this.badge,
      el('span', { class: 'phone-btn-label' }, 'Phone ', el('kbd', {}, 'P')),
    );
    this.root.addEventListener('click', () => app.openPhone());
    uiRoot().append(this.root);
    this.off = app.store.on(() => this.paint());
    this.timer = window.setInterval(() => this.paint(), 2000);
    this.paint();
  }

  private paint() {
    const n = phoneBadgeCount(this.app);
    this.badge.classList.toggle('hidden', !n);
    this.badge.textContent = String(n);
  }

  destroy() {
    this.off();
    clearInterval(this.timer);
    this.root.remove();
  }
}
