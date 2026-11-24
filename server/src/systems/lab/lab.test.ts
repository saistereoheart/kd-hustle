import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAB_DIRS, LAB_OPPOSITE, labLevel, roomLayout, seenHas, type LabDir } from '@kh/shared';
import { loadConfig } from '../../config/loadConfig';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import type { OnlinePlayer } from '../../game/world';
import { ROOT } from '../../paths';
import { LabSystem } from './lab';

const cfg = loadConfig(path.join(ROOT, 'shared/config'), path.join(ROOT, 'shared/map'));
const lc = cfg.lab;
const T = lc.tile;

function setup() {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const id = repos.accounts.create('delver', 'h', false, { x: 0, y: 0 }, 2, 0);
  const p = { id, name: 'delver', hasCharacter: true, lab: null } as unknown as OnlinePlayer;
  let now = 1_700_000_000_000;
  const lab = new LabSystem(lc, repos, () => 0.5, () => now);
  return { lab, p, repos, tick: (ms: number) => (now += ms) };
}

/** Teleport-free: walk to a tile in small legal steps (straight lines are clear: the cross of paths). */
function walkTo(s: ReturnType<typeof setup>, tile: [number, number]) {
  const pos = s.p.lab!;
  const tx = (tile[0] + 0.5) * T, ty = (tile[1] + 0.5) * T;
  for (let i = 0; i < 400 && Math.hypot(pos.x - tx, pos.y - ty) > 4; i++) {
    s.tick(100);
    const k = Math.min(1, (lc.walkSpeed * 0.1) / Math.hypot(tx - pos.x, ty - pos.y));
    // Go along the middle lines: first across to the centre column / row, then along.
    const nx = pos.x + (tx - pos.x) * k, ny = pos.y + (ty - pos.y) * k;
    expect(s.lab.move(s.p, nx, ny, 'down', true)).toBe(true);
  }
}

/** Through a door: walk to it (via the room's centre), then go through. */
function through(s: ReturnType<typeof setup>, dir: LabDir) {
  const f = s.lab.floor(s.p.lab!.floor);
  const L = roomLayout(lc, f, f.rooms[s.p.lab!.room]);
  walkTo(s, L.spot.centre);
  const d = L.doorAt[dir]!;
  walkTo(s, [Math.max(1, Math.min(L.w - 2, d[0])), Math.max(1, Math.min(L.h - 2, d[1]))]);
  return s.lab.door(s.p, dir);
}

describe('Labirin Purba (server)', () => {
  it('enters at the entrance hall and marks it seen', () => {
    const s = setup();
    const v = s.lab.enter(s.p, 'save');
    expect(v.floor).toBe(0);
    expect(v.room).toBe(s.lab.floor(0).start);
    expect(seenHas(v.seen, v.room)).toBe(true);
    expect(() => s.lab.enter(s.p, 'save')).toThrow(/already/);
  });

  it('only lets you through a door you are standing at, into the right room by the opposite door', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const f = s.lab.floor(0);
    const start = f.rooms[f.start];
    const dir = LAB_DIRS.find((d) => start.doors[d] && start.doors[d]!.lock === undefined)!;
    expect(() => s.lab.door(s.p, dir === 'n' ? 's' : 'n')).toThrow(); // not at that door (or no door)
    const v = through(s, dir);
    expect(v.room).toBe(start.doors[dir]!.to);
    expect(seenHas(v.seen, v.room)).toBe(true);
  });

  it('refuses steps that are too long or into a wall', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const pos = { ...s.p.lab! };
    s.tick(100);
    expect(s.lab.move(s.p, pos.x + T * 6, pos.y, 'right', true)).toBe(false);
    s.tick(100);
    expect(s.lab.move(s.p, pos.x, -50, 'up', true)).toBe(false);
  });

  it('pays a loot box once a day, carried until you rest; dying would cost the carried part', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const f = s.lab.floor(0);
    // Walk (by the map) to the nearest room with a chest.
    const target = f.rooms.filter((r) => r.chest && r.kind === 'chamber').sort((a, b) => a.dist - b.dist)[0];
    const prev = new Map<number, [number, LabDir]>();
    const q = [f.start];
    prev.set(f.start, [-1, 'n']);
    while (q.length) {
      const r = f.rooms[q.shift()!];
      for (const d of LAB_DIRS) {
        const door = r.doors[d];
        if (door && door.lock === undefined && !prev.has(door.to)) {
          prev.set(door.to, [r.id, d]);
          q.push(door.to);
        }
      }
    }
    const path: LabDir[] = [];
    for (let at = target.id; at !== f.start; at = prev.get(at)![0]) path.unshift(prev.get(at)![1]);
    for (const d of path) through(s, d);
    expect(s.p.lab!.room).toBe(target.id);
    const L = roomLayout(lc, f, target);
    walkTo(s, L.spot.centre);
    walkTo(s, [L.spot.chest[0], L.spot.centre[1]]);
    walkTo(s, [L.spot.chest[0], L.spot.chest[1] + 1]);
    const r = s.lab.use(s.p, 'chest');
    expect(r.text).toMatch(/Syiling/);
    expect(r.loot?.coins).toBe(s.lab.self(s.p).carried);
    expect(s.lab.self(s.p).carried).toBeGreaterThan(0);
    expect(s.lab.self(s.p).coins).toBe(0);
    expect(() => s.lab.use(s.p, 'chest')).toThrow(/tomorrow/);
    // Leaving is only from the entrance hall or a rest chamber.
    expect(() => s.lab.leave(s.p)).toThrow(/rest chamber/);
  });

  it('keeps your save point and banked coins across a reload', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    s.lab.state(s.p).carried = 40;
    s.lab.leave(s.p); // the entrance hall: banks it
    expect(s.lab.self(s.p).coins).toBe(40);
    s.lab.forget(s.p.id);
    expect(s.lab.self(s.p).coins).toBe(40); // read back from the database
  });
});

