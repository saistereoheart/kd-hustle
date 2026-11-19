// HustlePhone → Trophies: one-time achievements (spec §15). Each one pays its reward the moment
// it's done (the server checks them with titles and the Hustle Path), and they stay through a
// rebirth. This screen only shows them: what's earned, what's next, and how far along you are.
import { conditionProgress } from '@kh/shared';
import { el } from '../dom';
import { progressLabel } from '../progressHud';
import { rewardText } from './daily';
import type { PhoneCtx } from './phone';

let group: string | null = null;

export function renderAchievements({ app, rerender }: PhoneCtx): HTMLElement[] {
  const ac = app.cfg.achievements;
  const pr = app.store.progress;
  const have = new Set(pr.achievements);
  const snap = app.snapshot();
  const all = ac.achievements;
  const earned = all.filter((a) => have.has(a.id)).length;

  const chips = el('div', { class: 'ach-chips' });
  const chip = (id: string | null, label: string) => {
    const n = all.filter((a) => (id === null || a.group === id) && have.has(a.id)).length;
    const total = all.filter((a) => id === null || a.group === id).length;
    const b = el('button', { class: `chip${group === id ? ' active' : ''}`, type: 'button', 'data-group': id ?? 'all' }, `${label} ${n}/${total}`);
    b.addEventListener('click', () => {
      group = id;
      rerender();
    });
    chips.append(b);
  };
  chip(null, '🏆 All');
  for (const g of ac.groups) chip(g.id, g.icon);

  const shown = all.filter((a) => group === null || a.group === group);
  // Nearly-done ones first, then the rest, earned ones at the bottom.
  const scored = shown.map((a) => {
    const p = conditionProgress(a.cond, snap, app.cfg.stages);
    const done = have.has(a.id);
    const frac = done ? 1 : Math.min(1, p.cur / Math.max(1e-9, p.target));
    return { a, p, done, frac };
  });
  scored.sort((x, y) => Number(x.done) - Number(y.done) || y.frac - x.frac);

  const cards = scored.map(({ a, p, done, frac }) => {
    const bar = done ? null : el('div', { class: 'progress' }, el('i', {}));
    if (bar) (bar.firstChild as HTMLElement).style.width = `${frac * 100}%`;
    return el(
      'div',
      { class: `ach-card${done ? ' done' : ''}`, 'data-ach': a.id },
      el('div', { class: 'ach-icon' }, a.icon),
      el(
        'div',
        { class: 'ach-info' },
        el('div', { class: 'ach-name' }, a.name, done ? el('span', { class: 'ach-tick' }, ' ✓') : el('span', { class: 'muted small' }, `  ${progressLabel(p)}`)),
        el('div', { class: 'muted small' }, a.desc),
        bar,
        el('div', { class: 'ach-reward' }, `${done ? '✅ Got' : '🎁'} ${rewardText(app, a.reward) || 'Bragging rights'}`),
      ),
    );
  });

  const pct = Math.round((earned / Math.max(1, all.length)) * 100);
  const head = el('div', { class: 'ach-head' }, el('div', { class: 'ach-big' }, `🏆 ${earned} / ${all.length}`), el('div', { class: 'muted small' }, `${pct}% done. Rewards pay out the moment you earn one. Achievements stay through a rebirth.`));
  const total = el('div', { class: 'progress' }, el('i', {}));
  (total.firstChild as HTMLElement).style.width = `${pct}%`;
  return [head, total, chips, ...cards];
}
