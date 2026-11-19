// Juice for progression (spec §15): level-up and stage-up splashes with confetti, plus toasts for
// titles, Hustle Path goals, achievements and finished quests.
import { formatMoney, stageDef, type ProgressEvent } from '@kh/shared';
import type { App } from '../app';
import { el, toast, uiRoot } from './dom';
import { rewardText } from './phone/daily';
import { sfx } from './sound';

function confetti(host: HTMLElement, colors: string[], count: number) {
  for (let i = 0; i < count; i++) {
    const p = el('i', { class: 'confetti-bit' });
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--drift', `${(Math.random() - 0.5) * 200}px`);
    p.style.setProperty('--spin', `${Math.random() * 1080 - 540}deg`);
    p.style.animationDelay = `${Math.random() * 400}ms`;
    p.style.animationDuration = `${1600 + Math.random() * 1200}ms`;
    host.append(p);
  }
}

/** A splash in the middle of the screen that doesn't block play (pointer-events: none). */
function splash(cls: string, title: string, sub: string, color: string, ms: number, confettiCount: number) {
  const host = el('div', { class: `celebrate ${cls}`, 'data-testid': cls }, el('div', { class: 'celebrate-card' }, el('div', { class: 'celebrate-title' }, title), sub ? el('div', { class: 'celebrate-sub' }, sub) : null));
  host.style.setProperty('--glow', color);
  confetti(host, [color, '#ffffff', '#ffd43b', '#69db7c', '#74c0fc'], confettiCount);
  uiRoot().append(host);
  setTimeout(() => host.classList.add('out'), ms);
  setTimeout(() => host.remove(), ms + 600);
}

const itemList = (app: App, ids: string[]) => ids.map((id) => app.items.get(id)?.name ?? id).join(', ');

export function celebrate(app: App, events: ProgressEvent[]) {
  // Several level-ups at once: one splash for the highest.
  const levels = events.filter((e): e is Extract<ProgressEvent, { kind: 'level' }> => e.kind === 'level');
  if (levels.length) {
    const top = levels[levels.length - 1];
    const sen = levels.reduce((a, e) => a + e.rewardSen, 0);
    const items = levels.flatMap((e) => e.items);
    const parts = [sen ? `+${formatMoney(sen)}` : '', items.length ? itemList(app, items) : ''].filter(Boolean);
    sfx.levelUp();
    splash('level-up', `LEVEL ${top.level}!`, parts.join(' · '), '#f59f00', 2200, 60);
  }
  // 🏆 Achievements: a small banner each (a summary if several land at once, e.g. after an update).
  const achs = events.filter((e): e is Extract<ProgressEvent, { kind: 'achievement' }> => e.kind === 'achievement');
  const defs = achs.map((e) => app.cfg.achievements.achievements.find((a) => a.id === e.id)).filter((a) => !!a);
  if (defs.length > 3) {
    sfx.fanfare();
    splash('ach-up', `🏆 ${defs.length} ACHIEVEMENTS!`, `${defs.slice(0, 4).map((a) => a.name).join(', ')}… Rewards paid. See 📱 → Trophies.`, '#fab005', 3800, 90);
  } else {
    defs.forEach((a, i) =>
      setTimeout(() => {
        sfx.chime();
        toast(`🏆 ${a.icon} ${a.name}${rewardText(app, a.reward) ? `: ${rewardText(app, a.reward)}` : ''}`, 'good', 5000);
      }, i * 500),
    );
  }
  for (const e of events) {
    if (e.kind === 'stage') {
      const s = stageDef(app.cfg.stages, e.stage);
      sfx.fanfare();
      app.town?.shake(0.6);
      splash('stage-up', `${s.icon} ${s.name.toUpperCase()}`, `Wealth stage ${s.n}! Unlocked: ${s.unlocks.join(', ')}`, s.color, 4200, 140);
    } else if (e.kind === 'title') {
      const t = app.cfg.titles.titles.find((x) => x.id === e.id);
      if (t) toast(`🏷️ New title: "${t.name}". Wear it from 📱 → Titles.`, 'good', 5000);
    } else if (e.kind === 'goal') {
      const g = app.cfg.goals.goals.find((x) => x.id === e.id);
      const parts = [e.rewardSen ? `+${formatMoney(e.rewardSen)}` : '', e.items.length ? itemList(app, e.items) : ''].filter(Boolean);
      sfx.chime();
      if (g) toast(`✅ ${g.text}${parts.length ? `: ${parts.join(' · ')}` : ''}`, 'good', 4500);
    } else if (e.kind === 'questReady') {
      const q = app.cfg.quests.daily.find((x) => x.id === e.id);
      sfx.chime();
      if (q) toast(`📋 Quest done! Claim it in 📱 → Quests.`, 'good', 4500);
    }
  }
}
