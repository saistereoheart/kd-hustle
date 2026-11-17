import type { Joystick } from '../input/joystick';
import { el, uiRoot } from './dom';

export interface HudOptions {
  name: string;
  level: number;
  joystick: Joystick | null;
  onChat: () => void;
  onEmote: () => void;
  onMap: () => void;
  onSettings: () => void;
  onInteract: () => void;
}

export class Hud {
  readonly root: HTMLElement;
  private district: HTMLElement;
  private banner: HTMLElement;
  private prompt: HTMLElement;
  private saved: HTMLElement;
  private bannerTimer = 0;
  private savedTimer = 0;
  private rotateHint: HTMLElement | null = null;

  constructor(opts: HudOptions) {
    const btn = (icon: string, label: string, action: string, fn: () => void) => {
      const b = el('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, 'data-action': action }, icon);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      return b;
    };
    this.district = el('span', { class: 'hud-district' });
    this.banner = el('div', { class: 'district-banner hidden' });
    this.prompt = el('div', { class: 'interact-prompt hidden' });
    this.saved = el('div', { class: 'saved-chip hidden', 'data-testid': 'saved' }, 'Saved ✓');

    const top = el(
      'div',
      { class: 'hud-top' },
      el(
        'div',
        { class: 'pill' },
        el('span', { class: 'lv-badge' }, `Lv ${opts.level}`),
        el('div', {}, el('div', { class: 'hud-name' }, opts.name), this.district),
      ),
      el('div', { class: 'hud-spacer' }),
      el(
        'div',
        { class: 'hud-buttons' },
        btn('💬', 'Chat (Enter)', 'chat', opts.onChat),
        btn('😀', 'Emotes (Q)', 'emote', opts.onEmote),
        btn('🗺️', 'Map (M)', 'map', opts.onMap),
        btn('⚙️', 'Settings (Tab)', 'settings', opts.onSettings),
      ),
    );

    this.root = el('div', { class: 'hud' }, top, this.banner, this.prompt, this.saved);
    if (opts.joystick) {
      const interact = el('button', { class: 'interact-btn', type: 'button', 'aria-label': 'Interact' }, 'E');
      interact.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        opts.onInteract();
      });
      this.root.append(opts.joystick.element, interact);
      if (innerHeight > innerWidth && sessionStorage.getItem('kh_rotate_dismissed') !== '1') {
        const close = el('button', { type: 'button' }, 'OK');
        this.rotateHint = el('div', { class: 'rotate-hint' }, '🔄 Rotate to landscape for a wider view', close);
        close.addEventListener('click', () => {
          this.rotateHint?.remove();
          try {
            sessionStorage.setItem('kh_rotate_dismissed', '1');
          } catch {
            /* ignore */
          }
        });
        this.root.append(this.rotateHint);
      }
    }
    uiRoot().append(this.root);
  }

  setDistrict(name: string, announce: boolean) {
    this.district.textContent = `📍 ${name}`;
    if (!announce) return;
    this.banner.textContent = `📍 ${name}`;
    this.banner.classList.remove('hidden');
    this.banner.style.opacity = '1';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.banner.style.opacity = '0';
      this.bannerTimer = window.setTimeout(() => this.banner.classList.add('hidden'), 450);
    }, 2200);
  }

  setPrompt(text: string | null, touch: boolean) {
    if (!text) {
      this.prompt.classList.add('hidden');
      return;
    }
    this.prompt.replaceChildren(touch ? '' : el('kbd', {}, 'E'), text);
    this.prompt.classList.remove('hidden');
  }

  showSaved() {
    this.saved.classList.remove('hidden');
    this.saved.style.opacity = '1';
    clearTimeout(this.savedTimer);
    this.savedTimer = window.setTimeout(() => {
      this.saved.style.opacity = '0';
      this.savedTimer = window.setTimeout(() => this.saved.classList.add('hidden'), 500);
    }, 1800);
  }

  destroy() {
    clearTimeout(this.bannerTimer);
    clearTimeout(this.savedTimer);
    this.root.remove();
  }
}
