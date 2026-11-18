// Client-side copy of the player's economy state. The server is the source of truth: this is
// filled from `init` and updated from acks/events, and panels re-render when it changes.
import type { ActiveBuff, ErrandState, PropPublic, PropSelf, SkipVoteState, EquipSlot, HotbarRef, InventoryItem, JobProgress, JobState, PityState, ProgressState, SelfState, StallPublic, StallSelf } from '@kh/shared';

type Listener = () => void;

export class Store {
  walletSen = 0;
  shards = 0;
  inventory: InventoryItem[] = [];
  equipped: Partial<Record<EquipSlot, number>> = {};
  index = new Set<string>();
  pages = new Set<string>();
  pity: Record<string, PityState> = {};
  jobs: Record<string, JobProgress> = {};
  job: JobState | null = null;
  isAdmin = false;
  skills: Record<string, number> = {};
  hotbar: Array<HotbarRef | null> = [];
  /** Vehicles we own and can ride ourselves (the starter bicycle). */
  vehicles: string[] = [];
  /** The vehicle we're riding (mirrors the town scene's avatar). */
  riding: string | null = null;
  /** XP, level, stage, titles, stats, buffs, quests (Phase 3). */
  progress: ProgressState = {
    xp: 0, level: 1, stage: 1, title: null, titles: [], stats: {}, buffs: [], daily: { canClaim: false, nextDay: 1, streak: 0 }, quests: [], path: 0, goalsDone: [],
  };
  /** When `progress` arrived (buff timers count down from here). */
  progressAt = Date.now();
  /** Who owns which home (unit id → owner). */
  props = new Map<string, PropPublic>();
  /** Your own homes (full detail, with ratings and suggestions). */
  myProps: PropSelf[] = [];
  /** An NPC errand in progress. */
  errand: ErrandState | null = null;
  /** The skip-the-night vote (null until the server sends it). */
  vote: SkipVoteState | null = null;
  /** Our food stall (private view), or null. */
  stall: StallSelf | null = null;
  /** Every stall on the map, by plot id. */
  stalls = new Map<string, StallPublic>();
  /** Server clock − local clock (ms), so the game clock matches the server's. */
  clockOffset = 0;
  private listeners = new Set<Listener>();

  setProps(list: PropPublic[]) {
    this.props = new Map(list.map((p) => [p.unit, p]));
    this.emit();
  }

  load(you: SelfState) {
    this.errand = you.errand ?? null;
    this.walletSen = you.walletSen;
    this.shards = you.shards;
    this.inventory = [...you.inventory];
    this.equipped = { ...you.equipped };
    this.index = new Set(you.index);
    this.pages = new Set(you.pagesClaimed);
    this.pity = { ...you.pity };
    this.jobs = { ...you.jobs };
    this.job = you.job;
    this.isAdmin = you.isAdmin;
    this.skills = { ...you.skills };
    this.hotbar = [...you.hotbar];
    this.vehicles = [...you.vehicles];
    this.riding = you.vehicle;
    this.setProgress(you.progress, false);
    this.stall = you.stall;
    this.emit();
  }

  /** Now, on the server's clock. */
  serverNow() {
    return Date.now() + this.clockOffset;
  }

  setStalls(list: StallPublic[], replace = false) {
    if (replace) this.stalls.clear();
    for (const s of list) {
      // A stall that moved (upgraded to the next tier) leaves its old plot.
      for (const [plot, old] of this.stalls) if (old.owner === s.owner && plot !== s.plot) this.stalls.delete(plot);
      this.stalls.set(s.plot, s);
    }
    this.emit();
  }

  setProgress(p: ProgressState, emit = true) {
    this.progress = p;
    this.progressAt = Date.now();
    if (emit) this.emit();
  }

  /** Buffs still running right now (time left counted down locally between server updates). */
  buffs(now = Date.now()): ActiveBuff[] {
    const dt = now - this.progressAt;
    return this.progress.buffs.map((b) => ({ ...b, leftMs: b.leftMs - dt })).filter((b) => b.leftMs > 0);
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  addItems(items: InventoryItem[], index?: string[]) {
    const have = new Set(this.inventory.map((i) => i.iid));
    for (const i of items) if (!have.has(i.iid)) this.inventory.push(i);
    if (index) this.index = new Set(index);
    else for (const i of items) this.index.add(i.itemId);
    this.emit();
  }

  removeItems(iids: number[]) {
    const gone = new Set(iids);
    this.inventory = this.inventory.filter((i) => !gone.has(i.iid));
    for (const [slot, iid] of Object.entries(this.equipped)) if (iid !== undefined && gone.has(iid)) delete this.equipped[slot as EquipSlot];
    this.emit();
  }

  /** Inventory grouped into stacks of identical item + variant (serials stay separate). */
  stacks(): Array<{ itemId: string; variant: string; grade: string; serial: number | null; items: InventoryItem[] }> {
    const map = new Map<string, { itemId: string; variant: string; grade: string; serial: number | null; items: InventoryItem[] }>();
    for (const i of this.inventory) {
      const grade = i.grade ?? 'D';
      const key = `${i.itemId}|${i.variant}|${grade}|${i.serial ?? ''}`;
      const s = map.get(key) ?? { itemId: i.itemId, variant: i.variant, grade, serial: i.serial, items: [] };
      s.items.push(i);
      map.set(key, s);
    }
    return [...map.values()];
  }
}
