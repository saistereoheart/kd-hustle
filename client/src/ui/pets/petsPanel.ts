// 🐾 Teman (pets), the window: your pets and battle team, and each pet's page (train, upgrade
// stats, pet gear, tier / variant rerolls). The side box sells starters and the Telur Teman egg.
// The server owns every number; this shows PetsView and sends intents.
import { PET_STATS, formatMoney, gradeDef, type PetCard, type PetStat, type PetsView } from '@kh/shared';
import type { App } from '../../app';
import { drawPet } from '../../items/petArt';
import { openCratePanel } from '../cratePanel';
import { el, toast } from '../dom';
import { openRerollWindow } from '../forge';
import { itemCard, openPanel } from '../panel';
import { sfx } from '../sound';
import { byRarity } from '../itemSort';

const STAT_INFO: Record<PetStat, { icon: string; name: string }> = {
  hp: { icon: '❤️', name: 'HP' },
  atk: { icon: '⚔️', name: 'Attack' },
  def: { icon: '🛡️', name: 'Defence' },
  spd: { icon: '💨', name: 'Speed' },
};

let cache: PetsView | null = null;

function fetchView(app: App, done: (v: PetsView) => void) {
  app.socket?.timeout(6000).emit('pets:view', (err, res) => {
    if (err || !res.ok) return void toast(err ? 'No reply from the server.' : res.ok ? '' : res.error, 'bad');
    cache = res.view;
    done(res.view);
  });
}

type PetsEvent = 'pets:buy' | 'pets:team' | 'pets:train' | 'pets:upgrade' | 'pets:gear';
type PetsReply = { ok: true; view: PetsView; level?: number } | { ok: false; error: string };
interface LooseSocket {
  timeout(ms: number): { emit(ev: string, msg: unknown, cb: (err: unknown, res: PetsReply) => void): void };
}
/** Sends an intent; every pets:* reply carries the fresh view (and training, the new level). */
function send(app: App, ev: PetsEvent, msg: unknown, done: (v: PetsView, extra: { level?: number }) => void) {
  const sock = app.socket as unknown as LooseSocket | null;
  sock?.timeout(6000).emit(ev, msg, (err, res) => {
    if (err || !res.ok) {
      sfx.error();
      return void toast(err ? 'No reply from the server.' : !res.ok ? res.error : '', 'bad');
    }
    cache = res.view;
    done(res.view, { level: res.level });
  });
}

