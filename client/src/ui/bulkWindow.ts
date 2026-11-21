// ⚒️ Merge all / ♻️ Scrap all: pick what's included with filters (rarity, kind of item, tier,
// variants) and tick items in or out one by one. Items you untick are remembered (on this device)
// as excluded until you tick them again. The preview here is a guide; the server does the real
// work and says what it did.
import { gradeDef, gradeIndex, gradeMult, mergePreview, planScrap, scrapShards, type ItemDef } from '@kh/shared';
import type { App } from '../app';
import { el, keepUiState, rebuildNow, toast } from './dom';
import { iconUrl, openPanel, tierOf } from './panel';
import { ITEM_GROUPS } from './itemGroups';
import { forgeable, placedIids } from './forge';
import { sfx } from './sound';

type Mode = 'merge' | 'scrap';

interface Row {
  def: ItemDef;
  /** Merge: how many merges. Scrap: how many copies go. */
  n: number;
  /** Scrap: shards for them. */
  shards: number;
  /** A short line: what happens to it. */
  info: string;
  keptLast: boolean;
}

const EXCLUDE_KEY = (m: Mode) => `kh.bulk.${m}.exclude`;
function loadExcluded(m: Mode): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(EXCLUDE_KEY(m)) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
function saveExcluded(m: Mode, s: Set<string>) {
  try {
    localStorage.setItem(EXCLUDE_KEY(m), JSON.stringify([...s]));
  } catch {
    /* private mode: just this time */
  }
}

const groupOf = (type: string) => ITEM_GROUPS.find((g) => g.slots.some(([t]) => t === type))?.id ?? 'other';

