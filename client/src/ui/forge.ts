// ⚒️ The forge: merging and rerolling items.
//  - Merge: put N copies of the SAME item at the SAME tier in the slots (any variants). The first
//    item you pick decides what the other slots accept. The result goes a tier up and keeps every
//    variant, with a chance of one more.
//  - Reroll: spend shards for a better tier, or another variant (they stack). A CS:GO-style reel
//    shows the roll; your luck boosts the odds, and soft / hard pity guarantee an upgrade in the end.
// The server decides everything; the reel just lands on what it rolled.
import { gradeDef, gradeIndex, nextGrade, variantLabel, variantParts, type InventoryItem, type ItemDef, type RerollPity, gradeRerollOdds, variantRerollOdds } from '@kh/shared';
import type { App } from '../app';
import { el, keepUiState, rebuildNow, toast } from './dom';
import { iconUrl, openPanel } from './panel';
import { sfx } from './sound';
import { openBulkWindow } from './bulkWindow';

const VARIANT_COLOR: Record<string, string> = { normal: '#868e96', shiny: '#74c0fc', golden: '#fcc419', rainbow: 'linear-gradient(90deg,#ff6b6b,#ffd43b,#51cf66,#4dabf7,#cc5de8)' };

function itemLine(app: App, it: InventoryItem): string {
  const v = variantLabel(app.cfg.rarities.variants, it.variant);
  return `${gradeDef(app.cfg.grades, it.grade).name}${v ? ` · ${v}` : ''}`;
}

/** Furniture placed in your homes (can't be merged or rerolled until it's taken out). */
export function placedIids(app: App): Set<number> {
  return new Set([...app.store.myProps, ...app.store.myShops].flatMap((p) => p.layout.map((l) => l.iid)));
}

/** Items that can go in the forge (from a crate, not limited, not worn, not placed in a home). */
export function forgeable(app: App): InventoryItem[] {
  const worn = new Set(Object.values(app.store.equipped));
  const placed = placedIids(app);
  return app.store.inventory.filter((i) => i.serial === null && !worn.has(i.iid) && !placed.has(i.iid) && app.cratesOfItem.has(i.itemId));
}

