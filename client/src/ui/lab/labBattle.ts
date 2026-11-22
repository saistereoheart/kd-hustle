// 🗝️ Labirin Purba: the battle screen, Pokémon style. Monsters at the top, your party at the bottom,
// a message box that plays each round out, and your choices: ⚔️ Attack, 💥 Skill, 🛡️ Guard,
// 🧪 Items, 🏃 Run. Tap a monster to aim at it. The server decides everything.
//
// ⚔️ In 3D (Settings → Labirin fights, on by default): the fight plays out with 3D models and big
// effects behind the cards (./battle3d, loaded only now and freed after). The 2D game pauses while
// it draws, and if a device can't keep 30 FPS it falls back to the flat cards by itself.
import type { Appearance, LabBattleEnd, LabBattleView, LabEvent, LabFighter, LabRoomView } from '@kh/shared';
import { labGear } from '@kh/shared';
import type { App } from '../../app';
import { el, labSay } from '../dom';
import { loadPrefs, savePrefs } from '../settings';
import { sfx } from '../sound';
import type { Stage2DFighter } from './battle2d/stage2d';

/** What both fight stages (pixel and 3D) can do. */
interface FightStage {
  setFighters(list: Stage2DFighter[], aim: string | null): void;
  play(e: LabEvent): number;
  destroy(): void;
}
import { loadMonsterPics, monsterPic, playerPics } from './portraits';
import { battleMusic, beatSec } from '../battleMusic';

const STEP_MS = 750;

export class LabBattleUi {
  private root: HTMLElement;
  private foesBox: HTMLElement;
  private partyBox: HTMLElement;
  private msg: HTMLElement;
  private actions: HTMLElement;
  private timerBar: HTMLElement;
  private view: LabBattleView;
  private target: string | null = null;
  private playing = false;
  private picked = false;
  private tick = 0;
  /** 🧪 Showing the potion list instead of the moves. */
  private itemsOpen = false;
  /** Potions carried (from your save; less as you use them here). */
  private potions: Record<string, number>;
  /** Rounds that arrived while the last one was still playing out. */
  private queue: Array<{ events: LabEvent[]; view: LabBattleView; end?: LabBattleEnd; room?: LabRoomView }> = [];
  /** The 3D stage (null: the flat cards). */
  private stage: FightStage | null = null;
  private stageHost: HTMLElement;
  private paused = false;
  private gone = false;
  /** The "entering battle" screen is over (the fight shows from then). */
  private introDone: Promise<void>;
  private introEl: HTMLElement | null = null;
  /** Showing the flat cards (2D chosen, no 3D here, or it fell back): they get portraits. */
  private flat = loadPrefs().fightView === 'cards';

  constructor(private app: App, view: LabBattleView) {
    this.view = view;
    this.potions = { ...(app.labHud?.self?.potions ?? {}) };
    this.foesBox = el('div', { class: 'lb-foes' });
    this.partyBox = el('div', { class: 'lb-party' });
    this.msg = el('div', { class: 'lb-msg', 'data-testid': 'lb-msg' });
    this.actions = el('div', { class: 'lb-actions' });
    this.timerBar = el('i');
    this.stageHost = el('div', { class: 'lb-3d' });
    this.root = el(
      'div',
      { class: 'lab-battle', 'data-testid': 'lab-battle' },
      el('div', { class: 'lb-field' }, this.stageHost, this.foesBox, this.partyBox),
      el('div', { class: 'lb-bottom' }, this.msg, el('div', { class: 'lb-timer' }, this.timerBar), this.actions),
    );
    document.body.append(this.root);
    const foes = view.fighters.filter((f) => f.side === 'foe');
    const names = foes.length > 1 ? `${foes.slice(0, -1).map((f) => f.name).join(', ')} and ${foes[foes.length - 1].name}` : foes[0]?.name;
    const boss = view.boss ? app.cfg.lab.bosses[view.floor] : undefined;
    if (boss) this.root.classList.add('boss-fight');
    this.say(boss ? `👹 ${boss.name}: "${boss.line}"` : view.ambush ? `🌿 Ambush! ${names} ${foes.length > 1 ? 'leap' : 'leaps'} out of hiding!` : `${names} ${foes.length > 1 ? 'jump' : 'jumps'} out!`);
    this.introDone = this.intro(boss ? 'boss' : 'fight', boss ? `👹 ${boss.name}` : `${names} ${foes.length > 1 ? 'jump' : 'jumps'} out!`);
    this.render();
    this.tick = window.setInterval(() => this.drawTimer(), 200);
    window.addEventListener('keydown', this.onKey, true);
    void this.start3d();
  }

