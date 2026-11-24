// ⚔️ Labirin Purba: the 3D fight stage. A torch-lit cave arena (rock all around, frost, drifting
// dust), your party in front, the monsters across from you, and every move played big: wind-ups,
// lunges, squash and stretch, hit-stop on impact, screen shake, slash arcs, sparks, shockwaves,
// a zoom punch on skills, giant damage numbers.
//
// Kept light for weak devices (the 30 FPS rule): it's only loaded when a fight starts and is
// thrown away (graphics freed) when it ends; low-poly shapes and cheap (Lambert) lighting; one
// particle pool with a cap; no real-time shadows (soft blobs instead). It watches its own frame
// rate: if a device can't keep up it first drops the sharpness and the extras, then hands back to
// the flat 2D cards (onSlow). The 2D game pauses while this one draws.
import * as THREE from 'three';
import type { LabEvent } from '@kh/shared';
import { G, add, disposeKit, mat } from './kit';
import { Flashes, Particles, dotTexture } from './fx';
import { shadowTex } from './paint';
import { monsterModel, playerModel, type Look, type Model } from './models';

export interface StageFighter {
  id: string;
  side: 'party' | 'foe';
  name: string;
  kind?: string;
  icon?: string;
  boss?: boolean;
  out: boolean;
  fled?: boolean;
  hp: number;
  maxHp: number;
  look?: Look;
}

export interface StageOpts {
  host: HTMLElement;
  quality: 'low' | 'normal';
  wall: string;
  floor: string;
  boss: boolean;
  /** Tapped a monster in 3D: aim at it. */
  onAim: (id: string) => void;
  /** This device can't keep 30 FPS even on the lowest setting: go back to 2D. */
  onSlow: () => void;
}

interface Actor {
  f: StageFighter;
  m: Model;
  home: THREE.Vector3;
  face: number;
  off: THREE.Vector3;
  lean: number;
  squash: number;
  swingK: number;
  spin: number;
  /** 0 standing → 1 lying down (fainted). */
  down: number;
  /** 0 → 1: shrinking away (a beaten monster), or ran off. */
  gone: number;
  flashT: number;
  meshes: THREE.Mesh[];
  shadow: THREE.Mesh;
  busy: number;
  /** The model's own size (bosses are bigger). */
  base: number;
}

interface Tween {
  t: number;
  dur: number;
  step: (k: number) => void;
  done?: () => void;
}

const ease = {
  out: (k: number) => 1 - Math.pow(1 - k, 3),
  in: (k: number) => k * k * k,
  inOut: (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  back: (k: number) => 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2),
};