describe('Labirin Purba fights (server)', () => {
  it('a monster room starts a fight; winning pays carried Syiling and quiets the room for a while', async () => {
    const { LabBattles } = await import('./labBattles');
    const s = setup();
    const events: string[] = [];
    let ended: { outcome: string; coins: number } | undefined;
    const timers: Array<() => void> = [];
    const battles = new LabBattles(lc, s.lab, {
      started: () => events.push('start'),
      picked: () => events.push('picked'),
      round: (_ps, _ev, _v, ends) => {
        events.push('round');
        ended = ends.get(s.p.id) ?? ended;
      },
    }, () => 0.3, () => 1_700_000_000_000, (fn) => (timers.push(fn), 0 as never), () => {});
    s.lab.enter(s.p, 'entrance');
    const f = s.lab.floor(0);
    // Stand in the nearest monster room (placed directly: walking is tested above).
    const room = f.rooms.filter((r) => r.monsters).sort((a, b) => a.dist - b.dist)[0];
    s.p.lab = { ...s.p.lab!, room: room.id };
    expect(s.lab.monstersHere(s.p)).toBe(true);
    expect(battles.encounter([s.p])).toBe(true);
    expect(() => s.lab.use(s.p, 'chest')).toThrow(/fight/);
    // Strong enough to win quickly.
    for (let i = 0; i < 40 && !ended; i++) battles.act(s.p, { kind: 'attack' });
    expect(ended?.outcome).toBe('win');
    expect(ended!.coins).toBeGreaterThan(0);
    expect(s.lab.self(s.p).carried).toBe(ended!.coins);
    expect(s.lab.monstersHere(s.p)).toBe(false);
    expect(s.lab.hp(s.p)).toBeLessThanOrEqual(lc.player.hp);
  });

  it('falling costs half the carried Syiling and wakes you at your save point, healed', async () => {
    const { LabBattles } = await import('./labBattles');
    const s = setup();
    let ended: { outcome: string; lost: number } | undefined;
    const battles = new LabBattles(lc, s.lab, { started: () => {}, picked: () => {}, round: (_p, _e, _v, ends) => (ended = ends.get(s.p.id) ?? ended) }, () => 0.5, () => 1_700_000_000_000, () => 0 as never, () => {});
    s.lab.enter(s.p, 'entrance');
    s.lab.state(s.p).carried = 100;
    const deep = s.lab.floor(7);
    s.p.lab = { ...s.p.lab!, floor: 7, room: deep.rooms.find((r) => r.monsters)!.id };
    battles.encounter([s.p]);
    for (let i = 0; i < 60 && !ended; i++) battles.act(s.p, { kind: 'guard' });
    expect(ended?.outcome).toBe('wipe');
    expect(ended!.lost).toBe(50);
    expect(s.lab.self(s.p).carried).toBe(50);
    expect(s.p.lab!.floor).toBe(0);
    expect(s.p.lab!.room).toBe(s.lab.floor(0).start);
    expect(s.lab.hp(s.p)).toBe(s.lab.stats(s.p).hp);
  });
});

