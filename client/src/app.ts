// App controller: boot → (auth) → socket → (character creator) → town.
import Phaser from 'phaser';
import {
  buildMap, EQUIP_SLOTS, randomAppearance,
  type Appearance, type BuiltMap, type CrateDef, type EquipSlot, type HotbarRef, type InitPayload, type ItemDef, type PublicConfig,
} from '@kh/shared';
import { Store } from './state/store';
import { showAnnouncement } from './ui/announce';
import { openCratePanel } from './ui/cratePanel';
import { Hotbar } from './ui/hotbar';
import { openInventoryPanel } from './ui/inventoryPanel';
import { DeliveryHud, openCarwashPanel, openJobsPanel } from './ui/jobs';
import { openPhonePanel } from './ui/phone';
import { openRonda, type RideHud } from './ui/ronda';
import { closePanel, isPanelOpen } from './ui/panel';
import { openPawnPanel } from './ui/pawnPanel';
import { sfx } from './ui/sound';
import { Joystick } from './input/joystick';
import { Keyboard } from './input/keyboard';
import { clearToken, fetchPublicConfig, loadToken } from './net/api';
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
  chat: Chat | null = null;
  minimap: Minimap | null = null;
  emotes: EmoteWheel | null = null;
  hotbar: Hotbar | null = null;
  /** Shown while a Ronda rider is taking us somewhere. */
  rideHud: RideHud | null = null;
  /** Canvas pixels per CSS pixel (see renderDpr). */
  dpr = 1;
  town: TownScene | null = null;
  lastInit: InitPayload | null = null;
  lastSavedAt: number | null = null;
  private kicked = false;
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
    this.items = new Map(this.cfg.items.items.map((i) => [i.id, i]));
    this.crates = new Map(this.cfg.crates.crates.map((c) => [c.id, c]));
    for (const c of this.cfg.crates.crates) for (const id of c.pool) this.cratesOfItem.set(id, c);
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
    };
    const queueFit = () => {
      if (!pending) pending = requestAnimationFrame(fit);
    };
    addEventListener('resize', queueFit);
    document.addEventListener('fullscreenchange', queueFit);
    this.game.scene.add('town', TownScene, false);
    this.bindKeys();
    loading.remove();

    const token = loadToken();
    if (token) this.connect(token);
    else showAuthScreen(this.cfg, (t) => this.connect(t));
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
    this.keyboard.onPress('KeyE', () => inTown() && this.town?.interact());
    this.keyboard.onPress('Tab', () => inTown() && this.openSettings());
    this.keyboard.onPress('KeyB', () => inTown() && !isPanelOpen() && openInventoryPanel(this));
    this.keyboard.onPress('KeyP', () => inTown() && !isPanelOpen() && openPhonePanel(this));
    this.keyboard.onPress('Escape', () => {
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

  openSettingsPanel() {
    this.openSettings();
  }

  connect(token: string) {
    this.kicked = false;
    const socket = connectSocket(token);
    this.socket = socket;
    socket.on('connect', () => this.setReconnecting(false));
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

  private setReconnecting(on: boolean) {
    if (on && !this.reconnecting) {
      this.reconnecting = messageOverlay('Reconnecting…', 'Lost connection to the server. Trying again.');
    } else if (!on && this.reconnecting) {
      this.reconnecting.remove();
      this.reconnecting = null;
    }
  }

  private onInit(p: InitPayload) {
    this.lastInit = p;
    // A ride ends if we were disconnected (the server drops us off where we were).
    this.rideHud?.destroy();
    this.rideHud = null;
    this.store.load(p.you);
    this.lastSavedAt = p.you.lastSavedAt;
    if (p.needsCharacter) {
      this.leaveTown();
      this.openCreator(true);
    } else {
      this.enterTown(p);
    }
  }

  private openCreator(first: boolean) {
    if (this.creatorOpen) return;
    this.creatorOpen = true;
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
        onInteract: () => this.town?.interact(),
        onBag: () => openInventoryPanel(this),
        onPhone: () => openPhonePanel(this),
        attribution: this.map.attribution,
      });
      this.hotbar = new Hotbar(this);
      this.hud.setWallet(this.store.walletSen, this.store.shards);
      this.jobHud = new DeliveryHud(this);
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

  /** Open the UI for a crate machine / Jobs Board / pawn shop / car wash the player is standing at. */
  openInteractable(it: { type: 'crate' | 'jobs' | 'pawn' | 'carwash'; crate?: string }) {
    if (it.type === 'crate' && it.crate) openCratePanel(this, it.crate);
    else if (it.type === 'jobs') openJobsPanel(this);
    else if (it.type === 'pawn') openPawnPanel(this);
    else if (it.type === 'carwash') openCarwashPanel(this);
  }

  onTownReady(scene: TownScene) {
    this.town = scene;
  }

  private leaveTown() {
    if (this.game?.scene.isActive('town')) this.game.scene.stop('town');
    this.town = null;
    this.settings?.close();
    this.settings = null;
    closePanel();
    this.jobHud?.destroy();
    this.jobHud = null;
    this.hud?.destroy();
    this.chat?.destroy();
    this.minimap?.destroy();
    this.emotes?.destroy();
    this.hotbar?.destroy();
    this.hud = this.chat = this.minimap = this.emotes = this.hotbar = null;
  }

  private openSettings() {
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