export function openBulkWindow(app: App, mode: Mode) {
  const g = app.cfg.grades;
  const rar = app.cfg.rarities;
  const panel = openPanel(mode === 'merge' ? '⚒️ Merge all' : '♻️ Scrap all', { wide: true, testId: `bulk-${mode}` });
  const excluded = loadExcluded(mode);
  // Filters. Scrapping is for good: it starts careful (Common–Rare, Tier D, no variants).
  const rarities = new Set(rar.tiers.map((t) => t.id).filter((id) => mode === 'merge' || ['common', 'uncommon', 'rare'].includes(id)));
  // Scrapping leaves potions, chefs / cashiers and Teman out unless you add them.
  const groups = new Set([...ITEM_GROUPS.map((x) => x.id), 'other'].filter((id) => mode === 'merge' || !['potions', 'chefs', 'pets'].includes(id)));
  let tier = mode === 'merge' ? g.grades.length - 1 : 0; // merge: up to; scrap: at or below
  let keepVariants = true;
  let armed = false; // scrap: second tap confirms
  let busy = false;

  const rows = (): Row[] => {
    const out: Row[] = [];
    const inv = app.store.inventory;
    if (mode === 'merge') {
      const byItem = new Map<string, number[]>();
      for (const i of forgeable(app)) {
        const c = byItem.get(i.itemId) ?? new Array(g.grades.length).fill(0);
        c[gradeIndex(g, i.grade)]++;
        byItem.set(i.itemId, c);
      }
      for (const [id, counts] of byItem) {
        const def = app.items.get(id);
        if (!def) continue;
        const r = mergePreview(counts, g.mergeCount, tier);
        if (!r.merges) continue;
        const now = counts.map((n, k) => (n ? `${n} ${g.grades[k].id}` : '')).filter(Boolean).join(' · ');
        const after = r.after.map((n, k) => (n ? `${n} ${g.grades[k].id}` : '')).filter(Boolean).join(' · ');
        out.push({ def, n: r.merges, shards: 0, info: `${now} → ${after}`, keptLast: false });
      }
    } else {
      const worn = new Set(Object.values(app.store.equipped));
      const placed = placedIids(app);
      const ids = new Set(inv.map((i) => i.itemId));
      for (const id of ids) {
        const def = app.items.get(id);
        if (!def) continue;
        const all = inv.filter((i) => i.itemId === id);
        const usable = all.filter((i) => !worn.has(i.iid) && !placed.has(i.iid));
        const { scrap, keptLast } = planScrap(g, rar.variants, all, usable, { maxGrade: tier, keepVariants });
        if (!scrap.length) continue;
        const shards = scrap.reduce((a, i) => a + Math.round(scrapShards(rar, def, i.variant) * gradeMult(g, i.grade)), 0);
        out.push({ def, n: scrap.length, shards, info: `${scrap.length} of ${all.length}${keptLast ? ' (keeps your last one)' : ''} · +${shards} 💎`, keptLast });
      }
    }
    const order = new Map(rar.tiers.map((t, k) => [t.id, k]));
    return out.sort((a, b) => (order.get(a.def.rarity) ?? 0) - (order.get(b.def.rarity) ?? 0) || a.def.name.localeCompare(b.def.name));
  };

  const chip = (label: string, on: boolean, click: () => void, color?: string) => {
    const b = el('button', { class: `chip bulk-chip${on ? ' active' : ''}`, type: 'button' }, label);
    if (color) b.style.setProperty('--chip', color);
    b.addEventListener('click', () => {
      armed = false;
      click();
      render();
    });
    return b;
  };

  // Re-render without losing the list's scroll (ticking a box, or a store update: report #12).
  const render = () => rebuildNow(panel.body, draw);
  const draw = () => {
    const all = rows();
    const shown = all.filter((r) => rarities.has(r.def.rarity) && groups.has(groupOf(r.def.type)));
    const picked = shown.filter((r) => !excluded.has(r.def.id));
    // --- filters
    const rarRow = el('div', { class: 'bulk-chips' }, el('span', { class: 'bulk-label' }, 'Rarity'),
      ...rar.tiers.map((t) => chip(t.name, rarities.has(t.id), () => (rarities.has(t.id) ? rarities.delete(t.id) : rarities.add(t.id)), t.color)));
    const kinds = [...ITEM_GROUPS.map((x) => ({ id: x.id, label: `${x.icon} ${x.name}` })), { id: 'other', label: '📦 Other' }];
    const kindRow = el('div', { class: 'bulk-chips' }, el('span', { class: 'bulk-label' }, 'Kind'),
      ...kinds.map((k) => chip(k.label, groups.has(k.id), () => (groups.has(k.id) ? groups.delete(k.id) : groups.add(k.id)))));
    const tierChoices = mode === 'merge' ? g.grades.slice(1) : g.grades;
    const tierRow = el('div', { class: 'bulk-chips' }, el('span', { class: 'bulk-label' }, mode === 'merge' ? 'Merge up to' : 'Tiers'),
      ...tierChoices.map((x) => {
        const k = gradeIndex(g, x.id);
        return chip(mode === 'merge' ? x.name : `${x.id}${k ? ' and below' : ' only'}`, tier === k, () => (tier = k), x.color);
      }));
    const extra = mode === 'scrap'
      ? el('div', { class: 'bulk-chips' }, el('span', { class: 'bulk-label' }, 'Variants'), chip('✨ Keep Shiny / Golden / Rainbow', keepVariants, () => (keepVariants = !keepVariants)))
      : null;
    // --- the list
    const list = el('div', { class: 'bulk-list' });
    for (const r of shown) {
      const on = !excluded.has(r.def.id);
      const name = el('b', {}, r.def.name);
      name.style.color = tierOf(rar, r.def.rarity).tier.color;
      const box = el('input', { type: 'checkbox', 'data-item': r.def.id }) as HTMLInputElement;
      box.checked = on;
      const row = el('label', { class: `bulk-row${on ? '' : ' off'}` }, box, el('img', { src: iconUrl(r.def, 'normal', 40), alt: '' }),
        el('span', { class: 'bulk-info' }, name, el('small', { class: 'muted' }, mode === 'merge' ? `${r.n} merge${r.n > 1 ? 's' : ''} · ${r.info}` : r.info)));
      box.addEventListener('change', () => {
        armed = false;
        if (box.checked) excluded.delete(r.def.id);
        else excluded.add(r.def.id);
        saveExcluded(mode, excluded);
        render();
      });
      list.append(row);
    }
    const all1 = el('button', { class: 'btn small', type: 'button' }, 'Tick all');
    all1.addEventListener('click', () => {
      for (const r of shown) excluded.delete(r.def.id);
      saveExcluded(mode, excluded);
      armed = false;
      render();
    });
    const none = el('button', { class: 'btn small', type: 'button' }, 'Untick all');
    none.addEventListener('click', () => {
      for (const r of shown) excluded.add(r.def.id);
      saveExcluded(mode, excluded);
      armed = false;
      render();
    });
    // --- go
    const total = picked.reduce((a, r) => a + r.n, 0);
    const shards = picked.reduce((a, r) => a + r.shards, 0);
    const go = el('button', { class: `btn ${armed ? 'danger' : 'primary'}`, type: 'button', 'data-action': `bulk-${mode}-go` },
      mode === 'merge'
        ? `⚒️ Merge all · ${total} merge${total === 1 ? '' : 's'}`
        : armed ? `Tap again: scrap ${total} for +${shards} 💎` : `♻️ Scrap ${total} item${total === 1 ? '' : 's'} · +${shards} 💎`) as HTMLButtonElement;
    go.disabled = busy || !total;
    go.addEventListener('click', () => (mode === 'scrap' && !armed ? ((armed = true), render()) : send(picked.map((r) => r.def.id))));
    panel.body.replaceChildren(
      el('div', { class: 'bulk-filters' }, rarRow, kindRow, tierRow, extra),
      el('div', { class: 'bulk-head' }, el('b', {}, `${picked.length} of ${shown.length} items included`), all1, none),
      shown.length ? list : el('p', { class: 'empty' }, all.length ? 'Nothing matches these filters.' : mode === 'merge' ? `You don't have ${g.mergeCount} copies of anything at one tier yet.` : 'Nothing to scrap (you always keep one copy of each item).'),
      go,
      el('p', { class: 'hint' }, mode === 'merge'
        ? `Every ${g.mergeCount} copies at a tier become 1 a tier up, again and again up to the tier you pick. Variants are spread over the results and kept. Worn, placed and limited items are left alone.`
        : 'You always keep at least one copy of every item (the best one). Worn, placed and limited items are left alone. Untick anything you want to keep: it stays unticked next time.'),
    );
  };

  const send = (items: string[]) => {
    if (busy || !items.length) return;
    busy = true;
    armed = false;
    render();
    const sock = app.socket?.timeout(15000);
    const done = () => {
      busy = false;
      render();
    };
    if (mode === 'merge') {
      sock?.emit('inv:mergeAll', { items, upTo: g.grades[tier].id }, (err, res) => {
        if (err || !res.ok) {
          sfx.error();
          toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
          return done();
        }
        app.store.removeItems(res.removed);
        app.store.addItems(res.items);
        sfx.reveal(res.bonuses ? 5 : 3);
        const best = [...res.items].sort((a, b) => gradeIndex(g, b.grade) - gradeIndex(g, a.grade))[0];
        toast(`⚒️ ${res.merges} merge${res.merges === 1 ? '' : 's'} done${best ? ` · best: ${gradeDef(g, best.grade).name}` : ''}${res.bonuses ? ` · ✨ ${res.bonuses} bonus variant${res.bonuses === 1 ? '' : 's'}!` : ''}`, 'good', 5000);
        done();
      });
    } else {
      sock?.emit('pawn:scrapAll', { items, maxGrade: g.grades[tier].id, keepVariants }, (err, res) => {
        if (err || !res.ok) {
          sfx.error();
          toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
          return done();
        }
        app.store.removeItems(res.removed);
        sfx.coin();
        toast(`♻️ Scrapped ${res.count} for +${res.gainedShards} 💎${res.kept.length ? ` · kept your last ${res.kept.length === 1 ? res.kept[0] : `copy of ${res.kept.length} items`}` : ''}`, 'good', 5000);
        done();
      });
    }
  };

  const off = app.store.on(() => !busy && keepUiState(panel.body, draw));
  panel.onClose = () => off();
  draw();
}
