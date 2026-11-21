// 🗝️ Labirin Purba: your bag down there. 🛒 the merchant's wares (at Tok Peraih: the entrance hall and
// every rest chamber), ⚔️ your gear (wear what you own) and 🧪 your potions (drink a heal, or 🧵 go
// home). Prices are in Syiling Purba: carried coins go first, then banked. The server checks all of it.
import { LAB_SLOTS, gearLine, labGearList, type LabGearItem, type LabSelf, type LabSlot } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { closePanel, openPanel, tabs } from '../panel';
import { sfx } from '../sound';
import { coinIcon } from './labHud';

type Tab = 'shop' | 'gear' | 'potions';

const SLOT_LABEL: Record<LabSlot, string> = { weapon: '🗡️ Weapon', shield: '🛡️ Shield', armour: '🥋 Armour', charm: '📿 Charm' };

export function openLabBag(app: App, start: Tab = 'gear') {
  const lc = app.cfg.lab;
  const shop = start === 'shop';
  const panel = openPanel(shop ? `🛒 ${lc.merchant.name}` : '🎒 Labirin bag', { wide: true, testId: 'lab-bag' });
  const names: Tab[] = shop ? ['shop', 'potions', 'gear'] : ['gear', 'potions'];
  const titles: Record<Tab, string> = { shop: '🛒 Gear for sale', gear: '⚔️ Your gear', potions: '🧪 Potions' };
  let tab: Tab = names[0];
  let self: LabSelf | null = null;
  let busy = false;
  const head = el('div', { class: 'lab-bag-head' });
  const content = el('div', { class: 'lab-bag' }, el('p', { class: 'muted' }, 'Loading…'));
  panel.body.append(
    tabs(names.map((n) => titles[n]), (i) => {
      tab = names[i];
      render();
    }),
    head,
    content,
  );

  const done = (s: LabSelf, text?: string) => {
    self = s;
    busy = false;
    app.labHud?.updateSelf(s);
    if (text) toast(text, 'good');
    render();
  };
  const fail = (err: unknown, res: { ok: false; error: string } | { ok: true }) => {
    busy = false;
    sfx.error();
    toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
    render();
  };
  const buy = (id: string, n = 1) => {
    if (busy) return;
    busy = true;
    app.socket?.timeout(6000).emit('lab:buy', { id, n }, (err, res) => {
      if (err || !res.ok) return fail(err, res);
      sfx.coin();
      done(res.self, res.text);
    });
  };
  const equip = (slot: LabSlot, id: string | null) => {
    if (busy) return;
    busy = true;
    app.socket?.timeout(6000).emit('lab:equip', { slot, id }, (err, res) => {
      if (err || !res.ok) return fail(err, res);
      sfx.click();
      done(res.self);
    });
  };
  const drink = (id: string) => {
    if (busy) return;
    busy = true;
    app.socket?.timeout(6000).emit('lab:item', { id }, (err, res) => {
      if (err || !res.ok) return fail(err, res);
      sfx.coin();
      if (res.left) {
        closePanel();
        app.exitLab(res.self);
        toast(res.text, 'good', 4000);
        return;
      }
      done(res.self, res.text);
    });
  };

  const money = (s: LabSelf) => s.coins + s.carried;
  const stat = (s: LabSelf) => {
    const t = s.stats;
    return el('div', { class: 'lab-bag-stats' },
      el('span', {}, `❤️ ${s.hp}/${t.hp}`), el('span', {}, `⚔️ ${t.atk}`), el('span', {}, `🛡️ ${t.def}`), el('span', {}, `💨 ${t.spd}`),
      el('span', {}, `🎯 ${Math.round(t.crit * 100)}% crit`), t.block ? el('span', {}, `🧱 ${Math.round(t.block * 100)}% block`) : null);
  };

  const gearRow = (s: LabSelf, g: LabGearItem, mode: 'shop' | 'gear') => {
    const owned = s.owned.includes(g.id);
    const worn = s.gear[g.slot] === g.id;
    const locked = s.deepest < g.minFloor;
    const name = el('b', {}, g.name);
    name.style.color = g.color;
    const btn = el('button', { class: 'btn small', type: 'button', 'data-gear': g.id }) as HTMLButtonElement;
    if (mode === 'shop') {
      if (owned) {
        btn.textContent = worn ? '✓ Wearing' : 'Wear';
        btn.disabled = worn || busy;
        btn.addEventListener('click', () => equip(g.slot, g.id));
      } else if (locked) {
        btn.textContent = `🔒 Floor ${g.minFloor + 1}`;
        btn.disabled = true;
        btn.title = `Sold once you've reached floor ${g.minFloor + 1}`;
      } else {
        btn.replaceChildren(coinIcon(), ` ${g.price}`);
        btn.classList.add('primary');
        btn.disabled = busy || money(s) < g.price;
        btn.title = money(s) < g.price ? `You have ${money(s)}` : 'Buy it (you wear it at once if it beats what you have)';
        btn.addEventListener('click', () => buy(g.id));
      }
    } else {
      btn.textContent = worn ? 'Take off' : 'Wear';
      btn.disabled = busy;
      btn.addEventListener('click', () => equip(g.slot, worn ? null : g.id));
    }
    return el('div', { class: `lab-bag-row${worn ? ' worn' : ''}${locked && !owned ? ' locked' : ''}` },
      el('span', { class: 'lab-bag-icon' }, g.icon),
      el('span', { class: 'lab-bag-info' }, name, el('small', { class: 'muted' }, gearLine(g))),
      btn);
  };

  const render = () => {
    const s = self;
    if (!s) return;
    head.replaceChildren(
      el('div', { class: 'lab-bag-money' }, coinIcon(), el('b', {}, ` ${money(s)}`), el('span', { class: 'muted small' }, ` Syiling (${s.coins} banked${s.carried ? ` + ${s.carried} carried` : ''})`)),
      stat(s),
    );
    const list = labGearList(lc);
    if (tab === 'shop') {
      const groups = LAB_SLOTS.map((slot) => el('div', { class: 'lab-bag-group' }, el('h5', {}, SLOT_LABEL[slot]), ...list.filter((g) => g.slot === slot).map((g) => gearRow(s, g, 'shop'))));
      content.replaceChildren(
        el('p', { class: 'muted small' }, 'Gear is yours for good. Better tiers are sold once you reach deeper floors. Carried Syiling are spent first, then banked.'),
        el('div', { class: 'lab-bag-grid' }, ...groups),
      );
    } else if (tab === 'gear') {
      const groups = LAB_SLOTS.map((slot) => {
        const mine = list.filter((g) => g.slot === slot && s.owned.includes(g.id));
        return el('div', { class: 'lab-bag-group' }, el('h5', {}, SLOT_LABEL[slot]),
          ...(mine.length ? mine.map((g) => gearRow(s, g, 'gear')) : [el('p', { class: 'muted small' }, `Nothing yet. ${lc.merchant.name} sells it.`)]));
      });
      content.replaceChildren(
        el('p', { class: 'muted small' }, `Your town gear stays outside: down here only Labirin gear counts. Buy it from ${lc.merchant.name} in the entrance hall or a rest chamber.`),
        el('div', { class: 'lab-bag-grid' }, ...groups),
      );
    } else {
      const rows = lc.potions.list.map((p) => {
        const have = s.potions[p.id] ?? 0;
        const btns = el('span', { class: 'lab-bag-btns' });
        if (shop) {
          for (const n of [1, 5]) {
            const b = el('button', { class: 'btn small primary', type: 'button', 'data-potion': p.id }, `+${n} `, coinIcon(), ` ${p.price * n}`) as HTMLButtonElement;
            b.disabled = busy || have >= lc.potions.max || money(s) < p.price;
            b.addEventListener('click', () => buy(p.id, n));
            btns.append(b);
          }
        }
        if (s.inside && (p.heal || p.home)) {
          const u = el('button', { class: 'btn small', type: 'button', 'data-use': p.id }, p.home ? 'Go home' : 'Drink') as HTMLButtonElement;
          u.disabled = busy || !have || (!!p.heal && s.hp >= s.stats.hp);
          u.addEventListener('click', () => drink(p.id));
          btns.append(u);
        }
        return el('div', { class: 'lab-bag-row' },
          el('span', { class: 'lab-bag-icon' }, p.icon),
          el('span', { class: 'lab-bag-info' }, el('b', {}, `${p.name} `, el('span', { class: 'muted' }, `×${have}`)), el('small', { class: 'muted' }, p.desc)),
          btns);
      });
      content.replaceChildren(
        el('p', { class: 'muted small' }, `Carry up to ${lc.potions.max} of each. In a fight, use them from 🧪 Items (it takes your turn).`),
        ...rows,
      );
    }
  };

  app.socket?.timeout(6000).emit('lab:self', (err, res) => {
    if (err || !res.ok) return void content.replaceChildren(el('p', { class: 'muted' }, 'No response.'));
    self = res.self;
    render();
  });
}