  /**
   * ⌨️ Keys: 1–9 press the buttons in order (1 Attack, 2 Skill, 3 Guard, 4 Items, 5 Run; in the potion
   * list, 1… each potion), Esc/Backspace goes back, Tab or ←/→ picks the next monster, Enter/Space
   * presses Continue. Caught first, so the hotbar and the room don't also get them.
   */
  private onKey = (e: KeyboardEvent) => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    if (this.root.classList.contains('intro') || e.repeat) return;
    const buttons = [...this.actions.querySelectorAll('button')] as HTMLButtonElement[];
    const press = (b: HTMLButtonElement | undefined) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (b && !b.disabled) b.click();
    };
    const n = /^Digit([1-9])$/.exec(e.code) ?? /^Numpad([1-9])$/.exec(e.code);
    if (n) return press(buttons[Number(n[1]) - 1]);
    if (e.code === 'Escape' || e.code === 'Backspace') {
      const back = this.actions.querySelector('[data-act="items-back"]') as HTMLButtonElement | null;
      if (back) press(back);
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      const ok = this.actions.querySelector('[data-action="lb-continue"]') as HTMLButtonElement | null;
      if (ok) press(ok);
      return;
    }
    if (e.code === 'Tab' || e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
      const foes = this.view.fighters.filter((f) => f.side === 'foe' && !f.out);
      if (foes.length < 2) return press(undefined);
      const i = foes.findIndex((f) => f.id === this.target);
      const step = e.code === 'ArrowLeft' || (e.code === 'Tab' && e.shiftKey) ? -1 : 1;
      this.target = foes[(i + step + foes.length) % foes.length].id;
      sfx.click();
      this.renderCards();
      return press(undefined);
    }
  };

  /** The number key shown on a button. */
  private static kbd(i: number) {
    return el('kbd', { class: 'lb-key' }, String(i + 1));
  }

  destroy() {
    this.gone = true;
    window.removeEventListener('keydown', this.onKey, true);
    this.introEl?.remove();
    document.body.classList.remove('lb-entering');
    clearInterval(this.tick);
    this.stop3d();
    this.root.remove();
  }

  // ---------------------------------------------------------------- ⚔️ entering battle
  /**
   * The "entering battle" screen, in time with the music: the battle track starts on its first beat
   * as this starts, and everything lands on a beat (4 beats, then the fight shows):
   *   beat 1: a flash, the room behind swirls; bars sweep in from both sides;
   *   beat 2: the screen is covered, "BATTLE!" slams in;  beat 3: it pulses with the kick;
   *   beat 4: the bars sweep away and the fight is there.
   */
  private async intro(track: 'fight' | 'boss', who: string): Promise<void> {
    const beat = beatSec(track);
    const bars = Array.from({ length: 8 }, (_, i) => el('i', { style: `--i:${i};--d:${i % 2 ? -1 : 1}` }));
    const box = el('div', { class: `lb-intro${track === 'boss' ? ' boss' : ''}`, style: `--beat:${beat}s`, 'data-testid': 'lb-intro' },
      el('div', { class: 'lbi-bars' }, ...bars),
      el('div', { class: 'lbi-title' }, el('b', {}, track === 'boss' ? '👹 BOSS BATTLE!' : '⚔️ BATTLE!'), el('small', {}, who)),
      el('div', { class: 'lbi-flash' }),
    );
    this.introEl = box;
    this.root.classList.add('intro');
    document.body.append(box);
    // Start the music first (the loops were made when you came down here), then go on its downbeat.
    await battleMusic.playNow(track);
    if (this.gone) return;
    box.classList.add('go');
    document.body.style.setProperty('--lbi-beat', `${beat}s`);
    document.body.classList.add('lb-entering');
    sfx.locked();
    await new Promise((r) => window.setTimeout(r, beat * 2000));
    if (this.gone) return;
    this.root.classList.remove('intro'); // behind the bars now
    document.body.classList.remove('lb-entering');
    await new Promise((r) => window.setTimeout(r, beat * 2000));
    if (this.gone) return;
    window.setTimeout(() => box.remove(), beat * 1000 + 100);
  }

  // ---------------------------------------------------------------- 3D
  private async start3d() {
    const view = loadPrefs().fightView;
    if (view === 'cards') return;
    if (view === 'pixel') return void this.startPixel();
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return void this.startPixel();
    try {
      const { Battle3D } = await import('./battle3d/stage');
      if (this.gone) return;
      const fc = this.app.cfg.lab.floors[this.view.floor];
      this.stage = new Battle3D({
        host: this.stageHost, quality: loadPrefs().memory === 'normal' ? 'normal' : 'low', wall: fc.wall, floor: fc.floor, boss: !!this.view.boss,
        onAim: (id) => {
          this.target = id;
          sfx.click();
          this.renderCards();
        },
        onSlow: () => {
          this.stop3d(false);
          const prefs = loadPrefs();
          prefs.fightView = 'pixel';
          savePrefs(prefs);
          labSay('⚔️ 3D fights were too slow on this device, so they are now pixel art. Change it in Settings → Labirin fights.', 'info', 6000);
          void this.startPixel();
        },
      });
      this.root.classList.add('is3d');
      // The monsters drop in as the bars open, not behind them.
      await this.introDone;
      if (this.gone || !this.stage) return;
      this.stage.setFighters(this.stageFighters(), this.target);
      // Only one thing draws at a time: the 2D game rests until the fight is over.
      this.app.game?.loop.sleep();
      this.paused = true;
    } catch (err) {
      console.warn('[lab] 3D fight unavailable, using pixel art', err);
      this.stop3d(false);
      void this.startPixel();
    }
  }

  /** 🎮 The pixel-art stage (the default): a 2D canvas, no 3D engine, the 2D game keeps resting. */
  private async startPixel() {
    try {
      const { Battle2D } = await import('./battle2d/stage2d');
      if (this.gone) return;
      this.stage = new Battle2D({
        host: this.stageHost, boss: !!this.view.boss, character: this.app.cfg.character,
        onAim: (id) => {
          this.target = id;
          sfx.click();
          this.renderCards();
        },
      });
      this.root.classList.add('is3d', 'is-pixel');
      await this.introDone;
      if (this.gone || !this.stage) return;
      this.stage.setFighters(this.stageFighters(), this.target);
      this.app.game?.loop.sleep();
      this.paused = true;
    } catch (err) {
      console.warn('[lab] pixel fight unavailable, using cards', err);
      this.stop3d();
    }
  }

  private stop3d(toCards = true) {
    this.stage?.destroy();
    this.stage = null;
    if (!toCards) {
      this.root.classList.remove('is3d', 'is-pixel');
      if (this.paused) this.app.game?.loop.wake();
      this.paused = false;
      return;
    }
    if (!this.flat && !this.gone) {
      this.flat = true;
      window.setTimeout(() => !this.gone && this.renderCards(), 0);
    }
    this.root.classList.remove('is3d', 'is-pixel');
    if (this.paused) this.app.game?.loop.wake();
    this.paused = false;
  }

  /** Your Labirin gear's tier colours (what your fighter holds). */
  private myGear() {
    const g = this.app.labHud?.self?.gear ?? {};
    const lc = this.app.cfg.lab;
    return { weapon: labGear(lc, g.weapon)?.color, shield: labGear(lc, g.shield)?.color, armour: labGear(lc, g.armour)?.color, charm: labGear(lc, g.charm)?.color };
  }

  /** The fighters for the stages (players with their own colours and look). */
  private stageFighters(): Stage2DFighter[] {
    const looks = this.looks();
    return this.view.fighters.map((f) => {
      const a = looks.get(f.id);
      return {
        id: f.id, side: f.side, name: f.name, kind: f.kind, icon: f.icon, boss: f.boss, out: f.out, fled: f.fled, hp: f.hp, maxHp: f.maxHp,
        look: a ? { skin: a.skin, hair: a.hairColor, top: a.topColor, bottom: a.bottomColor, shoes: a.shoesColor, eyes: a.eyeColor } : undefined,
        appearance: a,
        gear: f.id === this.meId ? this.myGear() : undefined,
      };
    });
  }

  private get meId() {
    return `p${this.app.lastInit?.you.id}`;
  }

  private me(): LabFighter | undefined {
    return this.view.fighters.find((f) => f.id === this.meId);
  }

  /** Someone picked (others see who's ready), or the fight's state after a reconnect. */
  update(view: LabBattleView) {
    if (this.playing) return;
    this.view = view;
    this.render();
  }

  /** A round came in: play its events one by one, then the next choice (or the end). */
  round(p: { events: LabEvent[]; view: LabBattleView; end?: LabBattleEnd; room?: LabRoomView }) {
    if (this.playing) return void this.queue.push(p);
    this.playing = true;
    this.picked = false;
    this.renderActions();
    let i = 0;
    const next = () => {
      const e = p.events[i++];
      if (!e) return this.afterRound(p);
      this.apply(e);
      const ms = this.stage?.play(e) ?? 0;
      window.setTimeout(next, Math.max(e.kind === 'guard' ? STEP_MS * 0.6 : STEP_MS, ms));
    };
    next();
  }

  private afterRound(p: { view: LabBattleView; end?: LabBattleEnd; room?: LabRoomView }) {
    this.playing = false;
    this.view = p.view;
    if (p.end) return this.finish(p.end, p.room);
    this.render();
    const queued = this.queue.shift();
    if (queued) this.round(queued);
  }

  private finish(end: LabBattleEnd, room?: LabRoomView) {
    this.renderActions(true);
    const text =
      end.outcome === 'win' && this.view.boss ? `🏆 ${this.app.cfg.lab.bosses[this.view.floor]?.name ?? 'The boss'} is beaten! The stairs down are open. +${end.coins} Syiling Purba (carried).`
      : end.outcome === 'win' ? `🏆 Victory! +${end.coins} Syiling Purba (carried).`
      : end.outcome === 'fled' ? '🏃 You got away, back to the last room.'
      : `💫 You fell… ${end.lost ? `Lost ${end.lost} carried Syiling. ` : ''}You wake at your rest chamber.`;
    this.say(text);
    if (end.outcome === 'win') sfx.coin();
    const ok = el('button', { class: 'btn primary', type: 'button', 'data-action': 'lb-continue' }, 'Continue');
    ok.addEventListener('click', () => this.app.labBattleDone(room));
    this.actions.replaceChildren(ok);
    ok.append(el('kbd', { class: 'lb-key end' }, 'Enter'));
  }

  // ---------------------------------------------------------------- drawing
  private say(text: string) {
    this.msg.textContent = text;
  }

  private card(f: LabFighter): HTMLElement {
    const pct = Math.max(0, Math.round((f.hp / f.maxHp) * 100));
    const bar = el('div', { class: 'lb-hp' }, el('i', { style: `width:${pct}%`, class: pct < 25 ? 'low' : pct < 55 ? 'mid' : '' }));
    const pips = f.side === 'party' ? el('div', { class: 'lb-focus', title: 'Focus (💥 Skill uses 2)' }, ...Array.from({ length: this.app.cfg.lab.player.focusMax }, (_, k) => el('b', { class: k < f.focus ? 'on' : '' }))) : null;
    const ready = f.side === 'party' && this.view.chosen.includes(f.id) ? el('span', { class: 'lb-ready' }, '✓') : null;
    const art = el('div', { class: 'lb-art' }, this.figure(f));
    const c = el(
      'div',
      { class: `lb-card ${f.side}${f.boss ? ' boss' : ''}${f.out ? ' out' : ''}${f.id === this.target ? ' aimed' : ''}${f.id === this.meId ? ' me' : ''}`, 'data-fighter': f.id },
      art,
      el('div', { class: 'lb-info' }, el('b', {}, f.name, ready), bar, el('small', {}, `${Math.max(0, Math.round(f.hp))} / ${f.maxHp}`), pips),
    );
    if (f.side === 'foe' && !f.out) {
      c.addEventListener('click', () => {
        this.target = f.id;
        this.renderCards();
      });
    }
    return c;
  }

  /** The fighter as a picture with fake 3D (2D cards): you in your own look, monsters from their
   *  3D models (the emoji until that picture is ready). */
  private figure(f: LabFighter): HTMLElement | string {
    if (f.side === 'party') {
      const a = this.looks().get(f.id);
      if (!a) return f.id === this.meId ? '🧑' : '🧑‍🤝‍🧑';
      const p = playerPics(a, this.app.cfg.character);
      return el('div', { class: 'lb-fig' },
        el('img', { class: 'idle', src: p.idle, alt: '' }), el('img', { class: 'act', src: p.act, alt: '' }), el('img', { class: 'hurt', src: p.hurt, alt: '' }));
    }
    const url = monsterPic(f.kind, f.icon, f.boss);
    return url ? el('div', { class: 'lb-fig' }, el('img', { class: 'idle', src: url, alt: '' })) : (f.icon ?? '👾');
  }

  private looks() {
    const looks = new Map<string, Appearance>();
    const you = this.app.lastInit?.you;
    if (you) looks.set(`p${you.id}`, you.appearance);
    for (const o of this.app.lab?.view?.others ?? []) looks.set(`p${o.id}`, o.appearance);
    return looks;
  }

  private renderCards() {
    // (Only for the flat cards: the snapshot shares the 3D parts, so never while the stage runs.)
    if (this.flat) void loadMonsterPics(this.view.fighters.filter((f) => f.side === 'foe'), () => !this.gone && this.renderCards());
    const foes = this.view.fighters.filter((f) => f.side === 'foe');
    if (!this.target || foes.find((f) => f.id === this.target)?.out) this.target = foes.find((f) => !f.out)?.id ?? null;
    this.foesBox.replaceChildren(...foes.map((f) => this.card(f)));
    this.partyBox.replaceChildren(...this.view.fighters.filter((f) => f.side === 'party').map((f) => this.card(f)));
    this.stage?.setFighters(this.stageFighters(), this.target);
  }

  private render() {
    this.renderCards();
    this.renderActions();
    const me = this.me();
    if (!this.playing && me && !me.out) this.say(this.picked ? 'Waiting for the others…' : `What will ${me.name} do?`);
    else if (me?.out && !this.playing) this.say('You fainted… if your party wins, you get back up.');
  }

  private renderActions(off = false) {
    const me = this.me();
    const can = !off && !this.playing && !this.picked && !!me && !me.out;
    if (this.itemsOpen && can) return this.renderItems();
    this.itemsOpen = false;
    const btn = (label: string, kind: 'attack' | 'skill' | 'guard' | 'run', enabled = true, title = '') => {
      const b = el('button', { class: 'btn', type: 'button', 'data-act': kind, title }, label) as HTMLButtonElement;
      b.disabled = !can || !enabled;
      b.addEventListener('click', () => this.pick(kind));
      return b;
    };
    const cost = this.app.cfg.lab.player.skillCost;
    const usable = this.usablePotions();
    const items = el('button', { class: 'btn', type: 'button', 'data-act': 'items', title: usable.length ? 'Use a potion (it takes your turn)' : 'No potions that work in a fight. Tok Peraih sells them.' }, '🧪 Items') as HTMLButtonElement;
    items.disabled = !can || !usable.length;
    items.addEventListener('click', () => {
      this.itemsOpen = true;
      sfx.click();
      this.renderActions();
    });
    this.actions.replaceChildren(
      btn('⚔️ Attack', 'attack'),
      btn(`💥 Skill`, 'skill', (me?.focus ?? 0) >= cost, `Hits much harder. Uses ${cost} focus (you gain 1 a round).`),
      btn('🛡️ Guard', 'guard', true, 'Take much less damage this round'),
      items,
      btn('🏃 Run', 'run', !this.view.boss, this.view.boss ? 'No running from a boss!' : `${Math.round(this.app.cfg.lab.battle.runChance * 100)}% chance to get away`),
    );
    this.keyHints();
  }

  /** The number keys on the buttons (only with a keyboard: hidden on touch screens by the CSS). */
  private keyHints() {
    [...this.actions.querySelectorAll('button')].forEach((b, i) => b.dataset.act !== 'items-back' && i < 9 && b.prepend(LabBattleUi.kbd(i)));
  }

  /** Potions you carry that do something in a fight. */
  private usablePotions() {
    return this.app.cfg.lab.potions.list.filter((p) => (this.potions[p.id] ?? 0) > 0 && !p.home);
  }

  private renderItems() {
    const me = this.me()!;
    const fallen = this.view.fighters.find((f) => f.side === 'party' && f.out && !f.fled);
    const list = this.usablePotions().map((p) => {
      const why = p.revive && !fallen ? 'Nobody has fallen' : p.heal && me.hp >= me.maxHp ? "You're at full HP" : p.escape && this.view.boss ? 'No escaping a boss' : '';
      const b = el('button', { class: 'btn lb-item', type: 'button', 'data-item': p.id, title: why || p.desc }, `${p.icon} ${p.name}`, el('small', {}, `×${this.potions[p.id]}${why ? ` · ${why}` : ''}`)) as HTMLButtonElement;
      b.disabled = !!why;
      b.addEventListener('click', () => this.pickItem(p.id, p.revive ? fallen?.id : me.id));
      return b;
    });
    const back = el('button', { class: 'btn', type: 'button', 'data-act': 'items-back' }, '↩ Back');
    back.addEventListener('click', () => {
      this.itemsOpen = false;
      this.renderActions();
    });
    this.actions.replaceChildren(...list, back);
    this.keyHints();
    back.append(el('kbd', { class: 'lb-key end' }, 'Esc'));
  }

  private pickItem(item: string, target?: string) {
    if (this.picked || this.playing) return;
    this.picked = true;
    this.itemsOpen = false;
    this.renderActions();
    sfx.click();
    this.app.socket?.timeout(5000).emit('lab:act', { kind: 'item', item, target }, (err, res) => {
      if (err || !res.ok) {
        this.picked = false;
        this.renderActions();
        return void labSay(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      }
      if (!this.playing) this.say('Waiting for the others…');
    });
  }

  private drawTimer() {
    const left = Math.max(0, this.view.deadline - this.app.store.serverNow());
    const pct = Math.min(100, (left / (this.view.roundSec * 1000)) * 100);
    this.timerBar.style.width = `${this.playing ? 0 : pct}%`;
  }

  private pick(kind: 'attack' | 'skill' | 'guard' | 'run') {
    if (this.picked || this.playing) return;
    this.picked = true;
    this.renderActions();
    sfx.click();
    const target = kind === 'attack' || kind === 'skill' ? (this.target ?? undefined) : undefined;
    this.app.socket?.timeout(5000).emit('lab:act', { kind, target }, (err, res) => {
      if (err || !res.ok) {
        this.picked = false;
        this.renderActions();
        return void labSay(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      }
      if (!this.playing) this.say('Waiting for the others…');
    });
  }

  /** One event: the message, the hit (shake + number), HP bars. */
  private apply(e: LabEvent) {
    this.say(e.text);
    // 🧪 One of ours used up (it only counts when it actually happened).
    if (e.item && e.actor === this.meId && (e.kind === 'item' || e.kind === 'run' || e.kind === 'runfail')) this.potions[e.item] = Math.max(0, (this.potions[e.item] ?? 0) - 1);
    if (e.kind === 'item' && e.target) {
      const t = this.view.fighters.find((x) => x.id === e.target);
      if (t && e.hp !== undefined) {
        t.hp = e.hp;
        if (e.revived) t.out = false;
        this.renderCards();
        const card = this.root.querySelector(`[data-fighter="${e.target}"]`);
        if (e.hp !== undefined && card) {
          const pop = el('span', { class: 'lb-pop heal' }, e.revived ? '↑' : '+');
          card.append(pop);
          window.setTimeout(() => pop.remove(), 900);
        }
      }
      sfx.coin();
    }
    const f = e.target ? this.view.fighters.find((x) => x.id === e.target) : undefined;
    if (e.kind === 'hit' && f) {
      f.hp = e.hp ?? f.hp;
      if (f.hp <= 0) f.out = true;
      this.renderCards();
      const card = this.root.querySelector(`[data-fighter="${e.target}"]`);
      card?.classList.add('hit');
      // 2D: the attacker lunges at it.
      this.root.querySelector(`[data-fighter="${e.actor}"]`)?.classList.add('lunge');
      const pop = el('span', { class: `lb-pop${e.crit ? ' crit' : ''}` }, `−${e.dmg}`);
      card?.append(pop);
      window.setTimeout(() => pop.remove(), 900);
      (e.crit ? sfx.error : sfx.click)();
    } else if (e.kind === 'faint') {
      const x = this.view.fighters.find((y) => y.id === e.actor);
      if (x) x.out = true;
      this.renderCards();
    } else if (e.kind === 'run') {
      const x = this.view.fighters.find((y) => y.id === e.actor);
      if (x) x.out = true;
      this.renderCards();
    }
  }
}
