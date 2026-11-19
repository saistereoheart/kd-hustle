// ⚔️ Gua Gelap, the window: the entrance (runs left today, best floor, how to play), the fight
// (cave, enemy, HP bars, the strike bar, the block ring), and the choice after each floor (go
// deeper or cash out). The server grades every tap; this just times them and animates.
import {
  formatMoney, gradeStrike, hitLandsAt, markerAt,
  type DungeonLoot, type DungeonRun, type DungeonTurn, type DungeonView, type HitGrade, type TurnResult,
} from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { openPanel } from '../panel';
import { sfx } from '../sound';
import { blitEnemy, drawCave } from './dungeonArt';

type Phase = 'strike' | 'block' | 'waiting' | 'result';

interface Floater {
  text: string;
  x: number;
  y: number;
  color: string;
  born: number;
  big?: boolean;
}

const GRADE_TEXT: Record<HitGrade, string> = { perfect: 'PERFECT!', great: 'Great', good: 'Good', miss: 'Miss' };
const GRADE_COLOR: Record<HitGrade, string> = { perfect: '#ffd43b', great: '#69db7c', good: '#a5d8ff', miss: '#adb5bd' };

export function openDungeon(app: App) {
  const dc = app.cfg.dungeon;
  const panel = openPanel(`⚔️ ${dc.name}`, { wide: true, testId: 'dungeon-panel', cls: 'dungeon-panel' });
  const lootBox = panel.side('🎒 This run');
  let view: DungeonView | null = null;
  let busy = false;

  // ---------------------------------------------------------------- fight state (client side)
  const canvas = el('canvas', { class: 'dungeon-canvas', 'data-testid': 'dungeon-canvas' }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const action = el('button', { class: 'btn primary dungeon-action', type: 'button', 'data-action': 'dungeon-action' }) as HTMLButtonElement;
  const flee = el('button', { class: 'btn small', type: 'button', 'data-action': 'dungeon-flee' }, '🏃 Flee (keep half)');
  const hint = el('div', { class: 'muted small dungeon-hint' });
  let phase: Phase = 'waiting';
  let turn: DungeonTurn | null = null;
  let t0 = 0; // performance.now() when the turn appeared
  let strikeMs: number | null = null;
  let blockMs: number | null = null;
  let blockTimer = 0;
  let strikeTimer = 0;
  let floaters: Floater[] = [];
  let hurtAt = -1e9; // when the enemy was last hit
  let youHurtAt = -1e9;
  let shownHp = { you: 0, enemy: 0 };
  let raf = 0;
  let W = 640, H = 300;

  const sizeCanvas = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = Math.max(280, Math.min(720, panel.body.clientWidth - 30));
    H = Math.round(Math.min(320, Math.max(220, W * 0.46)));
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const run = (): DungeonRun | null => view?.run ?? null;

  function float(text: string, x: number, y: number, color: string, big = false) {
    floaters.push({ text, x, y, color, born: performance.now(), big });
  }

  function startTurn() {
    const r = run();
    if (!r || r.phase !== 'fight' || !r.turn) return;
    turn = r.turn;
    t0 = performance.now();
    strikeMs = null;
    blockMs = null;
    phase = 'strike';
    clearTimeout(strikeTimer);
    clearTimeout(blockTimer);
    // No tap in time: the strike misses, on to the block.
    strikeTimer = window.setTimeout(() => phase === 'strike' && doStrike(true), dc.strike.timeoutMs);
    paintControls();
  }

  function doStrike(timedOut = false) {
    if (phase !== 'strike' || !turn) return;
    clearTimeout(strikeTimer);
    strikeMs = timedOut ? null : performance.now() - t0;
    const g = gradeStrike(dc, turn, strikeMs);
    sfx[g === 'miss' ? 'error' : 'click']();
    const r = run()!;
    const dealt = Math.max(g === 'miss' ? 0 : 1, Math.round(r.atk * dc.strike.mult[g]));
    // If that finishes it off, there's no swing to block: send now.
    if (dealt >= r.enemy.hp) return send();
    phase = 'block';
    const lands = hitLandsAt(dc, turn, strikeMs ?? dc.strike.timeoutMs);
    blockTimer = window.setTimeout(() => phase === 'block' && send(), Math.max(0, lands + dc.block.windowMs.good + 150 - (performance.now() - t0)));
    paintControls();
  }

  function doBlock() {
    if (phase !== 'block') return;
    blockMs = performance.now() - t0;
    clearTimeout(blockTimer);
    send();
  }

  function send() {
    if (!turn || !app.socket) return;
    phase = 'waiting';
    paintControls();
    const nonce = turn.nonce;
    app.socket.timeout(8000).emit('dungeon:turn', { nonce, strikeMs: strikeMs === null ? null : Math.round(strikeMs), blockMs: blockMs === null ? null : Math.round(blockMs) }, (err, res) => {
      if (err || !res.ok) {
        toast(err ? 'No reply from the server.' : res.ok ? '' : res.error, 'bad');
        return load();
      }
      showResult(res.result, res.view, res.paid);
    });
  }

  function showResult(r: TurnResult, v: DungeonView, paid: DungeonLoot | null) {
    view = v;
    phase = 'result';
    const now = performance.now();
    const ex = W * 0.7, ey = H * 0.42;
    float(r.dealt ? `${r.crit ? '💥 ' : ''}-${r.dealt}` : 'Miss', ex, ey, r.crit ? '#ffd43b' : '#fff', r.crit);
    float(GRADE_TEXT[r.strike], ex, ey - 30, GRADE_COLOR[r.strike]);
    if (r.dealt) hurtAt = now;
    if (r.block) {
      float(r.parried ? '🛡️ PARRY!' : r.taken ? `-${r.taken}` : 'Blocked', W * 0.2, H * 0.45, r.parried ? '#ffd43b' : '#ff8787', r.parried);
      if (r.taken) youHurtAt = now;
      if (r.taken) sfx.error();
    }
    if (r.crit) sfx.coin();
    if (r.killed) {
      sfx.reveal(run()?.enemy.boss ? 4 : 2);
      float(`+${formatMoney(r.floorLoot!.sen)}`, ex, ey - 64, '#8ce99a', true);
    }
    if (r.dead && paid) toast(`💀 You fell on floor ${v.run?.floor}. You kept half the loot: ${formatMoney(paid.sen)}${paid.shards ? ` · ${paid.shards} 💎` : ''}.`, 'bad', 5000);
    paintLoot();
    window.setTimeout(() => {
      if (v.run?.phase === 'fight') startTurn();
      else render();
    }, r.killed || r.dead ? 1100 : 750);
  }

  // ---------------------------------------------------------------- drawing
  function frame() {
    raf = requestAnimationFrame(frame);
    const r = run();
    if (!r) return;
    const now = performance.now();
    const t = now - t0;
    drawCave(ctx, W, H, r.floor, now);
    // HP bars ease towards the real values.
    shownHp.you += (r.hp - shownHp.you) * 0.15;
    shownHp.enemy += (r.enemy.hp - shownHp.enemy) * 0.15;
    // You (left): a hustler with a rolled-up newspaper.
    const youShake = Math.max(0, 1 - (now - youHurtAt) / 300);
    ctx.save();
    ctx.translate(W * 0.2 + Math.sin(now / 20) * 4 * youShake, H * 0.82);
    ctx.font = `${Math.round(H * 0.28)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('🧍', 0, 0);
    ctx.font = `${Math.round(H * 0.14)}px system-ui, sans-serif`;
    ctx.fillText(phase === 'block' ? '🛡️' : '🗞️', H * 0.12, -H * 0.1);
    ctx.restore();
    // The enemy (right).
    const wind = phase === 'block' && turn && strikeMs !== null
      ? (() => {
          const start = strikeMs + dc.block.gapMs, lands = hitLandsAt(dc, turn, strikeMs);
          return t < start ? 0 : t < lands ? (t - start) / (lands - start) : Math.max(0, 1 - (t - lands) / 150);
        })()
      : 0;
    const size = H * (r.enemy.boss ? 0.62 : 0.5);
    blitEnemy(ctx, r.enemy.id, W * 0.7, H * 0.84, size, now, wind, Math.max(0, 1 - (now - hurtAt) / 220));
    // HP bars
    const bar = (x: number, y: number, w: number, cur: number, max: number, label: string, color: string) => {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x, y, w, 14);
      ctx.fillStyle = color;
      ctx.fillRect(x + 2, y + 2, Math.max(0, (w - 4) * (cur / max)), 10);
      ctx.font = '800 12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x, y - 2);
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.max(0, Math.round(cur))} / ${max}`, x + w, y - 2);
    };
    bar(12, 26, W * 0.36, shownHp.you, r.maxHp, 'You', '#51cf66');
    bar(W - 12 - W * 0.42, 26, W * 0.42, shownHp.enemy, r.enemy.maxHp, `${r.enemy.boss ? 'BOSS · ' : ''}${r.enemy.name}`, r.enemy.boss ? '#f03e3e' : '#ff922b');
    // The strike bar (bottom).
    if (turn && (phase === 'strike' || phase === 'block' || phase === 'waiting')) {
      const bx = W * 0.1, bw = W * 0.8, by = H - 24, bh = 14;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx - 3, by - 3, bw + 6, bh + 6);
      const z = dc.strike.zone;
      const band = (half: number, color: string) => {
        ctx.fillStyle = color;
        ctx.fillRect(bx + (turn!.zone - half) * bw, by, half * 2 * bw, bh);
      };
      band(z.good, '#1971c2');
      band(z.great, '#2f9e44');
      band(z.perfect, '#f59f00');
      const m = markerAt(turn.sweepMs, phase === 'strike' ? t : strikeMs ?? dc.strike.timeoutMs);
      ctx.fillStyle = '#fff';
      ctx.fillRect(bx + m * bw - 2, by - 6, 4, bh + 12);
    }
    // The block ring: closes on you, tap as it touches.
    if (phase === 'block' && turn && strikeMs !== null) {
      const lands = hitLandsAt(dc, turn, strikeMs);
      const start = strikeMs + dc.block.gapMs;
      if (t >= start) {
        const k = Math.max(0, (lands - t) / (lands - start));
        const cx = W * 0.2, cy = H * 0.62, r0 = H * 0.12;
        ctx.beginPath();
        ctx.arc(cx, cy, r0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, r0 + k * H * 0.45, 0, Math.PI * 2);
        ctx.strokeStyle = k < 0.12 ? '#ffd43b' : '#ff6b6b';
        ctx.lineWidth = 5;
        ctx.stroke();
      }
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
    // Floor label
    ctx.font = '900 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = r.enemy.boss ? '#ff8787' : '#ced4da';
    ctx.fillText(`Floor ${r.floor}${r.enemy.boss ? ' · BOSS' : ''}`, W / 2, 6);
  }

  // ---------------------------------------------------------------- controls & screens
  function paintControls() {
    action.disabled = phase === 'waiting' || phase === 'result';
    action.classList.toggle('block', phase === 'block');
    action.textContent = phase === 'strike' ? '⚔️ STRIKE' : phase === 'block' ? '🛡️ BLOCK!' : '…';
    hint.textContent = phase === 'strike'
      ? 'Tap STRIKE (or Space) when the white marker is in the middle of the zone. Gold = critical hit.'
      : phase === 'block'
      ? 'The enemy swings: tap BLOCK (or Space) the moment the red ring touches the white one. Perfect = parry.'
      : '';
  }

  function paintLoot() {
    const r = run();
    const best = view?.best ?? 0;
    const parts: HTMLElement[] = [
      el('div', { class: 'dungeon-stat' }, el('span', {}, '🏆 Best floor'), el('b', {}, String(best))),
      el('div', { class: 'dungeon-stat' }, el('span', {}, '🎟️ Runs left today'), el('b', {}, `${view?.runsLeft ?? 0} / ${dc.runsPerDay}`)),
    ];
    if (r) {
      parts.push(
        el('h5', { class: 'worn-section' }, `Floor ${r.floor}`),
        el('div', { class: 'dungeon-stat' }, el('span', {}, '💰 Money'), el('b', {}, formatMoney(r.loot.sen))),
        el('div', { class: 'dungeon-stat' }, el('span', {}, '💎 Shards'), el('b', {}, String(r.loot.shards))),
        el('div', { class: 'dungeon-stat' }, el('span', {}, '⭐ XP'), el('b', {}, String(r.loot.xp))),
        el('div', { class: 'muted small' }, r.phase === 'dead' ? 'You fell: half of this was kept.' : `If you fall or flee: you keep half (${formatMoney(Math.floor(r.loot.sen * dc.deathKeep))}). Cash out between floors to keep it all.`),
      );
    }
    lootBox.replaceChildren(...parts);
  }

  function lobby(): HTMLElement[] {
    const v = view!;
    const enter = el('button', { class: 'btn primary dungeon-enter', type: 'button', 'data-action': 'dungeon-enter', disabled: !v.runsLeft }, v.runsLeft ? `⚔️ Enter the cave (${v.runsLeft} left today)` : '🌙 No runs left today');
    enter.addEventListener('click', () => call('dungeon:enter'));
    return [
      el('p', {}, 'A cave under Kota Damansara, full of pests and spirits. One enemy per floor, a boss every ' + dc.bossEvery + ' floors. The deeper you go, the better the loot.'),
      el('ol', { class: 'dungeon-how' },
        el('li', {}, '⚔️ Strike: tap when the white marker is in the zone (gold middle = critical hit).'),
        el('li', {}, '🛡️ Block: the enemy winds up; tap as the red ring meets the white one (perfect = parry, no damage).'),
        el('li', {}, '⬇️ After each floor: go deeper (you heal a little) or 💰 cash out with everything.'),
        el('li', {}, `💀 Fall or flee and you keep half the loot. ${dc.runsPerDay} runs a day.`),
      ),
      el('p', { class: 'muted small' }, 'Loot grows with your wealth stage and the floor; bosses also drop 💎 shards. Your HP and attack grow with your level.'),
      enter,
    ];
  }

  function render() {
    cancelAnimationFrame(raf);
    clearTimeout(strikeTimer);
    clearTimeout(blockTimer);
    paintLoot();
    if (!view) return void panel.body.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
    const r = view.run;
    if (!r) return void panel.body.replaceChildren(...lobby());
    if (r.phase === 'fight') {
      panel.body.replaceChildren(canvas, el('div', { class: 'dungeon-controls' }, action, flee), hint);
      sizeCanvas();
      shownHp = { you: r.hp, enemy: r.enemy.hp };
      raf = requestAnimationFrame(frame);
      startTurn();
      return;
    }
    // Between floors, or fallen: one still frame of the cave and the choice.
    panel.body.replaceChildren(canvas);
    sizeCanvas();
    shownHp = { you: r.hp, enemy: 0 };
    raf = requestAnimationFrame(frame);
    if (r.phase === 'cleared') {
      const nextBoss = (r.floor + 1) % dc.bossEvery === 0;
      const deeper = el('button', { class: 'btn primary', type: 'button', 'data-action': 'dungeon-deeper' }, `⬇️ Go deeper: floor ${r.floor + 1}${nextBoss ? ' (BOSS!)' : ''}`);
      deeper.addEventListener('click', () => call('dungeon:deeper'));
      const cash = el('button', { class: 'btn', type: 'button', 'data-action': 'dungeon-cashout' }, `💰 Cash out ${formatMoney(r.loot.sen)}${r.loot.shards ? ` + ${r.loot.shards} 💎` : ''}`);
      cash.addEventListener('click', () => leave());
      panel.body.append(el('div', { class: 'dungeon-cleared' }, el('h4', {}, `✅ Floor ${r.floor} cleared!`), el('div', { class: 'muted' }, `HP ${r.hp} / ${r.maxHp} (you'll heal ${Math.round(dc.healPerFloor * 100)}% on the way down)`), el('div', { class: 'dungeon-controls' }, deeper, cash)));
    } else {
      const ok = el('button', { class: 'btn primary', type: 'button', 'data-action': 'dungeon-ok' }, 'Back to the entrance');
      ok.addEventListener('click', () => leave());
      panel.body.append(el('div', { class: 'dungeon-cleared' }, el('h4', {}, `💀 You fell on floor ${r.floor}`), el('div', { class: 'muted' }, `Half the loot was kept: ${formatMoney(Math.floor(r.loot.sen * dc.deathKeep))}.`), ok));
    }
  }

  function call(ev: 'dungeon:enter' | 'dungeon:deeper' | 'dungeon:view') {
    if (busy || !app.socket) return;
    busy = true;
    app.socket.timeout(6000).emit(ev, (err, res) => {
      busy = false;
      if (err || !res.ok) return void toast(err ? 'No reply from the server.' : res.ok ? '' : res.error, 'bad');
      view = res.view;
      if (ev === 'dungeon:enter') sfx.click();
      render();
    });
  }

  function leave() {
    if (busy || !app.socket) return;
    busy = true;
    app.socket.timeout(6000).emit('dungeon:leave', (err, res) => {
      busy = false;
      if (err || !res.ok) return void toast(err ? 'No reply from the server.' : res.ok ? '' : res.error, 'bad');
      if (res.paid.sen || res.paid.shards) {
        sfx.coin();
        toast(`💰 +${formatMoney(res.paid.sen)}${res.paid.shards ? ` · +${res.paid.shards} 💎` : ''} · +${res.paid.xp} XP from ${dc.name}`, 'good', 4000);
      }
      view = res.view;
      render();
    });
  }
  const load = () => call('dungeon:view');

  action.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (phase === 'strike') doStrike();
    else if (phase === 'block') doBlock();
  });
  flee.addEventListener('click', () => {
    if (confirm('Run away? You keep half of the loot from this run.')) leave();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || panel.root.classList.contains('panel-hidden')) return;
    const r = run();
    if (!r || r.phase !== 'fight') return;
    e.preventDefault();
    if (phase === 'strike') doStrike();
    else if (phase === 'block') doBlock();
  };
  window.addEventListener('keydown', onKey);
  panel.onClose = () => {
    cancelAnimationFrame(raf);
    clearTimeout(strikeTimer);
    clearTimeout(blockTimer);
    window.removeEventListener('keydown', onKey);
  };
  render();
  load();
}
