// Wandering NPCs (server side): chit-chat, and small errands for money + XP. NPC positions
// come from the shared route maths, so "you're standing next to Uncle Lim" is checked here
// against the same position every client draws. Errands: go to a place, then back to the NPC.
import { buildNpcRoutes, errandOffer, npcPose, seededRandom, type BuiltMap, type ErrandState, type NpcRoute, type NpcsConfig } from '@kh/shared';
import { GameError } from '../economy/economy';
import type { OnlinePlayer } from '../../game/world';

export interface NpcDeps {
  map: BuiltMap;
  cfg: NpcsConfig;
  /** Pays a reward (money + XP) in one transaction. */
  pay: (p: OnlinePlayer, sen: number, xp: number, reason: string) => void;
  /** The player's wealth stage (rewards scale with it). */
  stageOf: (p: OnlinePlayer) => number;
  now?: () => number;
}

export class NpcSystem {
  readonly routes: NpcRoute[];
  /** "npcId:playerId" → time slot of the last errand taken (one per NPC per slot). */
  private taken = new Map<string, number>();
  private now: () => number;

  constructor(private d: NpcDeps) {
    this.routes = buildNpcRoutes(d.map, d.cfg);
    this.now = d.now ?? Date.now;
  }

  private route(id: number): NpcRoute {
    const r = this.routes.find((x) => x.id === id);
    if (!r) throw new GameError('Nobody by that name around here.');
    return r;
  }

  private near(p: OnlinePlayer, x: number, y: number, radius: number) {
    const T = this.d.map.tileSize;
    return Math.hypot(p.x / T - x, (p.y - 4) / T - y) <= radius;
  }

  /** Throws unless the player is next to the NPC right now (a little slack for lag). */
  private requireNear(p: OnlinePlayer, r: NpcRoute) {
    const pose = npcPose(r, this.d.cfg, this.now());
    if (!this.near(p, pose.x, pose.y, this.d.cfg.talkRadiusTiles + 1.5)) throw new GameError(`Walk up to ${r.name} first.`);
  }

  private rewardSen(p: OnlinePlayer) {
    const t = this.d.cfg.rewardSenByStage;
    return t[Math.min(t.length - 1, Math.max(0, this.d.stageOf(p) - 1))];
  }

  /** The place an errand sends you: one of the configured buildings, not too far from the NPC. */
  private placeFor(r: NpcRoute, playerId: number, slot: number) {
    const pose = npcPose(r, this.d.cfg, this.now());
    const doors = this.d.cfg.places
      .map((id) => this.d.map.buildings.find((b) => b.id === id))
      .filter((b): b is NonNullable<typeof b> => !!b?.door)
      .map((b) => ({ name: b.name ?? 'the shop', x: b.door!.frontX + 0.5, y: b.door!.frontY + 0.5 }))
      .filter((b) => Math.hypot(b.x - pose.x, b.y - pose.y) > 15);
    const inRange = doors.filter((b) => Math.hypot(b.x - pose.x, b.y - pose.y) <= this.d.cfg.errandMaxTiles);
    const pool = inRange.length ? inRange : doors;
    if (!pool.length) return null;
    const rand = seededRandom(r.id * 7 + playerId * 13 + slot);
    return pool[Math.floor(rand() * pool.length)];
  }

  private offerFor(p: OnlinePlayer, r: NpcRoute) {
    if (p.errand) return null;
    const o = errandOffer(this.d.cfg, r.id, p.id, this.now());
    if (!o || this.taken.get(`${r.id}:${p.id}`) === o.slot) return null;
    const place = this.placeFor(r, p.id, o.slot);
    if (!place) return null;
    return { ...o, place, def: this.d.cfg.errands[o.errand] };
  }

  talk(p: OnlinePlayer, npcId: number) {
    const r = this.route(npcId);
    this.requireNear(p, r);
    // Doing an errand for them: talking to them hands it in.
    if (p.errand?.npc === npcId && p.errand.stage === 'return') return { line: this.progress(p).text ?? 'Thanks!' };
    const o = this.offerFor(p, r);
    const lines = this.d.cfg.lines;
    const line = lines[Math.floor(seededRandom(npcId * 31 + Math.floor(this.now() / 20_000))() * lines.length)];
    if (!o) return { line };
    const reward = this.rewardSen(p);
    const text = o.def.ask.replace('{place}', o.place.name).replace('{reward}', `RM ${(reward / 100).toLocaleString('en-US')}`);
    return { line: text, offer: { text, rewardSen: reward, xp: this.d.cfg.rewardXp } };
  }

  accept(p: OnlinePlayer, npcId: number): ErrandState {
    const r = this.route(npcId);
    this.requireNear(p, r);
    if (p.errand) throw new GameError('Finish your other errand first.');
    const o = this.offerFor(p, r);
    if (!o) throw new GameError(`${r.name} doesn't need help right now.`);
    this.taken.set(`${r.id}:${p.id}`, o.slot);
    p.errand = {
      npc: r.id, npcName: r.name, stage: 'go', place: o.place, rewardSen: this.rewardSen(p), xp: this.d.cfg.rewardXp,
      expiresAt: this.now() + this.d.cfg.errandExpiresMs, pickupText: o.def.pickup.replace('{npc}', r.name),
    };
    return p.errand;
  }

  /** At the place → head back; back at the NPC → paid. Server re-checks every distance. */
  progress(p: OnlinePlayer): { errand: ErrandState | null; text?: string; paidSen?: number } {
    const e = p.errand;
    if (!e) throw new GameError('No errand.');
    if (this.now() > e.expiresAt) {
      p.errand = null;
      throw new GameError(`Too slow! ${e.npcName} gave up waiting.`);
    }
    if (e.stage === 'go') {
      if (!this.near(p, e.place.x, e.place.y, 3.5)) throw new GameError(`Go to ${e.place.name} first.`);
      e.stage = 'return';
      return { errand: e, text: e.pickupText };
    }
    const r = this.route(e.npc);
    this.requireNear(p, r);
    p.errand = null;
    this.d.pay(p, e.rewardSen, e.xp, `errand-${r.id}`);
    return { errand: null, text: thanksOf(this.d.cfg, e) ?? 'Thank you!', paidSen: e.rewardSen };
  }

  cancel(p: OnlinePlayer) {
    p.errand = null;
  }
}

/** The thank-you line for the errand template this pickup text came from. */
function thanksOf(cfg: NpcsConfig, e: ErrandState): string | null {
  for (const x of cfg.errands) if (x.pickup.replace('{npc}', e.npcName) === e.pickupText) return x.thanks;
  return null;
}