export class Battle3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
  private camBase = new THREE.Vector3();
  private camLook = new THREE.Vector3(0.4, 0.9, -0.6);
  private fovBase = 40;
  private actors = new Map<string, Actor>();
  private tweens: Tween[] = [];
  private timers: Array<{ at: number; fn: () => void }> = [];
  private time = 0;
  private stop = 0;
  private shakeAmp = 0;
  private punch = 0;
  private sparks: Particles;
  private dust: THREE.Points | null = null;
  private flashes: Flashes;
  private torches: THREE.PointLight[] = [];
  private flames: THREE.Object3D[] = [];
  private aim: THREE.Group;
  private aimId: string | null = null;
  private overlay: HTMLElement;
  private flashEl: HTMLElement;
  private white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private tex: THREE.Texture[] = [];
  private own: Array<THREE.BufferGeometry | THREE.Material> = [];
  private ro: ResizeObserver;
  private last = performance.now();
  private frames = 0;
  private fpsT = 0;
  private fpsStart = performance.now();
  private degraded = false;
  private slowStrikes = 0;
  private dead = false;
  private ray = new THREE.Raycaster();

  constructor(private o: StageOpts) {
    const low = o.quality === 'low';
    this.renderer = new THREE.WebGLRenderer({ antialias: !low, powerPreference: 'default', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const cv = this.renderer.domElement;
    cv.className = 'b3-canvas';
    o.host.append(cv);
    this.overlay = document.createElement('div');
    this.overlay.className = 'b3-overlay';
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'b3-flash';
    o.host.append(this.overlay, this.flashEl);

    const bg = o.boss ? 0x140a10 : 0x090b14;
    this.scene.background = new THREE.Color(bg);
    this.scene.fog = new THREE.FogExp2(bg, low ? 0.06 : 0.05);
    const dot = dotTexture();
    this.tex.push(dot);
    this.buildArena(low, dot);
    this.sparks = new Particles(this.scene, low ? 220 : 480, dot, 0.22);
    this.flashes = new Flashes(this.scene, this.camera, low ? 8 : 14);
    this.aim = this.buildAim();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(o.host);
    this.resize();
    cv.addEventListener('pointerdown', this.onTap);
    this.renderer.setAnimationLoop(this.frame);
  }

  // ------------------------------------------------------------------ the arena
  private buildArena(low: boolean, dot: THREE.Texture) {
    const s = this.scene;
    // Moonlight from above and a cold fill from the sky; torches give the warm pools.
    s.add(new THREE.HemisphereLight(0x9fb4ff, 0x2a2338, 2.4));
    const moon = new THREE.DirectionalLight(0xd0dcff, 2.2);
    moon.position.set(-4, 10, 6);
    s.add(moon);
    // A soft fill from the camera's side, so faces aren't lost in the dark.
    const fill = new THREE.DirectionalLight(0xffe8cc, 1.1);
    fill.position.set(-6, 4, 10);
    s.add(fill);
    // The floor: irregular flagstones (drawn once into a picture).
    const floorTex = this.flagstones();
    const floorGeo = new THREE.CircleGeometry(16, 40);
    const floorMat = new THREE.MeshLambertMaterial({ map: floorTex, color: 0xffffff });
    this.own.push(floorGeo, floorMat);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    // Rock all around (denser behind the monsters), frost caps on some, a few stalagmites.
    const rockC = new THREE.Color(this.o.wall).lerp(new THREE.Color(0x8c99bd), 0.5).getHex();
    const rockM = mat(rockC, { flat: true, rim: false });
    const frost = mat(0xdbe4ff, { flat: true, rim: false });
    // Drawn as three batches (rocks, frost caps, stalagmites): one draw each, however many there are.
    const rocks: THREE.Matrix4[] = [], caps: THREE.Matrix4[] = [], spikes: THREE.Matrix4[] = [];
    const m4 = (pos: [number, number, number], sc: [number, number, number], rot: [number, number, number]) =>
      new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...sc));
    const n = low ? 16 : 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      const r = 8.5 + Math.random() * 3;
      const sc = 1.2 + Math.random() * 2.2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r - 1;
      if (z > 6) continue; // keep the camera side open
      const sy = sc * (0.8 + Math.random() * 0.8);
      rocks.push(m4([x, sc * 0.45, z], [sc, sy, sc], [Math.random(), Math.random() * 3, Math.random()]));
      if (Math.random() < 0.45) caps.push(m4([x, sc * 0.45 + sy * 0.75, z], [sc * 0.55, sc * 0.2, sc * 0.55], [0, Math.random() * 3, 0]));
    }
    for (let i = 0; i < (low ? 4 : 8); i++) {
      const h = 0.8 + Math.random() * 1.8;
      spikes.push(m4([(Math.random() - 0.5) * 16, h / 2, -5 - Math.random() * 4], [0.35 + Math.random() * 0.3, h, 0.35 + Math.random() * 0.3], [0, 0, 0]));
    }
    // Boulders and rubble near the fight.
    for (let i = 0; i < (low ? 5 : 10); i++) {
      const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 2.5;
      const k = 0.2 + Math.random() * 0.35;
      rocks.push(m4([Math.cos(a) * r, 0.1, Math.sin(a) * r - 0.5], [k, k, k], [Math.random(), Math.random(), 0]));
    }
    for (const [geo, m, list] of [[G.rock(), rockM, rocks], [G.rock(), frost, caps], [G.cone(), rockM, spikes]] as const) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geo, m, list.length);
      list.forEach((x, i) => im.setMatrixAt(i, x));
      im.instanceMatrix.needsUpdate = true;
      s.add(im);
    }
    // Torches: posts with a flame, a glow and a warm light.
    const glowMat = new THREE.SpriteMaterial({ map: dot, color: 0xff9a3c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.own.push(glowMat);
    const torchSpots: Array<[number, number]> = low ? [[-4.6, -3.2]] : [[-4.6, -3.2], [5.2, -2.2]];
    for (const [x, z] of torchSpots) {
      add(s, G.cyl(), 0x4a3426, [x, 0.9, z], [0.1, 1.8, 0.1]);
      add(s, G.cyl(), 0x2b2b2b, [x, 1.85, z], [0.2, 0.15, 0.2]);
      const fl = add(s, G.cone(), mat(0xffd43b, { emissive: 0xff8c00, glow: 1 }), [x, 2.15, z], [0.16, 0.45, 0.16]);
      this.flames.push(fl);
      const glow = new THREE.Sprite(glowMat);
      glow.position.set(x, 2.15, z);
      glow.scale.setScalar(2.2);
      s.add(glow);
      const light = new THREE.PointLight(this.o.boss ? 0xff5c3c : 0xff8c32, 26, 16, 1.4);
      light.position.set(x, 2.3, z);
      s.add(light);
      this.torches.push(light);
    }
    if (this.o.boss) {
      const red = new THREE.PointLight(0xff2b2b, 18, 12, 1.5);
      red.position.set(1.8, 3, -3.5);
      s.add(red);
    }
    // Drifting dust / snow motes (just floating dots; skipped on Low).
    if (!low) {
      const N = 140;
      const p = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) p.set([(Math.random() - 0.5) * 18, Math.random() * 6, (Math.random() - 0.5) * 14 - 1], i * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const m = new THREE.PointsMaterial({ size: 0.07, map: dot, color: 0xcfdcff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
      this.own.push(g, m);
      this.dust = new THREE.Points(g, m);
      s.add(this.dust);
    }
  }

  /** Irregular flagstones, in the floor's own colour pulled towards cold night blue. */
  private flagstones(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const x = c.getContext('2d')!;
    const base = new THREE.Color(this.o.floor).lerp(new THREE.Color(0x2b3452), 0.55).multiplyScalar(0.75);
    x.fillStyle = `#${base.clone().multiplyScalar(0.55).getHexString()}`;
    x.fillRect(0, 0, 512, 512);
    const rowH = 42;
    for (let y = 0, row = 0; y < 512; y += rowH, row++) {
      let px = row % 2 ? -20 : 0;
      while (px < 512) {
        const w = 34 + Math.random() * 46;
        const k = 0.8 + Math.random() * 0.45;
        x.fillStyle = `#${base.clone().multiplyScalar(k).getHexString()}`;
        x.beginPath();
        x.roundRect(px + 2, y + 2 + (Math.random() - 0.5) * 3, w - 4, rowH - 4, 7);
        x.fill();
        px += w;
      }
    }
    // A worn, lighter path across the middle, and frost specks.
    const grd = x.createLinearGradient(0, 0, 512, 0);
    grd.addColorStop(0, 'rgba(200,215,255,0)');
    grd.addColorStop(0.5, 'rgba(200,215,255,0.12)');
    grd.addColorStop(1, 'rgba(200,215,255,0)');
    x.fillStyle = grd;
    x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 300; i++) {
      x.fillStyle = `rgba(220,230,255,${Math.random() * 0.25})`;
      x.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(5, 5);
    t.colorSpace = THREE.SRGBColorSpace;
    this.tex.push(t);
    return t;
  }

  private buildAim() {
    const g = new THREE.Group();
    const ringGeo = new THREE.TorusGeometry(0.75, 0.05, 6, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 0.9 });
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffd43b });
    this.own.push(ringGeo, ringMat, arrowMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
    const arrow = new THREE.Mesh(G.cone(), arrowMat);
    arrow.scale.set(0.18, 0.3, 0.18);
    arrow.rotation.x = Math.PI;
    arrow.name = 'arrow';
    g.add(arrow);
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  // ------------------------------------------------------------------ fighters
  /** Who's in the fight (and who's out), and who you're aiming at. */
  setFighters(list: StageFighter[], aim: string | null) {
    const party = list.filter((f) => f.side === 'party');
    const foes = list.filter((f) => f.side === 'foe');
    const place = (row: StageFighter[], side: 'party' | 'foe') => {
      row.forEach((f, i) => {
        let a = this.actors.get(f.id);
        const spread = side === 'party' ? 1.7 : f.boss ? 0 : 2.1;
        const cx = side === 'party' ? -1.7 : 1.9;
        const x = cx + (i - (row.length - 1) / 2) * spread;
        const z = side === 'party' ? 2.3 - Math.abs(i - (row.length - 1) / 2) * 0.4 : -2.4 + Math.abs(i - (row.length - 1) / 2) * 0.5;
        if (!a) {
          const m = side === 'party' ? playerModel(f.look ?? DEFAULT_LOOK) : monsterModel(f.kind, f.icon, !!f.boss);
          const meshes: THREE.Mesh[] = [];
          m.root.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) ((o as THREE.Mesh).userData.mat = (o as THREE.Mesh).material, meshes.push(o as THREE.Mesh));
          });
          // A soft painted shadow (dark in the middle, fading out), not a hard black disc.
          const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false });
          this.own.push(shadowMat);
          const shadow = new THREE.Mesh(G.plane(), shadowMat);
          shadow.rotation.x = -Math.PI / 2;
          shadow.scale.set(1.5 * m.root.scale.x, 1.15 * m.root.scale.x, 1);
          this.scene.add(shadow, m.root);
          a = { f, m, home: new THREE.Vector3(x, 0, z), face: 0, off: new THREE.Vector3(), lean: 0, squash: 1, swingK: 0, spin: 0, down: f.out && !f.fled ? 1 : 0, gone: f.out && (f.fled || side === 'foe') ? 1 : 0, flashT: 0, meshes, shadow, busy: 0, base: m.root.scale.x };
          // Monsters drop in from above when the fight starts.
          if (side === 'foe' && !f.out) {
            const act = a;
            act.off.y = 6;
            this.tween(0.55 + i * 0.12, (k) => (act.off.y = 6 * (1 - ease.in(k))), () => this.land(act));
          }
          this.actors.set(f.id, a);
        }
        a.f = f;
        a.home.set(x, 0, z);
        // Face the other side.
        const other = side === 'party' ? new THREE.Vector3(1.9, 0, -2.4) : new THREE.Vector3(-1.7, 0, 2.3);
        a.face = Math.atan2(other.x - x, other.z - z);
        if (!a.busy) {
          if (!f.out && a.down > 0 && side === 'party') this.tween(0.4, (k) => (a!.down = 1 - k)); // got back up
          if (f.out && f.fled) a.gone = 1;
        }
      });
    };
    place(party, 'party');
    place(foes, 'foe');
    this.aimId = aim;
  }

  private land(a: Actor) {
    a.squash = 0.6;
    this.tween(0.3, (k) => (a.squash = 0.6 + 0.4 * ease.back(k)));
    this.sparks.burst(a.home.clone().setY(0.2), 14, 0x9aa7c7, 3, { up: 1.5, gravity: 4, life: 0.5 });
    this.flashes.ring(a.home.clone().setY(0.05), 0xaab8e0, a.f.boss ? 4 : 2.4, 0.45);
    this.shake(a.f.boss ? 0.35 : 0.12);
  }

  // ------------------------------------------------------------------ playing a round
  /** Play one event big. Returns how long it takes (ms) before the next one should start. */
  play(e: LabEvent): number {
    const A = this.actors.get(e.actor);
    const B = e.target ? this.actors.get(e.target) : undefined;
    // 📜 An ultimate: a burst of the spell's colour on the caster, then every hit lands together.
    if (e.kind === 'spell' && A) {
      const c = new THREE.Color(e.color ?? '#ff922b').getHex();
      const at = this.chest(A);
      this.flashes.ball(at, c, 0.5, 2 * this.size(A), 0.7, true);
      this.flashes.ring(A.home.clone().setY(0.05), c, 3.5, 0.7);
      this.sparks.burst(at, 40, c, 3.5, { up: 3, gravity: -1, life: 0.7, spread: 1.6 });
      if (e.element) this.elementFx(A, e.element, c, 1.5);
      this.punch = 1.2;
      this.after(0.4, () => {
        this.punch = 2.2;
        this.shake(0.9);
        this.screenFlash(0.9);
        this.hitStop(0.12);
        const mid = new THREE.Vector3(0, 0.05, 0);
        this.flashes.ring(mid, c, 14, 0.6);
        this.flashes.ring(mid.clone().setY(1.5), 0xffffff, 10, 0.5);
        for (const f of this.actors.values()) if (f.f.side === 'foe' && !f.f.out) this.sparks.burst(this.chest(f), 40, c, 6, { up: 4, gravity: 4, life: 0.9, spread: 1.2 });
      });
      return 1150;
    }
    // 🔥 A burn ticking.
    if (e.kind === 'hit' && e.burn && B) {
      const at = this.chest(B);
      this.sparks.burst(at, 18, 0xff922b, 1.5, { up: 3, gravity: -2, life: 0.6, spread: 0.6 });
      this.sparks.burst(at, 8, 0xffe066, 1.2, { up: 2.5, gravity: -2, life: 0.4, spread: 0.4 });
      B.flashT = 0.08;
      this.popup(B, `${e.dmg ?? 0}`, 'hurt');
      return 380;
    }
    // 🌪️ A skill that hits everyone: a short charge (the hits follow).
    if (e.kind === 'cast' && A) {
      const c = new THREE.Color(e.color ?? '#63e6be').getHex();
      const at = this.chest(A);
      this.flashes.ball(at, c, 0.3, 1.5 * this.size(A), 0.4, true);
      this.flashes.ring(A.home.clone().setY(0.05), c, 3, 0.45);
      this.sparks.burst(at, 26, c, 3, { up: 1.5, gravity: 0, life: 0.45, spread: 1.2 });
      this.punch = 1;
      return 450;
    }
    if (e.kind === 'hit' && e.aoe && A && B) {
      const c = new THREE.Color(e.color ?? '#ff922b').getHex();
      this.impact(A, B, e, B.home.clone().sub(A.home).setY(0).normalize(), c);
      return e.spell ? 340 : 280;
    }
    if (e.kind === 'hit' && A && B) return this.attack(A, B, e);
    if (e.kind === 'guard' && A) {
      A.busy++;
      const at = this.chest(A);
      const stone = e.element === 'tanah';
      this.flashes.ball(at, stone ? 0xc08a5a : 0x4dabf7, 0.6, 1.25 * this.size(A), 0.7, true);
      this.flashes.ball(at, stone ? 0x8d6e4f : 0x1c7ed6, 0.5, 1.1 * this.size(A), 0.5);
      this.flashes.ring(A.home.clone().setY(0.05), stone ? 0xc08a5a : 0x74c0fc, 2.2, 0.5);
      this.sparks.burst(at, 18, stone ? 0xa47148 : 0x74c0fc, 2.5, { up: 1, gravity: stone ? 6 : 0, life: 0.5 });
      this.tween(0.5, (k) => (A.squash = 1 - Math.sin(k * Math.PI) * 0.15), () => A.busy--);
      return 500;
    }
    if (e.kind === 'faint' && A) {
      A.busy++;
      if (A.f.side === 'foe') {
        // Beaten: flash, wobble, then burst into smoke.
        this.tween(0.35, (k) => ((A.spin = Math.sin(k * 30) * 0.15), (A.flashT = k < 0.5 ? 0.05 : 0)), () => {
          const at = this.chest(A);
          this.sparks.burst(at, 40, 0x9775fa, 4, { up: 1.5, gravity: 1, life: 0.9, spread: 0.6 });
          this.sparks.burst(at, 20, 0xffffff, 6, { up: 2, gravity: 5, life: 0.5 });
          this.flashes.ring(A.home.clone().setY(0.05), 0xb197fc, A.f.boss ? 5 : 3, 0.6);
          this.tween(0.35, (k) => (A.gone = ease.in(k)), () => A.busy--);
          this.shake(A.f.boss ? 0.5 : 0.18);
        });
      } else {
        this.tween(0.5, (k) => (A.down = ease.back(k)), () => {
          this.sparks.burst(A.home.clone().setY(0.2), 16, 0x868e96, 2.5, { up: 1, gravity: 3, life: 0.5 });
          A.busy--;
        });
      }
      return 800;
    }
    if (e.kind === 'run' && A) {
      A.busy++;
      const away = A.f.side === 'party' ? -1 : 1;
      this.tween(0.15, (k) => (A.spin = k * Math.PI));
      this.tween(0.6, (k) => ((A.off.x = away * 9 * ease.in(k)), (A.off.y = Math.abs(Math.sin(k * 12)) * 0.2)), () => ((A.gone = 1), A.busy--));
      this.sparks.burst(A.home.clone().setY(0.2), 12, 0xadb5bd, 2, { up: 0.5, gravity: 2, life: 0.4 });
      return 700;
    }
    if (e.kind === 'runfail' && A) {
      A.busy++;
      this.tween(0.6, (k) => ((A.off.y = Math.sin(k * Math.PI) * 0.8), (A.spin = Math.sin(k * Math.PI * 2) * 0.4), (A.squash = k > 0.8 ? 0.75 : 1)), () => ((A.squash = 1), (A.spin = 0), A.busy--));
      this.popup(A, '!?', 'miss');
      return 650;
    }
    if (e.kind === 'item') {
      const T = B ?? A;
      if (!T) return 600;
      const at = this.chest(T);
      const color = e.revived ? 0xffd43b : 0x69db7c;
      this.sparks.burst(at, 34, color, 2.2, { up: 3, gravity: -1, life: 1, spread: 1 });
      this.flashes.ring(T.home.clone().setY(0.05), color, 2.6, 0.6);
      this.flashes.ball(at, color, 0.4, 1.2, 0.5);
      if (e.revived) this.tween(0.5, (k) => (T.down = 1 - ease.out(k)));
      this.popup(T, e.revived ? 'REVIVED!' : e.hp !== undefined ? '+HP' : '✓', 'heal');
      return 800;
    }
    if (e.kind === 'win') {
      for (const a of this.actors.values())
        if (a.f.side === 'party' && !a.f.out) this.tween(0.9, (k) => ((a.off.y = Math.abs(Math.sin(k * Math.PI * 2)) * 0.9), (a.spin = k * Math.PI * 2)), () => ((a.off.y = 0), (a.spin = 0)));
      for (const c of [0xff6b6b, 0xffd43b, 0x69db7c, 0x4dabf7, 0xda77f2]) this.sparks.burst(new THREE.Vector3(-1.7, 3.2, 2), 16, c, 5, { up: 3, gravity: 6, life: 1.2, spread: 2 });
      return 1000;
    }
    return 500;
  }

  private attack(A: Actor, B: Actor, e: LabEvent): number {
    A.busy++;
    const skill = !!e.skill, crit = !!e.crit;
    const party = A.f.side === 'party';
    const dir = B.home.clone().sub(A.home).setY(0).normalize();
    const reach = B.home.clone().sub(dir.clone().multiplyScalar(1.1 * this.size(B))).sub(A.home);
    const charge = skill ? 0.45 : 0;
    const color = party ? (skill ? (e.color ? new THREE.Color(e.color).getHex() : 0x4dabf7) : 0xffd43b) : skill ? 0xda77f2 : 0xff6b6b;
    if (skill) {
      // ⚡ Charge up: an aura, sparks spiralling in, the camera leans in.
      const at = this.chest(A);
      this.flashes.ball(at, color, 0.4, 2.6 * this.size(A), charge);
      this.flashes.ring(A.home.clone().setY(0.05), color, 4.5, charge);
      this.flashes.ring(A.home.clone().setY(0.05), 0xffffff, 3, charge * 0.8);
      this.sparks.burst(at, 50, color, 3.5, { up: 4, gravity: -3, life: charge + 0.1, spread: 1.6 });
      this.punch = 1.6;
      this.shake(0.15);
      this.tween(charge, (k) => ((A.lean = -0.35 * ease.out(k)), (A.squash = 1 - 0.18 * Math.sin(k * Math.PI)), (A.off.y = A.m.hover ? 0 : Math.sin(k * Math.PI) * 0.3)));
    }
    // Wind up (lean back, raise the weapon), lunge, strike, hold, back home.
    this.after(charge, () =>
      this.tween(0.16, (k) => ((A.swingK = 0.28 * k), (A.lean = -0.3 * k)), () =>
        this.tween(skill ? 0.13 : 0.16, (k) => {
          const q = ease.in(k);
          A.off.copy(reach).multiplyScalar(q);
          A.off.y = (A.m.hover ? 0.3 : skill ? Math.sin(k * Math.PI) * 1.2 : Math.sin(k * Math.PI) * 0.35);
          A.squash = 1 + 0.25 * Math.sin(k * Math.PI);
          A.lean = 0.35 * k;
        }, () =>
          this.tween(0.09, (k) => (A.swingK = 0.28 + 0.72 * k), () => {
            this.impact(A, B, e, dir, color);
            this.after(0.12, () =>
              this.tween(0.3, (k) => {
                const q = 1 - ease.out(k);
                A.off.copy(reach).multiplyScalar(q);
                A.off.y = Math.sin(k * Math.PI) * 0.25;
                A.swingK = q;
                A.lean = 0.35 * q;
              }, () => ((A.swingK = 0), (A.lean = 0), (A.squash = 1), A.busy--)),
            );
          }),
        ),
      ),
    );
    return (charge + 0.16 + 0.16 + 0.09 + 0.12 + 0.3) * 1000 + (crit || skill ? 220 : 120);
  }

  /** The hit lands: stop, flash, knock back, shake, sparks, slashes, the number. */
  private impact(A: Actor, B: Actor, e: LabEvent, dir: THREE.Vector3, color: number) {
    const skill = !!e.skill, crit = !!e.crit, blocked = !!e.blocked;
    const at = this.chest(B);
    const heavy = (e.dmg ?? 0) / Math.max(1, B.f.maxHp);
    this.hitStop(skill ? 0.17 : crit ? 0.14 : 0.08);
    B.flashT = 0.12;
    const kb = dir.clone().multiplyScalar(0.5 + heavy * 2 + (skill ? 0.6 : 0));
    this.tween(0.38, (k) => {
      const q = Math.sin(k * Math.PI) * (1 - k * 0.3);
      B.off.set(kb.x * q, B.m.hover ? q * 0.3 : 0, kb.z * q);
      B.squash = 1 - 0.3 * Math.sin(k * Math.PI);
      B.lean = -0.4 * Math.sin(k * Math.PI);
    }, () => ((B.off.set(0, 0, 0)), (B.squash = 1), (B.lean = 0)));
    this.shake(0.1 + heavy * 0.8 + (crit ? 0.18 : 0) + (skill ? 0.3 : 0));
    if (blocked) {
      this.flashes.ball(at, 0x74c0fc, 0.5, 1.1 * this.size(B), 0.3, true);
      this.sparks.burst(at, 24, 0x74c0fc, 5, { up: 1, gravity: 3, life: 0.4 });
    }
    const ult = !!e.spell;
    const n = ult ? 80 : skill ? 100 : crit ? 45 : 24;
    this.sparks.burst(at, n, crit ? 0xfff3bf : color, ult || skill ? 10 : 6, { up: 1.5, gravity: 7, life: ult || skill ? 0.85 : 0.6 });
    this.sparks.burst(at, Math.round(n / 3), 0xffffff, 9, { up: 1, gravity: 9, life: 0.3 });
    const s = this.size(B);
    this.flashes.slash(at, color, 1.3 * s, 0.6);
    if (crit || skill) this.flashes.slash(at, crit ? 0xfff3bf : 0xffffff, 1.6 * s, -1.1);
    if (skill || ult) {
      this.flashes.slash(at, color, 3.2 * s, 2.2);
      this.flashes.slash(at, 0xffffff, 3.8 * s, -0.4);
      this.flashes.ring(B.home.clone().setY(0.05), color, 8 * s, 0.7);
      this.flashes.ball(at, color, 0.5, (ult ? 3.2 : 2.6) * s, 0.4);
      this.screenFlash(ult ? 0.5 : 0.7);
      this.hitStop(0.22);
      this.punch = Math.max(this.punch, ult ? 1.8 : 2);
      this.shake(ult ? 0.5 : 0.6);
    } else if (crit) this.screenFlash(0.3);
    if (e.element) this.elementFx(B, e.element, color, ult ? 2.2 : skill ? 1.7 : 1);
    this.popup(B, `${blocked ? '🛡' : ''}${e.dmg ?? 0}`, skill ? 'skill' : crit ? 'crit' : blocked ? 'block' : A.f.side === 'party' ? 'hit' : 'hurt');
  }

  /** 🔥💧⚡🌪️🪨 What each element adds where it lands (same style, its own look). */
  private elementFx(B: Actor, element: string, color: number, big = 1) {
    const at = this.chest(B);
    const s = this.size(B) * big;
    const ground = B.home.clone().setY(0.05);
    const n = (k: number) => Math.round(k * big);
    /** A column of sparks shooting up from the ground (skills and ultimates). */
    const column = (c: number, k: number) => big > 1 && this.sparks.burst(ground, n(k), c, 1.2, { up: 9 * big, gravity: 2, life: 0.8, spread: 0.25 });
    if (element === 'api') {
      this.sparks.burst(at, n(30), 0xff922b, 2 * big, { up: 4 * big, gravity: -3, life: 0.7 + 0.15 * big, spread: 0.8 * big });
      this.sparks.burst(at, n(12), 0xffe066, 1.5 * big, { up: 3 * big, gravity: -2, life: 0.5 + 0.15 * big, spread: 0.5 * big });
      this.flashes.ball(at, 0xff6b00, 0.4, 1.3 * s, 0.3 + 0.1 * big);
      column(0xff6b00, 30);
    } else if (element === 'air') {
      this.sparks.burst(at, n(30), 0x74c0fc, 4 * big, { up: 4 * big, gravity: 12, life: 0.7 + 0.15 * big, spread: 0.6 * big });
      this.flashes.ring(ground, 0xa5d8ff, 3 * s, 0.5);
      if (big > 1) this.flashes.ring(ground, 0x4dabf7, 4.5 * s, 0.7);
      column(0x4dabf7, 26);
    } else if (element === 'petir') {
      this.flashes.slash(at.clone().setY(at.y + 1.2 * s), 0xfff3bf, 2.6 * s, Math.PI / 2);
      this.flashes.slash(at.clone().setY(at.y + 1.2 * s), color, 2.2 * s, Math.PI / 2 + 0.25);
      this.sparks.burst(at, n(24), 0xffe066, 7 * big, { up: 0.5, gravity: 2, life: 0.3 + 0.15 * big });
      column(0xfff3bf, 20);
      this.screenFlash(Math.min(0.8, 0.4 * big));
    } else if (element === 'angin') {
      const rings = big > 1 ? 4 : 2;
      for (let j = 0; j < rings; j++) this.flashes.ring(ground.clone().setY((0.5 + j * 0.6) * this.size(B)), j % 2 ? 0xc3fae8 : color, (2.6 - j * 0.3) * s, 0.45 + j * 0.05);
      this.sparks.burst(at, n(22), 0x96f2d7, 4.5 * big, { up: 1, gravity: -1, life: 0.6 + 0.15 * big, spread: 1.4 * big });
    } else if (element === 'tanah') {
      this.sparks.burst(ground, n(26), 0xa47148, 3.5 * big, { up: 5 * big, gravity: 16, life: 0.8 + 0.1 * big, spread: 0.8 * big });
      this.sparks.burst(ground, n(10), 0x5c3d2e, 2.5 * big, { up: 4 * big, gravity: 16, life: 0.7 + 0.1 * big });
      this.flashes.ring(ground, 0xc08a5a, 3.5 * s, 0.5);
      column(0xa47148, 22);
      this.shake(0.2 * big);
    } else if (element === 'fizikal') {
      // 👊 A punch: shock rings, dust off the ground, a jolt.
      for (let j = 0; j < (big > 1 ? 3 : 1); j++) this.flashes.ring(at, j % 2 ? 0xffffff : color, (1.2 + j * 0.8) * s, 0.3 + j * 0.08);
      this.sparks.burst(ground, n(16), 0xcbb89a, 3 * big, { up: 3 * big, gravity: 10, life: 0.6, spread: 0.8 * big });
      this.shake(0.25 * big);
    }
  }

  private chest(a: Actor) {
    return new THREE.Vector3(a.home.x + a.off.x, (a.m.hover ? 0.9 : 0) + a.m.height * 0.5 * a.m.root.scale.y + a.off.y, a.home.z + a.off.z);
  }

  private size(a: Actor) {
    return a.m.root.scale.x;
  }

  // ------------------------------------------------------------------ juice
  private tween(dur: number, step: (k: number) => void, done?: () => void) {
    step(0);
    this.tweens.push({ t: 0, dur, step, done });
  }

  private after(sec: number, fn: () => void) {
    if (sec <= 0) fn();
    else this.timers.push({ at: this.time + sec, fn });
  }

  private hitStop(sec: number) {
    this.stop = Math.max(this.stop, sec);
  }

  private shake(amp: number) {
    this.shakeAmp = Math.min(0.9, Math.max(this.shakeAmp, amp));
  }

  private screenFlash(alpha: number) {
    this.flashEl.style.transition = 'none';
    this.flashEl.style.opacity = String(alpha);
    void this.flashEl.offsetWidth;
    this.flashEl.style.transition = 'opacity 0.35s ease-out';
    this.flashEl.style.opacity = '0';
  }

  /** A big number (or word) that pops off a fighter. */
  private popup(a: Actor, text: string, kind: 'hit' | 'hurt' | 'crit' | 'skill' | 'block' | 'heal' | 'miss') {
    if (this.overlay.childElementCount > 10) this.overlay.firstElementChild?.remove();
    const p = this.chest(a).setY(a.m.height * a.m.root.scale.y + (a.m.hover ? 1.1 : 0.3));
    p.project(this.camera);
    const r = this.o.host.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = `b3-num ${kind}`;
    el.innerHTML = kind === 'crit' ? `<small>CRIT!</small>${text}` : kind === 'skill' ? `<small>SKILL!</small>${text}` : text;
    el.style.left = `${((p.x + 1) / 2) * r.width}px`;
    el.style.top = `${((1 - p.y) / 2) * r.height}px`;
    this.overlay.append(el);
    window.setTimeout(() => el.remove(), 1100);
  }

  // ------------------------------------------------------------------ frames
  private frame = () => {
    if (this.dead) return;
    const now = performance.now();
    // (__kh3dSlow: tests can slow the fight down to look at it.)
    const real = Math.min(0.1, (now - this.last) / 1000) * ((window as unknown as { __kh3dSlow?: number }).__kh3dSlow ?? 1);
    this.last = now;
    this.watchFps(now);
    // Hit-stop: the world nearly freezes for a beat on impact (the effects still play).
    let dt = real;
    if (this.stop > 0) {
      this.stop -= real;
      dt = real * 0.05;
    }
    this.time += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) if (this.timers[i].at <= this.time) this.timers.splice(i, 1)[0].fn();
    for (let i = 0; i < this.tweens.length; i++) {
      const tw = this.tweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.step(k);
      if (k >= 1) {
        this.tweens.splice(i--, 1);
        tw.done?.();
      }
    }
    const t = this.time;
    for (const a of this.actors.values()) this.pose(a, t, real);
    this.sparks.update(real);
    this.flashes.update(real);
    // Torches flicker; dust drifts.
    this.torches.forEach((l, i) => (l.intensity = 22 + Math.sin(t * 9 + i * 3) * 3 + Math.sin(t * 23 + i) * 2));
    this.flames.forEach((f, i) => (f.scale.y = 0.45 * (1 + Math.sin(t * 14 + i * 2) * 0.15)));
    if (this.dust) this.dust.rotation.y = t * 0.02;
    // The aim marker under the monster you're aiming at.
    const aimed = this.aimId ? this.actors.get(this.aimId) : undefined;
    this.aim.visible = !!aimed && !aimed.f.out && aimed.gone < 0.5;
    if (aimed && this.aim.visible) {
      const s = this.size(aimed);
      this.aim.position.set(aimed.home.x + aimed.off.x, 0.04, aimed.home.z + aimed.off.z);
      this.aim.scale.setScalar(s);
      this.aim.rotation.y = t * 1.5;
      const arrow = this.aim.getObjectByName('arrow')!;
      arrow.position.y = (aimed.m.height + (aimed.m.hover ? 1.2 : 0.4)) + Math.sin(t * 5) * 0.12;
    }
    // Camera: shake and a zoom punch on skills.
    this.shakeAmp *= Math.pow(0.02, real);
    this.punch *= Math.pow(0.08, real);
    const sx = (Math.random() - 0.5) * this.shakeAmp, sy = (Math.random() - 0.5) * this.shakeAmp;
    this.camera.position.set(this.camBase.x + sx, this.camBase.y + sy, this.camBase.z);
    this.camera.fov = this.fovBase * (1 - this.punch * 0.14);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.camLook);
    this.renderer.render(this.scene, this.camera);
  };

  private pose(a: Actor, t: number, real: number) {
    const m = a.m;
    const hoverY = m.hover && a.down < 0.5 ? 0.9 + Math.sin(t * 2.6 + a.home.x) * 0.15 : 0;
    m.root.position.set(a.home.x + a.off.x, hoverY + a.off.y, a.home.z + a.off.z);
    m.root.rotation.set(0, a.face + a.spin, 0);
    const breathe = a.busy ? 0 : Math.sin(t * 3 + a.home.x) * 0.03;
    const sq = a.squash + breathe;
    m.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    m.body.rotation.x = a.lean;
    // Fainted: tipped over on its side.
    m.body.rotation.z = a.down * 1.45;
    m.body.position.y = -a.down * 0.25;
    if (!a.busy) m.idle(t);
    m.swing(a.swingK);
    const vis = a.gone < 1;
    m.root.visible = vis;
    if (a.gone > 0 && vis) m.root.scale.setScalar(a.base * (1 - a.gone));
    a.shadow.visible = vis;
    a.shadow.position.set(m.root.position.x, 0.02, m.root.position.z);
    // Fake depth: the higher it is off the ground, the smaller and fainter its shadow.
    const lift = Math.max(0, m.root.position.y);
    const k = 1 / (1 + lift * 0.35);
    a.shadow.scale.set(1.5 * a.base * k * (1 - a.gone), 1.15 * a.base * k * (1 - a.gone), 1);
    (a.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.25, k);
    // The white flash when hit.
    if (a.flashT > 0) {
      a.flashT -= real;
      const on = a.flashT > 0;
      for (const mesh of a.meshes) mesh.material = on ? this.white : mesh.userData.mat;
    }
  }

  /** Keep 30 FPS: drop the sharpness and extras first, then give up on 3D. */
  private watchFps(now: number) {
    this.frames++;
    if (now - this.fpsStart < 2500) return (this.fpsT = now), void (this.frames = 0); // settle in first
    if (now - this.fpsT < 2000) return;
    const fps = (this.frames * 1000) / (now - this.fpsT);
    this.frames = 0;
    this.fpsT = now;
    if (document.hidden || (window as unknown as { __kh3dNoGuard?: boolean }).__kh3dNoGuard) return;
    if (fps >= 28) return void (this.slowStrikes = 0);
    if (!this.degraded) {
      this.degraded = true;
      this.renderer.setPixelRatio(Math.max(0.6, this.renderer.getPixelRatio() * 0.6));
      if (this.dust) this.dust.visible = false;
      for (const l of this.torches.slice(1)) l.visible = false;
      this.resize();
      return;
    }
    if (++this.slowStrikes >= 2) this.o.onSlow();
  }

  private resize() {
    const r = this.o.host.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Fit both teams (about 9 units across), further back on a tall phone screen; from the side a
    // little, so you see your fighter's profile rather than the back of their head.
    const hfov = 2 * Math.atan(Math.tan((this.fovBase * Math.PI) / 360) * aspect);
    const dist = Math.min(15, Math.max(10, (aspect < 1 ? 4.2 : 5.8) / Math.tan(hfov / 2)));
    // Thinner fog when the camera is further back (a phone held upright), so it isn't all murk.
    (this.scene.fog as THREE.FogExp2).density = (this.o.quality === 'low' ? 0.06 : 0.05) * (10 / dist);
    this.camBase.set(-dist * 0.42, 1.6 + dist * 0.3, 1.2 + dist * 0.85);
    this.camera.updateProjectionMatrix();
  }

  private onTap = (ev: PointerEvent) => {
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(p, this.camera);
    let best: { id: string; d: number } | null = null;
    for (const [id, a] of this.actors) {
      if (a.f.side !== 'foe' || a.f.out) continue;
      const hit = this.ray.intersectObject(a.m.root, true)[0];
      if (hit && (!best || hit.distance < best.d)) best = { id, d: hit.distance };
    }
    if (best) this.o.onAim(best.id);
  };

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onTap);
    this.flashes.dispose();
    this.sparks.points.geometry.dispose();
    (this.sparks.points.material as THREE.Material).dispose();
    for (const x of this.own) x.dispose();
    for (const t of this.tex) t.dispose();
    this.white.dispose();
    disposeKit();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.overlay.remove();
    this.flashEl.remove();
    this.actors.clear();
  }
}

const DEFAULT_LOOK: Look = { skin: '#f1c27d', hair: '#3b2a20', top: '#4dabf7', bottom: '#343a40', shoes: '#212529', eyes: '#3b2a20' };
