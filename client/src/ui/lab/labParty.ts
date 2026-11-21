// 🗝️ Labirin Purba parties: who's in yours (and where), invite players who are online, leave, and
// (the leader) remove someone. Party members in the same room fight together; walking into your
// party's fight joins it. The invite prompt pops up anywhere (town or labyrinth).
import type { LabPartyView } from '@kh/shared';
import type { App } from '../../app';
import { el, toast, uiRoot } from '../dom';
import { openPanel } from '../panel';
import { sfx } from '../sound';

type Online = Array<{ id: number; name: string; level: number; inParty: boolean }>;

const fail = (err: unknown, res: { ok: false; error: string } | { ok: true }) => {
  sfx.error();
  toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
};

/** Where a member is, in words. */
function whereIs(app: App, m: LabPartyView['members'][number]): string {
  if (!m.online) return 'offline';
  if (!m.inside) return 'in town';
  const f = app.cfg.lab.floors[m.floor ?? 0];
  return `${m.fighting ? '⚔️ fighting · ' : ''}B${(m.floor ?? 0) + 1} ${f?.name ?? ''}`;
}

export function openLabParty(app: App) {
  const panel = openPanel('👥 Labirin party', { testId: 'lab-party' });
  const body = el('div', { class: 'lab-party' }, el('p', { class: 'muted' }, 'Loading…'));
  panel.body.append(body);
  let online: Online = [];
  const me = app.lastInit?.you.id;

  const render = () => {
    const party = app.labParty;
    const parts: HTMLElement[] = [
      el('p', { class: 'muted small' }, 'Up to 4 players. Party members in the same room fight together; walk into your party\'s fight to join it. Each of you gets the Syiling for the win. Parties end when the server restarts.'),
    ];
    if (party) {
      const leader = party.leader === me;
      parts.push(el('h5', {}, `Your party (${party.members.length}/${party.max})`));
      for (const m of party.members) {
        const row = el('div', { class: 'lab-party-row' },
          el('b', {}, `${m.id === party.leader ? '👑 ' : ''}${m.name}${m.id === me ? ' (you)' : ''}`),
          el('span', { class: 'muted small' }, ` Lv ${m.level} · ${whereIs(app, m)}`));
        if (leader && m.id !== me) {
          const kick = el('button', { class: 'btn small', type: 'button', 'data-kick': String(m.id) }, 'Remove');
          kick.addEventListener('click', () => app.socket?.timeout(5000).emit('lab:kick', { id: m.id }, (err, res) => (err || !res.ok ? fail(err, res) : undefined)));
          row.append(kick);
        }
        parts.push(row);
      }
      if (party.invited.length) parts.push(el('p', { class: 'muted small' }, `Invited: ${party.invited.map((x) => x.name).join(', ')} (an invite lasts a minute)`));
      const leave = el('button', { class: 'btn', type: 'button', 'data-action': 'party-leave' }, '🚪 Leave the party');
      leave.addEventListener('click', () => app.socket?.timeout(5000).emit('lab:partyLeave', (err, res) => {
        if (err || !res.ok) return fail(err, res);
        app.labParty = null;
        render();
      }));
      parts.push(leave);
    } else parts.push(el('p', {}, "You're not in a party. Invite someone below: you lead it."));
    // Invite
    const full = !!party && party.members.length + party.invited.length >= party.max;
    const mine = new Set([...(party?.members.map((m) => m.id) ?? []), ...(party?.invited.map((m) => m.id) ?? [])]);
    const cands = online.filter((o) => !mine.has(o.id));
    parts.push(el('h5', {}, '➕ Invite'));
    if (!cands.length) parts.push(el('p', { class: 'muted small' }, 'Nobody else is online right now.'));
    for (const o of cands) {
      const b = el('button', { class: 'btn small primary', type: 'button', 'data-invite': String(o.id) }, 'Invite') as HTMLButtonElement;
      b.disabled = full || o.inParty;
      b.title = o.inParty ? "They're in another party" : full ? 'Your party is full' : '';
      b.addEventListener('click', () => app.socket?.timeout(5000).emit('lab:invite', { id: o.id }, (err, res) => {
        if (err || !res.ok) return fail(err, res);
        sfx.click();
        toast(`📨 Invited ${o.name}.`, 'good');
      }));
      parts.push(el('div', { class: 'lab-party-row' }, el('b', {}, o.name), el('span', { class: 'muted small' }, ` Lv ${o.level}${o.inParty ? ' · in a party' : ''}`), b));
    }
    body.replaceChildren(...parts);
  };

  const fetchState = () =>
    app.socket?.timeout(5000).emit('lab:party', (err, res) => {
      if (err || !res.ok) return void body.replaceChildren(el('p', { class: 'muted' }, 'No response.'));
      app.labParty = res.party;
      online = res.online;
      render();
    });
  const off = app.onLabParty(render);
  panel.onClose = () => off();
  fetchState();
}

/** "Ali invites you to their Labirin party": Join / No thanks (runs out after a minute). */
export function showLabInvite(app: App, party: number, from: string) {
  sfx.tick();
  const yes = el('button', { class: 'btn primary', type: 'button', 'data-action': 'party-accept' }, '👥 Join');
  const no = el('button', { class: 'btn', type: 'button', 'data-action': 'party-decline' }, 'No thanks');
  const card = el('div', { class: 'modal lab-invite', role: 'dialog' },
    el('h3', {}, '🗝️ Labirin party'),
    el('p', {}, `${from} invites you to their Labirin Purba party. Party members in the same room fight together.`),
    el('div', { class: 'actions' }, no, yes));
  const back = el('div', { class: 'modal-backdrop' }, card);
  const close = () => back.remove();
  const t = window.setTimeout(close, 60_000);
  yes.addEventListener('click', () => {
    clearTimeout(t);
    close();
    app.socket?.timeout(5000).emit('lab:accept', { party }, (err, res) => {
      if (err || !res.ok) return fail(err, res);
      sfx.coin();
      app.setLabParty(res.party);
      toast(`👥 You're in ${from}'s party.`, 'good');
    });
  });
  no.addEventListener('click', () => {
    clearTimeout(t);
    close();
    app.socket?.timeout(5000).emit('lab:decline', { party }, () => {});
  });
  uiRoot().append(back);
}
