// HustlePhone → Titles: earned by milestones, worn one at a time over your head (spec §12).
import { conditionProgress } from '@kh/shared';
import { el, toast } from '../dom';
import { progressLabel } from '../progressHud';
import { sfx } from '../sound';
import type { PhoneCtx } from './phone';

export function renderTitles({ app, rerender }: PhoneCtx): HTMLElement[] {
  const pr = app.store.progress;
  const rar = app.cfg.rarities;
  const owned = new Set(pr.titles);
  const snap = app.snapshot();
  const wear = (id: string | null) =>
    app.socket?.timeout(5000).emit('title:equip', { title: id }, (err, res) => {
      if (err || !res.ok) {
        sfx.error();
        return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      }
      sfx.click();
      app.store.progress = { ...app.store.progress, title: id };
      app.store.emit();
      rerender();
    });
  const tierIdx = (id: string) => rar.tiers.findIndex((t) => t.id === id);
  const sorted = [...app.cfg.titles.titles].sort((a, b) => Number(owned.has(b.id)) - Number(owned.has(a.id)) || tierIdx(a.rarity) - tierIdx(b.rarity));
  const cards = sorted.map((t) => {
    const tier = rar.tiers[tierIdx(t.rarity)];
    const have = owned.has(t.id);
    const worn = pr.title === t.id;
    const hidden = t.secret && !have;
    const name = el('span', { class: 'title-name' }, hidden ? '???' : t.name);
    name.style.color = tier?.color ?? '#fff';
    let action: HTMLElement;
    if (have) {
      action = el('button', { class: `btn${worn ? '' : ' primary'}`, type: 'button', 'data-action': `title-${t.id}` }, worn ? 'Take off' : 'Wear');
      action.addEventListener('click', () => wear(worn ? null : t.id));
    } else {
      const p = conditionProgress(t.cond, snap, app.cfg.stages);
      action = el('span', { class: 'muted small title-progress' }, hidden ? '🔒' : `🔒 ${progressLabel(p)}`);
    }
    const bonus = t.bonus ? [t.bonus.luck ? `+${Math.round((t.bonus.luck - 1) * 100)}% luck` : '', t.bonus.xp ? `+${Math.round((t.bonus.xp - 1) * 100)}% XP` : '', t.bonus.jobPay ? `+${Math.round((t.bonus.jobPay - 1) * 100)}% job pay` : ''].filter(Boolean).join(', ') : '';
    return el(
      'div',
      { class: `title-card${have ? '' : ' locked'}${worn ? ' worn' : ''}`, 'data-title': t.id },
      el('div', { class: 'title-info' }, el('div', {}, name, el('span', { class: 'title-tier' }, ` ${tier?.name ?? t.rarity}`)), el('div', { class: 'muted small' }, hidden ? 'A secret. Keep rolling…' : t.desc), bonus && !hidden ? el('div', { class: 'title-bonus' }, `✨ Worn: ${bonus}`) : null),
      action,
    );
  });
  return [el('p', { class: 'muted' }, `${owned.size} of ${app.cfg.titles.titles.length} earned. Your worn title shows over your head for everyone.`), ...cards];
}
