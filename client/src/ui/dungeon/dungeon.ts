// ⚔️ Gua Gelap, the window: a turn-based battle between your 🐾 Teman team and the cave's
// residents. Each round you pick an action (⚔️ the pet's move, ⚡ Charge, 🌟 its Ultimate once it
// has the points), or turn on 🤖 Auto, or ⏩ Skip to play the fight out at once. The server
// decides everything; this plays back what happened (move names, dialogue, HP) and animates.
import { formatMoney, restOffer, type BattleEvent, type DungeonLoot, type DungeonRun, type DungeonView, type Fighter, type RestChoice } from '@kh/shared';
import type { App } from '../../app';
import { drawPetStyled } from '../../items/petArt';
import { battleMusic } from '../battleMusic';
import { el, toast } from '../dom';
import { openPanel } from '../panel';
import { openPetsPanel } from '../pets/petsPanel';
import { sfx } from '../sound';
import { blitEnemy, drawCave } from './dungeonArt';

type Act = 'attack' | 'charge' | 'ultimate' | 'auto';
interface Floater {
  text: string;
  x: number;
  y: number;
  color: string;
  born: number;
  big?: boolean;
}
interface Disp {
  team: Fighter[];
  active: number;
  enemy: Fighter;
}
type LogLine = { text: string; cls: string };

/** Playback speed per event (ms): normal, Auto, Skip. */
const PACE = { normal: 750, auto: 330, skip: 90 };

