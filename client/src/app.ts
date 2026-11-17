// App controller: boot → (auth) → socket → (character creator) → town.
import Phaser from 'phaser';
import { buildMap, randomAppearance, type Appearance, type BuiltMap, type InitPayload, type PublicConfig } from '@kh/shared';
import { Joystick } from './input/joystick';
import { Keyboard } from './input/keyboard';
import { clearToken, fetchPublicConfig, loadToken } from './net/api';
import { connectSocket, type GameSocket } from './net/socket';
import { showAuthScreen } from './ui/authScreen';
import { Chat } from './ui/chat';
import { showCreator } from './ui/creator';
import { el, isTouchDevice, messageOverlay, uiRoot } from './ui/dom';
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
  chat: Chat | null = null;
  minimap: Minimap | null = null;
  emotes: EmoteWheel | null = null;
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
    this.map = buildMap(this.cfg.map);
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game',
      backgroundColor: '#151826',
      scale: { mode: Phaser.Scale.RESIZE, width: innerWidth, height: innerHeight },
      render: { antialias: true, roundPixels: true, powerPreference: 'high-performance' },
      input: { keyboard: false },
      fps: { target: 60 },
      banner: false,
      scene: [],
    });
    this.game.scene.add('town', TownScene, false);
    this.bindKeys();
    loading.remove();

    const token = loadToken();
    if (token) this.connect(token);
    else showAuthScreen(this.cfg, (t) => this.connect(t));
  }

  inputVector() {
    if (this.chat?.isOpen || this.creatorOpen || this.settings) return { x: 0, y: 0 };
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
    this.keyboard.onPress('KeyM', () => inTown() && this.minimap?.toggle());
    this.keyboard.onPress('KeyE', () => inTown() && this.town?.interact());
    this.keyboard.onPress('Tab', () => inTown() && this.openSettings());
    this.keyboard.onPress('Escape', () => {
      this.emotes?.close();
      this.minimap?.closeFull();
    });
    for (let i = 1; i <= 9; i++) {
      this.keyboard.onPress(`Digit${i}`, () => {
        if (!inTown() || !this.emotes?.isOpen) return;
        const e = this.cfg.chat.emotes[i - 1];
        if (e) this.emotes.pick(e.id);
      });
    }
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
      });
      this.chat = new Chat(
        (text) =>
          new Promise((resolve) => {
            if (!this.socket?.connected) return resolve('Not connected.');
            this.socket.timeout(4000).emit('chat:send', { text }, (err, res) => resolve(err ? 'Message not sent.' : res.ok ? null : res.error));
          }),
        this.cfg.chat.maxLength,
      );
      this.minimap = new Minimap(this.map);
      this.emotes = new EmoteWheel(this.cfg.chat.emotes, (id) => this.socket?.emit('emote', { emote: id }));
    }
    for (const m of p.chat) this.chat?.add(m);
    document.body.dataset.state = 'town';
    this.game.scene.start('town', { app: this, init: p });
  }

  onTownReady(scene: TownScene) {
    this.town = scene;
  }

  private leaveTown() {
    if (this.game?.scene.isActive('town')) this.game.scene.stop('town');
    this.town = null;
    this.settings?.close();
    this.settings = null;
    this.hud?.destroy();
    this.chat?.destroy();
    this.minimap?.destroy();
    this.emotes?.destroy();
    this.hud = this.chat = this.minimap = this.emotes = null;
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