/** A small animated pet portrait. Stops when it leaves the page. */
function petPortrait(app: App, itemId: string, size: number): HTMLCanvasElement {
  const def = app.items.get(itemId);
  const c = el('canvas', { class: 'pet-portrait' }) as HTMLCanvasElement;
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = c.height = size * dpr;
  c.style.width = c.style.height = `${size}px`;
  const ctx = c.getContext('2d')!;
  const tick = (t: number) => {
    if (!c.isConnected && t > 1000) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const s = (size * dpr) / 40;
    ctx.setTransform(s, 0, 0, s, (size * dpr) / 2, (size * dpr) / 2 + s);
    drawPet(ctx, def?.shape ?? 'kucing', t, def?.color, def?.color2);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return c;
}

export function openPetsPanel(app: App) {
  const panel = openPanel('🐾 Teman', { wide: true, testId: 'pets-panel' });
  const shop = panel.side('🛒 Get Teman');
  const rar = app.cfg.rarities;

  function paintShop(v: PetsView) {
    const egg = app.crates.get('pet_egg');
    const roll = el('button', { class: 'btn primary', type: 'button', 'data-action': 'pets-egg' }, `🥚 Roll a ${egg?.name ?? 'Telur Teman'}`, el('small', {}, egg ? formatMoney(egg.priceSen) : ''));
    roll.addEventListener('click', () => openCratePanel(app, 'pet_egg', { remote: true }));
    shop.replaceChildren(
      el('p', { class: 'muted small' }, 'Starters are sold here. The rarer Teman (and pet gear) come from the egg.'),
      ...v.starters.ids.map((id) => {
        const def = app.items.get(id);
        const b = el('button', { class: 'btn small', type: 'button', 'data-action': `pets-buy-${id}` }, `Buy ${formatMoney(v.starters.priceSen)}`);
        b.addEventListener('click', () => {
          if (app.store.walletSen < v.starters.priceSen) return void toast('Not enough money.', 'bad');
          send(app, 'pets:buy', { id }, (nv) => {
            sfx.coin();
            toast(`🐾 ${def?.name ?? 'A Teman'} joined you!`, 'good');
            paint(nv);
          });
        });
        return el('div', { class: 'pet-shop-row' }, petPortrait(app, id, 44), el('div', { class: 'grow' }, el('b', {}, def?.name ?? id), el('div', { class: 'muted small' }, app.cfg.pets.species[id]?.move ?? '')), b);
      }),
      roll,
      el('p', { class: 'muted small' }, '🎲 A Teman\'s tier and variant make it stronger: reroll them from its page (💎 shards).'),
    );
  }

  function card(v: PetsView, p: PetCard) {
    const it = app.store.inventory.find((i) => i.iid === p.iid);
    const def = app.items.get(p.itemId);
    if (!it || !def) return null;
    const inTeam = v.team.indexOf(p.iid);
    const c = itemCard(rar, def, it.variant, { caption: `Lv ${p.level}${inTeam >= 0 ? ` · #${inTeam + 1}` : ''}${p.gear !== null ? ' · 🎽' : ''}`, grade: it.grade, gradeColor: gradeDef(app.cfg.grades, it.grade).color });
    if (p.gear !== null) c.title = `Wearing ${gearName(app, p.gear)}`;
    c.classList.add('pet-card');
    if (inTeam >= 0) c.classList.add('in-team');
    c.dataset.iid = String(p.iid);
    c.tabIndex = 0;
    c.addEventListener('click', () => openPetPage(app, p.iid));
    return c;
  }

  function paint(v: PetsView) {
    paintShop(v);
    if (!v.pets.length) {
      panel.body.replaceChildren(
        el('div', { class: 'empty' }, el('div', { class: 'pet-empty-icon' }, '🐾'), el('p', {}, 'No Teman yet. Buy a starter (on the side) or roll a Telur Teman egg. Your Teman fight for you in ⚔️ Gua Gelap.')),
      );
      return;
    }
    const team = v.team.map((iid) => v.pets.find((p) => p.iid === iid)).filter((p): p is PetCard => !!p);
    const slots = Array.from({ length: v.teamSize }, (_, i) => {
      const p = team[i];
      if (!p) return el('div', { class: 'pet-slot empty' }, el('span', { class: 'muted small' }, `Slot ${i + 1}: tap a Teman below, then "Add to team"`));
      const def = app.items.get(p.itemId);
      const up = el('button', { class: 'icon-btn', type: 'button', title: 'Move up', disabled: i === 0 }, '▲');
      up.addEventListener('click', (e) => {
        e.stopPropagation();
        const order = [...v.team];
        [order[i - 1], order[i]] = [order[i], order[i - 1]];
        send(app, 'pets:team', { iids: order }, (nv) => paint(nv));
      });
      const slot = el('div', { class: 'pet-slot' }, el('b', { class: 'pet-slot-n' }, `${i + 1}`), petPortrait(app, p.itemId, 48),
        el('div', { class: 'grow' }, el('b', {}, def?.name ?? ''), el('div', { class: 'muted small' }, `Lv ${p.level} · ❤️${p.stats.hp} ⚔️${p.stats.atk} 🛡️${p.stats.def} 💨${p.stats.spd}`), el('div', { class: 'muted small' }, p.gear !== null ? `🎽 ${gearName(app, p.gear)}` : '🎽 no gear')), up);
      slot.addEventListener('click', () => openPetPage(app, p.iid));
      return slot;
    });
    const go = el('button', { class: 'btn', type: 'button', 'data-action': 'pets-to-dungeon' }, '⚔️ To Gua Gelap');
    go.addEventListener('click', () => void import('../dungeon/dungeon').then((m) => m.openDungeon(app)));
    // Rarest first (then tier, variant, level), like the bag.
    const look = (p: PetCard) => {
      const inv = app.store.inventory.find((i) => i.iid === p.iid);
      return { ...p, grade: inv?.grade, variant: inv?.variant };
    };
    const sorted = v.pets.map(look).sort(byRarity(app, (a, b) => b.level - a.level));
    panel.body.replaceChildren(
      el('h5', { class: 'worn-section' }, `⚔️ Battle team (${team.length}/${v.teamSize}) · the first one fights first`),
      el('div', { class: 'pet-team' }, ...slots),
      el('div', { class: 'row-end' }, go),
      el('h5', { class: 'worn-section' }, `🐾 All your Teman (${v.pets.length})`),
      el('div', { class: 'item-grid pet-grid' }, ...sorted.map((p) => card(v, p)).filter((c): c is HTMLDivElement => !!c)),
    );
  }

  panel.onResume = () => fetchView(app, paint);
  if (cache) paint(cache);
  else panel.body.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
  fetchView(app, paint);
}

/** One Teman's page: stats + upgrades, training, gear, team, rerolls. */
function openPetPage(app: App, iid: number) {
  const it0 = app.store.inventory.find((i) => i.iid === iid);
  const def0 = it0 && app.items.get(it0.itemId);
  const panel = openPanel(`🐾 ${def0?.name ?? 'Teman'}`, { wide: true, testId: 'pet-page' });
  const pc = app.cfg.pets;
  const g = app.cfg.grades;

  function paint(v: PetsView) {
    const p = v.pets.find((x) => x.iid === iid);
    const it = app.store.inventory.find((i) => i.iid === iid);
    const def = it && app.items.get(it.itemId);
    if (!p || !it || !def) {
      panel.body.replaceChildren(el('p', { class: 'muted' }, 'This Teman is gone.'));
      return;
    }
    const sp = pc.species[def.id];
    const inTeam = v.team.includes(iid);
    const xpPct = p.xpNext ? Math.min(100, (p.xp / p.xpNext) * 100) : 100;
    const xpBar = el('div', { class: 'progress' }, el('i', {}));
    (xpBar.firstChild as HTMLElement).style.width = `${xpPct}%`;

    const train = el('button', { class: 'btn primary', type: 'button', 'data-action': 'pet-train', disabled: p.trainSen === null },
      p.trainSen === null ? '🏅 Top level' : `🏋️ Train: +1 level`, p.trainSen !== null ? el('small', {}, formatMoney(p.trainSen)) : null);
    train.addEventListener('click', () => {
      if (p.trainSen !== null && app.store.walletSen < p.trainSen) return void toast('Not enough money.', 'bad');
      send(app, 'pets:train', { iid }, (nv, x) => {
        sfx.levelUp();
        toast(`⬆️ ${def.name} is now level ${x.level}!`, 'good');
        paint(nv);
      });
    });
    const team = el('button', { class: 'btn', type: 'button', 'data-action': 'pet-team' }, inTeam ? '➖ Take out of the team' : `➕ Add to team (${v.team.length}/${v.teamSize})`);
    team.addEventListener('click', () => {
      const order = inTeam ? v.team.filter((x) => x !== iid) : [...v.team, iid];
      if (!inTeam && order.length > v.teamSize) return void toast(`The team is full (${v.teamSize}). Take one out first.`, 'bad');
      send(app, 'pets:team', { iids: order }, (nv) => paint(nv));
    });
    const lead = el('button', { class: 'btn small', type: 'button', 'data-action': 'pet-lead', disabled: v.team[0] === iid }, '⭐ Make it lead');
    lead.addEventListener('click', () => {
      const order = [iid, ...v.team.filter((x) => x !== iid)].slice(0, v.teamSize);
      send(app, 'pets:team', { iids: order }, (nv) => paint(nv));
    });

    const statRows = PET_STATS.map((st) => {
      const cost = p.upgradeSen[st];
      const b = el('button', { class: 'btn small', type: 'button', 'data-action': `pet-up-${st}`, disabled: cost === null }, cost === null ? 'MAX' : `+${Math.round(pc.upgrade.perLevel * 100)}% · ${formatMoney(cost)}`);
      b.addEventListener('click', () => {
        if (cost !== null && app.store.walletSen < cost) return void toast('Not enough money.', 'bad');
        send(app, 'pets:upgrade', { iid, stat: st }, (nv) => {
          sfx.click();
          paint(nv);
        });
      });
      const pips = el('span', { class: 'pet-pips' }, ...Array.from({ length: pc.upgrade.maxLevel }, (_, i) => el('i', { class: i < p.up[st] ? 'on' : '' })));
      return el('div', { class: 'pet-stat' }, el('span', { class: 'pet-stat-name' }, `${STAT_INFO[st].icon} ${STAT_INFO[st].name}`), el('b', {}, String(p.stats[st])), pips, b);
    });

    const rerolls = (['grade', 'variant'] as const).map((what) => {
      const cost = (what === 'grade' ? g.shards.rerollGrade : g.shards.rerollVariant)[def.rarity] ?? 100;
      const b = el('button', { class: 'btn small', type: 'button', 'data-action': `pet-reroll-${what}` }, `🎲 ${what === 'grade' ? 'Tier' : 'Variant'} reroll`, el('small', {}, `${cost} 💎`));
      b.addEventListener('click', () => openRerollWindow(app, iid, what));
      return b;
    });

    panel.body.replaceChildren(
      el('div', { class: 'pet-hero' },
        petPortrait(app, def.id, 120),
        el('div', { class: 'grow' },
          el('h4', {}, `${def.name} · Lv ${p.level}`),
          el('div', { class: 'muted small' }, `${def.rarity} · tier ${it.grade}${it.variant !== 'normal' ? ` · ✨ ${it.variant}` : ''}`),
          sp ? el('div', { class: 'small' }, `⚔️ ${sp.move} · 🌟 ${sp.ultimate}`) : null,
          sp ? el('div', { class: 'muted small' }, `“${sp.cry}”`) : null,
          el('div', { class: 'small' }, p.xpNext ? `XP ${p.xp} / ${p.xpNext}` : 'Top level'),
          xpBar,
        ),
      ),
      el('div', { class: 'dungeon-controls' }, train, team, inTeam ? lead : null),
      ...gearSection(app, v, p, (nv) => paint(nv)),
      el('h5', { class: 'worn-section' }, '📈 Stats & upgrades'),
      ...statRows,
      el('p', { class: 'muted small' }, 'Stats = species × rarity × level × upgrades, a little more for a higher tier or a variant, plus the gear.'),
      el('h5', { class: 'worn-section' }, '🎲 Forge'),
      el('div', { class: 'dungeon-controls' }, ...rerolls),
    );
  }

  panel.onResume = () => fetchView(app, paint); // back from a reroll
  if (cache) paint(cache);
  fetchView(app, paint);
}

// ------------------------------------------------------------------ 🎽 pet gear
function gearName(app: App, gearIid: number): string {
  const gi = app.store.inventory.find((i) => i.iid === gearIid);
  return (gi && app.items.get(gi.itemId)?.name) ?? 'gear';
}

function boostText(app: App, itemId: string): string {
  const boosts = app.cfg.pets.gear[itemId] ?? {};
  return Object.entries(boosts).map(([k, n]) => `${STAT_INFO[k as PetStat].icon}+${Math.round((n ?? 0) * 100)}%`).join(' ');
}

/** On a Teman's page: what it wears now (with Take off) and every other piece you own, to tap on. */
function gearSection(app: App, v: PetsView, p: PetCard, repaint: (v: PetsView) => void): HTMLElement[] {
  const g = app.cfg.grades;
  const owner = new Map<number, number>();
  for (const x of v.pets) if (x.gear !== null) owner.set(x.gear, x.iid);
  const worn = p.gear !== null ? app.store.inventory.find((i) => i.iid === p.gear) : undefined;
  const wornDef = worn && app.items.get(worn.itemId);
  const off = el('button', { class: 'btn small', type: 'button', 'data-action': 'pet-gear-off' }, 'Take off');
  off.addEventListener('click', () =>
    send(app, 'pets:gear', { iid: p.iid, gear: null }, (nv) => {
      sfx.click();
      repaint(nv);
    }),
  );
  const now =
    worn && wornDef
      ? el(
          'div',
          { class: 'pet-gear-now' },
          itemCard(app.cfg.rarities, wornDef, worn.variant, { grade: worn.grade, gradeColor: gradeDef(g, worn.grade).color, size: 56 }),
          el('div', { class: 'grow' }, el('b', {}, `Wearing: ${wornDef.name}`), el('div', { class: 'small' }, boostText(app, wornDef.id))),
          off,
        )
      : el('div', { class: 'pet-gear-now empty' }, el('span', { class: 'muted' }, 'Wearing: nothing. Tap a piece below to put it on.'));
  const pieces = app.store.inventory.filter((i) => app.items.get(i.itemId)?.type === 'petgear' && i.iid !== p.gear).sort(byRarity(app));
  const cards = pieces.map((gi) => {
    const gd = app.items.get(gi.itemId)!;
    const other = owner.get(gi.iid);
    const otherName = other !== undefined ? app.items.get(app.store.inventory.find((i) => i.iid === other)?.itemId ?? '')?.name : null;
    const c = itemCard(app.cfg.rarities, gd, gi.variant, {
      caption: otherName ? `on ${otherName}` : boostText(app, gd.id),
      grade: gi.grade,
      gradeColor: gradeDef(g, gi.grade).color,
      size: 64,
    });
    c.classList.add('pet-gear-card');
    if (otherName) c.classList.add('on-other');
    c.title = `${gd.name}: ${boostText(app, gd.id)}${otherName ? ` (on ${otherName}: tap to move it here)` : ' (tap to put it on)'}`;
    c.addEventListener('click', () =>
      send(app, 'pets:gear', { iid: p.iid, gear: gi.iid }, (nv) => {
        sfx.click();
        toast(`🎽 ${gd.name} on!`, 'good');
        repaint(nv);
      }),
    );
    return c;
  });
  return [
    el('h5', { class: 'worn-section' }, '🎽 Gear (one piece per Teman)'),
    now,
    pieces.length
      ? el('div', { class: 'item-grid small pet-gear-grid' }, ...cards)
      : el('p', { class: 'muted small' }, worn ? 'No other pet gear. More comes from the 🥚 Telur Teman egg.' : 'No pet gear yet. It comes from the 🥚 Telur Teman egg.'),
  ];
}

/** From the bag: pick which Teman wears this piece of gear. */
export function openGearPicker(app: App, gearIid: number) {
  const gi = app.store.inventory.find((i) => i.iid === gearIid);
  const gd = gi && app.items.get(gi.itemId);
  if (!gi || !gd) return;
  const panel = openPanel(`🎽 ${gd.name}`, { testId: 'pet-gear-picker' });
  const paint = (v: PetsView) => {
    const wearer = v.pets.find((x) => x.gear === gearIid);
    const look = (x: PetCard) => {
      const inv = app.store.inventory.find((i) => i.iid === x.iid);
      return { ...x, grade: inv?.grade, variant: inv?.variant };
    };
    const rows = v.pets
      .map(look)
      .sort(byRarity(app, (a, b) => b.level - a.level))
      .map((x) => {
        const def = app.items.get(x.itemId);
        const on = x.iid === wearer?.iid;
        const b = el('button', { class: `btn${on ? '' : ' primary'}`, type: 'button', disabled: on }, on ? '✓ Wearing it' : 'Put it on');
        b.addEventListener('click', () =>
          send(app, 'pets:gear', { iid: x.iid, gear: gearIid }, (nv) => {
            sfx.click();
            toast(`🎽 ${def?.name ?? 'Your Teman'} now wears ${gd.name}.`, 'good');
            paint(nv);
          }),
        );
        const note = on ? 'wearing this' : x.gear !== null ? `🎽 ${gearName(app, x.gear)} (swaps out)` : 'no gear';
        return el('div', { class: 'pet-slot' }, petPortrait(app, x.itemId, 44), el('div', { class: 'grow' }, el('b', {}, def?.name ?? ''), el('div', { class: 'muted small' }, `Lv ${x.level} · ${note}`)), b);
      });
    const off = el('button', { class: 'btn small', type: 'button' }, 'Take it off');
    off.addEventListener('click', () => wearer && send(app, 'pets:gear', { iid: wearer.iid, gear: null }, (nv) => paint(nv)));
    panel.body.replaceChildren(
      el('p', {}, `${boostText(app, gd.id)} · ${wearer ? `now on ${app.items.get(wearer.itemId)?.name ?? 'a Teman'}` : 'not on any Teman'}`),
      ...(wearer ? [el('div', { class: 'row-end' }, off)] : []),
      ...(rows.length ? rows : [el('p', { class: 'empty' }, 'No Teman yet. Get one in 📱 Teman.')]),
    );
  };
  if (cache) paint(cache);
  fetchView(app, paint);
}
