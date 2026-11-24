// Client-side copy of the player's economy state. The server is the source of truth: this is
// filled from `init` and updated from acks/events, and panels re-render when it changes.
import type { ItemBest, ActiveBuff, ErrandState, PropPublic, PropSelf, SkipVoteState, EquipSlot, HotbarRef, InventoryItem, JobProgress, JobState, PityState, ProgressState, SelfState, StallPublic, StallSelf, Ventures, BankView, BoutiqueSelf, Listing, MusicView, TradeView, ActiveEvent, EventDef, MarketListing, RebirthView, GarageView, ParkedPublic, SeatInfo, ShoplotPublic } from '@kh/shared';

type Listener = () => void;

export class Store {
  walletSen = 0;
  shards = 0;
  inventory: InventoryItem[] = [];
  equipped: Partial<Record<EquipSlot, number>> = {};
  index = new Set<string>();
  /** 📖 Best tier / variant ever had per item (from the server at login)… */
  best = new Map<string, ItemBest>();
  /** …and every copy that's come in since (the Item Index folds them in, so it's current). */
  seen: Array<{ itemId: string; grade?: string; variant: string }> = [];
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
  /** Riding along in someone else's vehicle (we're not driving), or null. */
  seat: SeatInfo | null = null;
  /** 🅿️ Vehicles put down around town (ours and other people's), by vid. */
  parked = new Map<string, ParkedPublic>();
  /** 🏪 Shoplots taken by Ventures (everyone's). */
  shoplots: ShoplotPublic[] = [];
  /** 🚗 Your showroom vehicles and their tuning (loaded after login; the garage windows refresh it). */
  garage: GarageView | null = null;
  /** XP, level, stage, titles, stats, buffs, quests (Phase 3). */
  progress: ProgressState = {
    xp: 0, level: 1, stage: 1, title: null, titles: [], stats: {}, buffs: [], daily: { canClaim: false, nextDay: 1, streak: 0 }, quests: [], weekly: [], path: 0, goalsDone: [], achievements: [],
  };
  /** When `progress` arrived (buff timers count down from here). */
  progressAt = Date.now();
  /** Who owns which home (unit id → owner). */
  props = new Map<string, PropPublic>();
  /** Your own homes (full detail, with ratings and suggestions). */
  myProps: PropSelf[] = [];
  /** 🏪 Your Ventures' and kopitiam's shop floors (furnished like a home, but businesses). */
  myShops: PropSelf[] = [];
  /** An NPC errand in progress. */
  errand: ErrandState | null = null;
  /** The skip-the-night vote (null until the server sends it). */
  vote: SkipVoteState | null = null;
  /** Our food stall (private view), or null. */
  stall: StallSelf | null = null;
  /** Your idle businesses and shop (Phase 6). */
  ventures: Ventures = { businesses: {}, retail: null };
  /** Credit score and loans (null until the server sends them). */
  bank: BankView | null = null;
  /** Everything on display in player boutiques, and your own butik. */
  listings: Listing[] = [];
  boutique: BoutiqueSelf | null = null;
  /** Today's free Lucky Spin is still there (null until we ask). */
  canSpin: boolean | null = null;
  /** The server event running now (and its buffs, from the events config). */
  event: ActiveEvent | null = null;
  eventDefs: EventDef[] = [];
  eventBuffs(now = Date.now()): ActiveBuff[] {
    const e = this.event;
    const def = e && this.eventDefs.find((d) => d.id === e.id);
    const left = e ? e.endsAt - (now + this.clockOffset) : 0;
    return def && left > 0 ? def.buffs.map((b) => ({ item: `event:${def.name}`, kind: b.kind, mult: b.mult, leftMs: left })) : [];
  }
  /** The shared radio (what's playing, votes). */
  music: MusicView | null = null;
  /** An open trade window. */
  trade: TradeView | null = null;
  /** Pasar Online listings. */
  marketListings: MarketListing[] = [];
  /** Rebirth count, tokens and perks. */
  rebirth: RebirthView | null = null;
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
    this.best = new Map(Object.entries(you.best ?? {}));
    this.seen = [];
    this.seenKeys.clear();
    this.pages = new Set(you.pagesClaimed);
    this.pity = { ...you.pity };
    this.jobs = { ...you.jobs };
    this.job = you.job;
    this.isAdmin = you.isAdmin;
    this.skills = { ...you.skills };
    this.hotbar = [...you.hotbar];
    this.vehicles = [...you.vehicles];
    this.riding = you.vehicle;
    this.seat = you.seat ?? null;
    this.setProgress(you.progress, false);
    this.stall = you.stall;
    this.emit();
  }

  /** Our own vehicle that's out (put down, or being driven by us). */
  myParked(selfId: number): ParkedPublic | null {
    for (const v of this.parked.values()) if (v.ownerId === selfId) return v;
    return null;
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
    const own = this.progress.buffs.filter((b) => !b.item.startsWith('event:')).map((b) => ({ ...b, leftMs: b.leftMs - dt })).filter((b) => b.leftMs > 0);
    return [...own, ...this.eventBuffs(now)];
  }

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Tells listeners something changed. Batched: many changes in a burst (a stall update, the
   *  wallet, progress...) wake the UI once, a moment later, instead of once each. */
  emit() {
    if (this.emitTimer) return;
    this.emitTimer = window.setTimeout(() => {
      this.emitTimer = 0;
      for (const fn of this.listeners) fn();
    }, 24);
  }
  private emitTimer = 0;

  /** Adds to `seen`, one entry per item / tier / variant (auto-rolling for hours added thousands of copies). */
  noteSeen(items: Array<{ itemId: string; grade?: string; variant: string }>) {
    for (const i of items) {
      const k = `${i.itemId}|${i.grade ?? ''}|${i.variant}`;
      if (this.seenKeys.has(k)) continue;
      this.seenKeys.add(k);
      this.seen.push({ itemId: i.itemId, grade: i.grade, variant: i.variant });
    }
  }
  private seenKeys = new Set<string>();

  addItems(items: InventoryItem[], index?: string[]) {
    const have = new Set(this.inventory.map((i) => i.iid));
    for (const i of items) if (!have.has(i.iid)) this.inventory.push(i);
    this.noteSeen(items);
    // The Item Index only grows: add the server's list (and these items) to what we know, never replace it
    // (an empty or partial list once wiped every crate's "x/y found" after buying furniture).
    for (const id of index ?? []) this.index.add(id);
    for (const i of items) this.index.add(i.itemId);
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
