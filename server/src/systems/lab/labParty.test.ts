import { describe, expect, it } from 'vitest';
import { LabParties } from './labParty';

describe('Labirin parties', () => {
  it('invite makes a party; accepting joins it; up to the max', () => {
    let now = 0;
    const ps = new LabParties(3, 60_000, () => now);
    const party = ps.invite(1, 2);
    expect(party.members).toEqual([1]);
    expect(ps.invited(party)).toEqual([2]);
    ps.accept(2, party.id);
    expect(ps.members(2)).toEqual([1, 2]);
    ps.invite(1, 3);
    expect(() => ps.invite(2, 4)).toThrow(/at most/); // 2 members + 1 invite = full
    ps.accept(3, party.id);
    expect(ps.members(1)).toEqual([1, 2, 3]);
    expect(() => ps.invite(1, 2)).toThrow(/already/);
  });

  it('invites run out, and other parties are off limits', () => {
    let now = 0;
    const ps = new LabParties(4, 60_000, () => now);
    const a = ps.invite(1, 2);
    now += 61_000;
    expect(() => ps.accept(2, a.id)).toThrow(/ran out/);
    ps.invite(3, 4);
    expect(() => ps.invite(1, 3)).toThrow(/another party/);
  });

  it('leaving passes the lead on; a party of one ends; the leader can kick', () => {
    const ps = new LabParties();
    const p = ps.invite(1, 2);
    ps.accept(2, p.id);
    ps.invite(1, 3);
    ps.accept(3, p.id);
    ps.leave(1);
    expect(p.leader).toBe(2);
    expect(ps.members(2)).toEqual([2, 3]);
    expect(() => ps.kick(3, 2)).toThrow(/leader/);
    ps.kick(2, 3);
    // Only the leader left: the party is over.
    expect(ps.of(2)).toBeUndefined();
    expect(ps.members(2)).toEqual([2]);
    expect(ps.get(p.id)).toBeUndefined();
  });
});
