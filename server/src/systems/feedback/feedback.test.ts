import { describe, expect, it } from 'vitest';
import { C2S } from '@kh/shared';
import { openDatabase } from '../../db/db';
import { createRepos } from '../../db/repos';
import { FEEDBACK_LIMITS, FeedbackDesk, cleanFeedbackText } from './feedback';

function setup() {
  const db = openDatabase(':memory:');
  const repos = createRepos(db);
  const id = repos.accounts.create('ali', 'h', false, { x: 0, y: 0 }, 2, 0);
  let t = 1_000_000_000;
  const desk = new FeedbackDesk(repos, 32, () => t);
  const me = { id, name: 'ali', scene: 'town', x: 320, y: 640, interior: null, walletSen: 12_345, prog: { level: 7, stage: 2 } };
  return { repos, desk, me, tick: (ms: number) => (t += ms) };
}

describe('feedback', () => {
  it('stores a report with server-side context plus what the client saw', () => {
    const { repos, desk, me } = setup();
    const res = desk.send(me, 'bug', '  The stall\u0007 button\r\ndoes nothing  ', { district: 'Dataran Sunway', screen: '390×844 @3x', errors: ['oops'] });
    expect(res.ok).toBe(true);
    const [r] = repos.feedback.list();
    expect(r.text).toBe('The stall button\ndoes nothing');
    expect(r.kind).toBe('bug');
    expect(r.username).toBe('ali');
    expect(r.done).toBe(false);
    expect(r.context).toMatchObject({ scene: 'town', tile: { x: 10, y: 20 }, level: 7, stage: 2, walletSen: 12_345, district: 'Dataran Sunway', errors: ['oops'] });
    expect(repos.feedback.countOpen()).toBe(1);
    expect(repos.feedback.setDone(r.id, true)).toBe(true);
    expect(repos.feedback.countOpen()).toBe(0);
    expect(repos.feedback.setDone(9999, true)).toBe(false);
  });

  it('refuses near-empty notes and rate-limits bursts and days', () => {
    const { desk, me, tick } = setup();
    expect(desk.send(me, 'idea', ' \u0000\u0001 ', {}).ok).toBe(false);
    for (let i = 0; i < FEEDBACK_LIMITS.perMinute; i++) expect(desk.send(me, 'idea', `idea number ${i}`, {}).ok).toBe(true);
    expect(desk.send(me, 'idea', 'one too many', {}).ok).toBe(false);
    tick(61_000);
    expect(desk.send(me, 'idea', 'fine again now', {}).ok).toBe(true);
    // Fill the day.
    let sent = FEEDBACK_LIMITS.perMinute + 1;
    while (sent < FEEDBACK_LIMITS.perDay) {
      tick(61_000);
      for (let i = 0; i < FEEDBACK_LIMITS.perMinute && sent < FEEDBACK_LIMITS.perDay; i++, sent++) expect(desk.send(me, 'feedback', `note ${sent}`, {}).ok).toBe(true);
    }
    tick(61_000);
    const res = desk.send(me, 'feedback', 'past the daily cap', {});
    expect(res.ok).toBe(false);
    tick(86_400_000);
    expect(desk.send(me, 'feedback', 'a new day', {}).ok).toBe(true);
  });

  it('cleans text and validates the socket message', () => {
    expect(cleanFeedbackText('a\n\n\n\n\n\nb')).toBe('a\n\n\nb');
    expect(C2S.feedbackSend.safeParse({ kind: 'bug', text: 'hey' }).success).toBe(false);
    expect(C2S.feedbackSend.safeParse({ kind: 'spam', text: 'hello there' }).success).toBe(false);
    expect(C2S.feedbackSend.safeParse({ kind: 'bug', text: 'x'.repeat(5000) }).success).toBe(false);
    const ok = C2S.feedbackSend.safeParse({ kind: 'idea', text: 'add a durian stall' });
    expect(ok.success && ok.data.client).toEqual({});
  });
});
