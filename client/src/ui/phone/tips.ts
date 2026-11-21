// 💡 The phone's Tips: a little bookmark tab on the side of the phone. Tap it and a window opens
// beside the phone that explains the app you point at (big icon and name, what it does, a short
// description). Inside an app it explains that app. On a touch screen (nothing to point with),
// the first tap on an app shows its tips and a second tap (or the Open button) opens it.
// Open / closed is remembered on this device.
import { el } from '../dom';
import { sfx } from '../sound';
import { categoryOf, type PhoneApp } from './apps';

const KEY = 'kh.phone.tips';

export interface PhoneTips {
  /** Is the Tips window showing? */
  readonly open: boolean;
  /** Touch screen with the Tips open: a first tap only shows an app's tips. */
  readonly tapToPreview: boolean;
  /** Explain this app (null: how to use the Tips). */
  show: (a: PhoneApp | null) => void;
}

function loadOpen() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
function saveOpen(v: boolean) {
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    /* private mode: just this time */
  }
}

/** Adds the tab and the Tips window to the phone's frame. `onOpenApp` opens the app shown. */
export function phoneTips(frame: HTMLElement, onOpenApp: (id: string) => void): PhoneTips {
  let open = loadOpen();
  let shown: PhoneApp | null = null;
  const noHover = () => window.matchMedia?.('(hover: none)').matches ?? false;

  const tab = el(
    'button',
    { class: 'phone-tips-tab', type: 'button', 'data-action': 'phone-tips', 'aria-controls': 'phone-tips', title: 'Tips: what each app does' },
    el('span', { class: 'phone-tips-tab-icon', 'aria-hidden': 'true' }, '💡'),
    el('span', { class: 'phone-tips-tab-text' }, 'TIPS'),
  );
  const icon = el('div', { class: 'phone-tips-icon', 'aria-hidden': 'true' });
  const name = el('h4', { class: 'phone-tips-name' });
  const cat = el('div', { class: 'phone-tips-cat' });
  const does = el('p', { class: 'phone-tips-does' });
  const about = el('p', { class: 'phone-tips-about' });
  const go = el('button', { class: 'btn primary phone-tips-go', type: 'button', 'data-action': 'phone-tips-open' });
  go.addEventListener('click', () => shown && onOpenApp(shown.id));
  const close = el('button', { class: 'icon-btn phone-tips-close', type: 'button', 'aria-label': 'Close tips', title: 'Close tips' }, '✕');
  const box = el(
    'aside',
    { class: 'phone-tips', id: 'phone-tips', 'aria-label': 'App tips', 'aria-live': 'polite', 'data-testid': 'phone-tips' },
    el('div', { class: 'phone-tips-head' }, el('span', {}, '💡 Tips'), close),
    el('div', { class: 'phone-tips-card' }, icon, name, cat, does, about, go),
  );
  frame.append(tab, box);

  const paint = () => {
    if (!shown) {
      icon.textContent = '📱';
      icon.style.background = '#3b4060';
      name.textContent = 'HustlePhone';
      cat.textContent = '';
      does.textContent = noHover() ? 'Tap an app to see what it does.' : 'Point at an app to see what it does.';
      about.textContent = noHover()
        ? 'Tap it again (or press Open) to open it. Tap 💡 TIPS to close this.'
        : 'Click it to open it. Click 💡 TIPS to close this.';
      go.hidden = true;
      return;
    }
    const c = categoryOf(shown);
    icon.textContent = shown.icon;
    icon.style.background = shown.color;
    name.textContent = shown.name;
    cat.textContent = `${c.icon} ${c.name}`;
    does.textContent = shown.does;
    about.textContent = shown.about;
    go.textContent = `Open ${shown.name} ›`;
    go.hidden = false;
  };

  const sync = () => {
    frame.classList.toggle('tips-open', open);
    tab.setAttribute('aria-expanded', String(open));
    tab.classList.toggle('active', open);
    box.hidden = !open;
    if (open) paint();
  };
  const toggle = (v: boolean) => {
    open = v;
    saveOpen(v);
    sfx.click();
    sync();
  };
  tab.addEventListener('click', () => toggle(!open));
  close.addEventListener('click', () => toggle(false));
  sync();

  return {
    get open() {
      return open;
    },
    get tapToPreview() {
      return open && noHover();
    },
    show(a) {
      if (shown === a) return;
      shown = a;
      if (open) paint();
    },
  };
}
