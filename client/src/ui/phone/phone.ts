// 📱 The HustlePhone (spec §16): a smartphone UI with apps. P or Tab opens it. On a phone it
// fills the screen; on a PC it's a phone-shaped window. Apps render inside the phone screen; the
// Bag, Index, Map and Settings open their own (bigger) windows.
import { questProgress } from '@kh/shared';
import type { App } from '../../app';
import { openInventoryPanel } from '../inventoryPanel';
import { el } from '../dom';
import { closePanel, openPanel } from '../panel';
import { sfx } from '../sound';
import { renderBusiness } from './business';
import { renderDaily } from './daily';
import { renderPath } from './path';
import { renderProfile } from './profile';
import { renderQuests } from './quests';
import { renderRides } from './rides';
import { renderSkills } from './skills';
import { renderTitles } from './titles';
import { renderHandbook } from './handbook';
import { renderClock } from './clock';
import { renderProperties } from './properties';

export interface PhoneCtx {
  app: App;
  /** Re-render the current app (after an action). */
  rerender: () => void;
  go: (id: string | null) => void;
}

interface PhoneApp {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** Renders inside the phone. */
  render?: (ctx: PhoneCtx) => Array<HTMLElement | null>;
  /** Opens something outside the phone instead. */
  open?: (app: App) => void;
  /** Not built yet: shows this note. */
  soon?: string;
  /** Red badge on the icon (e.g. "!" when something is claimable). */
  badge?: (app: App) => string | null;
}

const APPS: PhoneApp[] = [
  {
    id: 'daily', name: 'Daily', icon: '🎁', color: '#e64980', render: renderDaily,
    badge: (app) => (app.store.progress.daily.canClaim ? '!' : null),
  },
  {
    id: 'quests', name: 'Quests', icon: '📋', color: '#f59f00', render: renderQuests,
    badge: (app) => {
      const pr = app.store.progress;
      const n = pr.quests.filter((q) => {
        const def = app.cfg.quests.daily.find((d) => d.id === q.id);
        return def && !q.claimed && questProgress(def, q, pr.stats).done;
      }).length;
      return n ? String(n) : null;
    },
  },
  { id: 'path', name: 'Hustle Path', icon: '🎯', color: '#40c057', render: renderPath },
  { id: 'handbook', name: 'Handbook', icon: '📘', color: '#1971c2', render: renderHandbook },
  {
    id: 'clock', name: 'Clock', icon: '🕰️', color: '#5f3dc4', render: renderClock,
    badge: (app) => (app.store.vote?.active ? '🗳' : null),
  },
  { id: 'skills', name: 'Skills', icon: '⬆️', color: '#7048e8', render: renderSkills },
  { id: 'titles', name: 'Titles', icon: '🏷️', color: '#1c7ed6', render: renderTitles },
  { id: 'profile', name: 'Profile', icon: '👤', color: '#0ca678', render: renderProfile },
  { id: 'rides', name: 'Ronda', icon: '🛵', color: '#2f9e44', render: renderRides },
  { id: 'bag', name: 'Bag', icon: '🎒', color: '#d9480f', open: (app) => openInventoryPanel(app, 0) },
  { id: 'index', name: 'Index', icon: '📖', color: '#5f3dc4', open: (app) => openInventoryPanel(app, 1) },
  { id: 'map', name: 'Map', icon: '🗺️', color: '#1098ad', open: (app) => app.minimap?.openFull() },
  {
    id: 'properties', name: 'Properties', icon: '🏠', color: '#0b7285', render: renderProperties,
    badge: (app) => (app.store.myProps.some((p) => p.requests.length) ? '!' : null),
  },
  {
    id: 'business', name: 'Business', icon: '🏪', color: '#e8590c', render: renderBusiness,
    badge: (app) => (app.store.stall && Object.values(app.store.stall.stock).every((b) => !b.reduce((a, x) => a + x.qty, 0)) ? '!' : null),
  },
  { id: 'bank', name: 'Bank Kota', icon: '🏦', color: '#868e96', soon: 'Loans, credit score and the Ah Long. Coming with Phase 6.' },
  { id: 'market', name: 'Pasar Online', icon: '🛒', color: '#868e96', soon: 'Trade and sell items to other players. Coming with Phase 7.' },
  { id: 'leaderboard', name: 'Leaderboard', icon: '🏆', color: '#868e96', soon: 'Race your friends on net worth, rarest pull and more. Coming with Phase 7.' },
  { id: 'settings', name: 'Settings', icon: '⚙️', color: '#495057', open: (app) => app.openSettings() },
];

