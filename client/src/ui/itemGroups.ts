// Item lists grouped by what things are FOR: outfit pieces by body slot (head, face, back...),
// then potions & boosters, collectibles and furniture. Used by the bag, the pawn shop and the
// shard shop. On wide screens the groups sit side by side as columns.
import { el } from './dom';

export interface ItemGroupDef {
  id: string;
  icon: string;
  name: string;
  /** Item type → sub-heading, in display order. */
  slots: Array<[type: string, label: string]>;
}

export const ITEM_GROUPS: ItemGroupDef[] = [
  { id: 'outfit', icon: '👕', name: 'Outfit', slots: [['hat', '🎩 Head'], ['face', '🕶️ Face'], ['back', '🎒 Back'], ['aura', '✨ Aura'], ['namecolor', '🌈 Name colour']] },
  { id: 'chefs', icon: '👨‍🍳', name: 'Chefs', slots: [['chef', 'Head chef (stall)']] },
  { id: 'potions', icon: '🧪', name: 'Potions & boosters', slots: [['potion', 'Potions'], ['booster', 'Boosters']] },
  { id: 'collectibles', icon: '💎', name: 'Collectibles', slots: [['trinket', 'Trinkets']] },
  { id: 'furniture', icon: '🛋️', name: 'Furniture', slots: [['furniture', 'Furniture']] },
];

/**
 * Lays entries out in groups (sections with a heading, sub-headings per slot, a grid or list in
 * each). `typeOf` gives an entry's item type; `render` draws one entry. Empty groups are skipped;
 * unknown types land in "Other".
 */
export function groupedItems<T>(entries: T[], typeOf: (t: T) => string, render: (t: T) => HTMLElement, opts: { list?: boolean; small?: boolean } = {}): HTMLElement {
  const known = new Set(ITEM_GROUPS.flatMap((g) => g.slots.map(([t]) => t)));
  const groups: ItemGroupDef[] = [...ITEM_GROUPS, { id: 'other', icon: '📦', name: 'Other', slots: [['__other', '']] }];
  const root = el('div', { class: 'item-groups' });
  for (const g of groups) {
    const section = el('section', { class: 'item-group', 'data-group': g.id });
    let count = 0;
    for (const [type, label] of g.slots) {
      const mine = entries.filter((e) => (type === '__other' ? !known.has(typeOf(e)) : typeOf(e) === type));
      if (!mine.length) continue;
      count += mine.length;
      const body = el('div', { class: opts.list ? 'stack-list' : `item-grid${opts.small ? ' small' : ''}` }, ...mine.map(render));
      section.append(...(label && g.slots.length > 1 ? [el('div', { class: 'item-sub' }, label, el('span', { class: 'muted' }, ` ${mine.length}`))] : []), body);
    }
    if (!count) continue;
    section.prepend(el('h4', { class: 'item-group-title' }, `${g.icon} ${g.name}`, el('span', { class: 'muted' }, ` · ${count}`)));
    root.append(section);
  }
  return root;
}
