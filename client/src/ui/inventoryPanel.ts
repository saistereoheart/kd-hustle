// 🎒 Bag: inventory (equip cosmetics) + the Item Index / Collection Book.
import { striva, strivaTag } from './striva';
import { potionPower, improveBest, variantLabel, CASHIER_STAT_INFO, CASHIER_STATS, cashierStats, CHEF_STAT_INFO, CHEF_STATS, chefStats, EQUIP_SLOTS, formatMoney, gearBuff, gradeDef, gradeIndex, gradeMult, isCollectible, itemValueSen, nextGrade, pawnPriceSen, type EquipSlot } from '@kh/shared';

const STAT_NAME: Record<string, string> = { luck: 'luck', xp: 'XP', jobPay: 'job pay', passive: 'passive income', dishPrice: 'stall prices' };
import type { App } from '../app';
import { el, toast, keepUiState } from './dom';
import { closePanel, iconUrl, itemCard, openPanel, tabs, tierOf } from './panel';
import { groupedItems } from './itemGroups';
import { byRarity as rarityOrder } from './itemSort';
import { openMergeWindow, openRerollWindow } from './forge';
import { openBulkWindow } from './bulkWindow';
import { openGearPicker, openPetsPanel } from './pets/petsPanel';
import { sfx } from './sound';

