import { el, uiRoot } from './dom';

const PREFS_KEY = 'kh_prefs';
export interface Prefs {
  volume: number;
  particles: boolean;
  /** Random gameplay tips every few minutes. */
  hints: boolean;
}

export function loadPrefs(): Prefs {
  try {
    return { volume: 70, particles: true, hints: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return { volume: 70, particles: true, hints: true };
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function ago(ts: number | null): string {
  if (!ts) return 'not yet';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s} s ago`;
  return `${Math.floor(s / 60)} min ${s % 60} s ago`;
}

export function openSettings(opts: {
  lastSavedAt?: () => number | null;
  /** In the game: edit your look and log out. Not shown on the start screen. */
  onEditCharacter?: () => void;
  onLogout?: () => void;
}) {
  const prefs = loadPrefs();
  const savedLabel = el('span', { class: 'muted', 'data-testid': 'last-saved' }, ago(opts.lastSavedAt?.() ?? null));
  const timer = window.setInterval(() => (savedLabel.textContent = ago(opts.lastSavedAt?.() ?? null)), 1000);

  const volume = el('input', { type: 'range', min: '0', max: '100', value: String(prefs.volume), 'aria-label': 'Volume' });
  volume.addEventListener('input', () => {
    prefs.volume = Number(volume.value);
    savePrefs(prefs);
  });
  const particles = el('input', { type: 'checkbox', 'aria-label': 'Particles', checked: prefs.particles });
  particles.addEventListener('change', () => {
    prefs.particles = particles.checked;
    savePrefs(prefs);
  });

  const hints = el('input', { type: 'checkbox', 'aria-label': 'Hints', checked: prefs.hints });
  hints.addEventListener('change', () => {
    prefs.hints = hints.checked;
    savePrefs(prefs);
  });

  const edit = el('button', { class: 'btn', type: 'button' }, '👕 Edit character');
  const logout = el('button', { class: 'btn danger', type: 'button', 'data-action': 'logout' }, 'Log out');
  const close = el('button', { class: 'btn', type: 'button' }, 'Close');

  const modal = el(
    'div',
    { class: 'modal', role: 'dialog', 'aria-label': 'Settings' },
    el('h3', {}, '⚙️ Settings'),
    ...(opts.lastSavedAt ? [el('div', { class: 'setting-row' }, el('span', {}, 'Last saved'), savedLabel)] : []),
    el('div', { class: 'setting-row' }, el('span', {}, 'Volume'), volume),
    el('div', { class: 'setting-row' }, el('span', {}, 'Particles / effects'), particles),
    el('div', { class: 'setting-row' }, el('span', {}, '💡 Random hints'), hints),
    el('div', { class: 'setting-row' }, el('span', { class: 'muted' }, 'Keys: WASD/arrows move · E interact · Enter chat · P or Tab HustlePhone · B bag · 1–0 hotbar (with Q: emotes) · − manifest · M map · N minimap')),
    el('div', { class: 'actions' }, ...(opts.onEditCharacter ? [edit] : []), ...(opts.onLogout ? [logout] : []), close),
  );
  const backdrop = el('div', { class: 'modal-backdrop' }, modal);
  const dismiss = () => {
    clearInterval(timer);
    backdrop.remove();
    window.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') dismiss();
  };
  window.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) dismiss();
  });
  close.addEventListener('click', dismiss);
  edit.addEventListener('click', () => {
    dismiss();
    opts.onEditCharacter?.();
  });
  logout.addEventListener('click', () => {
    logout.disabled = true;
    logout.textContent = 'Saving…';
    opts.onLogout?.();
  });
  uiRoot().append(backdrop);
  return { close: dismiss };
}