describe('Labirin Purba merchant, gear and potions', () => {
  it('sells only at the merchant, spends carried Syiling first, and wears better gear at once', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const st = s.lab.state(s.p);
    st.carried = 20;
    st.coins = 500;
    expect(() => s.lab.buy(s.p, 'weapon_kayu')).toThrow(/Tok Peraih|merchant/); // not next to the merchant yet
    const f = s.lab.floor(0);
    walkTo(s, roomLayout(lc, f, f.rooms[f.start]).spot.merchant);
    const atk0 = s.lab.stats(s.p).atk;
    s.lab.buy(s.p, 'weapon_kayu'); // 30: 20 carried + 10 banked
    expect(st.carried).toBe(0);
    expect(st.coins).toBe(490);
    expect(st.gear.weapon).toBe('weapon_kayu');
    expect(s.lab.stats(s.p).atk).toBeGreaterThan(atk0);
    expect(() => s.lab.buy(s.p, 'weapon_kayu')).toThrow(/already/);
    expect(() => s.lab.buy(s.p, 'weapon_gangsa')).toThrow(/floor 2/); // not deep enough yet
    s.lab.buy(s.p, 'weapon_besi');
    expect(st.gear.weapon).toBe('weapon_besi');
    // Back to the old one if you like; a slot can be emptied.
    s.lab.equip(s.p, 'weapon', 'weapon_kayu');
    expect(st.gear.weapon).toBe('weapon_kayu');
    s.lab.equip(s.p, 'weapon', null);
    expect(st.gear.weapon).toBeUndefined();
    expect(() => s.lab.equip(s.p, 'shield', 'shield_besi')).toThrow(/don't have/);
  });

  it('potions: carry limit, heal out of a fight, Tali Pulang home from anywhere', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const st = s.lab.state(s.p);
    st.coins = 5000;
    const f = s.lab.floor(0);
    walkTo(s, roomLayout(lc, f, f.rooms[f.start]).spot.merchant);
    s.lab.buy(s.p, 'jamu_kecil', 20);
    expect(st.potions.jamu_kecil).toBe(lc.potions.max);
    expect(() => s.lab.buy(s.p, 'jamu_kecil')).toThrow(/at most/);
    expect(() => s.lab.useItem(s.p, 'jamu_kecil')).toThrow(/full HP/);
    s.lab.setHp(s.p, 10);
    const r = s.lab.useItem(s.p, 'jamu_kecil');
    expect(r.text).toMatch(/\+30 HP/);
    expect(st.potions.jamu_kecil).toBe(lc.potions.max - 1);
    expect(() => s.lab.useItem(s.p, 'asap_lari')).toThrow(/no Asap Lari/);
    s.lab.buy(s.p, 'tali_pulang');
    st.carried = 40;
    const home = s.lab.useItem(s.p, 'tali_pulang');
    expect(home.left).toBe(true);
    expect(s.p.lab).toBeNull();
    expect(st.carried).toBe(0);
    expect(st.potions.tali_pulang).toBeUndefined();
  });
});

