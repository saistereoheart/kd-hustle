// Client-side copy of the player's economy state. The server is the source of truth: this is
// filled from `init` and updated from acks/events, and panels re-render when it changes.
import type { ActiveBuff, EquipSlot, HotbarRef, InventoryItem, JobProgress, JobState, PityState, ProgressState, SelfState } from '@kh/shared';

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
    xp: 0, level: 1, stage: 1, title: null, titles: [], stats: {}, buffs: [], daily: { canClaim: false, nextDay: 1, streak: 0 }, quests: [], path: 0,
  };
  /** When `progress` arrived (buff timers count down from here). */
  progressAt = Date.now();
  private listeners = new Set<Listener>();

  load(you: SelfState) {
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
  stacks(): Array<{ itemId: string; variant: string; serial: number | null; items: InventoryItem[] }> {
    const map = new Map<string, { itemId: string; variant: string; serial: number | null; items: InventoryItem[] }>();
    for (const i of this.inventory) {
      const key = `${i.itemId}|${i.variant}|${i.serial ?? ''}`;
      const s = map.get(key) ?? { itemId: i.itemId, variant: i.variant, serial: i.serial, items: [] };
      s.items.push(i);
      map.set(key, s);
    }
    return [...map.values()];
  }
}
