// 🗝️ Labirin Purba: the battle screen, Pokémon style. Monsters at the top, your party at the bottom,
// a message box that plays each round out, and your choices: ⚔️ Attack, 💥 Skill, 🛡️ Guard,
// 🏃 Run (🧪 items come with the merchant). Tap a monster to aim at it. The server decides everything.
import type { LabBattleEnd, LabBattleView, LabEvent, LabFighter, LabRoomView } from '@kh/shared';
import type { App } from '../../app';
import { el, toast } from '../dom';
import { sfx } from '../sound';

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
  /** Rounds that arrived while the last one was still playing out. */
  private queue: Array<{ events: LabEvent[]; view: LabBattleView; end?: LabBattleEnd; room?: LabRoomView }> = [];

  constructor(private app: App, view: LabBattleView) {
    this.view = view;
    this.foesBox = el('div', { class: 'lb-foes' });
    this.partyBox = el('div', { class: 'lb-party' });
    this.msg = el('div', { class: 'lb-msg', 'data-testid': 'lb-msg' });
    this.actions = el('div', { class: 'lb-actions' });
    this.timerBar = el('i');
    this.root = el(
      'div',
      { class: 'lab-battle', 'data-testid': 'lab-battle' },
      el('div', { class: 'lb-field' }, this.foesBox, this.partyBox),
      el('div', { class: 'lb-bottom' }, this.msg, el('div', { class: 'lb-timer' }, this.timerBar), this.actions),
    );
    document.body.append(this.root);
    const foes = view.fighters.filter((f) => f.side === 'foe');
    const names = foes.length > 1 ? `${foes.slice(0, -1).map((f) => f.name).join(', ')} and ${foes[foes.length - 1].name}` : foes[0]?.name;
    this.say(`${names} ${foes.length > 1 ? 'jump' : 'jumps'} out!`);
    sfx.locked();
    this.render();
    this.tick = window.setInterval(() => this.drawTimer(), 200);
  }

  destroy() {
    clearInterval(this.tick);
    this.root.remove();
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
      window.setTimeout(next, e.kind === 'guard' ? STEP_MS * 0.6 : STEP_MS);
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
      end.outcome === 'win' ? `🏆 Victory! +${end.coins} Syiling Purba (carried).`
      : end.outcome === 'fled' ? '🏃 You got away, back to the last room.'
      : `💫 You fell… ${end.lost ? `Lost ${end.lost} carried Syiling. ` : ''}You wake at your rest chamber.`;
    this.say(text);
    if (end.outcome === 'win') sfx.coin();
    const ok = el('button', { class: 'btn primary', type: 'button', 'data-action': 'lb-continue' }, 'Continue');
    ok.addEventListener('click', () => this.app.labBattleDone(room));
    this.actions.replaceChildren(ok);
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
    const art = el('div', { class: 'lb-art' }, f.icon ?? (f.id === this.meId ? '🧑' : '🧑‍🤝‍🧑'));
    const c = el(
      'div',
      { class: `lb-card ${f.side}${f.out ? ' out' : ''}${f.id === this.target ? ' aimed' : ''}${f.id === this.meId ? ' me' : ''}`, 'data-fighter': f.id },
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

  private renderCards() {
    const foes = this.view.fighters.filter((f) => f.side === 'foe');
    if (!this.target || foes.find((f) => f.id === this.target)?.out) this.target = foes.find((f) => !f.out)?.id ?? null;
    this.foesBox.replaceChildren(...foes.map((f) => this.card(f)));
    this.partyBox.replaceChildren(...this.view.fighters.filter((f) => f.side === 'party').map((f) => this.card(f)));
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
    const btn = (label: string, kind: 'attack' | 'skill' | 'guard' | 'run', enabled = true, title = '') => {
      const b = el('button', { class: 'btn', type: 'button', 'data-act': kind, title }, label) as HTMLButtonElement;
      b.disabled = !can || !enabled;
      b.addEventListener('click', () => this.pick(kind));
      return b;
    };
    const cost = this.app.cfg.lab.player.skillCost;
    const items = el('button', { class: 'btn', type: 'button', disabled: '', title: 'Potions come with the merchant (soon)' }, '🧪 Items');
    this.actions.replaceChildren(
      btn('⚔️ Attack', 'attack'),
      btn(`💥 Skill`, 'skill', (me?.focus ?? 0) >= cost, `Hits much harder. Uses ${cost} focus (you gain 1 a round).`),
      btn('🛡️ Guard', 'guard', true, 'Take much less damage this round'),
      items,
      btn('🏃 Run', 'run', true, `${Math.round(this.app.cfg.lab.battle.runChance * 100)}% chance to get away`),
    );
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
        return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      }
      if (!this.playing) this.say('Waiting for the others…');
    });
  }

  /** One event: the message, the hit (shake + number), HP bars. */
  private apply(e: LabEvent) {
    this.say(e.text);
    const f = e.target ? this.view.fighters.find((x) => x.id === e.target) : undefined;
    if (e.kind === 'hit' && f) {
      f.hp = e.hp ?? f.hp;
      if (f.hp <= 0) f.out = true;
      this.renderCards();
      const card = this.root.querySelector(`[data-fighter="${e.target}"]`);
      card?.classList.add('hit');
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