export function openPhone(app: App, startApp?: string) {
  const panel = openPanel('📱 HustlePhone', { testId: 'phone-panel', cls: 'phone-frame' });
  const clock = el('span', { class: 'phone-clock' });
  const status = el('div', { class: 'phone-status' }, clock, el('span', {}, 'KotaNet 5G ▂▄▆█ 🔋'));
  const screen = el('div', { class: 'phone-screen' });
  const homeBar = el('button', { class: 'phone-home', type: 'button', 'aria-label': 'Home', 'data-action': 'phone-home' });
  panel.body.replaceChildren(status, screen, homeBar);
  let current: string | null = null;

  const tick = () => {
    const d = new Date();
    clock.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  tick();
  const clockTimer = window.setInterval(tick, 10_000);

  const ctx: PhoneCtx = { app, rerender: () => render(), go: (id) => go(id) };

  function go(id: string | null) {
    const def = id ? APPS.find((a) => a.id === id) : null;
    if (def?.open) {
      closePanel();
      def.open(app);
      return;
    }
    current = def ? def.id : null;
    sfx.click();
    render();
    screen.scrollTop = 0;
  }

  function home() {
    const grid = el('div', { class: 'phone-grid' });
    for (const a of APPS) {
      const badge = a.badge?.(app);
      const icon = el('span', { class: 'phone-icon' }, a.icon, badge ? el('span', { class: 'phone-badge' }, badge) : null);
      icon.style.background = a.color;
      const b = el('button', { class: `phone-app${a.soon ? ' soon' : ''}`, type: 'button', 'data-app': a.id }, icon, el('span', { class: 'phone-app-name' }, a.name));
      b.addEventListener('click', () => go(a.id));
      grid.append(b);
    }
    const pr = app.store.progress;
    const hello = el('div', { class: 'phone-hello' }, el('div', { class: 'phone-hello-big' }, `Hi, ${app.lastInit?.you.name ?? 'boss'} 👋`), el('div', { class: 'muted' }, `Level ${pr.level} · ${pr.titles.length} titles · ${pr.stats.jobs ?? 0} jobs done`));
    screen.replaceChildren(hello, grid);
    panel.root.querySelector('.panel-head h3')!.textContent = '📱 HustlePhone';
  }

  function render() {
    const def = current ? APPS.find((a) => a.id === current) : null;
    if (!def) return home();
    const back = el('button', { class: 'phone-back', type: 'button', 'data-action': 'phone-back' }, '‹ Home');
    back.addEventListener('click', () => go(null));
    const body = def.render ? def.render(ctx) : [el('div', { class: 'phone-soon' }, el('div', { class: 'phone-soon-icon' }, def.icon), el('h4', {}, def.name), el('p', {}, def.soon ?? 'Coming soon.'))];
    screen.replaceChildren(el('div', { class: 'phone-appbar' }, back, el('span', { class: 'phone-apptitle' }, `${def.icon} ${def.name}`)), el('div', { class: 'phone-appbody', 'data-phone-app': def.id }, ...body));
    panel.root.querySelector('.panel-head h3')!.textContent = `📱 ${def.name}`;
  }

  homeBar.addEventListener('click', () => go(null));
  const off = app.store.on(() => render());
  // Timers in apps (buffs, quest progress) refresh every second while the phone is open.
  const refresh = window.setInterval(() => {
    if (current === 'profile' || current === 'clock') render();
  }, 1000);
  panel.onClose = () => {
    off();
    clearInterval(clockTimer);
    clearInterval(refresh);
  };
  if (startApp) go(startApp);
  else render();
}
