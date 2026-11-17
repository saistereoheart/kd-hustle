import type { Joystick } from '../input/joystick';
import { formatMoney, formatMoneyExact, levelInfo, stageDef } from '@kh/shared';
import type { App } from '../app';
import { el, toast, uiRoot } from './dom';

export interface HudOptions {
  name: string;
  level: number;
  joystick: Joystick | null;
  onChat: () => void;
  onEmote: () => void;
  onMap: () => void;
  onSettings: () => void;
  onInteract: () => void;
  onBag: () => void;
  onPhone: () => void;
  /** Map data credit, e.g. "© OpenStreetMap contributors" (required by the ODbL). */
  attribution: string;
}

export class Hud {
  readonly root: HTMLElement;
  private district: HTMLElement;
  private wallet: HTMLElement;
  private shards: HTMLElement;
  private walletSen = 0;
  private banner: HTMLElement;
  private prompt: HTMLElement;
  private saved: HTMLElement;
  private bannerTimer = 0;
  private savedTimer = 0;
  private rotateHint: HTMLElement | null = null;
  private lv: HTMLElement;
  private xpFill: HTMLElement;
  private xpText: HTMLElement;
  private stage: HTMLElement;
  /** Row with the wallet, shards (and the luck readout from ProgressHud). */
  readonly moneyRow: HTMLElement;
  /** The top-left pill (ProgressHud sits just below it). */
  readonly pill: HTMLElement;
  private offStore: () => void;

  constructor(opts: HudOptions, private app: App) {
    const btn = (icon: string, label: string, action: string, fn: () => void) => {
      const b = el('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, 'data-action': action }, icon);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      return b;
    };
    this.district = el('span', { class: 'hud-district' });
    this.wallet = el('span', { class: 'hud-wallet', 'data-testid': 'wallet', title: 'Tap for the exact amount' }, 'RM 0');
    this.shards = el('span', { class: 'hud-shards', title: 'Shards' }, '💎 0');
    this.wallet.addEventListener('click', () => toast(formatMoneyExact(this.walletSen)));
    this.banner = el('div', { class: 'district-banner hidden' });
    this.prompt = el('div', { class: 'interact-prompt hidden' });
    this.saved = el('div', { class: 'saved-chip hidden', 'data-testid': 'saved' }, 'Saved ✓');

    this.lv = el('span', { class: 'lv-badge', 'data-testid': 'hud-level' }, `Lv ${opts.level}`);
    this.xpFill = el('i', {});
    this.xpText = el('span', { class: 'xp-text' });
    this.stage = el('button', { class: 'stage-badge', type: 'button', 'data-testid': 'hud-stage' });
    this.stage.addEventListener('click', () => app.openPhone('profile'));
    this.moneyRow = el('div', { class: 'hud-money' }, this.wallet, this.shards);
    const xpBar = el('div', { class: 'xp-bar', title: 'XP to the next level' }, this.xpFill, this.xpText);
    this.pill = el(
      'div',
      { class: 'pill hud-pill' },
      this.lv,
      el('div', { class: 'hud-pill-main' }, el('div', { class: 'hud-name-row' }, el('span', { class: 'hud-name' }, opts.name), this.stage), this.moneyRow, xpBar, this.district),
    );
    const top = el(
      'div',
      { class: 'hud-top' },
      this.pill,
      el('div', { class: 'hud-spacer' }),
      el(
        'div',
        { class: 'hud-buttons' },
        btn('📱', 'HustlePhone (P or Tab)', 'phone', opts.onPhone),
        btn('🎒', 'Bag (B)', 'bag', opts.onBag),
        btn('💬', 'Chat (Enter)', 'chat', opts.onChat),
        btn('😀', 'Emotes (Q)', 'emote', opts.onEmote),
        btn('🗺️', 'Map (M)', 'map', opts.onMap),
        btn('⚙️', 'Settings', 'settings', opts.onSettings),
      ),
    );

    this.root = el('div', { class: 'hud' }, top, this.banner, this.prompt, this.saved, el('div', { class: 'osm-credit' }, opts.attribution));
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
    this.offStore = app.store.on(() => this.renderProgress());
    this.renderProgress();
  }

  /** Level badge, XP bar and wealth stage. */
  private renderProgress() {
    const pr = this.app.store.progress;
    const info = levelInfo(this.app.cfg.levels, pr.xp);
    this.lv.textContent = `Lv ${pr.level}`;
    this.xpFill.style.width = info.maxed ? '100%' : `${Math.min(100, (info.into / Math.max(1, info.need)) * 100)}%`;
    this.xpText.textContent = info.maxed ? 'MAX' : `${info.into.toLocaleString('en-US')} / ${info.need.toLocaleString('en-US')} XP`;
    const st = stageDef(this.app.cfg.stages, pr.stage);
    this.stage.replaceChildren(st.icon, el('span', { class: 'stage-name-text' }, ` ${st.name}`));
    this.stage.style.setProperty('--stage', st.color);
    this.stage.title = `Wealth stage ${st.n}: ${st.name}`;
  }

  setWallet(sen: number, shards: number) {
    this.walletSen = sen;
    this.wallet.textContent = formatMoney(sen);
    this.shards.textContent = `💎 ${shards.toLocaleString('en-US')}`;
  }

  /** A floating +RM number by the wallet. */
  floatMoney(sen: number) {
    const f = el('div', { class: 'float-money' }, `+${formatMoney(sen)}`);
    const r = this.wallet.getBoundingClientRect();
    f.style.left = `${r.left}px`;
    f.style.top = `${r.bottom}px`;
    uiRoot().append(f);
    setTimeout(() => f.remove(), 1500);
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
    this.offStore();
    clearTimeout(this.bannerTimer);
    clearTimeout(this.savedTimer);
    this.root.remove();
  }
}
