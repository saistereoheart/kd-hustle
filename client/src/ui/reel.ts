// The roll experience (spec §7.5). The result is already decided by the server; this just
// makes it feel amazing. ×1 → CS:GO-style reel; ×5/×10 → a grid of cards that flip over.
import { striva, strivaTag } from './striva';
import { variantLabel, crateOdds, formatOneIn, gradeDef, type CrateDef, type GradesConfig, type ItemDef, type RaritiesConfig, type RollResult } from '@kh/shared';
import { el, uiRoot } from './dom';
import { itemCard } from './panel';
import { sfx } from './sound';

export interface RevealOpts {
  rar: RaritiesConfig;
  /** Item tiers (for the badge on each card). */
  grades?: GradesConfig;
  items: Map<string, ItemDef>;
  crate: CrateDef;
  results: RollResult[];
  /** Camera shake in the game world (0..1 intensity). */
  shake: (intensity: number) => void;
  onDone: (again: boolean) => void;
  /** Live luck (the reel's filler cards follow the real odds). */
  luck?: number;
  /** Fast Hands: 1.3 = the reel spins 30% faster. */
  speed?: number;
  /** Auto-Roll is on: roll again by itself after a short look at the result. */
  auto?: { isOn: () => boolean; stop: () => void };
  /** Called the moment a result is shown (the reel lands, or its card flips): your server-wide
   *  banner / takeover for a big roll goes off right then. */
  onReveal?: (r: RollResult) => void;
}

const tierIndex = (rar: RaritiesConfig, id: string) => rar.tiers.findIndex((t) => t.id === id);

