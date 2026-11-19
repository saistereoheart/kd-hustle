// App controller: boot → (auth) → socket → (character creator) → town.
import Phaser from 'phaser';
import {
  buildMap, buildSnapshot, computeMods, rebirthMods, gearOf, EQUIP_SLOTS, formatMoney, randomAppearance,
  buildListings, roomStyleOf, type Unit,
  type Appearance, type BuiltBuilding, type BuiltMap, type CrateDef, type EquipSlot, type HotbarRef, type InitPayload, type ItemDef, type Mods,
  type ProgCfg, type ProgressSnapshot, type PublicConfig,
} from '@kh/shared';
import { celebrate } from './ui/celebrate';
import { ProgressHud } from './ui/progressHud';
import { Store } from './state/store';
import { showAnnouncement } from './ui/announce';
import { openCratePanel } from './ui/cratePanel';
import { Hotbar } from './ui/hotbar';
import { openInventoryPanel } from './ui/inventoryPanel';
import { DeliveryHud, openCarwashPanel, openJobsPanel } from './ui/jobs';
import { openPhone } from './ui/phone/phone';
import { openRonda, type RideHud } from './ui/ronda';
import { closePanel, isPanelOpen } from './ui/panel';
import { openPawnPanel } from './ui/pawnPanel';
import { openMarketPanel } from './ui/stall/market';
import { openStallPanel } from './ui/stall/stallPanel';
import { openCasinoGame } from './ui/casino';
import { refreshSpin } from './ui/phone/spin';
import { sfx } from './ui/sound';
import { Joystick } from './input/joystick';
import { Keyboard } from './input/keyboard';
import { checkSession, clearToken, fetchPublicConfig, loadToken } from './net/api';
import { connectSocket, type GameSocket } from './net/socket';
import { showAuthScreen } from './ui/authScreen';
import { Chat } from './ui/chat';
import { showCreator } from './ui/creator';
import { el, isTouchDevice, messageOverlay, toast, uiRoot } from './ui/dom';

/** Device pixel ratio to render at: up to 3× (phones), but keep the canvas under ~8.3 MP
 *  (about 4K) so big high-DPI monitors don't tank the frame rate. */
function renderDpr(): number {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const budget = Math.sqrt(8_300_000 / Math.max(1, innerWidth * innerHeight));
  return Math.max(1, Math.min(dpr, budget));
}
import { EmoteWheel } from './ui/emoteWheel';
import { Hud } from './ui/hud';
import { Minimap } from './ui/minimap';
import { openSettings } from './ui/settings';
import { TownScene } from './world/townScene';
import { InteriorScene } from './world/interiorScene';
import { Guide } from './ui/guide';
import { VoteBanner } from './ui/voteBanner';
import { PhoneButton } from './ui/phoneButton';
import { Radio } from './ui/radio';
import { EventBanner } from './ui/eventBanner';
import { DebugOverlay } from './ui/debugOverlay';
import { showTrade, showTradeRequest } from './ui/trade';
import { showCoinflipChallenge, showCoinflipResult } from './ui/coinflip';
import { rememberLook, showTitleScreen } from './ui/titleScreen';
import { introCancel, introCover } from './ui/intro';
import { openErrandOffer } from './ui/errand';
import { HomeScene } from './world/homeScene';
import { openPropertyPanel } from './ui/property/propertyPanel';
import { openFurnitureStore } from './ui/property/furnitureStore';
import { showWelcomeBack } from './ui/property/welcome';
import { setFurnitureCatalog } from './items/furnitureArt';

export class App {
  cfg!: PublicConfig;
  map!: BuiltMap;
  game!: Phaser.Game;
  socket: GameSocket | null = null;
  readonly touch = isTouchDevice();
  readonly keyboard = new Keyboard();
  readonly joystick: Joystick | null = this.touch ? new Joystick() : null;
  hud: Hud | null = null;
  readonly store = new Store();
  items = new Map<string, ItemDef>();
  crates = new Map<string, CrateDef>();
  cratesOfItem = new Map<string, CrateDef>();
  jobHud: DeliveryHud | null = null;
  /** Guide arrow to goals/places + random hints. */
  guide: Guide | null = null;
  voteBanner: VoteBanner | null = null;
  phoneBtn: PhoneButton | null = null;
  radio: Radio | null = null;
  eventBanner: EventBanner | null = null;
  debugOverlay: DebugOverlay | null = null;
  progressHud: ProgressHud | null = null;
  /** The dish being cooked right now (debug/tests). */
  cookingDish: import('@kh/shared').DishState | null = null;
  /** Config bundle for the shared progression maths (same as the server's). */
  prog!: ProgCfg;
  chat: Chat | null = null;
  minimap: Minimap | null = null;
  emotes: EmoteWheel | null = null;
  hotbar: Hotbar | null = null;
  /** Shown while a Ronda rider is taking us somewhere. */
  rideHud: RideHud | null = null;
  /** Canvas pixels per CSS pixel (see renderDpr). */
  dpr = 1;
  town: TownScene | null = null;
  /** The building we're inside (its interior scene runs over the town), or null. */
  interior: InteriorScene | null = null;
  /** Inside one of our own homes (its scene runs over the town), or null. */
  home: HomeScene | null = null;
  /** Every home for sale on the map (computed from the map + properties.json). */
  listings: Unit[] = [];
  private townBlur: Phaser.FX.Blur | null = null;
  lastInit: InitPayload | null = null;
  lastSavedAt: number | null = null;
  private kicked = false;
  private username = '';
  private reconnecting: HTMLElement | null = null;
  private settings: { close: () => void } | null = null;
  private creatorOpen = false;