describe('Labirin: the tavern and the brush', () => {
  it('a tavern drink buffs your next fights, then wears off', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const st = s.lab.state(s.p);
    st.coins = 500;
    expect(() => s.lab.drink(s.p, 'kopi_o')).toThrow(/entrance hall/); // not at the counter yet
    const f = s.lab.floor(0);
    walkTo(s, roomLayout(lc, f, f.rooms[f.start]).spot.tavern);
    const def0 = s.lab.stats(s.p).def;
    expect(s.lab.drink(s.p, 'kopi_o')).toMatch(/Kopi O/);
    expect(st.coins).toBe(500 - lc.tavern.drinks.find((d) => d.id === 'kopi_o')!.price);
    expect(s.lab.stats(s.p).def).toBeGreaterThan(def0);
    expect(s.lab.self(s.p).drink).toEqual({ id: 'kopi_o', left: 3 });
    for (let i = 0; i < 3; i++) s.lab.battleDone(s.p);
    expect(s.lab.self(s.p).drink).toBeNull();
    expect(s.lab.stats(s.p).def).toBe(def0);
  });

  it('skills: points from levels, level gates, stats go up; respec at the merchant for Syiling', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const st = s.lab.state(s.p);
    const atk0 = s.lab.stats(s.p).atk;
    expect(s.lab.learn(s.p, 'tangan_besi')).toMatch(/rank 1/);
    expect(s.lab.stats(s.p).atk).toBeGreaterThan(atk0);
    expect(() => s.lab.learn(s.p, 'kulit_badak')).toThrow(/No skill points/);
    st.xp = 10_000;
    // 🌳 Deeper nodes open with points in their branch.
    expect(() => s.lab.learn(s.p, 'untung_purba')).toThrow(/needs 8 points/);
    for (let i = 0; i < 8; i++) s.lab.learn(s.p, 'langkah_angin');
    expect(() => s.lab.learn(s.p, 'untung_purba')).not.toThrow();
    st.xp = 0;
    expect(() => s.lab.learn(s.p, 'tenaga_dalam')).toThrow(/No skill points/);
    // Win XP: level up.
    const r = s.lab.won(s.p, 0, 1, 1000, false, true, 1_000);
    expect(r.levelUp).toBeGreaterThan(1);
    expect(r.coins).toBeGreaterThan(1000); // (Untung Purba rank 1)
    // Respec only at the merchant.
    expect(() => s.lab.respec(s.p)).toThrow(/entrance hall or a rest chamber/);
    const f = s.lab.floor(0);
    walkTo(s, roomLayout(lc, f, f.rooms[f.start]).spot.merchant);
    st.coins = lc.progress.respec;
    st.carried = 0;
    s.lab.respec(s.p);
    expect(st.skills).toEqual({});
    expect(st.coins).toBe(0);
  });

  it('spell books: bought once at the merchant, they power up their element; roll-only ones are not sold', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const st = s.lab.state(s.p);
    const f = s.lab.floor(0);
    walkTo(s, roomLayout(lc, f, f.rooms[f.start]).spot.merchant);
    st.coins = 10_000;
    // 🔥 Api is the default element: its basic ultimate until you own its book.
    expect(s.lab.self(s.p)).toMatchObject({ element: 'api', ultimate: 'ult_api', book: null });
    expect(s.lab.buy(s.p, 'kitab_api')).toMatch(/Kitab Api/);
    expect(s.lab.self(s.p)).toMatchObject({ ultimate: 'kitab_api', book: 'kitab_api' });
    expect(() => s.lab.buy(s.p, 'kitab_api')).toThrow(/already/);
    expect(() => s.lab.buy(s.p, 'kitab_gempa')).toThrow(/daily roll/);
    expect(() => s.lab.buy(s.p, 'kitab_ribut')).toThrow(/floor 5/);
    expect(() => s.lab.buy(s.p, 'ult_air')).toThrow(/doesn't sell/);
    expect(() => s.lab.wearBook(s.p, 'kitab_petir')).toThrow(/don't have/);
    // Another element: its own basic ultimate.
    expect(s.lab.setElement(s.p, 'air')).toMatch(/Pancutan Air/);
    expect(s.lab.self(s.p)).toMatchObject({ element: 'air', ultimate: 'ult_air', book: null });
    expect(() => s.lab.setElement(s.p, 'kayu')).toThrow(/No such element/);
    // "Using" a book switches to its element.
    s.lab.wearBook(s.p, 'kitab_api');
    expect(s.lab.self(s.p).element).toBe('api');
  });

  it('💥 element skills (#29, #30): the merchant teaches some by floor, beaten bosses teach their own; pick one per element', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const st = s.lab.state(s.p);
    const f = s.lab.floor(0);
    // The free skill until you learn another.
    expect(s.lab.self(s.p)).toMatchObject({ element: 'api', skill: 'api', moves: [] });
    // Not away from the merchant.
    st.coins = 50_000;
    expect(() => s.lab.buy(s.p, 'tendangan_berantai')).toThrow(/entrance hall/);
    walkTo(s, roomLayout(lc, f, f.rooms[f.start]).spot.merchant);
    // A floor-gated one, and a boss-taught one (locked until that boss is beaten).
    expect(() => s.lab.buy(s.p, 'tendangan_berantai')).toThrow(/floor 2/);
    expect(() => s.lab.buy(s.p, 'gigitan_raja')).toThrow(/beat it first/);
    st.deepest = 1;
    st.bosses = [0];
    const before = st.coins;
    expect(s.lab.buy(s.p, 'gigitan_raja')).toMatch(/learned and equipped/);
    expect(st.coins).toBe(before - 400);
    expect(s.lab.self(s.p)).toMatchObject({ element: 'fizikal', skill: 'gigitan_raja', moves: ['gigitan_raja'] });
    expect(() => s.lab.buy(s.p, 'gigitan_raja')).toThrow(/already know/);
    s.lab.buy(s.p, 'tendangan_berantai');
    // Pick per element: back to the free one, then the learned one again; the other element keeps its own pick.
    expect(s.lab.setElement(s.p, 'fizikal', 'fizikal')).toMatch(/Tumbukan Padu/);
    expect(s.lab.self(s.p).skill).toBe('fizikal');
    expect(s.lab.setElement(s.p, 'fizikal', 'tendangan_berantai')).toMatch(/Tendangan Berantai/);
    expect(s.lab.setElement(s.p, 'api')).toMatch(/Percikan Api/);
    expect(s.lab.self(s.p).skill).toBe('api');
    expect(s.lab.setElement(s.p, 'fizikal')).toMatch(/Tendangan Berantai/);
    // Only your own skills, and only that element's.
    expect(() => s.lab.setElement(s.p, 'api', 'lidah_api')).toThrow(/haven't learned/);
    expect(() => s.lab.setElement(s.p, 'api', 'tendangan_berantai')).toThrow(/isn't one of/);
    // Kept across a reload.
    s.lab.save(s.p);
    s.lab.forget(s.p.id);
    expect(s.lab.self(s.p)).toMatchObject({ element: 'fizikal', skill: 'tendangan_berantai' });
  });

  it('🔷 mana: full at first, comes back slowly, potions refill it, resting fills it', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const max = lc.player.mana.max;
    expect(s.lab.self(s.p)).toMatchObject({ mana: max, maxMana: max });
    expect(() => s.lab.useItem(s.p, 'air_kelapa')).toThrow(/no Air Kelapa/);
    s.lab.state(s.p).potions.air_kelapa = 1;
    expect(() => s.lab.useItem(s.p, 'air_kelapa')).toThrow(/already full/);
    s.lab.setMana(s.p, 0);
    s.tick(10_000);
    expect(s.lab.mana(s.p)).toBe(Math.floor(max * lc.player.mana.regenPer10s));
    expect(s.lab.useItem(s.p, 'air_kelapa').text).toMatch(/mana/);
    expect(s.lab.mana(s.p)).toBe(Math.floor(max * lc.player.mana.regenPer10s) + max / 2);
    // 📖 Tenaga Dalam raises max mana.
    s.lab.state(s.p).xp = 10_000;
    s.lab.state(s.p).skills.tenaga_dalam = 2;
    const lv = labLevel(lc, 10_000).level;
    expect(s.lab.self(s.p).maxMana).toBe(Math.round(max + lc.progress.perLevel.mana * (lv - 1) + 2));
  });

  it('the tavern roll: once a day, at the counter; a book or a free drink', () => {
    const db = openDatabase(':memory:');
    const repos = createRepos(db);
    const id = repos.accounts.create('roller', 'h', false, { x: 0, y: 0 }, 2, 0);
    const p = { id, name: 'roller', hasCharacter: true, lab: null } as unknown as OnlinePlayer;
    let now = 1_700_000_000_000;
    const lab = new LabSystem(lc, repos, () => 0, () => now); // the roll always hits
    const s = { lab, p, repos, tick: (ms: number) => (now += ms) };
    lab.enter(p, 'entrance');
    const st = lab.state(p);
    st.coins = 1000;
    expect(() => lab.roll(p)).toThrow(/entrance hall/);
    const f = lab.floor(0);
    walkTo(s, roomLayout(lc, f, f.rooms[f.start]).spot.tavern);
    const r = lab.roll(p);
    expect(r.book).toBe(lc.spells.list[0].id);
    expect(st.coins).toBe(1000 - lc.spells.roll.price);
    expect(lab.self(p).rolled).toBe(true);
    expect(() => lab.roll(p)).toThrow(/One roll a day/);
    s.tick(24 * 3600_000);
    expect(() => lab.roll(p)).not.toThrow();
  });

  it('crates: smash one in reach (maybe loot), it stays broken a while, then comes back', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const f = s.lab.floor(0);
    // A chamber with a crate we can walk to straight from the room's centre.
    let found: { room: number; at: [number, number] } | null = null;
    for (const r of f.rooms) {
      if (r.kind !== 'chamber' && r.kind !== 'rest') continue;
      const L = roomLayout(lc, f, r);
      const c = L.props.find((x) => x.kind === 'crate');
      if (c) {
        found = { room: r.id, at: c.at };
        break;
      }
    }
    expect(found).not.toBeNull();
    const pos = s.p.lab!;
    pos.room = found!.room;
    pos.x = (found!.at[0] + 0.5) * T;
    pos.y = (found!.at[1] + 0.5) * T;
    const before = s.lab.state(s.p).carried;
    expect(s.lab.use(s.p, 'crate').text).toMatch(/Smash/);
    expect(s.lab.view(s.p).broken).toEqual([0]);
    expect(() => s.lab.use(s.p, 'crate')).toThrow(/splinters/);
    s.tick(lc.crates.respawnMin * 60_000 + 1);
    expect(s.lab.view(s.p).broken).toEqual([]);
    expect(() => s.lab.use(s.p, 'crate')).not.toThrow();
    expect(s.lab.state(s.p).carried).toBeGreaterThanOrEqual(before);
  });

  it('every floor has one cracked rock: its stash pays once', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const f = s.lab.floor(0);
    const rooms = f.rooms.filter((r) => roomLayout(lc, f, r).props.some((x) => x.kind === 'secret'));
    expect(rooms.length).toBe(1);
    const sec = roomLayout(lc, f, rooms[0]).props.find((x) => x.kind === 'secret')!;
    const pos = s.p.lab!;
    pos.room = rooms[0].id;
    pos.x = (sec.at[0] + 0.5) * T;
    pos.y = (sec.at[1] + 1.5) * T;
    const before = s.lab.state(s.p).carried;
    expect(s.lab.use(s.p, 'secret').text).toMatch(/hidden stash/);
    expect(s.lab.state(s.p).carried).toBeGreaterThan(before);
    expect(s.lab.view(s.p).secretFound).toBe(true);
    expect(() => s.lab.use(s.p, 'secret')).toThrow(/empty/);
  });

  it('sitting by the hall campfire heals about 1 HP every few seconds, on top of the slow regen', () => {
    const s = setup();
    s.lab.enter(s.p, 'entrance');
    const f = s.lab.floor(0);
    const L = roomLayout(lc, f, f.rooms[f.start]);
    const fire = L.hall!.fire;
    const max = s.lab.stats(s.p).hp;
    // Away from the fire: only the slow regen.
    s.lab.setHp(s.p, 50);
    s.tick(30_000);
    const slow = s.lab.hp(s.p) - 50;
    expect(slow).toBe(Math.round(max * lc.player.regenPer10s * 3));
    // By the fire (a free tile next to it, reached from the centre).
    walkTo(s, [L.spot.centre[0], fire[1]]);
    walkTo(s, [fire[0] + 2, fire[1]]);
    expect(s.lab.atFire(s.p)).toBe(true);
    s.lab.setHp(s.p, 50);
    s.tick(30_000);
    const fast = s.lab.hp(s.p) - 50;
    expect(fast - slow).toBe(Math.round((lc.player.campfire.hp / lc.player.campfire.everySec) * 30));
  });

  it('stepping into a bush can start a fight, each time, but not right after one', () => {
    const db = openDatabase(':memory:');
    const repos = createRepos(db);
    const id = repos.accounts.create('bushy', 'h', false, { x: 0, y: 0 }, 2, 0);
    const p = { id, name: 'bushy', hasCharacter: true, lab: null } as unknown as OnlinePlayer;
    let now = 1_700_000_000_000;
    const lab = new LabSystem(lc, repos, () => 0, () => now); // every roll hits
    const f = lab.floor(0);
    // A chamber with brush next to open floor.
    let found: { room: number; from: [number, number]; to: [number, number] } | null = null;
    for (const r of f.rooms) {
      const L = roomLayout(lc, f, r);
      for (const i of L.brush.keys()) {
        const x = i % L.w, y = Math.floor(i / L.w);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = (y + dy) * L.w + x + dx;
          if (!L.brush.has(j) && !L.solid.has(j) && x + dx >= 1 && y + dy >= 1 && x + dx <= L.w - 2 && y + dy <= L.h - 2) found ??= { room: r.id, from: [x + dx, y + dy], to: [x, y] };
        }
      }
      if (found) break;
    }
    expect(found).not.toBeNull();
    const { room, from, to } = found!;
    const at = (t: [number, number]) => ({ x: (t[0] + 0.5) * T, y: (t[1] + 0.5) * T });
    p.lab = { floor: 0, room, ...at(from), dir: 'up', moving: false, at: now };
    now += 200;
    expect(lab.move(p, at(to).x, at(to).y, 'up', true)).toBe(true);
    expect(lab.takeAmbush(p)).toBe(true);
    expect(lab.takeAmbush(p)).toBe(false); // taken
    // After a fight: calm for a few seconds, even stepping out and back in.
    lab.battleDone(p);
    for (const t of [from, to]) {
      now += 200;
      lab.move(p, at(t).x, at(t).y, 'up', true);
    }
    expect(lab.takeAmbush(p)).toBe(false);
    now += lc.brush.graceSec * 1000;
    for (const t of [from, to]) {
      now += 200;
      lab.move(p, at(t).x, at(t).y, 'up', true);
    }
    expect(lab.takeAmbush(p)).toBe(true);
  });

  it('opens a locked treasure door with any key from that floor, and spent keys stay gone', () => {
    const s = setup();
    const f = s.lab.floor(0);
    expect(f.treasure.length).toBeGreaterThanOrEqual(2);
    // Hold only the key for treasure 1, then stand at treasure 0's locked door.
    s.repos.playerData.save(s.p.id, 'lab', { keys: ['0:1'], used: [], unlocked: [] });
    s.lab.enter(s.p, 'entrance');
    const t = f.rooms[f.treasure[0]];
    const [d, door] = Object.entries(t.doors)[0] as [LabDir, { to: number }];
    const outside = f.rooms[door.to];
    const L = roomLayout(lc, f, outside);
    const at = L.doorAt[LAB_OPPOSITE[d]]!;
    const stand = () => { s.p.lab = { floor: 0, room: outside.id, x: (at[0] + 0.5) * T, y: (at[1] + 0.5) * T, dir: 'up', moving: false, at: 0 }; };
    stand();
    const v = s.lab.door(s.p, LAB_OPPOSITE[d]);
    expect(v.room).toBe(t.id);
    expect(v.self.keys).toEqual([]);
    expect(v.self.used).toEqual(['0:1']);
    expect(v.self.unlocked).toEqual(['0:0']);
    // Treasure 1's door stays locked without another key.
    const t1 = f.rooms[f.treasure[1]];
    const [d1, door1] = Object.entries(t1.doors)[0] as [LabDir, { to: number }];
    const out1 = f.rooms[door1.to];
    const at1 = roomLayout(lc, f, out1).doorAt[LAB_OPPOSITE[d1]]!;
    s.p.lab = { floor: 0, room: out1.id, x: (at1[0] + 0.5) * T, y: (at1[1] + 0.5) * T, dir: 'up', moving: false, at: 0 };
    expect(() => s.lab.door(s.p, LAB_OPPOSITE[d1])).toThrow(/any key/);
  });

  it('treats keys behind doors opened by older saves as spent', () => {
    const s = setup();
    s.repos.playerData.save(s.p.id, 'lab', { keys: [], unlocked: ['0:0'] });
    expect(s.lab.self(s.p).used).toEqual(['0:0']);
  });
});

