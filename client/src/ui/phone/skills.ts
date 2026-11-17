// HustlePhone → Skills: the Hustle Skills upgrade tree (spec §11). Costs grow per level
// (base × growth^level, from upgrades.json); some skills need a player level or wealth stage.
import { formatMoney, skillCostSen, skillLevel, skillLockReason, type SkillDef } from '@kh/shared';
import { el, toast } from '../dom';
import { sfx } from '../sound';
import type { PhoneCtx } from './phone';

let branch = 'hustle';

/** What a skill does at a level, in words ("+20% job pay", "RM 0.05/s"). */
export function effectText(def: SkillDef, level: number): string {
  const v = def.effect.base + def.effect.perLevel * (level - def.startLevel);
  const pct = `${Math.round(v * 100)}%`;
  switch (def.effect.kind) {
    case 'jobPay': return `+${pct} job pay`;
    case 'luck': return `+${pct} luck`;
    case 'variantChance': return `+${pct} variant chance`;
    case 'pity': return `pity ${pct} sooner`;
    case 'potionDuration': return `+${pct} potion time`;
    case 'xp': return `+${pct} XP`;
    case 'rollSpeed': return `+${pct} reel speed`;
    case 'passiveIncome': return `+${pct} passive income`;
    case 'walkSpeed': return `+${pct} walk speed`;
    case 'carwashSeconds': return `+${v} s car wash time`;
    case 'manifestRate': return `RM ${(v / 100).toFixed(2)}/s · RM ${((v * 3600) / 100).toFixed(0)}/hour`;
    case 'unlock': return v > 0 ? 'Unlocked' : 'Locked';
    case 'dishPrice': return `+${pct} dish prices`;
    case 'customers': return `+${pct} stall customers`;
    case 'wages': return `−${pct} staff wages`;
  }
}

export function renderSkills({ app, rerender }: PhoneCtx): HTMLElement[] {
  const cfg = app.cfg.upgrades;
  const st = app.store;
  const pr = st.progress;
  const tabsEl = el('div', { class: 'branch-tabs' });
  for (const b of cfg.branches) {
    const t = el('button', { class: `branch-tab${b.id === branch ? ' active' : ''}${b.comingSoon ? ' soon' : ''}`, type: 'button', 'data-branch': b.id }, `${b.icon} ${b.name}`);
    t.addEventListener('click', () => {
      branch = b.id;
      rerender();
    });
    tabsEl.append(t);
  }
  const bdef = cfg.branches.find((b) => b.id === branch) ?? cfg.branches[0];
  const list: HTMLElement[] = [];
  if (bdef.comingSoon) list.push(el('div', { class: 'phone-soon' }, el('div', { class: 'phone-soon-icon' }, bdef.icon), el('p', {}, `🔒 ${bdef.comingSoon}`)));
  for (const [id, def] of Object.entries(cfg.skills)) {
    if (def.branch !== bdef.id) continue;
    const level = skillLevel(cfg, st.skills, id);
    const lock = skillLockReason(def, level, pr.level, pr.stage, app.cfg.stages);
    const maxed = level >= def.maxLevel;
    const cost = maxed ? 0 : skillCostSen(def, level);
    const btn = el(
      'button',
      { class: `btn${!lock && st.walletSen >= cost ? ' primary' : ''}`, type: 'button', 'data-action': `upgrade-${id}`, disabled: !!lock || st.walletSen < cost },
      maxed ? 'Maxed' : lock ? `🔒 ${lock}` : `Lv ${level + 1}`,
      maxed || lock ? null : el('small', {}, formatMoney(cost)),
    );
    btn.addEventListener('click', () => {
      btn.disabled = true;
      app.socket?.timeout(5000).emit('skill:upgrade', { skill: id }, (err, res) => {
        if (err || !res.ok) {
          sfx.error();
          rerender();
          return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
        }
        sfx.coin();
        st.skills = res.skills;
        st.walletSen = res.walletSen;
        st.emit();
        toast(`${def.icon} ${def.name} Lv ${res.level}!`, 'good');
      });
    });
    const pips = el('div', { class: 'skill-pips' });
    if (def.maxLevel <= 25) for (let i = def.startLevel; i < def.maxLevel; i++) pips.append(el('i', { class: i < level ? 'on' : '' }));
    list.push(
      el(
        'div',
        { class: `job-card skill-card${maxed ? ' maxed' : ''}`, 'data-skill': id },
        el('div', { class: 'job-icon' }, def.icon),
        el(
          'div',
          { class: 'job-info' },
          el('h4', {}, def.name, el('span', { class: 'lv-badge' }, `Lv ${level}/${def.maxLevel}`)),
          el('p', {}, def.desc),
          pips,
          el('div', { class: 'muted small' }, level > def.startLevel || def.startLevel > 0 ? `Now: ${effectText(def, level)}` : 'Not learned yet', maxed ? '' : ` → ${effectText(def, level + 1)}`),
        ),
        btn,
      ),
    );
  }
  return [tabsEl, ...list, el('p', { class: 'hint' }, `You have ${formatMoney(st.walletSen)}. Skills are permanent.`)];
}
