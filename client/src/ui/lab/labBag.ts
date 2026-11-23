// 🗝️ Labirin Purba: your bag down there. 🛒 the merchant's wares (at Tok Peraih: the entrance hall and
// every rest chamber), ⚔️ your gear (wear what you own), 🔥 elements (your 💥 skill and 📜 ultimate),
// 📖 skills, 📜 spell books and 🧪 your potions (drink a heal or mana, or 🧵 go home). Prices are in Syiling Purba: carried coins go first, then banked. The server checks all of it.
import { LAB_SLOTS, branchPoints, gearLine, itemMult, itemName, itemScrap, labGear, labGearList, labStats, treeBlock, wornBonus, type LabGearItem, type LabSelf, type LabSlot } from '@kh/shared';
import type { App } from '../../app';
import { el, labSay } from '../dom';
import { closePanel, openPanel, tabs } from '../panel';
import { sfx } from '../sound';
import { coinIcon } from './labHud';

type Tab = 'shop' | 'gear' | 'potions' | 'skills' | 'books' | 'elements' | 'classes';

const SLOT_LABEL: Record<LabSlot, string> = { weapon: '🗡️ Weapon', shield: '🛡️ Shield', armour: '🥋 Armour', charm: '📿 Charm' };

export function openLabBag(app: App, start: Tab = 'gear') {
  const lc = app.cfg.lab;
  const shop = start === 'shop';
  const panel = openPanel(shop ? `🛒 ${lc.merchant.name}` : '🎒 Labirin bag', { wide: true, testId: 'lab-bag' });
  const names: Tab[] = shop ? ['shop', 'books', 'potions', 'classes', 'gear', 'elements', 'skills'] : ['gear', 'classes', 'elements', 'skills', 'books', 'potions'];
  const titles: Record<Tab, string> = { shop: '🛒 Gear for sale', gear: '⚔️ Your gear', potions: '🧪 Potions', skills: '🌳 Level & tree', books: '📜 Spell books', elements: '🔥 Elements', classes: '🎭 Classes' };
  let tab: Tab = names.includes(start) ? start : names[0];
  let self: LabSelf | null = null;
  let busy = false;
  const head = el('div', { class: 'lab-bag-head' });
  const content = el('div', { class: 'lab-bag' }, el('p', { class: 'muted' }, 'Loading…'));
  panel.body.append(
    tabs(names.map((n) => titles[n]), (i) => {
      tab = names[i];
      render();
    }, Math.max(0, names.indexOf(tab))),
    head,
    content,
  );

  const done = (s: LabSelf, text?: string) => {
    self = s;
    busy = false;
    app.labHud?.updateSelf(s);
    if (text) labSay(text, 'good');
    render();
  };
  const fail = (err: unknown, res: { ok: false; error: string } | { ok: true }) => {
    busy = false;
    sfx.error();
    labSay(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
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
        labSay(res.text, 'good', 4000);
        return;
      }
      done(res.self, res.text);
    });
  };

  const learn = (id: string) => {
    if (busy) return;
    busy = true;
    app.socket?.timeout(6000).emit('lab:skill', { id }, (err, res) => {
      if (err || !res.ok) return fail(err, res);
      sfx.coin();
      done(res.self, res.text);
    });
  };
  const respec = () => {
    if (busy || !confirm(`Unlearn every skill for ${lc.progress.respec} Syiling? You get all the points back.`)) return;
    busy = true;
    app.socket?.timeout(6000).emit('lab:respec', (err, res) => {
      if (err || !res.ok) return fail(err, res);
      sfx.click();
      done(res.self, res.text);
    });
  };
  /** Any lab:* call that answers { self, text }. */
  const call = (ev: 'lab:scrap' | 'lab:class' | 'lab:classBuy' | 'lab:classRoll', msg: object | null, ok = sfx.click) => {
    if (busy) return;
    busy = true;
    const ack = (err: unknown, res: { ok: false; error: string } | { ok: true; self: LabSelf; text: string }) => {
      if (err || !res.ok) return fail(err, res as never);
      ok();
      done(res.self, res.text);
    };
    const sock = app.socket?.timeout(6000) as unknown as { emit: (...a: unknown[]) => void } | undefined;
    if (msg) sock?.emit(ev, msg, ack);
    else sock?.emit(ev, ack);
  };
  const setElement = (id: string) => {
    if (busy) return;
    busy = true;
    app.socket?.timeout(6000).emit('lab:element', { id }, (err, res) => {
      if (err || !res.ok) return fail(err, res);
      sfx.click();
      done(res.self, res.text);
    });
  };
  const wearBook = (id: string | null) => {
    if (busy) return;
    busy = true;
    app.socket?.timeout(6000).emit('lab:book', { id }, (err, res) => {
      if (err || !res.ok) return fail(err, res);
      sfx.click();
      done(res.self);
    });
  };

  const money = (s: LabSelf) => s.coins + s.carried;
  const stat = (s: LabSelf) => {
    const t = s.stats;
    return el('div', { class: 'lab-bag-stats' },
      el('span', {}, `❤️ ${s.hp}/${t.hp}`), el('span', {}, `🔷 ${s.mana}/${s.maxMana}`), el('span', {}, `💎 ${s.diamonds}`), el('span', {}, `⚔️ ${t.atk}`), el('span', {}, `🛡️ ${t.def}`), el('span', {}, `💨 ${t.spd}`),
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
      } else if (lc.gear.tiers[g.tier]?.dropOnly) {
        btn.textContent = '🐲 World boss drop';
        btn.disabled = true;
        btn.title = 'Never sold: only the world boss drops it (rarely)';
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
    if (tab === 'classes') {
      const rows = lc.classes.map((c) => {
        const owned = s.classes.includes(c.id);
        const on = s.cls === c.id;
        const b = el('button', { class: 'btn small', type: 'button', 'data-class': c.id }) as HTMLButtonElement;
        if (owned) {
          b.textContent = on ? '✓ Wearing' : 'Wear';
          b.disabled = busy || on;
          b.addEventListener('click', () => call('lab:class', { id: c.id }));
        } else if (c.source === 'shop') {
          if (shop) {
            b.replaceChildren(coinIcon(), ` ${c.price ?? 0}`);
            b.classList.add('primary');
            b.disabled = busy || money(s) < (c.price ?? 0);
            b.addEventListener('click', () => call('lab:classBuy', { id: c.id }, sfx.coin));
          } else {
            b.textContent = `At ${lc.merchant.name}`;
            b.disabled = true;
          }
        } else {
          b.textContent = c.source === 'roll' ? '🎲 Class roll' : c.from === 'worldBoss' ? '🐲 World boss drop' : '👹 Floor boss drop';
          b.disabled = true;
        }
        return el('div', { class: `lab-bag-row${on ? ' worn' : ''}${owned ? '' : ' locked'}` },
          el('span', { class: 'lab-bag-icon' }, c.icon),
          el('span', { class: 'lab-bag-info' }, el('b', {}, c.name, c.source === 'drop' ? el('span', { class: 'lab-limited' }, ' limited') : ''), el('small', { class: 'muted' }, c.desc)),
          b);
      });
      const r = lc.loot.classRoll;
      const roll = el('button', { class: 'btn primary', type: 'button', 'data-action': 'class-roll' }, `🎲 Roll a class (${r.price} 💎)`) as HTMLButtonElement;
      roll.disabled = busy || s.diamonds < r.price;
      roll.addEventListener('click', () => call('lab:classRoll', null, sfx.coin));
      content.replaceChildren(
        el('p', { class: 'muted small' }, `Wear one class (switch any time outside a fight). Basic classes are free; ${lc.merchant.name} sells some; the 🎲 class roll (${Math.round(r.chance * 100)}% a new class, else ${r.refund} 💎 back) has others; limited ones only drop from bosses. 💎 Diamonds drop now and then from monsters, or scrap found gear.`),
        el('div', { class: 'actions' }, roll, el('span', { class: 'muted small' }, ` You have ${s.diamonds} 💎`)),
        el('div', { class: 'lab-bag-grid' }, ...rows),
      );
      return;
    }
    if (tab === 'elements') {
      const rows = lc.elements.map((x) => {
        const on = s.element === x.id;
        const book = lc.spells.list.find((b) => b.element === x.id && s.books.includes(b.id));
        const ult = book ? `📜 ${book.move} (${book.name}): ${book.desc}` : `📜 ${x.ultimate.move}: ${x.ultimate.desc}`;
        const b = el('button', { class: `btn small${on ? '' : ' primary'}`, type: 'button', 'data-element': x.id }, on ? '✓ Equipped' : 'Equip') as HTMLButtonElement;
        b.disabled = busy || on;
        b.addEventListener('click', () => setElement(x.id));
        const row = el('div', { class: `lab-bag-row lab-book${on ? ' worn' : ''}` },
          el('span', { class: 'lab-bag-icon' }, x.icon),
          el('span', { class: 'lab-bag-info' },
            el('b', {}, `${x.skill.name} `, el('span', { class: 'muted' }, `🔷 ${x.skill.mana} mana`)),
            el('small', { class: 'muted' }, x.skill.desc),
            el('small', { class: 'muted' }, ult)),
          b);
        row.style.setProperty('--book', x.color);
        return row;
      });
      content.replaceChildren(
        el('p', { class: 'muted small' }, `Equip one element: its 💥 skill is your Skill button in a fight (it costs 🔷 mana) and its 📜 ultimate comes with it (a spell book of that element makes the ultimate stronger). Switch any time, even mid-fight with ⇄. Mana: +${lc.player.mana.perRound} a round in a fight, slowly back outside, faster by the campfire; resting fills it.`),
        el('div', { class: 'lab-bag-grid' }, ...rows),
      );
      return;
    }
    if (tab === 'skills') {
      const lvl = el('div', { class: 'lab-lv' },
        el('b', {}, `🌀 Abyss level ${s.level}`),
        el('div', { class: 'lab-lv-bar', title: `${s.xpInto} / ${s.xpNeed} XP` }, el('i', { style: `width:${s.xpNeed ? Math.round((s.xpInto / s.xpNeed) * 100) : 100}%` })),
        el('span', { class: 'muted small' }, `${s.xpInto}/${s.xpNeed} XP`),
        el('b', { class: s.points ? 'good' : 'muted' }, `✨ ${s.points} skill point${s.points === 1 ? '' : 's'}`));
      // 📊 Where your stats come from: (base + items) × (1 + buffs).
      const st = labStats(lc, { level: s.level, ranks: s.skills, gear: wornBonus(lc, s.gear, s.items), cls: s.cls, drink: s.drink?.id, teman: s.boost });
      const row = (icon: string, name: string, l: { base: number; items: number; pct: number; total: number }) =>
        el('div', { class: 'lab-statline' }, el('b', {}, `${icon} ${name}`),
          el('span', {}, `(${l.base} base${l.items ? ` + ${l.items} items` : ''})${l.pct ? ` × ${Math.round((1 + l.pct) * 100)}%` : ''}`),
          el('b', { class: 'lab-stat-total' }, String(l.total)));
      const breakdown = el('div', { class: 'lab-statlines' },
        row('❤️', 'HP', st.lines.hp), row('⚔️', 'ATK', st.lines.atk), row('🛡️', 'DEF', st.lines.def), row('💨', 'SPD', st.lines.spd), row('🔷', 'Mana', st.lines.mana),
        el('div', { class: 'lab-statline' }, el('b', {}, '🎯 Crit · 🧱 Block · 🌊 Mana/round'), el('span', {}, ''), el('b', { class: 'lab-stat-total' }, `${(st.crit * 100).toFixed(1)}% · ${(st.block * 100).toFixed(1)}% · +${st.manaRegen}`)));
      // 🌳 The tree: a column per branch; deeper nodes open with points in their branch.
      const cols = lc.tree.branches.map((br) => {
        const have = branchPoints(lc, s.skills, br.id);
        const nodes = lc.tree.nodes.filter((n) => n.branch === br.id).map((n) => {
          const r = s.skills[n.id] ?? 0;
          const why = treeBlock(lc, s.skills, n.id, s.points);
          const locked = have < n.need;
          const btn = el('button', { class: 'btn small primary', type: 'button', 'data-skill': n.id }, n.max && r >= n.max ? '✓ Max' : '+1') as HTMLButtonElement;
          btn.disabled = busy || !!why;
          btn.title = why || `Spend 1 point: ${n.desc}`;
          btn.addEventListener('click', () => learn(n.id));
          return el('div', { class: `lab-node${locked ? ' locked' : ''}${r ? ' has' : ''}` },
            el('span', { class: 'lab-node-icon' }, n.icon),
            el('span', { class: 'lab-node-info' },
              el('b', {}, n.name, el('span', { class: 'lab-node-rank' }, ` ${r}${n.max ? `/${n.max}` : ''}`)),
              el('small', { class: 'muted' }, locked ? `🔒 ${n.need} points in ${br.name}` : n.desc)),
            btn);
        });
        const col = el('div', { class: 'lab-branch' }, el('div', { class: 'lab-branch-head' }, el('b', {}, `${br.icon} ${br.name}`), el('span', { class: 'muted small' }, ` ${have} pts`), el('small', { class: 'muted' }, br.desc)), ...nodes);
        col.style.setProperty('--branch', br.color);
        return col;
      });
      const reset = shop && Object.values(s.skills).some((n) => n > 0) ? el('button', { class: 'btn small', type: 'button', 'data-action': 'lab-respec' }, '↺ Unlearn all ', coinIcon(), ` ${lc.progress.respec}`) as HTMLButtonElement : null;
      if (reset) {
        reset.disabled = busy || money(s) < lc.progress.respec;
        reset.addEventListener('click', respec);
      }
      content.replaceChildren(
        lvl,
        el('p', { class: 'muted small' }, `The abyss keeps its own you: level, stats, items, HP, mana and Syiling stay down here. Every level adds a little to your base stats and gives a skill point (no cap). Flat points add to your base; items add on top; buffs (class, drink, Teman, % nodes) multiply the lot.${shop ? '' : ` ${lc.merchant.name} can reset your tree (for Syiling).`}`),
        breakdown,
        el('div', { class: 'lab-tree' }, ...cols),
        reset ? el('div', { class: 'actions' }, reset) : '',
      );
      return;
    }
    if (tab === 'books') {
      const rows = lc.spells.list.map((sp) => {
        const owned = s.books.includes(sp.id);
        const worn = s.book === sp.id;
        const elem = lc.elements.find((x) => x.id === sp.element);
        const locked = s.deepest < sp.minFloor;
        const btn = el('button', { class: 'btn small', type: 'button', 'data-book': sp.id }) as HTMLButtonElement;
        if (owned) {
          btn.textContent = worn ? '✓ In use' : elem ? `Use (${elem.icon} ${elem.name})` : 'Owned';
          btn.disabled = busy || worn || !elem;
          btn.title = worn ? 'Its ultimate is on your 📜 Ultimate button.' : elem ? `Equip ${elem.icon} ${elem.skill.name}: this book then powers your ultimate` : '';
          btn.addEventListener('click', () => wearBook(sp.id));
        } else if (sp.dropOnly) {
          btn.textContent = '🐲 World boss drop';
          btn.disabled = true;
          btn.title = 'Mythic: only the world boss drops it (rarely)';
        } else if (sp.rollOnly) {
          btn.textContent = '🎲 Tavern roll';
          btn.disabled = true;
          btn.title = `Only from ${lc.tavern.name}'s once-a-day roll`;
        } else if (!shop) {
          btn.textContent = locked ? `🔒 Floor ${sp.minFloor + 1}` : `At ${lc.merchant.name}`;
          btn.disabled = true;
        } else if (locked) {
          btn.textContent = `🔒 Floor ${sp.minFloor + 1}`;
          btn.disabled = true;
          btn.title = `Sold once you've reached floor ${sp.minFloor + 1}`;
        } else {
          btn.replaceChildren(coinIcon(), ` ${sp.price}`);
          btn.classList.add('primary');
          btn.disabled = busy || money(s) < sp.price;
          btn.title = money(s) < sp.price ? `You have ${money(s)}` : 'Buy it (yours for good)';
          btn.addEventListener('click', () => buy(sp.id));
        }
        const row = el('div', { class: `lab-bag-row lab-book${worn ? ' worn' : ''}${locked && !owned ? ' locked' : ''}` },
          el('span', { class: 'lab-bag-icon' }, sp.icon),
          el('span', { class: 'lab-bag-info' }, el('b', {}, sp.name), el('small', { class: 'muted' }, sp.desc)),
          btn);
        row.style.setProperty('--book', sp.color);
        return row;
      });
      content.replaceChildren(
        el('p', { class: 'muted small' }, `Every element has a basic 📜 ultimate (once your focus bar is full: ${lc.spells.focus}). A spell book makes its element's ultimate stronger: it works while that element is equipped (🔥 Elements). Books are yours for good. ${lc.tavern.name} has a once-a-day roll for one too.`),
        el('div', { class: 'lab-bag-grid' }, ...rows),
      );
      return;
    }
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
      // 🎁 Gear found on monsters: wear it or scrap it for 💎.
      const found = [...s.items].sort((a, b) => (labGear(lc, b.gear)?.tier ?? 0) - (labGear(lc, a.gear)?.tier ?? 0) || itemMult(lc, b) - itemMult(lc, a)).map((it) => {
        const g = labGear(lc, it.gear);
        const worn = s.gear[g?.slot ?? 'weapon'] === `#${it.uid}`;
        const name = el('b', {}, itemName(lc, it));
        if (g) name.style.color = g.color;
        const wear = el('button', { class: 'btn small', type: 'button', 'data-item': String(it.uid) }, worn ? 'Take off' : 'Wear') as HTMLButtonElement;
        wear.disabled = busy || !g;
        wear.addEventListener('click', () => g && equip(g.slot, worn ? null : `#${it.uid}`));
        const scrap = el('button', { class: 'btn small', type: 'button', 'data-scrap': String(it.uid) }, `♻️ ${itemScrap(lc, it)} 💎`) as HTMLButtonElement;
        scrap.disabled = busy || worn;
        scrap.title = worn ? 'Take it off first' : 'Scrap it for diamonds';
        scrap.addEventListener('click', () => confirm(`Scrap ${itemName(lc, it)} for ${itemScrap(lc, it)} 💎?`) && call('lab:scrap', { uid: it.uid }, sfx.coin));
        return el('div', { class: `lab-bag-row${worn ? ' worn' : ''}${it.variant !== 'normal' ? ' variant' : ''}` },
          el('span', { class: 'lab-bag-icon' }, g?.icon ?? '🎁'),
          el('span', { class: 'lab-bag-info' }, name, el('small', { class: 'muted' }, g ? `${gearLine(g)} ×${itemMult(lc, it).toFixed(2)}` : '')),
          el('span', { class: 'lab-bag-btns' }, wear, scrap));
      });
      content.replaceChildren(
        el('p', { class: 'muted small' }, `Your town gear stays outside: down here only Labirin gear counts. Buy it from ${lc.merchant.name} in the entrance hall or a rest chamber.`),
        el('div', { class: 'lab-bag-grid' }, ...groups),
        el('h5', {}, `🎁 Found gear (${s.items.length})`),
        found.length
          ? el('div', { class: 'lab-bag-grid' }, ...found)
          : el('p', { class: 'muted small' }, 'Monsters sometimes drop gear: a grade (D to S) and a variant (Shiny, Golden, Rainbow) make it stronger than the shop piece. Scrap spares for 💎.'),
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
        if (s.inside && (p.heal || p.home || p.mana)) {
          const u = el('button', { class: 'btn small', type: 'button', 'data-use': p.id }, p.home ? 'Go home' : 'Drink') as HTMLButtonElement;
          u.disabled = busy || !have || (!!p.heal && s.hp >= s.stats.hp) || (!!p.mana && s.mana >= s.maxMana);
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