// ------------------------------------------------------------------ merge
export function openMergeWindow(app: App, firstIid?: number) {
  const g = app.cfg.grades;
  const n = g.mergeCount;
  const panel = openPanel('⚒️ Merge items', { wide: true, testId: 'merge-panel' });
  const slots: Array<number | null> = new Array(n).fill(null);
  if (firstIid !== undefined && forgeable(app).some((i) => i.iid === firstIid)) slots[0] = firstIid;
  const get = (iid: number | null) => (iid === null ? undefined : app.store.inventory.find((i) => i.iid === iid));

  // Re-render without losing the list's scroll (picking an item, or a store update every second:
  // report #12, the list jumped back to the top while scrolling).
  const render = () => rebuildNow(panel.body, draw);
  const draw = () => {
    const picked = slots.map(get);
    const first = picked.find(Boolean);
    const def = first ? app.items.get(first.itemId) : undefined;
    // The slots
    const row = el('div', { class: 'merge-slots' });
    picked.forEach((it, k) => {
      const d = it ? app.items.get(it.itemId) : undefined;
      const slot = el('button', { class: `merge-slot${it ? ' full' : ''}`, type: 'button', 'data-slot': String(k) },
        it && d ? el('img', { src: iconUrl(d, it.variant, 72), alt: d.name }) : el('span', { class: 'merge-plus' }, '+'),
        el('small', {}, it && d ? itemLine(app, it) : k === 0 ? 'Pick an item' : first ? `Another ${def?.name ?? ''}` : 'Empty'));
      slot.addEventListener('click', () => {
        if (!it) return;
        if (k === 0 || slots.filter((x) => x !== null).length === 1) slots.fill(null); // a new first item
        else slots[k] = null;
        render();
      });
      row.append(slot, k < n - 1 ? el('span', { class: 'merge-op' }, '+') : el('span', { class: 'merge-op' }, '='));
    });
    // The preview of the result
    let preview: HTMLElement;
    const full = picked.every(Boolean);
    if (first && def) {
      const inputs = picked.filter((x): x is InventoryItem => !!x);
      const idx = inputs.map((i) => gradeIndex(g, i.grade));
      const lo = Math.min(...idx), hi = Math.max(...idx);
      const gi = Math.min(g.grades.length - 1, Math.max(lo + 1, hi));
      const parts = [...new Set(inputs.flatMap((i) => variantParts(i.variant)))];
      const count = inputs.flatMap((i) => variantParts(i.variant)).length;
      const bonus = 1 - Math.pow(1 - g.mergeVariantBonus, count);
      preview = el('div', { class: 'merge-result' },
        el('img', { src: iconUrl(def, inputs.reduce((best, i) => (variantParts(i.variant).length > variantParts(best).length ? i.variant : best), 'normal'), 96), alt: def.name }),
        el('div', {},
          el('b', {}, def.name),
          el('div', {}, `→ ${g.grades[gi].name}${full ? '' : ' (when all slots are full)'}`),
          el('div', { class: 'muted small' }, parts.length ? `Keeps: ${variantLabel(app.cfg.rarities.variants, parts.join('+'))} (they multiply)` : 'No variants yet'),
          el('div', { class: 'muted small' }, count ? `✨ ${Math.round(bonus * 100)}% chance of one more variant (${Math.round(g.mergeVariantBonus * 100)}% per variant put in)` : 'Put in items with variants for a chance of a new one')));
    } else preview = el('p', { class: 'muted' }, `Pick ${n} copies of the same item at the same tier. Variants can differ.`);
    const go = el('button', { class: 'btn primary', type: 'button', 'data-action': 'merge-go', disabled: !full }, `⚒️ Merge ${n} → 1`);
    go.addEventListener('click', () => {
      go.disabled = true;
      app.socket?.timeout(6000).emit('inv:merge', { iids: slots as number[] }, (err, res) => {
        if (err || !res.ok) {
          go.disabled = false;
          sfx.error();
          return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
        }
        sfx.reveal(res.bonus ? 5 : 3);
        app.store.removeItems(res.removed);
        app.store.addItems([res.item]);
        const name = app.items.get(res.item.itemId)?.name ?? '';
        toast(`⚒️ ${name}: ${itemLine(app, res.item)}${res.bonus ? ` · ✨ bonus ${variantLabel(app.cfg.rarities.variants, res.bonus)}!` : ''}`, 'good', 5000);
        slots.fill(null);
        render();
      });
    });
    // What can go in: everything that has a full set at first, then only copies of the first item
    // at its tier (and nothing already at the top tier).
    const top = g.grades.length - 1;
    const inSlots = new Set(slots.filter((x): x is number => x !== null));
    const pool = forgeable(app).filter(
      (i) => !inSlots.has(i.iid) && gradeIndex(g, i.grade) < top && (!first || (i.itemId === first.itemId && gradeIndex(g, i.grade) === gradeIndex(g, first.grade))),
    );
    const byItem = new Map<string, InventoryItem[]>();
    for (const i of pool) {
      const k = `${i.itemId}|${gradeIndex(g, i.grade)}`;
      byItem.set(k, [...(byItem.get(k) ?? []), i]);
    }
    const list = el('div', { class: 'merge-pool' });
    for (const [k, its] of byItem) {
      const d = app.items.get(k.split('|')[0]) as ItemDef;
      if (!first && its.length < n) continue; // can't make a set of n at this tier
      for (const it of its.sort((a, b) => gradeIndex(g, b.grade) - gradeIndex(g, a.grade) || variantParts(b.variant).length - variantParts(a.variant).length)) {
        const c = el('button', { class: 'merge-pick', type: 'button', 'data-iid': String(it.iid) }, el('img', { src: iconUrl(d, it.variant, 48), alt: d.name }), el('span', {}, d.name, el('small', {}, itemLine(app, it))));
        c.addEventListener('click', () => {
          const k = slots.indexOf(null);
          if (k < 0) return;
          slots[k] = it.iid;
          render();
        });
        list.append(c);
      }
    }
    // Copies placed in your homes don't show up here: say so (and where to take them out).
    const placed = placedIids(app);
    const inHomes = first ? app.store.inventory.filter((i) => i.itemId === first.itemId && placed.has(i.iid)).length : 0;
    const all = el('button', { class: 'btn small', type: 'button', 'data-action': 'merge-all' }, '⚒️ Merge all… (every full set, with filters)');
    all.addEventListener('click', () => openBulkWindow(app, 'merge'));
    panel.body.replaceChildren(
      el('div', { class: 'bulk-entry' }, all),
      row, preview, go,
      el('h4', {}, first ? `Your other ${gradeDef(g, first.grade).name} ${def?.name ?? ''}s` : `Items you have ${n}+ of at one tier`),
      list.childElementCount ? list : el('p', { class: 'empty' }, first ? 'No more copies of this item at this tier (worn ones don\'t count).' : `You don't have ${n} copies of anything at the same tier yet.`),
      ...(inHomes ? [el('p', { class: 'merge-placed-note' }, `🏠 ${inHomes} more ${inHomes === 1 ? 'is' : 'are'} placed in your homes (see 🎒 Bag → 🏠 Placed). Take ${inHomes === 1 ? 'it' : 'them'} out first (inside the home → 🛠️ Decorate) to merge.`)] : []),
      el('p', { class: 'hint' }, `Same tier in, one tier up out (e.g. ${n} × D → 1 C). Every variant is kept and they multiply (Shiny + Golden = both bonuses).`),
    );
  };
  const off = app.store.on(() => keepUiState(panel.body, draw));
  panel.onClose = () => off();
  draw();
}