  async start() {
    document.body.classList.toggle('touch', this.touch);
    const orient = () => document.body.classList.toggle('portrait', innerHeight > innerWidth);
    orient();
    addEventListener('resize', orient);
    const loading = el('div', { class: 'loading' }, 'Loading Kota Hustle…');
    uiRoot().append(loading);
    try {
      this.cfg = await fetchPublicConfig();
    } catch {
      loading.textContent = 'Cannot reach the server. Check that it is running, then refresh.';
      return;
    }
    this.map = buildMap(this.cfg.map, this.cfg.terrain);
    this.listings = buildListings(this.map, this.cfg.properties);
    setFurnitureCatalog(this.cfg.furniture);
    this.items = new Map(this.cfg.items.items.map((i) => [i.id, i]));
    this.crates = new Map(this.cfg.crates.crates.map((c) => [c.id, c]));
    for (const c of this.cfg.crates.crates) if (!c.event) for (const id of c.pool) this.cratesOfItem.set(id, c);
    const c = this.cfg;
    this.prog = {
      rarities: c.rarities, items: c.items, itemById: this.items, crates: c.crates, crateOfItem: this.cratesOfItem, pawnRate: c.economy.pawnRate,
      levels: c.levels, stages: c.stages, titles: c.titles, upgrades: c.upgrades, quests: c.quests, goals: c.goals, grades: c.grades,
    };
    this.store.on(() => this.hud?.setWallet(this.store.walletSen, this.store.shards));
    // Render in DEVICE pixels (the canvas is shrunk back with CSS) so phones and high-DPI
    // screens get crisp vector art instead of an upscaled, blurry 1× canvas.
    this.dpr = renderDpr();
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game',
      backgroundColor: '#151826',
      scale: { mode: Phaser.Scale.NONE, width: Math.round(innerWidth * this.dpr), height: Math.round(innerHeight * this.dpr), zoom: 1 / this.dpr },
      render: { antialias: true, roundPixels: true, powerPreference: 'high-performance' },
      input: { keyboard: false },
      fps: { target: 60 },
      banner: false,
      scene: [],
    });
    // Window resized (incl. fullscreen on/off): resize the canvas ourselves. Phaser's NONE scale
    // mode skips the CSS size when the zoom is exactly 1 and only resizes cameras in some cases,
    // which left the game not filling the screen, or zoomed in and off-centre afterwards.
    let pending = 0;
    const fit = () => {
      pending = 0;
      this.dpr = renderDpr();
      const w = Math.round(innerWidth * this.dpr);
      const h = Math.round(innerHeight * this.dpr);
      this.game.scale.setZoom(1 / this.dpr);
      this.game.scale.resize(w, h);
      const style = this.game.canvas.style;
      style.width = `${innerWidth}px`;
      style.height = `${innerHeight}px`;
      this.town?.onViewportResize(w, h);
      this.interior?.fit();
      this.home?.fit();
    };
    const queueFit = () => {
      if (!pending) pending = requestAnimationFrame(fit);
    };
    addEventListener('resize', queueFit);
    document.addEventListener('fullscreenchange', queueFit);
    this.game.scene.add('town', TownScene, false);
    this.game.scene.add('interior', InteriorScene, false);
    this.game.scene.add('home', HomeScene, false);
    this.bindKeys();
    loading.remove();

    void this.showLoginThenTitle();
  }

  /**
   * Every page load: the login screen first (skipped when this device's saved session is still
   * valid), then the START GAME screen.
   */
  async showLoginThenTitle(notice?: string) {
    const token = loadToken();
    if (token) {
      const s = await checkSession(token);
      if (s.ok) {
        this.showTitle(s.username, notice);
        return;
      }
      if (!s.offline) clearToken();
    }
    showAuthScreen(this.cfg, (_t, username) => this.showTitle(username, notice), { notice });
  }

  /** The START GAME screen (after login, and after losing the connection for good). */
  showTitle(username: string, notice?: string) {
    this.username = username;
    introCancel();
    showTitleScreen(this.cfg, {
      notice,
      username,
      onStart: () => {
        const token = loadToken();
        if (token) {
          introCover(); // dark + a dot until the town is drawn, then it opens up
          this.connect(token);
        }
        else void this.showLoginThenTitle();
      },
      onLogout: () => {
        const token = loadToken();
        if (token) void fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }).catch(() => undefined);
        clearToken();
        setTimeout(() => location.reload(), 150);
      },
    });
  }

  /** The connection is gone for good: back to the start screen. */
  private dropToTitle(notice: string) {
    const sock = this.socket;
    if (sock) {
      sock.io.opts.reconnection = false;
      sock.removeAllListeners();
      sock.disconnect();
    }
    this.socket = null;
    this.setReconnecting(false);
    this.leaveTown();
    if (this.username && loadToken()) this.showTitle(this.username, notice);
    else void this.showLoginThenTitle(notice);
  }

  /** Our live bonuses (luck, XP, job pay, walk speed...), computed like the server does. */
  private modsCache: { at: number; v: Mods } | null = null;
  /** Skills, gear, title and potions combined (cached for a moment: it's read every frame). */
  mods(): Mods {
    const now = performance.now();
    if (this.modsCache && now - this.modsCache.at < 250) return this.modsCache.v;
    const st = this.store;
    const v = computeMods(this.prog, { skills: st.skills, title: st.progress.title, buffs: st.buffs(), gear: gearOf(this.prog, st.equipped, st.inventory), rebirth: rebirthMods(this.cfg.rebirth, { count: st.rebirth?.count ?? this.lastInit?.you.rebirths ?? 0 }) });
    this.modsCache = { at: now, v };
    return v;
  }

  snapshot(): ProgressSnapshot {
    const st = this.store;
    return buildSnapshot(this.prog, {
      level: st.progress.level, stage: st.progress.stage, walletSen: st.walletSen, inventory: st.inventory,
      index: st.index, pages: st.pages, stats: st.progress.stats, skills: st.skills,
    });
  }

  /** Drink a potion (or use any usable item). */
  useItem(iid: number) {
    this.socket?.timeout(5000).emit('item:use', { iid }, (err, res) => {
      if (err || !res.ok) return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      const inst = this.store.inventory.find((i) => i.iid === iid);
      const def = inst && this.items.get(inst.itemId);
      this.store.removeItems([res.removed]);
      sfx.gulp();
      if (def) toast(`🧪 ${def.name}: ${def.desc ?? 'active!'}`, 'good', 3500);
    });
  }

  openPhone(appId?: string) {
    closePanel();
    openPhone(this, appId);
  }

  inputVector() {
    if (this.chat?.isOpen || this.creatorOpen || this.settings || isPanelOpen() || document.querySelector('.reveal-overlay')) return { x: 0, y: 0 };
    const k = this.keyboard.vector();
    if (k.x || k.y) return k;
    return this.joystick?.vector() ?? { x: 0, y: 0 };
  }

  private bindKeys() {
    const inTown = () => document.body.dataset.state === 'town' && !this.creatorOpen;
    this.keyboard.onPress('Enter', (e) => {
      if (!inTown()) return;
      e.preventDefault();
      this.chat?.open();
    });
    this.keyboard.onPress('KeyQ', () => inTown() && this.emotes?.toggle());
    this.keyboard.onPress('KeyM', () => inTown() && this.minimap?.toggleFull());
    this.keyboard.onPress('KeyN', () => inTown() && this.minimap?.toggle());
    this.keyboard.onPress('KeyE', () => inTown() && !isPanelOpen() && this.interact());
    // Tab or P: the HustlePhone (spec §16). Settings live in the phone and behind the ⚙️ button.
    this.keyboard.onPress('Tab', (e) => {
      if (!inTown()) return;
      e.preventDefault();
      if (document.querySelector('[data-testid=phone-panel]')) closePanel();
      else if (!isPanelOpen()) this.openPhone();
    });
    this.keyboard.onPress('KeyB', () => inTown() && !isPanelOpen() && openInventoryPanel(this));
    this.keyboard.onPress('KeyP', () => inTown() && !isPanelOpen() && this.openPhone());
    this.keyboard.onPress('Escape', () => {
      if (this.interior && !isPanelOpen() && !this.minimap?.fullOpen && !this.chat?.isOpen) this.interior.leave();
      else if (this.home && !isPanelOpen() && !this.minimap?.fullOpen && !this.chat?.isOpen && !document.querySelector('.modal-backdrop')) this.home.leave();
      this.emotes?.close();
      this.minimap?.closeFull();
    });
    // 1-9, 0 use the hotbar. With the emote wheel open (Q) they fire emotes instead, so emotes
    // stay spammable from the keyboard. − is always Manifest.
    for (let i = 0; i < 10; i++) {
      this.keyboard.onPress(`Digit${(i + 1) % 10}`, () => {
        if (!inTown() || isPanelOpen()) return;
        const e = this.cfg.chat.emotes[i];
        if (this.emotes?.isOpen && e) this.triggerEmote(e.id);
        else this.useHotbar(i);
      });
    }
    this.keyboard.onPress('Minus', () => {
      const e = this.cfg.chat.emotes[10];
      if (inTown() && e) this.triggerEmote(e.id);
    });
  }

  // ------------------------------------------------------------------ hotbar + vehicles
  /** Use hotbar slot i: hop on/off a vehicle, or wear/take off an item. */
  useHotbar(i: number) {
    const ref = this.store.hotbar[i];
    if (!ref) {
      toast(`Slot ${(i + 1) % 10} is empty. Open the 🎒 Bag (B) and use "Add to hotbar".`);
      return;
    }
    if (ref.kind === 'vehicle') {
      const v = this.cfg.vehicles.vehicles[ref.id];
      if (this.store.riding === ref.id) this.ride(null);
      else if (this.store.vehicles.includes(ref.id)) this.ride(ref.id);
      else toast(`You don't own a ${v?.name ?? 'ride like that'}. Book a ${this.cfg.rides.appName} ride from your 📱 Phone (P).`);
      return;
    }
    const def = this.items.get(ref.itemId);
    const inst = this.store.inventory.find((it) => it.itemId === ref.itemId && it.variant === ref.variant);
    if (!def || !inst) return void toast("You don't have that item any more.", 'bad');
    if (def.effect) return this.useItem(inst.iid);
    if (!(EQUIP_SLOTS as readonly string[]).includes(def.type)) return void toast(`${def.name} can't be used yet.`);
    const slot = def.type as EquipSlot;
    const wornIid = this.store.equipped[slot];
    const wearingThis = this.store.inventory.some((it) => it.iid === wornIid && it.itemId === ref.itemId && it.variant === ref.variant);
    if (wearingThis) {
      this.socket?.timeout(5000).emit('inv:unequip', { slot }, (err, res) => {
        if (err || !res.ok) return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
        const next = { ...this.store.equipped };
        delete next[slot];
        this.store.equipped = next;
        this.store.emit();
      });
    } else {
      this.socket?.timeout(5000).emit('inv:equip', { iid: inst.iid }, (err, res) => {
        if (err || !res.ok) return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
        this.store.equipped = { ...this.store.equipped, [slot]: inst.iid };
        this.store.emit();
      });
    }
  }

  setHotbarSlot(slot: number, ref: HotbarRef | null) {
    this.socket?.timeout(5000).emit('hotbar:set', { slot, ref }, (err, res) => {
      if (err || !res.ok) return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      this.store.hotbar = res.hotbar;
      this.store.emit();
    });
  }

  /** Hop on a vehicle we have (or off, with null). */
  ride(vehicle: string | null) {
    this.socket?.timeout(5000).emit('vehicle:ride', { vehicle }, (err, res) => {
      if (err || !res.ok) return toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      this.store.vehicles = res.vehicles;
      this.store.riding = res.vehicle;
      this.store.emit();
    });
  }

  /** 🛵 Ronda: pick a destination on the map and get a ride there. */
  openRonda() {
    closePanel();
    openRonda(this);
  }

  openBag() {
    if (!isPanelOpen()) openInventoryPanel(this);
  }

  connect(token: string) {
    this.kicked = false;
    const socket = connectSocket(token);
    this.socket = socket;
    socket.on('connect', () => this.setReconnecting(false));
    socket.io.on('reconnect_attempt', () => this.setReconnecting(true));
    socket.on('connect_error', (err) => {
      if (err.message === 'unauthorized') {
        clearToken();
        socket.disconnect();
        this.socket = null;
        this.leaveTown();
        this.setReconnecting(false);
        showAuthScreen(this.cfg, (t) => this.connect(t));
      } else {
        this.setReconnecting(true);
      }
    });
    socket.on('disconnect', (reason) => {
      if (!this.kicked && reason !== 'io client disconnect') this.setReconnecting(true);
    });
    socket.on('kicked', ({ reason }) => {
      this.kicked = true;
      socket.io.opts.reconnection = false;
      this.leaveTown();
      messageOverlay('Disconnected', reason, { label: 'Reload', onClick: () => location.reload() });
    });
    socket.on('init', (p) => this.onInit(p));
    socket.on('wallet', (w) => {
      const gained = w.walletSen - this.store.walletSen;
      this.store.walletSen = w.walletSen;
      this.store.shards = w.shards;
      this.store.emit();
      if (gained > 0) this.hud?.floatMoney(gained);
    });
    socket.on('inv:added', ({ items, index }) => {
      this.store.addItems(items, index);
      sfx.coin();
    });
    socket.on('job:update', ({ job, jobs }) => {
      this.store.job = job;
      this.store.jobs = jobs;
      this.store.emit();
    });
    socket.on('announce', (a) => showAnnouncement(a, this.cfg.rarities));
    socket.on('stalls', ({ stalls, removed }) => {
      for (const plot of removed ?? []) this.store.stalls.delete(plot); // gone (rebirth)
      this.store.setStalls(stalls);
    });
    socket.on('rebirth:self', ({ view }) => {
      this.store.rebirth = view;
      this.store.emit();
    });
    socket.on('props', ({ props }) => this.store.setProps(props));
    socket.on('props:self', ({ props }) => {
      this.store.myProps = props;
      this.store.emit();
    });
    socket.on('ventures:self', ({ ventures }) => {
      this.store.ventures = ventures;
      this.store.emit();
    });
    socket.on('notice', (n) => toast(n.text, n.kind, 5000));
    socket.on('market', ({ listings }) => {
      this.store.marketListings = listings;
      this.store.emit();
    });
    socket.on('event', ({ event }) => {
      this.store.event = event;
      this.store.emit();
    });
    socket.on('inv:removed', ({ iids }) => this.store.removeItems(iids));
    socket.on('trade:request', ({ from, name }) => showTradeRequest(this, from, name));
    socket.on('coinflip:challenge', ({ from, name, sen }) => showCoinflipChallenge(this, from, name, sen));
    socket.on('coinflip:result', (r) => showCoinflipResult(this, r));
    socket.on('trade', ({ trade, done, reason }) => {
      this.store.trade = trade;
      showTrade(this, trade);
      if (reason) toast(reason, done ? 'good' : 'info', 4000);
      if (done) sfx.reveal(3);
    });
    socket.on('music', (v) => {
      this.store.music = v;
      this.store.emit();
    });
    socket.on('bank:self', ({ bank }) => {
      this.store.bank = bank;
      this.store.emit();
    });
    socket.on('loan:event', (ev) => toast(ev.text, ev.kind, 6000));
    socket.on('boutique', ({ listings }) => {
      this.store.listings = listings;
      this.store.emit();
    });
    socket.on('boutique:self', ({ boutique }) => {
      this.store.boutique = boutique;
      this.store.emit();
    });
    socket.on('prop:event', (ev) => toast(ev.text, ev.kind, 5000));
    socket.on('welcome', (w) => showWelcomeBack(this, w));
    socket.on('time:vote', (v) => {
      const started = v.active && !this.store.vote?.active;
      this.store.vote = v;
      this.store.emit();
      if (started) sfx.chime();
    });
    socket.on('time:offset', ({ offsetGameMinutes }) => {
      this.cfg.time.offsetGameMinutes = offsetGameMinutes;
      this.store.emit();
    });
    socket.on('stall:self', ({ stall }) => {
      this.store.stall = stall;
      this.store.emit();
    });
    socket.on('stall:event', (ev) => {
      if (ev.kind === 'staffSale') {
        // A cook sold something: "+RM" over the stall (and a quiet coin), not a toast.
        sfx.staffCoin();
        this.town?.stalls.popIncome(ev.sen ?? 0);
        return;
      }
      if (ev.kind === 'lowStock') sfx.error();
      toast(ev.text, ev.kind === 'staffServed' || ev.kind === 'blogger' || ev.kind === 'restocked' ? 'good' : ev.kind === 'closed' || ev.kind === 'lowStock' ? 'info' : 'bad', ev.kind === 'lowStock' ? 6000 : 4500);
    });
    socket.on('progress', ({ progress, events }) => {
      this.store.setProgress(progress);
      if (events.length) celebrate(this, events);
    });
    socket.on('ride:ended', ({ arrived }) => {
      this.rideHud?.destroy();
      this.rideHud = null;
      this.store.emit();
      toast(arrived ? `🛵 You've arrived. Terima kasih for riding ${this.cfg.rides.appName}!` : '🛵 You got off.', 'good');
    });
    socket.on('saved', ({ at }) => {
      this.lastSavedAt = at;
      this.hud?.showSaved();
    });
  }

  private reconnectTimer = 0;

  /**
   * A dropped connection: keep playing on screen (a small banner counts down) while the socket
   * reconnects. Back within the grace period → carry on as if nothing happened. Still gone →
   * back to the start screen.
   */
  private setReconnecting(on: boolean) {
    if (on && !this.reconnecting) {
      const grace = this.cfg.net.reconnectGraceMs;
      const until = Date.now() + grace;
      const text = el('span', {}, '📶 Reconnecting…');
      this.reconnecting = el('div', { class: 'reconnect-banner', 'data-testid': 'reconnecting' }, text);
      uiRoot().append(this.reconnecting);
      this.reconnectTimer = window.setInterval(() => {
        const left = Math.ceil((until - Date.now()) / 1000);
        text.textContent = `📶 Reconnecting… ${Math.max(0, left)}s`;
        if (left <= 0) this.dropToTitle('Lost connection to the server. Press START GAME to join again.');
      }, 500);
    } else if (!on && this.reconnecting) {
      clearInterval(this.reconnectTimer);
      this.reconnecting.remove();
      this.reconnecting = null;
    }
  }

  private onInit(p: InitPayload) {
    window.setTimeout(() => refreshSpin(this), 1500); // the daily free spin badge
    this.store.eventDefs = this.cfg.events.events;
    this.socket?.timeout(5000).emit('event:view', (err, res) => {
      if (err || !res.ok) return;
      this.store.event = res.event;
      this.store.emit();
    });
    this.socket?.timeout(5000).emit('music:view', (err, res) => {
      if (err || !res.ok) return;
      this.store.music = res.view;
      this.store.emit();
    });
    const resume = !!this.town && !p.needsCharacter && this.lastInit?.you.id === p.you.id && document.body.dataset.state === 'town';
    this.lastInit = p;
    if (p.you.appearance) rememberLook(p.you.appearance);
    // A ride ends if we were disconnected (the server drops us off where we were).
    this.rideHud?.destroy();
    this.rideHud = null;
    this.store.load(p.you);
    this.store.clockOffset = p.serverTime - Date.now();
    this.store.setStalls(p.stalls, true);
    this.store.setProps(p.props ?? []);
    this.lastSavedAt = p.you.lastSavedAt;
    if (p.needsCharacter) {
      this.leaveTown();
      this.openCreator(true);
    } else if (resume) {
      // Back after a short drop-out: keep the scene, just catch up with the world.
      this.town!.resync(p);
      this.store.emit();
      if (this.interior) this.socket?.emit('interior', { building: this.interior.building.id }, () => {});
    } else {
      this.enterTown(p);
    }
  }

  private openCreator(first: boolean) {
    if (this.creatorOpen) return;
    this.creatorOpen = true;
    introCancel(); // the creator needs the screen; the town opens from the dot after it
    const prevState = document.body.dataset.state;
    document.body.dataset.state = 'creator';
    const start: Appearance = first || !this.lastInit?.you.appearance ? randomAppearance(this.cfg.character) : this.lastInit.you.appearance;
    showCreator(this.cfg.character, start, {
      title: first ? 'Create your hustler' : 'Edit your look',
      saveLabel: first ? "Let's hustle →" : 'Save look',
      onSave: (appearance) =>
        new Promise<string | null>((resolve) => {
          if (!this.socket?.connected) return resolve('Not connected to the server.');
          this.socket.timeout(5000).emit('character:save', { appearance }, (err, res) => {
            if (err) return resolve('The server did not respond. Try again.');
            if (!res.ok) return resolve(res.error);
            this.creatorOpen = false;
            if (first) introCover();
            if (!first) {
              document.body.dataset.state = 'town';
              if (this.lastInit) this.lastInit.you.appearance = appearance;
            }
            resolve(null);
          });
        }),
      onCancel: first
        ? undefined
        : () => {
            this.creatorOpen = false;
            document.body.dataset.state = prevState ?? 'town';
          },
    });
  }

  private enterTown(p: InitPayload) {
    if (this.interior || this.home) {
      if (this.interior) this.game.scene.stop('interior');
      if (this.home) this.game.scene.stop('home');
      this.interior = null;
      this.home = null;
      this.townBlur = null;
      delete document.body.dataset.inside;
    }
    if (this.game.scene.isActive('town') || this.game.scene.isPaused('town')) this.game.scene.stop('town');
    if (!this.hud) {
      this.hud = new Hud({
        name: p.you.name,
        level: p.you.level,
        joystick: this.joystick,
        onChat: () => this.chat?.toggle(),
        onEmote: () => this.emotes?.toggle(),
        onMap: () => this.minimap?.openFull(),
        onSettings: () => this.openSettings(),
        onInteract: () => this.interact(),
        onBag: () => openInventoryPanel(this),
        onPhone: () => this.openPhone(),
        attribution: this.map.attribution,
      }, this);
      this.progressHud = new ProgressHud(this);
      this.hotbar = new Hotbar(this);
      this.hud.setWallet(this.store.walletSen, this.store.shards);
      this.jobHud = new DeliveryHud(this);
      this.guide = new Guide(this);
      this.minimap?.setPois(this.guide.pois);
      this.voteBanner = new VoteBanner(this);
      this.phoneBtn = new PhoneButton(this);
      this.radio ??= new Radio(this);
      this.eventBanner ??= new EventBanner(this);
      this.debugOverlay ??= new DebugOverlay(this);
      this.chat = new Chat(
        (text) =>
          new Promise((resolve) => {
            if (!this.socket?.connected) return resolve('Not connected.');
            this.socket.timeout(4000).emit('chat:send', { text }, (err, res) => resolve(err ? 'Message not sent.' : res.ok ? null : res.error));
          }),
        this.cfg.chat.maxLength,
      );
      this.minimap = new Minimap(this.map);
      this.emotes = new EmoteWheel(this.cfg.chat.emotes, (id) => this.triggerEmote(id));
    }
    for (const m of p.chat) this.chat?.add(m);
    this.onOwnEmote(null);
    document.body.dataset.state = 'town';
    this.game.scene.start('town', { app: this, init: p });
  }

  /** The continuous emote our own character is playing (null if none). */
  private ownLoop: string | null = null;

  get ownEmote() {
    return this.ownLoop;
  }

  onOwnEmote(loopId: string | null) {
    this.ownLoop = loopId;
    this.emotes?.setActive(loopId);
  }

  /** Play an emote; picking the continuous one that's already playing stops it. */
  triggerEmote(id: string) {
    if (!this.socket?.connected) return;
    if (id === this.ownLoop) this.socket.emit('emote:stop');
    else this.socket.emit('emote', { emote: id });
  }

  /** E / the interact button: inside a building it uses what you're at, outdoors the town decides. */
  interact() {
    if (this.interior) this.interior.interact();
    else if (this.home) return;
    else this.town?.interact();
  }

  /** What the prompt says at a building's door. */
  doorPrompt(b: BuiltBuilding): string {
    const units = this.listings.filter((u) => u.building === b.id);
    if (units.length) {
      const me = this.lastInit?.you.id;
      const mine = units.filter((u) => this.store.props.get(u.id)?.owner === me).length;
      const free = units.filter((u) => !this.store.props.has(u.id)).length;
      const t = this.cfg.properties.types[units[0].type];
      if (mine) return `🏠 Your ${units.length > 1 ? 'unit' : t.name.toLowerCase()} · go in`;
      return free ? `🏷️ FOR SALE · ${free > 1 ? `${free} units` : t.name}` : `🔒 ${t.name} (owned)`;
    }
    const style = roomStyleOf(this.cfg.interiors, b);
    const name = b.name ?? (style ? this.cfg.interiors.styles[style]?.label : null) ?? 'house';
    if (!style) return `🔒 ${name} (locked)`;
    const inside = this.map.interactables.filter((i) => i.building === b.id && i.name !== b.name).map((i) => i.name);
    return `🚪 Walk in: ${name}${inside.length ? ` · ${inside.join(', ')}` : ''}`;
  }

  /**
   * Walked into a door (or pressed E at one). Returns false when the door is locked: the
   * player bumps it and hears a knock.
   */
  walkIntoDoor(b: BuiltBuilding): boolean {
    if (this.interior || this.home) return true;
    const units = this.listings.filter((u) => u.building === b.id);
    if (units.length) {
      const me = this.lastInit?.you.id;
      const mine = units.some((u) => this.store.props.get(u.id)?.owner === me);
      const free = units.some((u) => !this.store.props.has(u.id));
      if (!mine && !free) {
        sfx.locked();
        toast('🔒 Locked. Someone lives here.');
        return false;
      }
      sfx.door();
      openPropertyPanel(this, b);
      return true;
    }
    if (!roomStyleOf(this.cfg.interiors, b)) {
      sfx.locked();
      toast(this.cfg.interiors.lockedMessage);
      return false;
    }
    if (this.store.riding) {
      sfx.locked();
      toast('Hop off your ride first (press its hotbar key).');
      return false;
    }
    this.enterBuilding(b);
    return true;
  }

  // ------------------------------------------------------------------ NPCs and errands
  /** Talk to a wandering NPC: a line of chat, sometimes a little job. */
  talkTo(npc: number) {
    const e = this.store.errand;
    if (e && e.npc === npc && e.stage === 'return') return this.progressErrand();
    this.socket?.timeout(5000).emit('npc:talk', { npc }, (err, res) => {
      if (err || !res.ok) return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      this.town?.npcs.say(npc, res.line);
      if (res.offer) openErrandOffer(this, npc, res.offer);
    });
  }

  private errandPending = false;
  /** At the errand's place, or back at the NPC: the server checks and moves it on. */
  progressErrand() {
    if (this.errandPending) return;
    this.errandPending = true;
    this.socket?.timeout(5000).emit('npc:progress', (err, res) => {
      this.errandPending = false;
      if (err) return;
      if (!res.ok) {
        if (/gave up/.test(res.error)) {
          this.store.errand = null;
          this.store.emit();
          toast(res.error, 'bad');
        }
        return;
      }
      const npc = this.store.errand?.npc;
      this.store.errand = res.errand;
      this.store.emit();
      if (res.paidSen !== undefined) {
        sfx.coin();
        if (npc !== undefined && res.text) this.town?.npcs.say(npc, res.text);
        toast(`🧺 Errand done! +${formatMoney(res.paidSen)}`, 'good', 4000);
      } else if (res.text) {
        sfx.click();
        toast(res.text, 'info', 4500);
      }
    });
  }

  cancelErrand() {
    this.socket?.timeout(5000).emit('npc:cancel', () => {
      this.store.errand = null;
      this.store.emit();
    });
  }

  /** Go into a building through the door we're standing at. */
  enterBuilding(b: BuiltBuilding) {
    if (this.interior || this.home) return;
    // Homes: the sale / ownership panel (your own unit: straight in).
    if (this.listings.some((u) => u.building === b.id)) return void openPropertyPanel(this, b);
    const styleId = roomStyleOf(this.cfg.interiors, b);
    const style = styleId ? this.cfg.interiors.styles[styleId] : undefined;
    if (!style) return void toast(this.cfg.interiors.lockedMessage);
    if (this.store.riding) return void toast('Hop off your ride first (press its hotbar key).');
    this.socket?.timeout(5000).emit('interior', { building: b.id }, (err, res) => {
      if (err || !res.ok) return void toast(err ? 'No response.' : res.ok ? '' : res.error, 'bad');
      if (this.interior || !this.town) return;
      sfx.door();
      // The door we came in by decides which way the room faces.
      const T = this.map.tileSize, p = this.town.position;
      const door = [...b.doors].sort((d1, d2) => Math.hypot(d1.frontX + 0.5 - p.x / T, d1.frontY + 0.5 - p.y / T) - Math.hypot(d2.frontX + 0.5 - p.x / T, d2.frontY + 0.5 - p.y / T))[0] ?? b.door;
      this.game.scene.run('interior', { app: this, building: b, style, door });
      this.interior = this.game.scene.getScene('interior') as InteriorScene;
      document.body.dataset.inside = b.id;
      // Blur the town behind the room (WebGL only; the dark overlay alone works everywhere).
      try {
        this.townBlur = this.town.cameras.main.postFX?.addBlur(1, 2, 2, 1.2) ?? null;
      } catch {
        this.townBlur = null;
      }
    });
  }

  /** Go into one of our own homes (from its door). */
  enterHome(unit: string) {
    if (this.interior || this.home || !this.town) return;
    const u = this.listings.find((x) => x.id === unit);
    if (!u) return;
    if (this.store.riding) return void toast('Hop off your ride first (press its hotbar key).');
    this.socket?.emit('interior', { building: u.building }, () => {});
    sfx.door();
    this.game.scene.run('home', { app: this, unit });
    this.home = this.game.scene.getScene('home') as HomeScene;
    this.hud?.setPrompt(null, this.touch);
    document.body.dataset.inside = u.building;
    try {
      this.townBlur = this.town.cameras.main.postFX?.addBlur(1, 2, 2, 1.2) ?? null;
    } catch {
      this.townBlur = null;
    }
  }

  exitBuilding() {
    if (!this.interior && !this.home) return;
    this.socket?.emit('interior', { building: null }, () => {});
    if (this.interior) this.game.scene.stop('interior');
    if (this.home) this.game.scene.stop('home');
    this.interior = null;
    this.home = null;
    delete document.body.dataset.inside;
    if (this.townBlur) this.town?.cameras.main.postFX?.remove(this.townBlur);
    this.townBlur = null;
    this.hud?.setPrompt(null, this.touch);
    this.town?.refreshPrompt();
  }

  /** Open the UI for a crate machine / Jobs Board / pawn shop / car wash the player is standing at. */
  openInteractable(it: { type: import('@kh/shared').InteractType; crate?: string; game?: string }) {
    if (it.type === 'market') openMarketPanel(this);
    else if (it.type === 'furniture') openFurnitureStore(this);
    else if (it.type === 'crate' && it.crate) openCratePanel(this, it.crate);
    else if (it.type === 'jobs') openJobsPanel(this);
    else if (it.type === 'pawn') openPawnPanel(this);
    else if (it.type === 'carwash') openCarwashPanel(this);
    else if (it.type === 'casino' && it.game) openCasinoGame(this, it.game);
  }

  /** At a stall plot: ours opens the stall (cook / manage), anyone else's shows what it sells. */
  openStallAt(plot: string) {
    openStallPanel(this, plot);
  }

  onTownReady(scene: TownScene) {
    this.town = scene;
  }

  private leaveTown() {
    if (this.interior) this.game.scene.stop('interior');
    if (this.home) this.game.scene.stop('home');
    this.interior = null;
    this.home = null;
    this.townBlur = null;
    if (this.game?.scene.isActive('town')) this.game.scene.stop('town');
    this.town = null;
    this.settings?.close();
    this.settings = null;
    closePanel();
    this.jobHud?.destroy();
    this.jobHud = null;
    this.guide?.destroy();
    this.guide = null;
    this.voteBanner?.destroy();
    this.voteBanner = null;
    this.phoneBtn?.destroy();
    this.phoneBtn = null;
    this.radio?.destroy();
    this.radio = null;
    this.eventBanner?.destroy();
    this.eventBanner = null;
    this.progressHud?.destroy();
    this.progressHud = null;
    this.hud?.destroy();
    this.chat?.destroy();
    this.minimap?.destroy();
    this.emotes?.destroy();
    this.hotbar?.destroy();
    this.hud = this.chat = this.minimap = this.emotes = this.hotbar = null;
  }

  openSettings() {
    if (this.settings) return;
    const s = openSettings({
      lastSavedAt: () => this.lastSavedAt,
      onEditCharacter: () => this.openCreator(false),
      onLogout: () => void this.logout(),
    });
    this.settings = {
      close: () => {
        s.close();
      },
    };
    // openSettings removes itself on close; track that so movement resumes.
    const check = window.setInterval(() => {
      if (!document.querySelector('.modal-backdrop')) {
        this.settings = null;
        clearInterval(check);
      }
    }, 200);
  }

  async logout() {
    const sock = this.socket;
    if (sock?.connected) {
      await new Promise<void>((resolve) => {
        sock.timeout(2000).emit('logout', () => resolve());
      });
    }
    clearToken();
    location.reload();
  }
}
