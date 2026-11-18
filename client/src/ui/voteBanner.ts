// A banner while a skip-the-night vote runs, so everyone can vote without opening the phone.
import type { App } from '../app';
import { el, toast, uiRoot } from './dom';
import { sfx } from './sound';

export function voteSkip(app: App, yes: boolean, after?: () => void) {
  app.socket?.timeout(5000).emit('time:vote', { yes }, (err, res) => {
    if (err || !res.ok) {
      sfx.error();
      toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
    }
    after?.();
  });
}

export class VoteBanner {
  private root: HTMLElement;
  private text: HTMLElement;
  private off: () => void;
  private timer: number;

  constructor(private app: App) {
    this.text = el('span', { class: 'vote-text' });
    const yes = el('button', { class: 'btn small primary', type: 'button', 'data-action': 'banner-vote-yes' }, '👍 Yes');
    const no = el('button', { class: 'btn small', type: 'button', 'data-action': 'banner-vote-no' }, '👎 No');
    yes.addEventListener('click', () => voteSkip(app, true));
    no.addEventListener('click', () => voteSkip(app, false));
    this.root = el('div', { class: 'vote-banner hidden', 'data-testid': 'vote-banner' }, this.text, yes, no);
    uiRoot().append(this.root);
    this.off = app.store.on(() => this.render());
    this.timer = window.setInterval(() => this.render(), 1000);
  }

  private render() {
    const v = this.app.store.vote;
    this.root.classList.toggle('hidden', !v?.active);
    if (!v?.active) return;
    const left = Math.max(0, Math.round((v.endsAt - Date.now()) / 1000));
    this.text.textContent = `🌙 Skip the night? ${v.yes}/${v.needed} yes · ${left}s`;
  }

  destroy() {
    this.off();
    clearInterval(this.timer);
    this.root.remove();
  }
}