function burst(host: HTMLElement, colors: string[], count: number, spread = 380) {
  for (let i = 0; i < count; i++) {
    const p = el('i', { class: 'burst-bit' });
    const a = Math.random() * Math.PI * 2;
    const d = spread * (0.35 + Math.random() * 0.65);
    p.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    p.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    p.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 120}ms`;
    host.append(p);
    setTimeout(() => p.remove(), 1600);
  }
}

/** Effects + sound for the best result of a roll. */
function revealFx(o: RevealOpts, host: HTMLElement, best: RollResult) {
  const ti = tierIndex(o.rar, best.tier);
  const color = o.rar.tiers[ti].color;
  sfx.reveal(ti);
  host.classList.add(`reveal-${best.tier}`);
  if (ti >= 3) {
    const flash = el('div', { class: 'reveal-flash' });
    flash.style.background = color;
    host.append(flash);
    setTimeout(() => flash.remove(), 700);
  }
  if (ti >= 4) {
    burst(host, [color, '#ffffff', '#fff3bf'], ti >= 5 ? 90 : 50);
    o.shake(ti >= 5 ? 1 : 0.5);
    host.classList.add('shake');
    setTimeout(() => host.classList.remove('shake'), 600);
  }
  if (ti >= 5) {
    const rays = el('div', { class: 'reveal-rays' });
    rays.style.setProperty('--ray', color);
    host.prepend(rays);
  }
}

/** 🧪 Bonus potions that came with these rolls. */
function bonusLine(o: RevealOpts, results: RollResult[]) {
  const got = results.filter((r) => r.bonus).map((r) => `${o.items.get(r.bonus!.itemId)?.name ?? r.bonus!.itemId}${r.bonus!.grade !== 'D' ? ` (Tier ${r.bonus!.grade})` : ''}`);
  return got.length ? el('div', { class: 'reveal-bonus' }, `🧪 Bonus potion${got.length > 1 ? 's' : ''}: ${got.join(', ')}`) : null;
}

function resultLine(o: RevealOpts, r: RollResult) {
  const def = o.items.get(r.itemId)!;
  const tier = o.rar.tiers[tierIndex(o.rar, r.tier)];
  const top = striva(r.grade, r.variant);
  const variant = r.variant !== 'normal' && !top ? `${variantLabel(o.rar.variants, r.variant)} ` : '';
  const title = el('div', { class: 'reveal-title' }, el('span', { class: 'reveal-tier' }, tier.name.toUpperCase()), ' ', top ? strivaTag() : '', `${top ? ' ' : ''}${variant}${def.name}${r.serial ? ` #${r.serial}` : ''}`);
  title.style.setProperty('--tier', tier.color);
  return el(
    'div',
    { class: 'reveal-info' },
    title,
    el('div', { class: 'reveal-sub' }, `${formatOneIn(r.oneIn)}${r.pity ? ' · pity!' : ''}`, r.isNew ? el('span', { class: 'new-badge' }, 'NEW!') : null),
    bonusLine(o, o.results),
  );
}

function buttons(o: RevealOpts, host: HTMLElement, best: RollResult) {
  const again = el('button', { class: 'btn primary', type: 'button', 'data-action': 'roll-again' }, 'Roll again');
  const ok = el('button', { class: 'btn', type: 'button', 'data-action': 'reveal-ok' }, 'Nice!');
  let timer = 0;
  let closed = false;
  const finish = (a: boolean) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    host.remove();
    o.onDone(a);
  };
  again.addEventListener('click', () => finish(true));
  ok.addEventListener('click', () => finish(false));
  const row = el('div', { class: 'reveal-actions' }, ok, again);
  if (o.auto?.isOn()) {
    // Auto-Roll: keep going by itself; linger longer on good pulls so they can be enjoyed.
    const stop = el('button', { class: 'btn danger', type: 'button', 'data-action': 'auto-stop' }, '⏹ Stop auto');
    stop.addEventListener('click', () => {
      o.auto?.stop();
      clearTimeout(timer);
      stop.remove();
    });
    row.append(stop);
    const ti = tierIndex(o.rar, best.tier);
    timer = window.setTimeout(() => {
      if (o.auto?.isOn()) finish(true);
    }, ti >= 4 ? 3500 : ti >= 3 ? 1800 : 800);
  }
  return row;
}

export function playReveal(o: RevealOpts) {
  if (o.results.length === 1) reel(o);
  else grid(o);
}

// ------------------------------------------------------------------ ×1: the reel
function reel(o: RevealOpts) {
  const result = o.results[0];
  const ti = tierIndex(o.rar, result.tier);
  const odds = crateOdds(o.rar, o.crate, o.items, o.luck ?? 1);
  const pool = o.crate.pool.map((id) => o.items.get(id)!).filter(Boolean);
  const randomFiller = () => {
    // Filler cards follow the real odds so the reel "looks" honest.
    let r = Math.random();
    let tier = odds[0].tier;
    for (const t of odds) {
      if (r < t.p) {
        tier = t.tier;
        break;
      }
      r -= t.p;
    }
    const opts = pool.filter((d) => d.rarity === tier);
    return opts[Math.floor(Math.random() * opts.length)] ?? pool[0];
  };
  const WIN = 46;
  const cards: HTMLElement[] = [];
  for (let i = 0; i < WIN + 6; i++) {
    const def = i === WIN ? o.items.get(result.itemId)! : randomFiller();
    // A "near miss" right next to the winner sometimes, for drama.
    const near = (i === WIN + 1 || i === WIN - 1) && Math.random() < 0.5 ? pool.filter((d) => tierIndex(o.rar, d.rarity) >= 4)[0] : undefined;
    cards.push(itemCard(o.rar, near ?? def, i === WIN ? result.variant : 'normal', { size: 64 }));
  }
  const strip = el('div', { class: 'reel-strip' }, ...cards);
  const marker = el('div', { class: 'reel-marker' });
  const skip = el('button', { class: 'btn reel-skip', type: 'button', 'data-action': 'skip' }, 'Skip ⏭');
  const stage = el('div', { class: 'reel-stage' }, el('div', { class: 'reel-window' }, strip, marker), skip);
  const host = el('div', { class: 'reveal-overlay', 'data-testid': 'reveal' }, stage);
  uiRoot().append(host);
  sfx.whoosh();

  const cardW = cards[0].getBoundingClientRect().width + 8;
  const windowW = stage.querySelector('.reel-window')!.getBoundingClientRect().width;
  const jitter = (Math.random() - 0.5) * cardW * 0.6;
  const target = WIN * cardW + cardW / 2 - windowW / 2 + jitter;
  const dramatic = ti >= 5;
  const duration = (dramatic ? 6200 : ti >= 4 ? 5000 : 4200) / Math.max(1, o.speed ?? 1);
  const start = performance.now();
  let lastIdx = -1;
  let done = false;
  const ease = (t: number) => (dramatic ? 1 - Math.pow(1 - t, 5) : 1 - Math.pow(1 - t, 4));
  const finish = () => {
    if (done) return;
    done = true;
    strip.style.transform = `translateX(${-target}px)`;
    skip.remove();
    cards[WIN].classList.add('winner');
    revealFx(o, host, result);
    o.onReveal?.(result);
    stage.append(resultLine(o, result), buttons(o, host, result));
  };
  const frame = (now: number) => {
    if (done) return;
    const t = Math.min(1, (now - start) / duration);
    const x = target * ease(t);
    strip.style.transform = `translateX(${-x}px)`;
    const idx = Math.floor((x + windowW / 2) / cardW);
    if (idx !== lastIdx) {
      lastIdx = idx;
      sfx.tick();
    }
    if (dramatic && t > 0.72) host.classList.add('darken');
    if (t >= 1) finish();
    else requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  skip.addEventListener('click', finish);
}

// ------------------------------------------------------------------ ×5 / ×10: flip grid
function grid(o: RevealOpts) {
  const host = el('div', { class: 'reveal-overlay', 'data-testid': 'reveal' });
  const gridEl = el('div', { class: `flip-grid n${o.results.length}` });
  const flippers = o.results.map((r) => {
    const def = o.items.get(r.itemId)!;
    const front = itemCard(o.rar, def, r.variant, { size: 56, serial: r.serial, grade: r.grade, gradeColor: o.grades ? gradeDef(o.grades, r.grade).color : undefined });
    if (r.isNew) front.append(el('span', { class: 'new-badge small' }, 'NEW'));
    const back = el('div', { class: 'card-back' }, '?');
    back.style.setProperty('--crate', o.crate.color);
    const card = el('div', { class: 'flip-card' }, el('div', { class: 'flip-inner' }, back, front));
    return { card, r };
  });
  gridEl.append(...flippers.map((f) => f.card));
  const skip = el('button', { class: 'btn reel-skip', type: 'button', 'data-action': 'skip' }, 'Flip all ⏭');
  const stage = el('div', { class: 'reel-stage' }, el('h3', { class: 'grid-title' }, `${o.crate.name} ×${o.results.length}`), gridEl, skip);
  host.append(stage);
  uiRoot().append(host);
  sfx.whoosh();

  let i = 0;
  let done = false;
  let timer = 0;
  const best = [...o.results].sort((a, b) => tierIndex(o.rar, b.tier) - tierIndex(o.rar, a.tier))[0];
  const flip = (f: (typeof flippers)[number]) => {
    f.card.classList.add('flipped');
    const ti = tierIndex(o.rar, f.r.tier);
    if (ti >= 3) f.card.classList.add('glow');
    sfx.reveal(Math.min(ti, 3));
    // Something big: the flash and the burst go off right as this card turns over.
    if (ti >= 4) {
      const color = o.rar.tiers[ti].color;
      const flash = el('div', { class: 'reveal-flash' });
      flash.style.background = color;
      host.append(flash);
      setTimeout(() => flash.remove(), 700);
      burst(host, [color, '#ffffff', '#fff3bf'], ti >= 5 ? 70 : 40);
      o.shake(ti >= 5 ? 1 : 0.5);
      sfx.reveal(ti);
    }
    o.onReveal?.(f.r);
  };
  const end = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    for (const f of flippers) {
      if (f.card.classList.contains('flipped')) continue;
      f.card.classList.add('flipped');
      o.onReveal?.(f.r);
    }
    skip.remove();
    revealFx(o, host, best);
    stage.append(resultLine(o, best), buttons(o, host, best));
  };
  const step = () => {
    if (done) return;
    if (i >= flippers.length) return end();
    const f = flippers[i++];
    flip(f);
    // Pause a little longer after something good.
    const sp = Math.max(1, o.speed ?? 1);
    timer = window.setTimeout(step, (tierIndex(o.rar, f.r.tier) >= 3 ? 650 : 230) / sp);
  };
  timer = window.setTimeout(step, 400 / Math.max(1, o.speed ?? 1));
  skip.addEventListener('click', end);
}
