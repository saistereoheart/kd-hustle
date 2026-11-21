// 🗝️ Labirin Purba parties (docs/LABYRINTH.md §5): up to `max` players who fight together when
// they're in the same room. Invite someone online; they get an Accept prompt (it runs out after a
// minute). Kept in memory: parties end when the server restarts, or when everyone has left.
import { GameError } from '../economy/economy';

export interface LabParty {
  id: number;
  leader: number;
  members: number[];
  /** Invited player → when the invite runs out. */
  invites: Map<number, number>;
}

export class LabParties {
  private parties = new Map<number, LabParty>();
  private byPlayer = new Map<number, LabParty>();
  private nextId = 1;

  constructor(
    readonly max = 4,
    private inviteMs = 60_000,
    private clock: () => number = Date.now,
  ) {}

  of(playerId: number): LabParty | undefined {
    return this.byPlayer.get(playerId);
  }

  get(id: number): LabParty | undefined {
    return this.parties.get(id);
  }

  /** Everyone in your party (you included); just you without one. */
  members(playerId: number): number[] {
    return this.byPlayer.get(playerId)?.members ?? [playerId];
  }

  /** Invite someone (a party is made for you if you have none). Returns the party. */
  invite(from: number, to: number): LabParty {
    if (from === to) throw new GameError("You can't invite yourself.");
    let party = this.byPlayer.get(from);
    if (this.byPlayer.get(to) && this.byPlayer.get(to) === party) throw new GameError("They're already in your party.");
    if (this.byPlayer.get(to)) throw new GameError("They're in another party.");
    if (!party) {
      party = { id: this.nextId++, leader: from, members: [from], invites: new Map() };
      this.parties.set(party.id, party);
      this.byPlayer.set(from, party);
    }
    this.prune(party);
    if (party.members.length + party.invites.size >= this.max) throw new GameError(`A party is ${this.max} players at most.`);
    party.invites.set(to, this.clock() + this.inviteMs);
    return party;
  }

  accept(playerId: number, partyId: number): LabParty {
    const party = this.parties.get(partyId);
    if (!party) throw new GameError('That party has broken up.');
    this.prune(party);
    if (!party.invites.has(playerId)) throw new GameError('That invite ran out. Ask for a new one.');
    if (this.byPlayer.get(playerId)) this.leave(playerId); // one party at a time
    party.invites.delete(playerId);
    if (party.members.length >= this.max) throw new GameError('The party is full.');
    party.members.push(playerId);
    this.byPlayer.set(playerId, party);
    return party;
  }

  decline(playerId: number, partyId: number): LabParty | undefined {
    const party = this.parties.get(partyId);
    party?.invites.delete(playerId);
    return party;
  }

  /** Leave your party (the next member leads; a party of one ends). Returns the party left, if any is left. */
  leave(playerId: number): LabParty | undefined {
    const party = this.byPlayer.get(playerId);
    if (!party) return undefined;
    this.byPlayer.delete(playerId);
    party.members = party.members.filter((m) => m !== playerId);
    if (party.leader === playerId) party.leader = party.members[0] ?? -1;
    if (party.members.length <= 1) {
      for (const m of party.members) this.byPlayer.delete(m);
      this.parties.delete(party.id);
      party.members = [];
      party.invites.clear();
    }
    return party;
  }

  /** The leader removes someone. */
  kick(leader: number, target: number): LabParty {
    const party = this.byPlayer.get(leader);
    if (!party || party.leader !== leader) throw new GameError('Only the party leader can do that.');
    if (!party.members.includes(target) || target === leader) throw new GameError("They're not in your party.");
    this.leave(target);
    return party;
  }

  private prune(party: LabParty) {
    const now = this.clock();
    for (const [id, until] of party.invites) if (until <= now) party.invites.delete(id);
  }

  /** Pending invites (live ones). */
  invited(party: LabParty): number[] {
    this.prune(party);
    return [...party.invites.keys()];
  }
}