export function openInventoryPanel(app: App, startTab = 0) {
  const panel = openPanel('🎒 Bag', { wide: true, testId: 'bag-panel', cls: 'bag-panel' });
  const rar = app.cfg.rarities;
  let tab = startTab;
  let selected: string | null = null; // stack key
  const content = el('div');
  panel.body.append(
    tabs(['Items', 'Item Index'], (i) => {
      tab = i;
      selected = null;
      render();
    }, startTab),
    content,
  );

  const equip = (iid: number) =>
    app.socket?.timeout(5000).emit('inv:equip', { iid }, (err, res) => {
      if (err || !res.ok) return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      const inst = app.store.inventory.find((i) => i.iid === iid);
      const def = inst && app.items.get(inst.itemId);
      if (def) app.store.equipped = { ...app.store.equipped, [def.type as EquipSlot]: iid };
      sfx.click();
      app.store.emit();
    });
  const unequip = (slot: EquipSlot) =>
    app.socket?.timeout(5000).emit('inv:unequip', { slot }, (err, res) => {
      if (err || !res.ok) return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      const next = { ...app.store.equipped };
      delete next[slot];
      app.store.equipped = next;
      app.store.emit();
    });

  /** Re-render without the grid jumping: the clicked card stays where it was on screen (the
   *  details card above the grid comes and goes, and stays pinned at the top while you scroll). */
  const keepInPlace = (key: string, fn: () => void) => {
    const find = () => [...content.querySelectorAll<HTMLElement>('.item-card')].find((c) => c.dataset.key === key);
    const before = find()?.getBoundingClientRect().top;
    fn();
    const after = find()?.getBoundingClientRect().top;
    if (before !== undefined && after !== undefined) panel.body.scrollTop += after - before;
    // Not hidden under the pinned details card.
    const card = find(), d = content.querySelector<HTMLElement>('.item-detail');
    if (card && d) {
      const gap = d.getBoundingClientRect().bottom + 6 - card.getBoundingClientRect().top;
      if (gap > 0) panel.body.scrollTop -= gap;
    }
  };

  /** What you're wearing (and your head chef / cashier): its own box beside the bag, so the
   *  grid only shows what's spare. Tap one for its details. */
  const wornBox = panel.side('👕 Wearing · 🏠 Placed');
  /** Furniture placed in your homes: inventory iid → where it is. */
  const placedIn = () => {
    const m = new Map<number, { unit: string; label: string }>();
    for (const pr of [...app.store.myProps, ...app.store.myShops]) {
      const u = app.listings.find((x) => x.id === pr.unit);
      const t = app.cfg.properties.types[pr.type];
      const label = `${t?.icon ?? '🏠'} ${t?.name ?? 'Home'}${u && u.n > 1 ? ` · unit ${u.n}` : ''}`;
      for (const pl of pr.layout) m.set(pl.iid, { unit: pr.unit, label });
    }
    return m;
  };
  const SLOT_LABEL: Record<EquipSlot, string> = { hat: '🎩 Head', face: '🕶️ Face', back: '🎒 Back', aura: '✨ Aura', namecolor: '🌈 Name colour', chef: '👨‍🍳 Head chef', cashier: '💵 Cashier' };
  const renderWorn = () => {
    const st = app.store;
    const rows = EQUIP_SLOTS.map((slot) => {
      const iid = st.equipped[slot];
      const inst = iid !== undefined ? st.inventory.find((i) => i.iid === iid) : undefined;
      const def = inst && app.items.get(inst.itemId);
      if (!inst || !def) return el('div', { class: 'worn-row empty', 'data-slot': slot }, el('span', { class: 'worn-slot' }, SLOT_LABEL[slot]), el('span', { class: 'muted small' }, 'nothing'));
      const key = `worn|${inst.iid}`;
      const tier = tierOf(rar, def.rarity).tier;
      const off = el('button', { class: 'btn small worn-off', type: 'button', 'data-action': 'unequip', title: 'Take it off (back into the bag)' }, '✕');
      off.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selected === key) selected = null;
        unequip(slot);
      });
      const name = el('b', { class: 'worn-name' }, def.name);
      name.style.color = tier.color;
      const row = el(
        'button',
        { class: `worn-row${selected === key ? ' selected' : ''}`, type: 'button', 'data-slot': slot, 'data-item': def.id },
        el('img', { src: iconUrl(def, inst.variant, 44), alt: '' }),
        el('span', { class: 'worn-info' }, el('span', { class: 'worn-slot' }, SLOT_LABEL[slot]), name, striva(inst.grade, inst.variant) ? strivaTag() : el('span', { class: 'muted small' }, `Tier ${inst.grade ?? 'D'}${inst.variant !== 'normal' ? ` · ${variantLabel(rar.variants, inst.variant)}` : ''}`)),
        off,
      );
      row.addEventListener('click', () => {
        if (tab !== 0) return;
        selected = selected === key ? null : key;
        render();
        panel.body.scrollTop = 0;
      });
      return row;
    });
    const none = EQUIP_SLOTS.every((slot) => st.equipped[slot] === undefined);
    // Furniture placed in your homes: also out of the bag grid, listed with where it is.
    const placed = placedIn();
    const placedRows = st.inventory
      .filter((i) => placed.has(i.iid))
      .map((inst) => {
        const def = app.items.get(inst.itemId);
        if (!def) return null;
        const key = `worn|${inst.iid}`;
        const name = el('b', { class: 'worn-name' }, def.name);
        name.style.color = tierOf(rar, def.rarity).tier.color;
        const row = el(
          'button',
          { class: `worn-row placed${selected === key ? ' selected' : ''}`, type: 'button', 'data-placed': String(inst.iid), 'data-item': def.id },
          el('img', { src: iconUrl(def, inst.variant, 44), alt: '' }),
          el('span', { class: 'worn-info' }, el('span', { class: 'worn-slot' }, placed.get(inst.iid)!.label), name, striva(inst.grade, inst.variant) ? strivaTag() : el('span', { class: 'muted small' }, `Tier ${inst.grade ?? 'D'}${inst.variant !== 'normal' ? ` · ${variantLabel(rar.variants, inst.variant)}` : ''}`)),
        );
        row.addEventListener('click', () => {
          if (tab !== 0) return;
          selected = selected === key ? null : key;
          render();
          panel.body.scrollTop = 0;
        });
        return row;
      })
      .filter((x): x is HTMLButtonElement => !!x);
    wornBox.replaceChildren(
      el('div', { class: 'muted small worn-hint' }, 'Worn items are kept here, out of the bag grid. ✕ takes one off.'),
      ...(none ? [el('div', { class: 'muted small worn-none' }, 'Nothing worn yet: tap an outfit piece in the bag, then Wear.')] : []),
      ...rows,
      ...(placedRows.length
        ? [el('h5', { class: 'worn-section' }, `🏠 In your homes (${placedRows.length})`), el('div', { class: 'muted small worn-hint' }, 'Placed furniture is kept out of the bag: take it out (inside the home → 🛠️ Decorate) to merge or sell it.'), ...placedRows]
        : []),
    );
  };

  const renderItems = () => {
    const st = app.store;
    renderWorn();
    const equippedIids = new Set(Object.values(st.equipped));
    const placed = placedIn();
    /** Worn or placed in a home: kept out of the grid. */
    const aside = (iid: number) => equippedIids.has(iid) || placed.has(iid);
    const byRarity = rarityOrder<{ itemId: string; grade: string; variant: string }>(app);
    // The grid: only what you're NOT wearing (worn copies are in the side box).
    const stacks = st
      .stacks()
      .map((s) => ({ ...s, items: s.items.filter((i) => !aside(i.iid)) }))
      .filter((s) => s.items.length)
      .sort(byRarity);
    // The one you tapped in the side box, if any.
    const wornSel = selected?.startsWith('worn|') ? st.inventory.find((i) => `worn|${i.iid}` === selected && aside(i.iid)) : undefined;
    const cards = new Map<(typeof stacks)[number], HTMLElement>();
    let detail: HTMLElement | null = null;
    const gcfg = app.cfg.grades;

    const detailFor = (s: (typeof stacks)[number], key: string, worn: boolean, home?: { unit: string; label: string }) => {
      const def = app.items.get(s.itemId)!;
      const crate = app.cratesOfItem.get(def.id);
      const tier = tierOf(rar, def.rarity).tier;
      const slot = (EQUIP_SLOTS as readonly string[]).includes(def.type) ? (def.type as EquipSlot) : null;
      const actions = el('div', { class: 'detail-actions' });
      if (def.effect) {
        const b = el('button', { class: 'btn primary', type: 'button', 'data-action': 'use' }, `Use (${s.items.length} left)`);
        b.addEventListener('click', () => app.useItem(s.items[0].iid));
        actions.append(b);
      }
      if (def.type === 'pet' || def.type === 'petgear') {
        const b = el('button', { class: 'btn primary', type: 'button', 'data-action': 'open-pets' }, def.type === 'pet' ? '🐾 Open in Teman (team, training, gear)' : '🎽 Put it on a Teman');
        b.addEventListener('click', () => (def.type === 'pet' ? openPetsPanel(app) : openGearPicker(app, s.items[0].iid)));
        actions.append(b);
      }
      if (slot && !home) {
        if (worn) {
          const b = el('button', { class: 'btn', type: 'button', 'data-action': 'unequip' }, 'Take off');
          b.addEventListener('click', () => {
            selected = null;
            unequip(slot);
          });
          actions.append(b);
        } else {
          const b = el('button', { class: 'btn primary', type: 'button', 'data-action': 'equip' }, slot === 'chef' ? '👨‍🍳 Make head chef' : slot === 'cashier' ? '💵 Make cashier' : `Wear (${slot})`);
          b.addEventListener('click', () => {
            selected = null;
            equip(s.items[0].iid);
          });
          actions.append(b);
        }
      }
      if (!worn) {
        // Hotbar: put this stack in the first free slot (or say where it already is).
        const ref = { kind: 'item' as const, itemId: s.itemId, variant: s.variant };
        const inSlot = app.store.hotbar.findIndex((h) => h?.kind === 'item' && h.itemId === s.itemId && h.variant === s.variant);
        const hb = el('button', { class: 'btn', type: 'button', 'data-action': 'add-hotbar' }, inSlot >= 0 ? `On hotbar (${(inSlot + 1) % 10}) · remove` : 'Add to hotbar');
        hb.addEventListener('click', () => {
          if (inSlot >= 0) return app.setHotbarSlot(inSlot, null);
          const free = app.store.hotbar.findIndex((h) => !h);
          if (free < 0) return toast('Hotbar is full. Right-click (or long-press) a slot to clear it.', 'bad');
          app.setHotbarSlot(free, ref);
          toast(`${def.name} → hotbar slot ${(free + 1) % 10}`, 'good');
        });
        actions.append(hb);
        // The forge: merge copies (a tier up, variants stack) and shard rerolls (with a reel).
        if (crate && s.serial === null) {
          const copies = st.inventory.filter((i) => i.itemId === s.itemId && i.serial === null && !aside(i.iid) && gradeIndex(gcfg, i.grade) === gradeIndex(gcfg, s.items[0]?.grade)).length;
          const m = el('button', { class: 'btn', type: 'button', 'data-action': 'merge', title: `${gcfg.mergeCount} copies at this tier → 1, a tier up, variants stack` }, `⚒️ Merge`, el('small', {}, `${copies}/${gcfg.mergeCount} copies`));
          m.addEventListener('click', () => openMergeWindow(app, s.items[0]?.iid));
          actions.append(m);
        }
        // Shard rerolls work on any item, limited and event ones too (merging needs crate copies).
        {
          for (const what of ['grade', 'variant'] as const) {
            const cost = (what === 'grade' ? gcfg.shards.rerollGrade : gcfg.shards.rerollVariant)[def.rarity] ?? 100;
            const b = el('button', { class: 'btn small', type: 'button', 'data-action': `reroll-${what}` }, `🎲 ${what === 'grade' ? 'Tier' : 'Variant'} reroll`, el('small', {}, `${cost} 💎`));
            b.addEventListener('click', () => openRerollWindow(app, s.items[0].iid, what));
            actions.append(b);
          }
        }
      } else if (home) {
        const go = el('button', { class: 'btn small', type: 'button', 'data-action': 'go-placed' }, '📍 Take me there');
        go.addEventListener('click', () => {
          const u = app.listings.find((x) => x.id === home.unit);
          closePanel();
          if (u) app.guide?.pointAt({ id: home.unit, label: 'YOUR HOME', icon: '🏠', x: u.x, y: u.y });
        });
        actions.append(go, el('div', { class: 'muted small' }, 'To merge, reroll or sell it, take it out first: go inside → 🛠️ Decorate → remove it.'));
      } else actions.append(el('div', { class: 'muted small' }, 'Take it off to merge, reroll, sell or put it on the hotbar.'));
      const buff = gearBuff(gcfg, { type: def.type, rarity: def.rarity, grade: s.grade, variant: s.variant });
      const nameEl = el('h4', {}, home ? `🏠 In your home (${home.label}) · ` : worn ? '✓ Wearing · ' : '', def.name);
      nameEl.style.color = tier.color;
      const close = el('button', { class: 'icon-btn item-detail-close', type: 'button', 'aria-label': 'Close details' }, '✕');
      close.addEventListener('click', () => {
        selected = null;
        if (worn) render();
        else keepInPlace(key, () => render());
      });
      return el(
        'div',
        { class: `item-detail sticky${worn ? ' worn' : ''}`, 'data-testid': 'item-detail' },
        close,
        el('img', { src: iconUrl(def, s.variant, 96), alt: def.name }),
        el(
          'div',
          {},
          nameEl,
          striva(s.grade, s.variant)
            ? el('div', { class: 'muted' }, `${tier.name} · `, strivaTag(), ` (×${gradeMult(gcfg, s.grade)} · ${variantLabel(rar.variants, s.variant)})${s.serial ? ` · #${s.serial} of ${def.limit}` : ''} · ${def.type}`)
            : el('div', { class: 'muted' }, `${tier.name} · Tier ${s.grade} (×${gradeMult(gcfg, s.grade)})${s.variant !== 'normal' ? ` · ${variantLabel(rar.variants, s.variant)}` : ''}${s.serial ? ` · #${s.serial} of ${def.limit}` : ''} · ${def.type}`),
          def.desc ? el('p', {}, def.desc) : null,
          // 🧪 A potion of a better tier / with variants: what this one really does.
          (() => {
            if (!def.effect) return null;
            const pw = potionPower(gcfg, def.effect, s.grade, s.variant);
            if (pw.q <= 1) return null;
            const what = pw.charges !== undefined ? `${pw.charges} uses` : `×${pw.mult} for ${Math.round((pw.durationSec ?? 0) / 60)} min`;
            return el('div', { class: 'item-buff' }, `🧪 This one (its tier and variants): ${what} (a plain one: ${def.effect.charges !== undefined ? `${def.effect.charges} uses` : `×${def.effect.mult} for ${Math.round((def.effect.durationSec ?? 0) / 60)} min`})`);
          })(),
          def.type === 'cashier'
            ? el('div', { class: 'item-buff' }, `As kopitiam cashier: ${CASHIER_STATS.map((k) => { const v = cashierStats(gcfg, { id: def.id, rarity: def.rarity, grade: s.grade, variant: s.variant }, app.mods().cashier?.boost ?? app.mods().chef?.boost ?? 0)[k]; return `${CASHIER_STAT_INFO[k].icon} +${(v * 100).toFixed(v < 0.1 ? 1 : 0)}% ${CASHIER_STAT_INFO[k].name.toLowerCase()}`; }).join(' · ')}`)
            : def.type === 'chef'
            ? el('div', { class: 'item-buff' }, `As head chef: ${CHEF_STATS.map((k) => { const v = chefStats(gcfg, { id: def.id, rarity: def.rarity, grade: s.grade, variant: s.variant }, app.mods().chef?.boost ?? 0)[k]; return `${CHEF_STAT_INFO[k].icon} +${(v * 100).toFixed(v < 0.1 ? 1 : 0)}% ${CHEF_STAT_INFO[k].name.toLowerCase()}`; }).join(' · ')}`)
            : buff ? el('div', { class: 'item-buff' }, `When worn: +${(buff.value * 100).toFixed(buff.value < 0.1 ? 1 : 0)}% ${STAT_NAME[buff.stat]}`) : null,
          el('div', {}, `Value ${formatMoney(itemValueSen(rar, def, crate, s.variant, gradeMult(gcfg, s.grade)))} · pawn pays ${formatMoney(pawnPriceSen(rar, def, crate, s.variant, app.cfg.economy.pawnRate, gradeMult(gcfg, s.grade)))}`),
          worn ? null : el('div', { class: 'muted' }, 'Sell or scrap at Kedai Pajak Untung (next to Kedai Runcit).'),
          def.type === 'furniture' ? furnitureHelp(app, def.id) : null,
          actions,
        ),
      );
    };

    if (wornSel) {
      detail = detailFor({ itemId: wornSel.itemId, variant: wornSel.variant, grade: wornSel.grade ?? 'D', serial: wornSel.serial, items: [wornSel] }, `worn|${wornSel.iid}`, true, placed.get(wornSel.iid));
    } else if (selected?.startsWith('worn|')) selected = null; // taken off meanwhile

    for (const s of stacks) {
      const def = app.items.get(s.itemId)!;
      const key = `${s.itemId}|${s.variant}|${s.grade}|${s.serial ?? ''}`;
      const card = itemCard(rar, def, s.variant, { count: s.items.length, serial: s.serial, grade: s.grade, gradeColor: gradeDef(gcfg, s.grade).color });
      card.dataset.item = s.itemId;
      card.dataset.key = key;
      card.tabIndex = 0;
      if (selected === key) card.classList.add('selected');
      card.addEventListener('click', () => {
        selected = selected === key ? null : key;
        keepInPlace(key, () => render());
      });
      cards.set(s, card);
      if (selected === key) detail = detailFor(s, key, false);
    }
    if (!stacks.length) {
      content.replaceChildren(...(detail ? [detail] : []), el('p', { class: 'empty' }, Object.keys(st.equipped).length
        ? 'Nothing spare in your bag: everything you own is worn (see 👕 Wearing). Roll a crate for more: the Capsule Machine is inside Kedai Runcit Pak Abu, just north of the square.'
        : 'Your bag is empty. Roll a crate: the Capsule Machine is inside Kedai Runcit Pak Abu, just north of the square.'));
      return;
    }
    // Grouped by what it's for: outfit (head, face, back...), potions, collectibles, furniture.
    const grouped = groupedItems(stacks, (s) => app.items.get(s.itemId)!.type, (s) => cards.get(s)!);
    const mergeAll = el('button', { class: 'btn small', type: 'button', 'data-action': 'merge-all' }, '⚒️ Merge all…');
    mergeAll.addEventListener('click', () => openBulkWindow(app, 'merge'));
    content.replaceChildren(...(detail ? [detail] : []), el('div', { class: 'bulk-entry' }, mergeAll), grouped);
  };

  const renderIndex = () => {
    renderWorn();
    const st = app.store;
    const gcfgIdx = app.cfg.grades;
    const collectibles = app.cfg.items.items.filter(isCollectible);
    const total = collectibles.length;
    const found = collectibles.filter((i) => st.index.has(i.id)).length;
    // 📖 The best you've ever had of each: the server's record, plus anything that came in since.
    const best = new Map(st.best);
    for (const c of [...st.seen, ...st.inventory]) {
      const next = improveBest(gcfgIdx, rar.variants, best.get(c.itemId), c);
      if (next) best.set(c.itemId, next);
    }
    const parts: HTMLElement[] = [
      el('div', { class: 'index-total' }, `Collection: ${found}/${total} (${Math.round((found / total) * 100)}%)`),
      el('div', { class: 'muted small index-hint' }, 'Each item shows the best you\'ve ever had of it: its highest tier (the badge and glow) and its best variant (the art).'),
    ];
    for (const c of app.cfg.crates.crates) {
      const have = c.pool.filter((id) => st.index.has(id)).length;
      const reward = Math.round(c.priceSen * app.cfg.economy.indexPageRewardMultiplier);
      const done = st.pages.has(c.id);
      const g = el('div', { class: 'item-grid small' });
      for (const id of c.pool) {
        const def = app.items.get(id)!;
        const b = st.index.has(id) ? best.get(id) : undefined;
        const gd = b ? gradeDef(gcfgIdx, b.grade) : undefined;
        const card = itemCard(rar, def, b?.variant ?? 'normal', { silhouette: !st.index.has(id), size: 56, grade: b?.grade, gradeColor: gd?.color });
        card.classList.add('index-card');
        if (b && gd) {
          card.style.setProperty('--best', gd.color);
          card.classList.add('has-best', `best-g${gradeIndex(gcfgIdx, b.grade)}`);
          card.title = `${def.name} · best: ${striva(b.grade, b.variant) ? 'STRIVA' : `${gd.name}${b.variant !== 'normal' ? ` · ${variantLabel(rar.variants, b.variant)}` : ''}`}`;
        }
        g.append(card);
      }
      const bar = el('div', { class: 'progress' }, el('i', {}));
      (bar.firstChild as HTMLElement).style.width = `${(have / c.pool.length) * 100}%`;
      parts.push(
        el('div', { class: 'index-page' }, el('h4', {}, `${c.name}`, el('span', { class: 'muted' }, ` ${have}/${c.pool.length}`)), bar, el('div', { class: 'muted' }, done ? `✓ Page reward claimed (${formatMoney(reward)})` : `Complete the page: +${formatMoney(reward)}`), g),
      );
    }
    content.replaceChildren(...parts);
  };

  const render = () => (tab === 0 ? renderItems() : renderIndex());
  const off = app.store.on(() => keepUiState(panel.body, render));
  panel.onClose = () => off();
  panel.onResume = () => keepUiState(panel.body, render); // back from the forge: counts changed
  render();
}

/** Furniture in the Bag: its stats, where it comes from, and how to place it. */
function furnitureHelp(app: App, id: string): HTMLElement {
  const f = app.cfg.furniture;
  const p = f.pieces[id];
  const box = el('div', { class: 'furniture-help' });
  if (p) {
    box.append(el('div', { class: 'item-buff' }, [
      `${p.w}×${p.h} m${p.wall ? ' · on a wall' : p.floor ? ' · on the floor' : ''}`,
      `🛏️ comfort ${p.comfort} · 💅 style ${p.style}`,
      p.theme ? `🎨 ${f.themes[p.theme]?.name ?? p.theme}` : '',
      p.essential ? `⭐ essential: ${p.essential}` : '',
      p.amenity ? `✨ amenity: ${p.amenity}` : '',
    ].filter(Boolean).join(' · ')));
    box.append(el('div', { class: 'muted small' }, p.storeSen ? `Sold at ${f.storeName} for ${formatMoney(p.storeSen)}.` : 'Only from the Mall Mystery Box (The Strand Mall).'));
  }
  const homes = app.store.myProps.length;
  box.append(el('div', { class: 'muted small' }, homes
    ? '🛠️ To use it: go into your home (📱 Properties → 📍 Take me there, then E at the door), tap Decorate, pick it and tap the floor.'
    : '🏠 You need a home to place furniture: your first one is free (📱 Properties, or walk to a 🏷️ FOR SALE door).'));
  const row = el('div', { class: 'detail-actions' });
  const go = el('button', { class: 'btn small', type: 'button', 'data-action': 'go-ikeja' }, `📍 Take me to ${f.storeName}`);
  go.addEventListener('click', () => {
    closePanel();
    app.guide?.point('ikeja');
  });
  row.append(go);
  if (homes) {
    const home = el('button', { class: 'btn small', type: 'button', 'data-action': 'go-home' }, '🏠 Take me home');
    home.addEventListener('click', () => {
      const s = app.store.myProps[0];
      const u = app.listings.find((x) => x.id === s.unit);
      closePanel();
      if (u) app.guide?.pointAt({ id: s.unit, label: 'YOUR HOME', icon: '🏠', x: u.x, y: u.y });
    });
    row.append(home);
  }
  box.append(row);
  return box;
}
