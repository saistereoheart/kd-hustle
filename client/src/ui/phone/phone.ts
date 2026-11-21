// 📱 The HustlePhone (spec §16): a smartphone UI with apps. P or Tab opens it. On a phone it
// fills the screen; on a PC it's a phone-shaped window. The home screen sorts the apps into a few
// groups (apps.ts) with anything waiting for you on top; the 💡 Tips tab on its side explains
// each app (tips.ts). Apps render inside the phone screen; the Bag, Map, Settings and a few
// others open their own (bigger) windows.
import type { App } from '../../app';
import { el, keepUiState } from '../dom';
import { closePanel, openPanel } from '../panel';
import { sfx } from '../sound';
import { APPS, CATEGORIES, appById, type PhoneApp, type PhoneCtx } from './apps';
import { phoneTips } from './tips';

export type { PhoneCtx } from './apps';

/** How many apps want your attention (for the badge on the phone button). */
export function phoneBadgeCount(app: App): number {
  return APPS.filter((a) => a.badge?.(app)).length;
}

export function openPhone(app: App, startApp?: string) {
  const panel = openPanel('📱 HustlePhone', { testId: 'phone-panel', cls: 'phone-frame' });
  const clock = el('span', { class: 'phone-clock' });
  const status = el('div', { class: 'phone-status' }, clock, el('span', {}, 'KotaNet 5G ▂▄▆█ 🔋'));
  const screen = el('div', { class: 'phone-screen' });
  const homeBar = el('button', { class: 'phone-home', type: 'button', 'aria-label': 'Home', 'data-action': 'phone-home' });
  panel.body.replaceChildren(status, screen, homeBar);
  let current: string | null = null;
  /** Touch + Tips: the app tapped once (its tips are showing; a second tap opens it). */
  let previewed: string | null = null;
  const tips = phoneTips(panel.root.querySelector<HTMLElement>('.panel-frame')!, (id) => go(id));

  const tick = () => {
    const d = new Date();
    clock.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  tick();
  const clockTimer = window.setInterval(tick, 10_000);

  const ctx: PhoneCtx = { app, rerender: () => keepUiState(screen, render), go: (id) => go(id) };

  function go(id: string | null) {
    const def = appById(id);
    previewed = null;
    if (def?.open) {
      if (!def.stacks) closePanel();
      sfx.click();
      def.open(app);
      return;
    }
    current = def ? def.id : null;
    sfx.click();
    render();
    screen.scrollTop = 0;
  }

  /** A tap on an app: opens it, or (touch screen, Tips open) shows its tips first. */
  function tap(a: PhoneApp) {
    if (tips.tapToPreview && previewed !== a.id) {
      previewed = a.id;
      tips.show(a);
      sfx.click();
      for (const b of screen.querySelectorAll<HTMLElement>('[data-app], [data-alert-app]')) {
        b.classList.toggle('previewed', (b.dataset.app ?? b.dataset.alertApp) === a.id);
      }
      return;
    }
    go(a.id);
  }

  /** Pointing at (or tabbing to) an app shows its tips. */
  function hoverable(b: HTMLElement, a: PhoneApp) {
    b.addEventListener('pointerenter', (e) => e.pointerType !== 'touch' && tips.show(a));
    b.addEventListener('focus', () => tips.show(a));
    b.addEventListener('click', () => tap(a));
  }

  function appButton(a: PhoneApp) {
    const badge = a.badge?.(app);
    const icon = el('span', { class: 'phone-icon' }, a.icon, badge ? el('span', { class: 'phone-badge' }, badge) : null);
    icon.style.background = a.color;
    const b = el('button', { class: `phone-app${previewed === a.id ? ' previewed' : ''}`, type: 'button', 'data-app': a.id, 'aria-label': `${a.name}: ${a.does}` }, icon, el('span', { class: 'phone-app-name' }, a.name));
    hoverable(b, a);
    return b;
  }

  function home() {
    const pr = app.store.progress;
    const hello = el('div', { class: 'phone-hello' }, el('div', { class: 'phone-hello-big' }, `Hi, ${app.lastInit?.you.name ?? 'boss'} 👋`), el('div', { class: 'muted' }, `Level ${pr.level} · ${pr.titles.length} titles · ${pr.stats.jobs ?? 0} jobs done`));
    // 🔔 Anything waiting for you (a gift to claim, a quest done, money to collect...), on top.
    const waiting = APPS.map((a) => ({ a, badge: a.badge?.(app) })).filter((x) => x.badge);
    const alerts = waiting.length
      ? el('div', { class: 'phone-alerts' }, el('div', { class: 'phone-cat' }, '🔔 Waiting for you'),
          el('div', { class: 'phone-alert-row' }, ...waiting.map(({ a, badge }) => {
            const b = el('button', { class: `phone-alert${previewed === a.id ? ' previewed' : ''}`, type: 'button', 'data-alert-app': a.id }, el('span', { class: 'phone-alert-icon' }, a.icon), el('span', {}, a.name), el('span', { class: 'phone-alert-badge' }, badge!));
            b.style.setProperty('--app', a.color);
            hoverable(b, a);
            return b;
          })))
      : null;
    const sections = CATEGORIES.map((c) => {
      const list = APPS.filter((a) => a.cat === c.id);
      return el('section', { class: 'phone-cat-box', 'data-cat': c.id }, el('h5', { class: 'phone-cat' }, `${c.icon} ${c.name}`), el('div', { class: 'phone-grid' }, ...list.map(appButton)));
    });
    screen.replaceChildren(...[hello, alerts, ...sections].filter((x): x is HTMLElement => !!x));
    panel.root.querySelector('.panel-head h3')!.textContent = '📱 HustlePhone';
  }

  function render() {
    const def = appById(current);
    if (!def) return home();
    tips.show(def);
    const back = el('button', { class: 'phone-back', type: 'button', 'data-action': 'phone-back' }, '‹ Home');
    back.addEventListener('click', () => go(null));
    const body = def.render ? def.render(ctx) : [];
    screen.replaceChildren(el('div', { class: 'phone-appbar' }, back, el('span', { class: 'phone-apptitle' }, `${def.icon} ${def.name}`)), el('div', { class: 'phone-appbody', 'data-phone-app': def.id }, ...body));
    panel.root.querySelector('.panel-head h3')!.textContent = `📱 ${def.name}`;
  }

  homeBar.addEventListener('click', () => go(null));
  const off = app.store.on(() => keepUiState(screen, render));
  // Timers in apps (buffs, quest progress) refresh every second while the phone is open.
  const refresh = window.setInterval(() => {
    if (current === 'profile' || current === 'clock' || current === 'ventures' || current === 'radio') keepUiState(screen, render);
  }, 1000);
  panel.onClose = () => {
    off();
    clearInterval(clockTimer);
    clearInterval(refresh);
  };
  if (startApp) go(startApp);
  else render();
}