describe('Labirin loot and classes (feedback #24)', () => {
  const lucky = () => {
    const db = openDatabase(':memory:');
    const repos = createRepos(db);
    const id = repos.accounts.create('l', 'h', false, { x: 0, y: 0 }, 2, 0);
    const p = { id, name: 'l', hasCharacter: true, lab: null } as unknown as OnlinePlayer;
    let r = 0.0001;
    const lab = new LabSystem(lc, repos, () => r, () => 1_700_000_000_000);
    return { lab, p, setRand: (v: number) => (r = v) };
  };

  it('a win can drop 💎 and gear; wear it as #uid (stats go up); scrap spares for 💎', () => {
    const { lab, p } = lucky();
    const before = lab.stats(p).atk;
    const got = lab.won(p, 2, 3, 10, false, false, 5, 3);
    expect(got.drops.some((d) => d.startsWith('💎'))).toBe(true);
    // 💰 The reward pop-up gets it all: Syiling, XP, the 💎 and the item in its tier colour.
    expect(got.loot.coins).toBe(got.coins);
    expect(got.loot.xp).toBe(5);
    expect(got.loot.items.some((x) => x.icon === '💎')).toBe(true);
    const found = got.loot.items.find((x) => x.icon !== '💎')!;
    expect(found.color).toMatch(/^#/);
    expect(found.sub).toMatch(/Gear/);
    const st = lab.state(p);
    expect(st.items?.length).toBe(1);
    const it = st.items![0];
    const slot = lc.gear.slots.find((s) => it.gear.startsWith(`${s.id}_`))!.id;
    lab.equip(p, slot, `#${it.uid}`);
    expect(lab.self(p).gear[slot]).toBe(`#${it.uid}`);
    if (slot === 'weapon') expect(lab.stats(p).atk).toBeGreaterThan(before);
    expect(() => lab.scrap(p, it.uid)).toThrow(/take it off/);
    lab.equip(p, slot, null);
    const d = st.diamonds ?? 0;
    expect(lab.scrap(p, it.uid)).toMatch(/scrapped/);
    expect(st.diamonds).toBeGreaterThan(d);
    expect(st.items).toEqual([]);
  });

  it('classes: basics are free and change your stats; shop classes at the merchant; the 💎 roll', () => {
    const { lab, p, setRand } = lucky();
    expect(lab.self(p).classes).toEqual(expect.arrayContaining(['pendekar', 'perisai', 'pemburu', 'bomoh']));
    const hp0 = lab.stats(p).hp;
    lab.setClass(p, 'perisai');
    expect(lab.stats(p).hp).toBeGreaterThan(hp0);
    expect(() => lab.setClass(p, 'hulubalang')).toThrow(/don't have/);
    expect(() => lab.buyClass(p, 'hulubalang')).toThrow(/sold by/);
    lab.enter(p, 'entrance');
    const f = lab.floor(0);
    const m = roomLayout(lc, f, f.rooms[f.start]).spot.merchant;
    p.lab!.x = (m[0] + 0.5) * lc.tile;
    p.lab!.y = (m[1] + 0.5) * lc.tile;
    lab.state(p).coins = 10_000;
    expect(lab.buyClass(p, 'hulubalang')).toMatch(/Hulubalang/);
    expect(lab.self(p).cls).toBe('hulubalang');
    expect(() => lab.buyClass(p, 'raja_purba')).toThrow(/isn't for sale/);
    // The roll: not enough diamonds, then a hit, then a miss (refund).
    expect(() => lab.classRoll(p)).toThrow(/costs/);
    lab.state(p).diamonds = 30;
    expect(lab.classRoll(p)).toMatch(/New class/);
    setRand(0.99);
    expect(lab.classRoll(p)).toMatch(/back/);
    expect(lab.state(p).diamonds).toBe(30 - 2 * lc.loot.classRoll.price + lc.loot.classRoll.refund);
  });
});
