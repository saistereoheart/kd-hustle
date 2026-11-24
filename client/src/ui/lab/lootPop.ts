// 🗝️ Labirin Purba: 💰 the reward pop-up. Whenever you get something down there (a won fight, a chest,
// a crate, a secret stash, a key) it shows big in the middle of the screen: the Syiling counting up
// with coins bursting out, XP, and each thing you got as a card in its tier's colour (rare ones glow,
// with a fanfare). It doesn't block: you can keep walking; tap it to close it sooner.
import type { LabLoot } from '@kh/shared';
import { el } from '../dom';
import { sfx } from '../sound';
import { coinIcon } from './labHud';

let current: { close: () => void } | null = null;

/** Show what you just got. `title`: a headline ("Victory!", "Treasure!"). Nothing to show: nothing happens. */
export function showLabLoot(loot: LabLoot | undefined, title = '') {
  if (!loot || (!loot.coins && !loot.xp && !loot.items.length)) return;
  current?.close();
  const card = el('div', { class: 'lab-loot-card', 'data-testid': 'lab-loot' });
  const host = el('div', { class: 'lab-loot' }, card);
  if (title) card.append(el('div', { class: 'lab-loot-title' }, title));

  // 🪙 Syiling: counts up, coins fly out.
  if (loot.coins) {
    const n = el('b', {}, '+0');
    const row = el('div', { class: 'lab-loot-coins' }, coinIcon(), n, el('span', {}, ' Syiling Purba'));
    card.append(row);
    const total = loot.coins;
    const t0 = performance.now();
    const dur = Math.min(900, 300 + total * 2);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      n.textContent = `+${Math.round(total * (1 - Math.pow(1 - k, 3)))}`;
      if (k < 1 && host.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    for (let i = 0; i < 16; i++) {
      const bit = coinIcon();
      bit.classList.add('lab-loot-bit');
      const a = (i / 16) * Math.PI * 2 + Math.random() * 0.4;
      const d = 70 + Math.random() * 70;
      bit.style.setProperty('--dx', `${Math.cos(a) * d}px`);
      bit.style.setProperty('--dy', `${Math.sin(a) * d - 30}px`);
      bit.style.animationDelay = `${Math.random() * 120}ms`;
      row.append(bit);
    }
    sfx.coin();
  }
  if (loot.xp) card.append(el('div', { class: 'lab-loot-xp' }, `📈 +${loot.xp} XP`));

  // 🎁 Things: one card each, popping in one after another.
  let rare = false;
  loot.items.forEach((it, i) => {
    const row = el('div', { class: `lab-loot-item${it.big ? ' big' : ''}` },
      el('span', { class: 'lab-loot-icon' }, it.icon),
      el('span', { class: 'lab-loot-text' }, el('b', {}, it.name), it.sub ? el('small', {}, it.sub) : null));
    if (it.color) row.style.setProperty('--tier', it.color);
    row.style.animationDelay = `${200 + i * 180}ms`;
    card.append(row);
    if (it.big) rare = true;
  });
  if (loot.items.length) window.setTimeout(() => (rare ? sfx.reveal(4) : sfx.reveal(2)), 220);
  if (rare) card.classList.add('rare');

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    host.classList.add('out');
    window.setTimeout(() => host.remove(), 260);
    if (current?.close === close) current = null;
  };
  card.addEventListener('click', close);
  document.body.append(host); // over the fight screen too
  current = { close };
  // Long enough to read; longer for more things and rare ones.
  window.setTimeout(close, 2200 + loot.items.length * 700 + (rare ? 1500 : 0));
}
