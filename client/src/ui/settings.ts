import { el } from './dom';
import { closePanel, openPanel } from './panel';

const PREFS_KEY = 'kh_prefs';
export interface Prefs {
  volume: number;
  particles: boolean;
  /** Random gameplay tips every few minutes. */
  hints: boolean;
  /** The shared radio. */
  musicOn: boolean;
  musicVolume: number;
  /** Rendering sharpness: auto (phones ≤ 2×), high (up to 3×), saver (1.25×, for battery / old phones). */
  quality: 'auto' | 'high' | 'saver';
  /** Coin sounds when money comes in or you pay. */
  moneySound: boolean;
  /** "+RM" pop-ups by your cash and over your stall. */
  moneyPopups: boolean;
  /** Pointers on the screen edge to off-screen places (yours, and signposted ones nearby). */
  pointers: boolean;
  /** 🚗 Engine and exhaust sounds (yours and nearby riders'). */
  engineSound: boolean;
  /** 🏙️ Background sounds: traffic, birds and crickets, the casino crowd, the frying pan. */
  ambience: boolean;
  /** 🏍️ Change gear yourself (R up, F down) instead of the automatic. */
  manualGears: boolean;
}

const DEFAULT_PREFS: Prefs = { volume: 70, particles: true, hints: true, musicOn: true, musicVolume: 40, quality: 'auto', moneySound: true, moneyPopups: true, pointers: true, engineSound: true, ambience: true, manualGears: false };
/** Parsed once and kept (sounds and pop-ups ask for it many times a second). */
let cached: Prefs | null = null;

export function loadPrefs(): Prefs {
  if (cached) return { ...cached };
  try {
    cached = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    cached = { ...DEFAULT_PREFS };
  }
  return { ...cached! };
}
export function savePrefs(p: Prefs) {
  cached = { ...p };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('kh-prefs')); // the radio picks up volume / on-off
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
  /** Called once the window has closed. */
  onClosed?: () => void;
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

  const musicOn = el('input', { type: 'checkbox', 'aria-label': 'Music', checked: prefs.musicOn });
  musicOn.addEventListener('change', () => {
    prefs.musicOn = musicOn.checked;
    savePrefs(prefs);
  });
  const musicVol = el('input', { type: 'range', min: '0', max: '100', value: String(prefs.musicVolume), 'aria-label': 'Music volume' });
  musicVol.addEventListener('input', () => {
    prefs.musicVolume = Number(musicVol.value);
    savePrefs(prefs);
  });

  const moneySound = el('input', { type: 'checkbox', 'aria-label': 'Money sounds', 'data-pref': 'moneySound', checked: prefs.moneySound });
  moneySound.addEventListener('change', () => {
    prefs.moneySound = moneySound.checked;
    savePrefs(prefs);
  });
  const moneyPopups = el('input', { type: 'checkbox', 'aria-label': 'Money pop-ups', 'data-pref': 'moneyPopups', checked: prefs.moneyPopups });
  moneyPopups.addEventListener('change', () => {
    prefs.moneyPopups = moneyPopups.checked;
    savePrefs(prefs);
  });

  const engine = el('input', { type: 'checkbox', 'aria-label': 'Engine sounds', 'data-pref': 'engineSound', checked: prefs.engineSound });
  engine.addEventListener('change', () => {
    prefs.engineSound = engine.checked;
    savePrefs(prefs);
  });

  const amb = el('input', { type: 'checkbox', 'aria-label': 'Ambient sounds', 'data-pref': 'ambience', checked: prefs.ambience });
  amb.addEventListener('change', () => {
    prefs.ambience = amb.checked;
    savePrefs(prefs);
  });

  const stats = el('button', { class: 'btn small', type: 'button', 'data-action': 'toggle-stats' }, 'Show / hide');
  stats.addEventListener('click', () => window.dispatchEvent(new Event('kh-debug')));

  const pointers = el('input', { type: 'checkbox', 'aria-label': 'Pointers to places', 'data-pref': 'pointers', checked: prefs.pointers });
  pointers.addEventListener('change', () => {
    prefs.pointers = pointers.checked;
    savePrefs(prefs);
  });

  const quality = el('select', { 'aria-label': 'Graphics' },
    ...([['auto', 'Auto'], ['high', 'Sharpest'], ['saver', 'Battery saver']] as const).map(([v, label]) => el('option', { value: v, selected: prefs.quality === v }, label)));
  quality.addEventListener('change', () => {
    prefs.quality = quality.value as Prefs['quality'];
    if (prefs.quality === 'saver') {
      prefs.particles = false;
      particles.checked = false;
    }
    savePrefs(prefs);
    window.dispatchEvent(new Event('resize')); // re-render at the new sharpness
  });

  const edit = el('button', { class: 'btn', type: 'button' }, '👕 Edit character');
  const logout = el('button', { class: 'btn danger', type: 'button', 'data-action': 'logout' }, 'Log out');
  const close = el('button', { class: 'btn', type: 'button', 'data-action': 'settings-close' }, '‹ Done');

  // A normal window (opened from the phone, ‹ Back goes back to it).
  const panel = openPanel('⚙️ Settings', { testId: 'settings-panel', cls: 'settings-panel' });
  panel.body.append(
    ...(opts.lastSavedAt ? [el('div', { class: 'setting-row' }, el('span', {}, 'Last saved'), savedLabel)] : []),
    el('div', { class: 'setting-row' }, el('span', {}, 'Volume'), volume),
    el('div', { class: 'setting-row' }, el('span', {}, '🎵 Music (lofi / shared radio)'), musicOn),
    el('div', { class: 'setting-row' }, el('span', {}, 'Music volume'), musicVol),
    el('div', { class: 'setting-row' }, el('span', {}, '📍 Pointers to places (screen edge)'), pointers),
    el('div', { class: 'setting-row' }, el('span', {}, '💰 Money sounds (coins)'), moneySound),
    el('div', { class: 'setting-row' }, el('span', {}, '💰 Money pop-ups (+RM)'), moneyPopups),
    el('div', { class: 'setting-row' }, el('span', {}, '🚗 Engine & exhaust sounds'), engine),
    el('div', { class: 'setting-row' }, el('span', {}, '🏙️ Ambient sounds (city, casino, cooking)'), amb),
    el('div', { class: 'setting-row' }, el('span', {}, '🖥️ Graphics'), quality),
    ...(opts.lastSavedAt ? [el('div', { class: 'setting-row' }, el('span', {}, '📊 FPS & ping (is it the WiFi or the game?)'), stats)] : []),
    el('div', { class: 'setting-row' }, el('span', {}, 'Particles / effects'), particles),
    el('div', { class: 'setting-row' }, el('span', {}, '💡 Random hints'), hints),
    el('div', { class: 'setting-row' }, el('span', { class: 'muted' }, 'Keys: WASD/arrows move · E interact · Enter chat · P or Tab HustlePhone · B bag · 1–0 hotbar (with Q: emotes) · − manifest · M map · N minimap · Esc back')),
    el('div', { class: 'actions' }, ...(opts.onEditCharacter ? [edit] : []), ...(opts.onLogout ? [logout] : []), close),
  );
  const dismiss = () => panel.close();
  panel.onClose = () => {
    clearInterval(timer);
    opts.onClosed?.();
  };
  close.addEventListener('click', dismiss);
  edit.addEventListener('click', () => {
    closePanel();
    opts.onEditCharacter?.();
  });
  logout.addEventListener('click', () => {
    logout.disabled = true;
    logout.textContent = 'Saving…';
    opts.onLogout?.();
  });
  return { close: dismiss };
}