export function openDungeon(app: App) {
  const dc = app.cfg.dungeon;
  const pc = app.cfg.pets;
  const panel = openPanel(`⚔️ ${dc.name}`, { wide: true, testId: 'dungeon-panel', cls: 'dungeon-panel' });
  const lootBox = panel.side('🎒 This run');
  battleMusic.warm();
  let view: DungeonView | null = null;
  let busy = false;
  let auto = false;

  // ---------------------------------------------------------------- fight state (client side)
  const petSprite = document.createElement('canvas');
  const canvas = el('canvas', { class: 'dungeon-canvas', 'data-testid': 'dungeon-canvas' }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const logBox = el('div', { class: 'battle-log', 'data-testid': 'battle-log', 'aria-live': 'polite' });
  const btnAtk = el('button', { class: 'btn battle-btn atk', type: 'button', 'data-action': 'battle-attack' }) as HTMLButtonElement;
  const btnCharge = el('button', { class: 'btn battle-btn charge', type: 'button', 'data-action': 'battle-charge' }) as HTMLButtonElement;
  const btnUlt = el('button', { class: 'btn battle-btn ult', type: 'button', 'data-action': 'battle-ultimate' }) as HTMLButtonElement;
  const btnAuto = el('button', { class: 'btn small battle-auto', type: 'button', 'data-action': 'battle-auto' }) as HTMLButtonElement;
  const btnSkip = el('button', { class: 'btn small', type: 'button', 'data-action': 'battle-skip', title: 'Play the whole fight out on Auto, fast' }, '⏩ Skip fight') as HTMLButtonElement;
  const btnFlee = el('button', { class: 'btn small', type: 'button', 'data-action': 'dungeon-flee' }, '🏃 Flee (keep half)') as HTMLButtonElement;
  const actions = el('div', { class: 'battle-actions' }, btnAtk, btnCharge, btnUlt);
  const tools = el('div', { class: 'dungeon-controls' }, btnAuto, btnSkip, btnFlee);
  let disp: Disp | null = null;
  let log: LogLine[] = [];
  let floaters: Floater[] = [];
  const hurtAt = { pet: -1e9, enemy: -1e9 };
  const lungeAt = { pet: -1e9, enemy: -1e9 };
  const chargeAt = { pet: -1e9, enemy: -1e9 };
  let banner: { text: string; side: 'pet' | 'enemy'; born: number } | null = null;
  /** 🌟 Ultimates playing: wind-up aura → a blast flying across → the explosion (with a flash and shake). */
  let ults: Array<{ side: 'pet' | 'enemy'; born: number }> = [];
  let sparks: Array<{ x: number; y: number; vx: number; vy: number; born: number; color: string; life: number }> = [];
  const shownHp = { pet: 0, enemy: 0 };
  let playing = false;
  let raf = 0;
  let W = 640, H = 300;
  let closed = false;

  const sizeCanvas = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = Math.max(280, Math.min(720, panel.body.clientWidth - 30));
    H = Math.round(Math.min(340, Math.max(230, W * 0.52))); // a little taller for the angled view
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const run = (): DungeonRun | null => view?.run ?? null;
  const copyDisp = (r: DungeonRun): Disp => ({ team: r.team.map((f) => ({ ...f })), active: r.active, enemy: { ...r.enemy } });
  const shapeOf = (f: Fighter) => app.items.get(f.id)?.shape ?? 'kucing';
  const itemOf = (f: Fighter) => app.store.inventory.find((i) => i.iid === f.iid);
  const cryOf = (f: Fighter) => pc.species[f.id]?.cry ?? '!';
  // An angled view into the cave: your Teman in front (bottom left, bigger), the enemy further back
  // (up and right, a little smaller), on a floor that runs away from you.
  const petX = () => W * 0.27, enemyX = () => W * 0.7, groundY = () => H * 0.8;
  const petFootY = () => H * 0.93, enemyFootY = () => H * 0.62;
  const ULT_MS = { wind: 480, fly: 260, boom: 650 };

  function say(text: string, cls = '') {
    log.push({ text, cls });
    if (log.length > 60) log = log.slice(-60);
    logBox.replaceChildren(...log.slice(-30).map((l) => el('div', { class: `battle-line ${l.cls}` }, l.text)));
    logBox.scrollTop = logBox.scrollHeight;
  }
  function float(text: string, x: number, y: number, color: string, big = false) {
    floaters.push({ text, x, y, color, born: performance.now(), big });
  }

  // ---------------------------------------------------------------- playback
  const wait = (ms: number) => new Promise<void>((res) => window.setTimeout(res, ms));

  /** Shows one event: the log line, the numbers, the animation. */
  function apply(e: BattleEvent, pace: number) {
    if (!disp) return;
    const now = performance.now();
    const pet = disp.team[disp.active];
    const isPet = e.side === 'pet';
    const who = isPet ? 'pet' : 'enemy';
    const other = isPet ? 'enemy' : 'pet';
    const tx = isPet ? enemyX() : petX();
    switch (e.kind) {
      case 'say':
        say(`💬 ${e.name}: “${e.text}”`, 'say');
        break;
      case 'act': {
        const me = isPet ? pet : disp.enemy;
        if (e.points !== undefined) me.points = e.points;
        if (e.action === 'charge') {
          chargeAt[who] = now;
          say(`⚡ ${e.name} charges up! (${e.points} pts, guarding)`, `${who} charge`);
          if (pace > 150) sfx.whoosh();
          break;
        }
        lungeAt[who] = now;
        if (e.action === 'ultimate') {
          banner = { text: `🌟 ${e.move}!`, side: e.side, born: now };
          ults.push({ side: who, born: now });
          if (pace > 150) lungeAt[who] = now + ULT_MS.wind; // the lunge comes with the release
          say(`🌟 ${e.name} unleashes ${e.move}!!`, `${who} ult`);
          if (pace > 150) sfx.reveal(4);
        } else {
          say(`${isPet ? '⚔️' : '💢'} ${e.name} used ${e.move}!`, who);
        }
        if (e.dmg !== undefined) {
          hurtAt[other] = now + (e.action === 'ultimate' && pace > 150 ? ULT_MS.wind + ULT_MS.fly : 120);
          const target = isPet ? disp.enemy : pet;
          if (e.targetHp !== undefined) target.hp = e.targetHp;
          float(`${e.crit ? '💥 ' : ''}-${e.dmg}`, tx, (isPet ? enemyFootY() : petFootY()) - H * 0.4, e.crit ? '#ffd43b' : isPet ? '#fff' : '#ff8787', e.crit || e.action === 'ultimate');
          const extra = [e.crit ? 'Critical hit!' : '', e.guarded ? 'Guarded by the charge.' : ''].filter(Boolean).join(' ');
          say(`   → ${e.dmg} damage.${extra ? ` ${extra}` : ''}`, `${who} dmg`);
          if (pace > 150) (isPet ? sfx.click : sfx.error)();
        }
        break;
      }
      case 'faint':
        say(`💫 ${e.name} fainted!`, e.side === 'pet' ? 'bad' : 'good');
        if (e.side === 'pet') pet.hp = 0;
        else disp.enemy.hp = 0;
        break;
      case 'switch': {
        disp.active = e.index ?? disp.active;
        const f = disp.team[disp.active];
        shownHp.pet = f.hp;
        say(`🐾 Go, ${f.name}! “${cryOf(f)}”`, 'pet');
        break;
      }
      case 'win':
        say(`🏆 ${disp.enemy.name} is beaten!`, 'good');
        sfx.reveal(disp.enemy.boss ? 5 : 2);
        break;
      case 'lose':
        say(`💀 Your whole team is down…`, 'bad');
        break;
      case 'flee':
        say(`💨 ${e.text}`, 'muted');
        break;
    }
  }

  async function playback(events: BattleEvent[], pace: number) {
    playing = true;
    paintControls();
    for (const e of events) {
      if (closed) return;
      apply(e, pace);
      const ult = e.kind === 'act' && e.action === 'ultimate';
      await wait(e.kind === 'say' ? pace * 0.8 : ult ? (pace > 150 ? Math.max(pace * 1.4, ULT_MS.wind + ULT_MS.fly + 450) : pace * 1.4) : pace);
    }
    playing = false;
  }

  function act(a: Act, skip = false) {
    if (busy || playing || !app.socket || run()?.phase !== 'fight') return;
    busy = true;
    paintControls();
    app.socket.timeout(8000).emit('dungeon:act', { action: a, skip }, async (err, res) => {
      busy = false;
      if (err || !res.ok) {
        toast(err ? 'No reply from the server.' : res.ok ? '' : res.error, 'bad');
        return load();
      }
      await playback(res.events, skip ? PACE.skip : auto ? PACE.auto : PACE.normal);
      if (closed) return;
      const was = view?.run?.floor;
      view = res.view;
      for (const u of res.levelUps) {
        sfx.levelUp();
        toast(`⬆️ ${u.name} reached level ${u.level}!`, 'good', 3500);
      }
      if (res.paid) showPaid(res.paid, true);
      const r = view.run;
      if (r && r.phase === 'fight' && r.floor === was) {
        disp = copyDisp(r);
        paintLoot();
        paintControls();
        if (auto) window.setTimeout(() => auto && act('auto'), 120);
      } else render();
    });
  }

  function showPaid(paid: DungeonLoot, fell: boolean) {
    if (!paid.sen && !paid.shards) return;
    sfx.coin();
    toast(`${fell ? '💀 Your team fell. You kept half: ' : '💰 '}+${formatMoney(paid.sen)}${paid.shards ? ` · +${paid.shards} 💎` : ''} · +${paid.xp} XP from ${dc.name}`, fell ? 'bad' : 'good', 4500);
  }

  // ---------------------------------------------------------------- drawing
  function bar(x: number, y: number, w: number, cur: number, max: number, label: string, color: string, points: number, alignRight: boolean) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y, w, 14);
    const k = Math.max(0, Math.min(1, cur / max));
    ctx.fillStyle = k < 0.25 ? '#fa5252' : color;
    ctx.fillRect(x + 2, y + 2, (w - 4) * k, 10);
    ctx.font = '800 12px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#fff';
    ctx.textAlign = alignRight ? 'right' : 'left';
    ctx.fillText(label, alignRight ? x + w : x, y - 2);
    ctx.textAlign = alignRight ? 'left' : 'right';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillText(`${Math.max(0, Math.round(cur))}/${max}`, alignRight ? x : x + w, y - 2);
    // Points pips (the ultimate needs ultimateCost).
    const n = Math.max(pc.battle.ultimateCost, Math.min(points, 12));
    for (let i = 0; i < n; i++) {
      const px = alignRight ? x + w - 6 - i * 13 : x + 6 + i * 13;
      ctx.beginPath();
      ctx.arc(px, y + 22, 5, 0, Math.PI * 2);
      ctx.fillStyle = i < points ? (points >= pc.battle.ultimateCost ? '#ffd43b' : '#74c0fc') : 'rgba(255,255,255,0.18)';
      ctx.fill();
    }
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    const r = run();
    if (!r || !disp) return;
    const now = performance.now();
    // Shake while an ultimate explodes.
    let shake = 0;
    for (const u of ults) {
      const k = (now - u.born - ULT_MS.wind - ULT_MS.fly) / ULT_MS.boom;
      if (k >= 0 && k < 1) shake = Math.max(shake, (1 - k) * (u.side === 'enemy' && disp.enemy.boss ? 10 : 7));
    }
    ctx.save();
    if (shake) ctx.translate((Math.random() - 0.5) * shake * 2, (Math.random() - 0.5) * shake * 2);
    drawCave(ctx, W, H, r.floor, now);
    const pet = disp.team[disp.active];
    shownHp.pet += (pet.hp - shownHp.pet) * 0.15;
    shownHp.enemy += (disp.enemy.hp - shownHp.enemy) * 0.15;
    const lunge = (side: 'pet' | 'enemy') => {
      const k = (now - lungeAt[side]) / 260;
      return k < 0 || k > 1 ? 0 : Math.sin(k * Math.PI);
    };
    const hurt = (side: 'pet' | 'enemy') => Math.max(0, 1 - Math.abs(now - hurtAt[side]) / 220);
    // Charge aura
    for (const side of ['pet', 'enemy'] as const) {
      const k = (now - chargeAt[side]) / 700;
      if (k >= 0 && k < 1) {
        ctx.beginPath();
        ctx.ellipse(side === 'pet' ? petX() : enemyX(), (side === 'pet' ? petFootY() : enemyFootY()) - H * 0.16, H * (0.12 + k * 0.18), H * (0.12 + k * 0.18) * 0.8, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(116,192,252,${1 - k})`;
        ctx.lineWidth = 6;
        ctx.stroke();
      }
    }
    // The enemy (right).
    const size = H * (disp.enemy.boss ? 0.5 : 0.38); // further back: smaller
    if (disp.enemy.hp > 0 || now - hurtAt.enemy < 700) {
      ctx.save();
      if (disp.enemy.hp <= 0) ctx.globalAlpha = Math.max(0, 1 - (now - hurtAt.enemy) / 700);
      const le = lunge('enemy');
      blitEnemy(ctx, disp.enemy.id, enemyX() + le * (petX() - enemyX()) * 0.42, enemyFootY() + le * (petFootY() - enemyFootY()) * 0.42, size * (1 + le * 0.2), now, le, hurt('enemy'));
      ctx.restore();
    }
    // Your pet (left, facing right).
    if (pet.hp > 0 || now - hurtAt.pet < 600) {
      const s = H / 64; // in front: bigger
      // Its shadow on the floor.
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(petX() + lunge('pet') * (enemyX() - petX()) * 0.42, petFootY() + lunge('pet') * (enemyFootY() - petFootY()) * 0.42 + 2, H * 0.13, H * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
      const def = app.items.get(pet.id);
      // Drawn on its own little canvas so a hit can tint just the pet.
      const sw = Math.ceil(44 * s), sh = Math.ceil(40 * s);
      if (petSprite.width !== sw || petSprite.height !== sh) {
        petSprite.width = sw;
        petSprite.height = sh;
      }
      const pctx = petSprite.getContext('2d')!;
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.clearRect(0, 0, sw, sh);
      pctx.setTransform(s, 0, 0, s, sw / 2, sh - 16.5 * s); // feet (y 14.5) 2 units off the bottom
      drawPetStyled(pctx, shapeOf(pet), now, def?.color, def?.color2);
      if (hurt('pet') > 0) {
        pctx.setTransform(1, 0, 0, 1, 0, 0);
        pctx.globalCompositeOperation = 'source-atop';
        pctx.fillStyle = `rgba(255,80,80,${0.55 * hurt('pet')})`;
        pctx.fillRect(0, 0, sw, sh);
        pctx.globalCompositeOperation = 'source-over';
      }
      ctx.save();
      if (pet.hp <= 0) ctx.globalAlpha = 0.4;
      const lp = lunge('pet');
      const px = petX() + lp * (enemyX() - petX()) * 0.42 + Math.sin(now / 25) * 5 * hurt('pet');
      const py = petFootY() + lp * (enemyFootY() - petFootY()) * 0.42;
      ctx.drawImage(petSprite, px - sw / 2, py + 2 * s - sh, sw, sh);
      ctx.restore();
      const it = itemOf(pet);
      if (it && it.variant !== 'normal') {
        ctx.font = '700 14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('✨', px - sw * 0.4, py - sh * 0.8);
      }
    }
    drawUlts(now);
    ctx.restore(); // end of the shake
    // HP bars + points
    bar(12, 24, W * 0.4, shownHp.pet, pet.maxHp, `${pet.name}`, '#51cf66', pet.points, false);
    bar(W - 12 - W * 0.42, 24, W * 0.42, shownHp.enemy, disp.enemy.maxHp, `${disp.enemy.boss ? 'BOSS · ' : ''}${disp.enemy.name}`, disp.enemy.boss ? '#f03e3e' : '#ff922b', disp.enemy.points, true);
    // Team dots (bottom left): who's still standing.
    disp.team.forEach((f, i) => {
      ctx.beginPath();
      ctx.arc(18 + i * 18, H - 14, 6, 0, Math.PI * 2);
      ctx.fillStyle = f.hp <= 0 ? '#495057' : i === disp!.active ? '#69db7c' : '#a5d8ff';
      ctx.fill();
    });
    // Move banner (an ultimate)
    if (banner && now - banner.born < 1300) {
      const k = (now - banner.born) / 1300;
      ctx.globalAlpha = k < 0.15 ? k / 0.15 : k > 0.8 ? (1 - k) / 0.2 : 1;
      ctx.fillStyle = banner.side === 'pet' ? 'rgba(25,113,194,0.85)' : 'rgba(201,42,42,0.85)';
      ctx.fillRect(0, H * 0.42, W, 40);
      ctx.font = `900 ${Math.round(Math.min(26, W / 18))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(banner.text, W / 2 + (banner.side === 'pet' ? -1 : 1) * (1 - Math.min(1, k * 5)) * W * 0.4, H * 0.42 + 20);
      ctx.globalAlpha = 1;
    }
    // Floating numbers
    floaters = floaters.filter((f) => now - f.born < 1100);
    for (const f of floaters) {
      const k = (now - f.born) / 1100;
      ctx.globalAlpha = 1 - k;
      ctx.font = `900 ${f.big ? 26 : 18}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000';
      ctx.strokeText(f.text, f.x, f.y - k * 40);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - k * 40);
      ctx.globalAlpha = 1;
    }
    ctx.font = '900 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = disp.enemy.boss ? '#ff8787' : '#ced4da';
    ctx.fillText(`Floor ${r.floor}${disp.enemy.boss ? ' · BOSS' : ''}`, W / 2, 4);
  }

  /** 🌟 Ultimate effects: a spinning aura while it winds up, a blazing shot across, then a blast. */
  function drawUlts(now: number) {
    ults = ults.filter((u) => now - u.born < ULT_MS.wind + ULT_MS.fly + ULT_MS.boom);
    for (const u of ults) {
      const t = now - u.born;
      const fromPet = u.side === 'pet';
      const ax = fromPet ? petX() : enemyX(), ay = (fromPet ? petFootY() : enemyFootY()) - H * 0.17;
      const bx = fromPet ? enemyX() : petX(), by = (fromPet ? enemyFootY() : petFootY()) - H * 0.17;
      const c1 = fromPet ? '255,212,59' : '255,107,107';
      const c2 = fromPet ? '116,192,252' : '190,75,219';
      if (t < ULT_MS.wind) {
        // Wind-up: the room darkens, rays spin round the attacker, sparks rise.
        const k = t / ULT_MS.wind;
        ctx.fillStyle = `rgba(0,0,0,${0.35 * k})`;
        ctx.fillRect(-20, -20, W + 40, H + 40);
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(t / 120);
        for (let i = 0; i < 10; i++) {
          ctx.rotate((Math.PI * 2) / 10);
          const g = ctx.createLinearGradient(0, 0, H * 0.4 * k, 0);
          g.addColorStop(0, `rgba(${c1},${0.9 * k})`);
          g.addColorStop(1, `rgba(${c1},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(0, -4);
          ctx.lineTo(H * 0.42 * k, 0);
          ctx.lineTo(0, 4);
          ctx.fill();
        }
        ctx.restore();
        const glow = ctx.createRadialGradient(ax, ay, 2, ax, ay, H * 0.22 * (0.5 + k));
        glow.addColorStop(0, `rgba(255,255,255,${0.8 * k})`);
        glow.addColorStop(0.4, `rgba(${c2},${0.5 * k})`);
        glow.addColorStop(1, `rgba(${c2},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(ax, ay, H * 0.22 * (0.5 + k), 0, Math.PI * 2);
        ctx.fill();
        if (Math.random() < 0.7) sparks.push({ x: ax + (Math.random() - 0.5) * H * 0.3, y: ay + H * 0.12, vx: (Math.random() - 0.5) * 20, vy: -60 - Math.random() * 80, born: now, color: `rgb(${c1})`, life: 500 });
      } else if (t < ULT_MS.wind + ULT_MS.fly) {
        // The shot: a bright orb with a trail flying from attacker to target.
        const k = (t - ULT_MS.wind) / ULT_MS.fly;
        const x = ax + (bx - ax) * k, y = ay + (by - ay) * k - Math.sin(k * Math.PI) * H * 0.12;
        for (let i = 6; i >= 0; i--) {
          const kk = Math.max(0, k - i * 0.05);
          const tx = ax + (bx - ax) * kk, ty = ay + (by - ay) * kk - Math.sin(kk * Math.PI) * H * 0.12;
          ctx.fillStyle = `rgba(${i ? c2 : '255,255,255'},${0.9 - i * 0.12})`;
          ctx.beginPath();
          ctx.arc(tx, ty, H * (0.06 - i * 0.006), 0, Math.PI * 2);
          ctx.fill();
        }
        const g = ctx.createRadialGradient(x, y, 1, x, y, H * 0.14);
        g.addColorStop(0, `rgba(${c1},0.9)`);
        g.addColorStop(1, `rgba(${c1},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, H * 0.14, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // The blast: a flash, shock rings, spikes and sparks flying out.
        const k = (t - ULT_MS.wind - ULT_MS.fly) / ULT_MS.boom;
        if (k < 0.04) {
          for (let i = 0; i < 26; i++) {
            const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 260;
            sparks.push({ x: bx, y: by, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7 - 40, born: now, color: i % 2 ? `rgb(${c1})` : `rgb(${c2})`, life: 450 + Math.random() * 300 });
          }
        }
        ctx.fillStyle = `rgba(255,255,255,${Math.max(0, 0.55 - k * 2)})`;
        ctx.fillRect(-20, -20, W + 40, H + 40);
        for (let i = 0; i < 3; i++) {
          const kk = Math.max(0, k - i * 0.12);
          ctx.strokeStyle = `rgba(${i === 1 ? c2 : c1},${Math.max(0, 1 - kk)})`;
          ctx.lineWidth = 8 * (1 - kk) + 1;
          ctx.beginPath();
          ctx.ellipse(bx, by + H * 0.1, H * 0.5 * kk, H * 0.5 * kk * 0.45, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.save();
        ctx.translate(bx, by);
        ctx.globalAlpha = Math.max(0, 1 - k * 1.4);
        for (let i = 0; i < 12; i++) {
          ctx.rotate((Math.PI * 2) / 12);
          ctx.fillStyle = `rgba(${c1},0.9)`;
          ctx.beginPath();
          ctx.moveTo(H * 0.05, -3);
          ctx.lineTo(H * (0.1 + 0.35 * k) * (i % 2 ? 0.7 : 1), 0);
          ctx.lineTo(H * 0.05, 3);
          ctx.fill();
        }
        ctx.restore();
      }
    }
    // Sparks (gravity pulls them down).
    sparks = sparks.filter((p) => now - p.born < p.life);
    for (const p of sparks) {
      const age = (now - p.born) / 1000;
      const x = p.x + p.vx * age, y = p.y + p.vy * age + 220 * age * age;
      ctx.globalAlpha = Math.max(0, 1 - (now - p.born) / p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- controls & screens
  function paintControls() {
    const r = run();
    const me = disp?.team[disp.active];
    const lock = busy || playing || auto || r?.phase !== 'fight';
    btnAtk.disabled = lock;
    btnCharge.disabled = lock;
    btnUlt.disabled = lock || !me || me.points < pc.battle.ultimateCost;
    btnSkip.disabled = busy || playing || r?.phase !== 'fight';
    btnFlee.disabled = busy || playing;
    btnAtk.replaceChildren(el('b', {}, `⚔️ ${me?.move ?? 'Attack'}`), el('small', {}, `Attack · +${pc.battle.attackPoints} pt`));
    btnCharge.replaceChildren(el('b', {}, '⚡ Charge'), el('small', {}, `+${pc.battle.chargePoints} pts · halves damage`));
    btnUlt.replaceChildren(el('b', {}, `🌟 ${me?.ultimate ?? 'Ultimate'}`), el('small', {}, `Ultimate · ${me?.points ?? 0}/${pc.battle.ultimateCost} pts`));
    btnAuto.textContent = auto ? '🤖 Auto: ON' : '🤖 Auto: off';
    btnAuto.classList.toggle('primary', auto);
  }

  function paintLoot() {
    const r = run();
    const parts: HTMLElement[] = [
      el('div', { class: 'dungeon-stat' }, el('span', {}, '🏆 Best floor'), el('b', {}, String(view?.best ?? 0))),
      el('div', { class: 'dungeon-stat' }, el('span', {}, '🎟️ Runs left today'), el('b', {}, `${view?.runsLeft ?? 0} / ${dc.runsPerDay}`)),
    ];
    if (r) {
      parts.push(
        el('h5', { class: 'worn-section' }, `Floor ${r.floor}`),
        el('div', { class: 'dungeon-stat' }, el('span', {}, '💰 Money'), el('b', {}, formatMoney(r.loot.sen))),
        el('div', { class: 'dungeon-stat' }, el('span', {}, '💎 Shards'), el('b', {}, String(r.loot.shards))),
        el('div', { class: 'dungeon-stat' }, el('span', {}, '⭐ XP'), el('b', {}, String(r.loot.xp))),
        el('div', { class: 'dungeon-stat' }, el('span', {}, '🐾 Pet XP'), el('b', {}, String(r.loot.petXp))),
        el('h5', { class: 'worn-section' }, 'Team'),
        ...(disp ?? copyDisp(r)).team.map((f) => el('div', { class: 'dungeon-stat' }, el('span', {}, `${f.hp <= 0 ? '💫' : '🐾'} ${f.name}`), el('b', {}, `${f.hp}/${f.maxHp}`))),
        el('div', { class: 'muted small' }, r.phase === 'dead' ? 'Your team fell: half of this was kept.' : `Fall or flee and you keep half (${formatMoney(Math.floor(r.loot.sen * dc.deathKeep))}). Cash out between floors to keep it all.`),
      );
    }
    lootBox.replaceChildren(...parts);
  }

  function lobby(): HTMLElement[] {
    const v = view!;
    const enter = el('button', { class: 'btn primary dungeon-enter', type: 'button', 'data-action': 'dungeon-enter', disabled: !v.runsLeft }, v.runsLeft ? `⚔️ Enter the cave (${v.runsLeft} left today)` : '🌙 No runs left today');
    enter.addEventListener('click', () => call('dungeon:enter'));
    const teman = el('button', { class: 'btn', type: 'button', 'data-action': 'dungeon-pets' }, '🐾 My Teman (team, training, gear)');
    teman.addEventListener('click', () => openPetsPanel(app));
    const b = pc.battle;
    return [
      el('p', {}, `A cave under Kota Damansara, full of pests and spirits. Your 🐾 Teman fight for you: one enemy per floor, a boss every ${dc.bossEvery} floors. The deeper you go, the better the loot.`),
      el('ol', { class: 'dungeon-how' },
        el('li', {}, `⚔️ Attack: your Teman's own move. Builds ${b.attackPoints} point.`),
        el('li', {}, `⚡ Charge: builds ${b.chargePoints} points and halves the damage you take that round.`),
        el('li', {}, `🌟 Ultimate: costs ${b.ultimateCost} points, hits about ${b.ultimatePower}× as hard.`),
        el('li', {}, '🤖 Auto picks for you and keeps going deeper until your whole team faints (⏸ to stop); ⏩ Skip plays one fight out in a flash. The faster one acts first.'),
        el('li', {}, `🐾 Up to ${b.teamSize} Teman: when one faints the next comes out. HP carries over from floor to floor. After each floor: go deeper or 💰 cash out.`),
        el('li', {}, `🏕️ A rest room every ${dc.rest.every} floors (and sometimes in between): 🍲 heal (fainted Teman come back), 💪 a buff for the rest of the run, or 🩸 sacrifice HP for money.`),
        el('li', {}, `💀 Fall or flee and you keep half the loot. ${dc.runsPerDay} runs a day.`),
      ),
      el('p', { class: 'muted small' }, 'Every floor cleared gives your team pet XP. Train, upgrade and kit them out in 📱 Teman.'),
      el('div', { class: 'dungeon-controls' }, enter, teman),
    ];
  }

  function music() {
    const r = run();
    battleMusic.play(r && r.phase !== 'dead' ? (r.enemy.boss ? 'boss' : 'fight') : null);
  }

  function startFloor(r: DungeonRun) {
    disp = copyDisp(r);
    shownHp.pet = disp.team[disp.active].hp;
    shownHp.enemy = disp.enemy.hp;
    floaters = [];
    banner = null;
    ults = [];
    sparks = [];
    log = [];
    say(`— Floor ${r.floor}${r.enemy.boss ? ' · BOSS' : ''} —`, 'muted');
    say(`${r.enemy.boss ? '👹' : '👾'} ${r.enemy.name} appears! ${r.enemyLine}`, 'enemy');
    const me = disp.team[disp.active];
    say(`🐾 Go, ${me.name}! “${cryOf(me)}”`, 'pet');
  }

  function render() {
    cancelAnimationFrame(raf);
    paintLoot();
    music();
    if (!view) return void panel.body.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
    const r = view.run;
    if (!r) {
      disp = null;
      return void panel.body.replaceChildren(...lobby());
    }
    if (r.phase === 'fight') {
      if (!disp || r.round === 0) startFloor(r);
      panel.body.replaceChildren(canvas, actions, logBox, tools);
      sizeCanvas();
      raf = requestAnimationFrame(frame);
      paintControls();
      if (auto) window.setTimeout(() => auto && act('auto'), 400);
      return;
    }
    if (r.phase === 'rest') return void panel.body.replaceChildren(...restRoom(r));
    // Between floors, or fallen: the last frame of the fight, the log and the choice.
    disp = copyDisp(r);
    panel.body.replaceChildren(canvas);
    sizeCanvas();
    raf = requestAnimationFrame(frame);
    if (r.phase === 'cleared') {
      const nextBoss = (r.floor + 1) % dc.bossEvery === 0;
      const deeper = el('button', { class: 'btn primary', type: 'button', 'data-action': 'dungeon-deeper' }, r.restNext ? '🏕️ On to the rest room' : `⬇️ Go deeper: floor ${r.floor + 1}${nextBoss ? ' (BOSS!)' : ''}`);
      deeper.addEventListener('click', () => call('dungeon:deeper'));
      const cash = el('button', { class: 'btn', type: 'button', 'data-action': 'dungeon-cashout' }, `💰 Cash out ${formatMoney(r.loot.sen)}${r.loot.shards ? ` + ${r.loot.shards} 💎` : ''}`);
      cash.addEventListener('click', () => leave());
      const standing = r.team.filter((f) => f.hp > 0).length;
      // 🤖 Auto keeps going down, floor after floor, until the whole team has fainted (or you stop it).
      const autoLine = el('div', { class: 'muted small' });
      const stop = el('button', { class: 'btn small', type: 'button', 'data-action': 'dungeon-auto-stop' }, '⏸ Stop Auto');
      stop.addEventListener('click', () => {
        auto = false;
        autoLine.textContent = '🤖 Auto stopped. Go deeper or cash out.';
        stop.remove();
      });
      panel.body.append(
        el('div', { class: 'dungeon-cleared' },
          el('h4', {}, `✅ Floor ${r.floor} cleared!`),
          el('div', { class: 'muted' }, `${standing}/${r.team.length} Teman standing · HP carries over${r.restNext ? ' · 🏕️ a rest room is next!' : ''}`),
          el('div', { class: 'dungeon-controls' }, deeper, cash),
          ...(auto ? [autoLine, stop] : [])),
        logBox,
      );
      if (auto) {
        const floor = r.floor;
        let left = 3;
        const tick = () => {
          if (!auto || closed || view?.run?.phase !== 'cleared' || view.run.floor !== floor) return;
          if (left <= 0) return void call('dungeon:deeper');
          autoLine.textContent = `🤖 Auto: going down to floor ${floor + 1} in ${left}…`;
          left--;
          window.setTimeout(tick, 700);
        };
        tick();
      }
    } else {
      const ok = el('button', { class: 'btn primary', type: 'button', 'data-action': 'dungeon-ok' }, 'Back to the entrance');
      ok.addEventListener('click', () => leave());
      panel.body.append(el('div', { class: 'dungeon-cleared' }, el('h4', {}, `💀 Your team fell on floor ${r.floor}`), el('div', { class: 'muted' }, `Half the loot was kept: ${formatMoney(Math.floor(r.loot.sen * dc.deathKeep))}.`), ok), logBox);
      auto = false;
    }
  }

  /** 🏕️ A rest room between floors: pick one (Auto picks: heal if hurt, otherwise the buff). */
  function restRoom(r: DungeonRun): HTMLElement[] {
    const rc = dc.rest;
    const offer = restOffer(dc, r, app.store.progress.stage);
    const hpShare = r.team.reduce((a, f) => a + Math.max(0, f.hp), 0) / Math.max(1, r.team.reduce((a, f) => a + f.maxHp, 0));
    const pick = (choice: RestChoice) => {
      if (busy || !app.socket) return;
      busy = true;
      app.socket.timeout(6000).emit('dungeon:rest', { choice }, (err, res) => {
        busy = false;
        if (err || !res.ok) {
          auto = false;
          return void toast(err ? 'No reply from the server.' : res.ok ? '' : res.error, 'bad');
        }
        if (choice === 'heal') sfx.levelUp();
        else if (choice === 'sacrifice') sfx.coin();
        else sfx.click();
        view = res.view;
        disp = null;
        render();
      });
    };
    const card = (choice: RestChoice, icon: string, title: string, desc: string, disabled = false) => {
      const b = el('button', { class: 'rest-card', type: 'button', 'data-action': `rest-${choice}`, disabled }, el('div', { class: 'rest-icon' }, icon), el('b', {}, title), el('small', {}, desc));
      b.addEventListener('click', () => pick(choice));
      return b;
    };
    const cash = el('button', { class: 'btn', type: 'button', 'data-action': 'dungeon-cashout' }, `💰 Cash out ${formatMoney(r.loot.sen)}`);
    cash.addEventListener('click', () => leave());
    const skip = el('button', { class: 'btn small', type: 'button', 'data-action': 'rest-skip' }, `Move on to floor ${r.floor + 1}`);
    skip.addEventListener('click', () => pick('skip'));
    const out = [
      el('div', { class: 'rest-room' },
        el('h4', {}, '🏕️ A quiet corner of the cave'),
        el('p', { class: 'muted' }, `A campfire, a trickle of clean water… and an old shrine that pays for blood. Pick ONE, then it's down to floor ${r.floor + 1}.`),
        el('div', { class: 'rest-team' }, ...r.team.map((f) => el('span', { class: `rest-pet${f.hp <= 0 ? ' out' : ''}` }, `${f.hp <= 0 ? '💫' : '🐾'} ${f.name} ${Math.max(0, f.hp)}/${f.maxHp}`))),
        el('div', { class: 'rest-cards' },
          card('heal', '🍲', 'Rest & eat', `+${Math.round(rc.heal * 100)}% HP each${offer.revives ? `, ${offer.revives} fainted back at ${Math.round(rc.revive * 100)}%` : ''} (+${offer.healHp} HP)`, offer.healHp <= 0),
          card('buff', '💪', 'Train hard', `+${Math.round(rc.buffAtk * 100)}% attack, +${Math.round(rc.buffDef * 100)}% defence for the rest of this run${r.buffs ? ` (you have ${r.buffs})` : ''}`),
          card('sacrifice', '🩸', 'Blood money', `Each standing Teman loses ${Math.round(rc.sacrificeHp * 100)}% HP (−${offer.sacrificeHp} HP): +${formatMoney(offer.sacrificeSen)} to the loot`, offer.sacrificeHp <= 0)),
        el('div', { class: 'dungeon-controls' }, skip, cash)),
    ];
    if (auto) {
      const choice: RestChoice = offer.revives || hpShare < 0.6 ? 'heal' : 'buff';
      const note = el('div', { class: 'muted small' }, `🤖 Auto picks ${choice === 'heal' ? '🍲 Rest & eat' : '💪 Train hard'}…`);
      out.push(note);
      window.setTimeout(() => auto && !closed && view?.run?.phase === 'rest' && pick(choice), 1400);
    }
    return out;
  }

  function call(ev: 'dungeon:enter' | 'dungeon:deeper' | 'dungeon:view') {
    if (busy || !app.socket) return;
    busy = true;
    app.socket.timeout(6000).emit(ev, (err, res) => {
      busy = false;
      if (err || !res.ok) {
        auto = false;
        return void toast(err ? 'No reply from the server.' : res.ok ? '' : res.error, 'bad');
      }
      view = res.view;
      if (ev !== 'dungeon:view') {
        sfx.click();
        disp = null;
      }
      render();
    });
  }

  function leave() {
    if (busy || !app.socket) return;
    busy = true;
    auto = false;
    app.socket.timeout(6000).emit('dungeon:leave', (err, res) => {
      busy = false;
      if (err || !res.ok) return void toast(err ? 'No reply from the server.' : res.ok ? '' : res.error, 'bad');
      showPaid(res.paid, false);
      view = res.view;
      disp = null;
      render();
    });
  }
  const load = () => call('dungeon:view');

  btnAtk.addEventListener('click', () => act('attack'));
  btnCharge.addEventListener('click', () => act('charge'));
  btnUlt.addEventListener('click', () => act('ultimate'));
  btnSkip.addEventListener('click', () => act('auto', true));
  btnAuto.addEventListener('click', () => {
    auto = !auto;
    paintControls();
    if (auto && !busy && !playing) act('auto');
  });
  btnFlee.addEventListener('click', () => {
    if (confirm('Run away? You keep half of the loot from this run.')) leave();
  });
  const onKey = (e: KeyboardEvent) => {
    if (panel.root.classList.contains('panel-hidden') || run()?.phase !== 'fight') return;
    const k = { Digit1: 'attack', Digit2: 'charge', Digit3: 'ultimate' }[e.code] as Act | undefined;
    if (k) {
      e.preventDefault();
      act(k);
    }
  };
  window.addEventListener('keydown', onKey);
  panel.onResume = () => paintControls();
  panel.onClose = () => {
    closed = true;
    auto = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    battleMusic.play(null);
  };
  render();
  load();
}
