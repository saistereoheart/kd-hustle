// 🎒 Bag: inventory (equip cosmetics) + the Item Index / Collection Book.
import { EQUIP_SLOTS, formatMoney, gearBuff, gradeDef, gradeMult, isCollectible, itemValueSen, nextGrade, pawnPriceSen, type EquipSlot } from '@kh/shared';

const STAT_NAME: Record<string, string> = { luck: 'luck', xp: 'XP', jobPay: 'job pay', passive: 'passive income', dishPrice: 'stall prices' };
import type { App } from '../app';
import { el, toast } from './dom';
import { iconUrl, itemCard, openPanel, tabs, tierOf } from './panel';
import { groupedItems } from './itemGroups';
import { sfx } from './sound';

export function openInventoryPanel(app: App, startTab = 0) {
  const panel = openPanel('🎒 Bag', { wide: true, testId: 'bag-panel' });
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

  const renderItems = () => {
    const st = app.store;
    const stacks = st.stacks().sort(
      (a, b) =>
        tierOf(rar, app.items.get(b.itemId)!.rarity).index - tierOf(rar, app.items.get(a.itemId)!.rarity).index || a.itemId.localeCompare(b.itemId),
    );
    if (!stacks.length) {
      content.replaceChildren(el('p', { class: 'empty' }, 'Your bag is empty. Roll a crate: the Capsule Machine is inside Kedai Runcit Pak Abu, just north of the square.'));
      return;
    }
    const equippedIids = new Set(Object.values(st.equipped));
    const cards = new Map<(typeof stacks)[number], HTMLElement>();
    let detail: HTMLElement | null = null;
    for (const s of stacks) {
      const def = app.items.get(s.itemId)!;
      const key = `${s.itemId}|${s.variant}|${s.grade}|${s.serial ?? ''}`;
      const worn = s.items.some((i) => equippedIids.has(i.iid));
      const gcfg = app.cfg.grades;
      const card = itemCard(rar, def, s.variant, { count: s.items.length, equipped: worn, serial: s.serial, grade: s.grade, gradeColor: gradeDef(gcfg, s.grade).color });
      card.dataset.item = s.itemId;
      card.tabIndex = 0;
      if (selected === key) card.classList.add('selected');
      card.addEventListener('click', () => {
        selected = selected === key ? null : key;
        render();
      });
      cards.set(s, card);
      if (selected === key) {
        const crate = app.cratesOfItem.get(def.id);
        const tier = tierOf(rar, def.rarity).tier;
        const slot = (EQUIP_SLOTS as readonly string[]).includes(def.type) ? (def.type as EquipSlot) : null;
        const actions = el('div', { class: 'detail-actions' });
        if (def.effect) {
          const b = el('button', { class: 'btn primary', type: 'button', 'data-action': 'use' }, `Use (${s.items.length} left)`);
          b.addEventListener('click', () => app.useItem(s.items[0].iid));
          actions.append(b);
        }
        if (slot) {
          if (worn) {
            const b = el('button', { class: 'btn', type: 'button', 'data-action': 'unequip' }, 'Take off');
            b.addEventListener('click', () => unequip(slot));
            actions.append(b);
          } else {
            const b = el('button', { class: 'btn primary', type: 'button', 'data-action': 'equip' }, `Wear (${slot})`);
            b.addEventListener('click', () => equip(s.items[0].iid));
            actions.append(b);
          }
        }
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
        // Tiers: merge copies up a tier; shards for a chance at a better tier or variant.
        const fromCrate = !!crate && s.serial === null;
        const next = nextGrade(gcfg, s.grade);
        const sameTier = st.inventory.filter((i) => i.itemId === s.itemId && (i.grade ?? 'D') === s.grade && i.serial === null && !equippedIids.has(i.iid)).length;
        if (fromCrate && next) {
          const m = el('button', { class: 'btn', type: 'button', 'data-action': 'merge', disabled: sameTier < gcfg.mergeCount, title: `${gcfg.mergeCount} × Tier ${s.grade} → 1 × Tier ${next} (keeps the best variant)` }, `⬆️ Merge ${gcfg.mergeCount} → Tier ${next}`, el('small', {}, `${sameTier}/${gcfg.mergeCount} (not worn)`));
          m.addEventListener('click', () =>
            app.socket?.timeout(5000).emit('inv:merge', { itemId: s.itemId, grade: s.grade }, (err, res) => {
              if (err || !res.ok) return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
              sfx.reveal(3);
              app.store.removeItems(res.removed);
              app.store.addItems([res.item]);
              toast(`⬆️ ${def.name} is now Tier ${res.item.grade}${res.item.variant !== 'normal' ? ` (${res.item.variant})` : ''}!`, 'good');
              selected = null;
              render();
            }),
          );
          actions.append(m);
        }
        if (fromCrate) {
          for (const what of ['grade', 'variant'] as const) {
            const cost = (what === 'grade' ? gcfg.shards.rerollGrade : gcfg.shards.rerollVariant)[def.rarity] ?? 100;
            const top = what === 'grade' ? !next : s.variant === rar.variants[rar.variants.length - 1].id;
            const b = el('button', { class: 'btn small', type: 'button', 'data-action': `reroll-${what}`, disabled: top || st.shards < cost }, `🎲 ${what === 'grade' ? 'Tier' : 'Variant'} reroll`, el('small', {}, `${cost} 💎`));
            b.addEventListener('click', () =>
              app.socket?.timeout(5000).emit('inv:reroll', { iid: s.items.find((i) => !equippedIids.has(i.iid))?.iid ?? s.items[0].iid, what }, (err, res) => {
                if (err || !res.ok) return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
                app.store.shards = res.shards;
                app.store.inventory = app.store.inventory.map((i) => (i.iid === res.item.iid ? res.item : i));
                if (res.improved) sfx.reveal(4);
                else sfx.click();
                toast(res.improved ? `✨ Better! Tier ${res.item.grade}${res.item.variant !== 'normal' ? ` · ${res.item.variant}` : ''}` : 'No luck this time (it stays the same).', res.improved ? 'good' : 'info');
                selected = null;
                app.store.emit();
              }),
            );
            actions.append(b);
          }
        }
        const buff = gearBuff(gcfg, { type: def.type, rarity: def.rarity, grade: s.grade, variant: s.variant });
        const nameEl = el('h4', {}, def.name);
        nameEl.style.color = tier.color;
        detail = el(
          'div',
          { class: 'item-detail' },
          el('img', { src: iconUrl(def, s.variant, 96), alt: def.name }),
          el(
            'div',
            {},
            nameEl,
            el('div', { class: 'muted' }, `${tier.name} · Tier ${s.grade} (×${gradeMult(gcfg, s.grade)})${s.variant !== 'normal' ? ` · ${s.variant}` : ''}${s.serial ? ` · #${s.serial} of ${def.limit}` : ''} · ${def.type}`),
            def.desc ? el('p', {}, def.desc) : null,
            buff ? el('div', { class: 'item-buff' }, `When worn: +${(buff.value * 100).toFixed(buff.value < 0.1 ? 1 : 0)}% ${STAT_NAME[buff.stat]}`) : null,
            el('div', {}, `Value ${formatMoney(itemValueSen(rar, def, crate, s.variant, gradeMult(gcfg, s.grade)))} · pawn pays ${formatMoney(pawnPriceSen(rar, def, crate, s.variant, app.cfg.economy.pawnRate, gradeMult(gcfg, s.grade)))}`),
            el('div', { class: 'muted' }, 'Sell or scrap at Kedai Pajak Untung (next to Kedai Runcit).'),
            actions,
          ),
        );
      }
    }
    // Grouped by what it's for: outfit (head, face, back...), potions, collectibles, furniture.
    const grouped = groupedItems(stacks, (s) => app.items.get(s.itemId)!.type, (s) => cards.get(s)!);
    content.replaceChildren(...(detail ? [detail] : []), grouped);
  };

  const renderIndex = () => {
    const st = app.store;
    const collectibles = app.cfg.items.items.filter(isCollectible);
    const total = collectibles.length;
    const found = collectibles.filter((i) => st.index.has(i.id)).length;
    const parts: HTMLElement[] = [el('div', { class: 'index-total' }, `Collection: ${found}/${total} (${Math.round((found / total) * 100)}%)`)];
    for (const c of app.cfg.crates.crates) {
      const have = c.pool.filter((id) => st.index.has(id)).length;
      const reward = Math.round(c.priceSen * app.cfg.economy.indexPageRewardMultiplier);
      const done = st.pages.has(c.id);
      const g = el('div', { class: 'item-grid small' });
      for (const id of c.pool) {
        const def = app.items.get(id)!;
        g.append(itemCard(rar, def, 'normal', { silhouette: !st.index.has(id), size: 56 }));
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
  const off = app.store.on(render);
  panel.onClose = () => off();
  render();
}