// ------------------------------------------------------------------ reroll (with the reel)
let pityCache: RerollPity | null = null;

export function openRerollWindow(app: App, iid: number, what: 'grade' | 'variant') {
  const g = app.cfg.grades;
  const rar = app.cfg.rarities;
  const panel = openPanel(what === 'grade' ? '🎲 Tier reroll' : '🎲 Variant reroll', { wide: true, testId: 'reroll-panel' });
  let spinning = false;
  /** While the reel spins: lands it at once (the Roll button turns into ⏭ Skip, same spot). */
  let skipNow: (() => void) | null = null;
  const strip = el('div', { class: 'reroll-strip' });
  const reel = el('div', { class: 'reroll-reel' }, strip, el('div', { class: 'reroll-marker' }));
  const info = el('div', { class: 'reroll-info' });
  const btn = el('button', { class: 'btn primary', type: 'button', 'data-action': 'reroll-go' });
  const pityEl = el('div', { class: 'reroll-pity' });
  const item = () => app.store.inventory.find((i) => i.iid === iid);

  /** Each outcome on the reel and its chance (luck applied), for the filler cells and the odds. */
  const outcomes = (): Array<{ id: string; label: string; color: string; p: number }> => {
    const luck = app.mods().luck;
    // (The same maths the server rolls with: luck = more tries, keep the rarest.)
    if (what === 'grade') {
      const odds = gradeRerollOdds(g, luck);
      return g.grades.map((x, i) => ({ id: x.id, label: x.id, color: x.color, p: odds[i].p }));
    }
    const odds = variantRerollOdds(rar.variants, variantParts(item()?.variant ?? 'normal'), luck);
    return odds.map((o) => {
      const v = rar.variants.find((x) => x.id === o.id);
      return { id: o.id, label: o.id === 'normal' ? 'Nothing new' : v?.name ?? o.id, color: VARIANT_COLOR[o.id] ?? '#e64980', p: o.p };
    });
  };
  const cell = (o: { label: string; color: string }) => {
    const c = el('div', { class: 'reroll-cell' }, el('b', {}, o.label));
    c.style.background = o.color;
    return c;
  };
  const pick = (os: ReturnType<typeof outcomes>) => {
    let r = Math.random();
    for (const o of os) if ((r -= o.p) <= 0) return o;
    return os[0];
  };

  const render = () => {
    const it = item();
    if (!it) return void panel.body.replaceChildren(el('p', { class: 'empty' }, 'You no longer have that item.'));
    const def = app.items.get(it.itemId)!;
    const cost = (what === 'grade' ? g.shards.rerollGrade : g.shards.rerollVariant)[def.rarity] ?? 100;
    const top = what === 'grade' ? !nextGrade(g, it.grade) : rar.variants.every((v) => v.oneIn <= 1 || variantParts(it.variant).includes(v.id));
    const pc = g.rerollPity[what];
    const fails = pityCache?.[what] ?? 0;
    info.replaceChildren(
      el('img', { src: iconUrl(def, it.variant, 96), alt: def.name }),
      el('div', {},
        el('b', {}, def.name),
        el('div', {}, itemLine(app, it)),
        el('div', { class: 'muted small' }, what === 'grade' ? 'Lands higher than your tier: you get it. Lower: nothing changes.' : 'Lands on a variant you don\'t have: it\'s added (variants stack and multiply).'),
        el('div', { class: 'muted small' }, `Odds (luck ×${app.mods().luck.toFixed(2)}): ${outcomes().map((o) => `${o.label} ${(o.p * 100).toFixed(o.p < 0.01 ? 2 : 1)}%`).join(' · ')}`)),
    );
    const soft = Math.max(0, pc.soft - fails);
    const hard = Math.max(0, pc.hard - fails);
    pityEl.replaceChildren(
      el('div', {}, `🎯 Misses in a row: ${fails}`),
      el('div', { class: 'pity-bar' }, el('i', { style: `width:${Math.min(100, (fails / pc.hard) * 100)}%` }), el('span', { class: 'pity-soft', style: `left:${(pc.soft / pc.hard) * 100}%` })),
      el('div', { class: 'muted small' }, fails + 1 >= pc.soft ? `🟡 Soft pity ON: +${Math.round((fails + 2 - pc.soft) * pc.softStep * 100)}% sure-upgrade chance this roll` : `🟡 Soft pity in ${soft} (from miss ${pc.soft}, +${Math.round(pc.softStep * 100)}% per miss)`),
      el('div', { class: 'muted small' }, hard <= 1 ? '🔴 Hard pity: the next reroll is a sure upgrade!' : `🔴 Hard pity in ${hard} (a sure upgrade at ${pc.hard} misses)`),
    );
    if (spinning) {
      // Same button, same place: a second click skips the spin.
      btn.replaceChildren(skipNow ? '⏭ Skip' : 'Rolling…', el('small', {}, 'land it now'));
      (btn as HTMLButtonElement).disabled = !skipNow;
      return;
    }
    btn.replaceChildren(top ? (what === 'grade' ? 'Top tier already' : 'Has every variant') : `🎲 Roll`, top ? '' : el('small', {}, `${cost} 💎 · you have ${app.store.shards}`));
    (btn as HTMLButtonElement).disabled = top || app.store.shards < cost;
  };

  const spin = (landing: string, improved: boolean, done: () => void) => {
    const os = outcomes();
    const N = 48, at = 40;
    const cells = Array.from({ length: N }, (_, i) => (i === at ? os.find((o) => o.id === landing) ?? os[0] : pick(os)));
    strip.replaceChildren(...cells.map(cell));
    strip.style.transition = 'none';
    strip.style.transform = 'translateX(0px)';
    const cw = 92; // cell width + gap (CSS)
    const viewW = reel.clientWidth || 600;
    const jitter = (Math.random() - 0.5) * (cw * 0.6);
    const target = at * cw + cw / 2 - viewW / 2 + jitter;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        strip.style.transition = 'transform 4.2s cubic-bezier(0.12, 0.8, 0.15, 1)';
        strip.style.transform = `translateX(${-target}px)`;
      }),
    );
    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      skipNow = null;
      strip.style.transition = 'none';
      strip.style.transform = `translateX(${-target}px)`;
      strip.children[at]?.classList.add(improved ? 'win' : 'lose');
      done();
    };
    skipNow = land;
    // Ticks as cells pass the marker.
    let last = -1;
    const t0 = performance.now();
    const tick = () => {
      if (landed) return;
      const m = new DOMMatrix(getComputedStyle(strip).transform);
      const i = Math.floor((-m.m41 + viewW / 2) / cw);
      if (i !== last) {
        last = i;
        sfx.tick();
      }
      if (performance.now() - t0 < 4300) requestAnimationFrame(tick);
      else land();
    };
    requestAnimationFrame(tick);
  };

  btn.addEventListener('click', () => {
    if (spinning) return void skipNow?.();
    spinning = true;
    render();
    app.socket?.timeout(6000).emit('inv:reroll', { iid, what }, (err, res) => {
      if (err || !res.ok) {
        spinning = false;
        sfx.error();
        render();
        return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      }
      app.store.shards = res.shards;
      pityCache = res.pity;
      spin(res.rolled, res.improved, () => {
        spinning = false;
        app.store.inventory = app.store.inventory.map((i) => (i.iid === res.item.iid ? res.item : i));
        app.store.noteSeen([res.item]);
        if (res.improved) sfx.reveal(res.forced ? 5 : 4);
        else sfx.click();
        toast(res.improved ? `✨ ${res.forced ? 'Pity! ' : ''}${itemLine(app, res.item)}` : 'No luck this time (it stays the same).', res.improved ? 'good' : 'info');
        app.store.emit();
      });
      render();
    });
  });

  panel.body.replaceChildren(info, reel, btn, pityEl, el('p', { class: 'hint' }, 'Your luck (skills, potions, title, gear) makes better rolls likelier. Every miss counts towards pity.'));
  strip.replaceChildren(...Array.from({ length: 12 }, () => cell(pick(outcomes()))));
  const off = app.store.on(() => !spinning && render());
  panel.onClose = () => off();
  render();
  app.socket?.timeout(5000).emit('inv:pity', (err, res) => {
    if (err || !res.ok) return;
    pityCache = res.pity;
    render();
  });
}
