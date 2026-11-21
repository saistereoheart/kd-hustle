// ⚔️ 3D fight: the big, exaggerated effects. Spark / smoke bursts from one fixed-size particle pool
// (no new objects mid-fight), slash arcs, shockwave rings, an aura, a shield bubble. Each has a hard
// cap, so a busy round never costs more than a quiet one on a weak device.
import * as THREE from 'three';

/** A soft round dot (for particles and glows), made once per fight. */
export function dotTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: number;
  private next = 0;
  private gravity: Float32Array;

  constructor(scene: THREE.Scene, max: number, tex: THREE.Texture, size: number) {
    this.max = max;
    this.pos = new Float32Array(max * 3).fill(-999);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.gravity = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.PointsMaterial({ size, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** `n` particles from `at`, flying out at `speed` (plus `up`), falling with `gravity`. */
  burst(at: THREE.Vector3, n: number, color: number, speed: number, o: { up?: number; gravity?: number; life?: number; spread?: number } = {}) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * Math.PI * 0.6;
      const s = speed * (0.4 + Math.random() * 0.8);
      const sp = o.spread ?? 0.15;
      this.pos[i * 3] = at.x + (Math.random() - 0.5) * sp;
      this.pos[i * 3 + 1] = at.y + (Math.random() - 0.5) * sp;
      this.pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * sp;
      this.vel[i * 3] = Math.cos(a) * Math.cos(e) * s;
      this.vel[i * 3 + 1] = Math.sin(e) * s + (o.up ?? 0);
      this.vel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * s;
      const tint = 0.8 + Math.random() * 0.4;
      this.col[i * 3] = c.r * tint;
      this.col[i * 3 + 1] = c.g * tint;
      this.col[i * 3 + 2] = c.b * tint;
      this.life[i] = (o.life ?? 0.7) * (0.6 + Math.random() * 0.6);
      this.gravity[i] = o.gravity ?? 6;
    }
  }

  update(dt: number) {
    let live = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      live = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -999;
        continue;
      }
      this.vel[i * 3 + 1] -= this.gravity[i] * dt;
      const drag = 1 - 1.8 * dt;
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      // Fade out at the end of life (colour towards black = invisible when added).
      if (this.life[i] < 0.2) {
        const f = 0.85;
        this.col[i * 3] *= f;
        this.col[i * 3 + 1] *= f;
        this.col[i * 3 + 2] *= f;
      }
    }
    if (live) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
  }
}

/** Short-lived meshes (slash arcs, rings, auras): grow, spin and fade, then hide. */
interface Flash {
  mesh: THREE.Mesh;
  t: number;
  dur: number;
  from: number;
  to: number;
  spin: number;
  face: boolean;
  /** Roll (for camera-facing ones). */
  ang: number;
}

export class Flashes {
  private pool: Flash[] = [];
  private live: Flash[] = [];
  private arcGeo = new THREE.RingGeometry(0.75, 1.15, 28, 1, 0, Math.PI * 1.25);
  private ringGeo = new THREE.RingGeometry(0.85, 1, 40);
  private ballGeo = new THREE.IcosahedronGeometry(1, 2);

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, private max: number) {}

  private take(geo: THREE.BufferGeometry): Flash | null {
    if (this.live.length >= this.max) return null;
    const f = this.pool.pop() ?? {
      mesh: new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })),
      t: 0, dur: 0, from: 0, to: 0, spin: 0, face: false, ang: 0,
    };
    f.mesh.geometry = geo;
    f.mesh.visible = true;
    f.mesh.rotation.set(0, 0, 0);
    this.scene.add(f.mesh);
    this.live.push(f);
    return f;
  }

  private start(f: Flash, at: THREE.Vector3, color: number, dur: number, from: number, to: number, spin: number, face: boolean, wire = false) {
    f.mesh.position.copy(at);
    (f.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    (f.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
    (f.mesh.material as THREE.MeshBasicMaterial).wireframe = wire;
    Object.assign(f, { t: 0, dur, from, to, spin, face, ang: 0 });
    f.mesh.scale.setScalar(from);
  }

  /** A big crescent slash, facing the camera, at an angle. */
  slash(at: THREE.Vector3, color: number, size = 1.4, angle = 0) {
    const f = this.take(this.arcGeo);
    if (!f) return;
    this.start(f, at, color, 0.32, size * 0.5, size * 1.6, 9, true);
    f.ang = angle;
  }

  /** A shockwave ring flat on the ground. */
  ring(at: THREE.Vector3, color: number, size = 3, dur = 0.5) {
    const f = this.take(this.ringGeo);
    if (!f) return;
    this.start(f, at, color, dur, 0.3, size, 0, false);
    f.mesh.rotation.x = -Math.PI / 2;
  }

  /** A glowing ball (a charge-up aura, a shield bubble when `wire`). */
  ball(at: THREE.Vector3, color: number, from: number, to: number, dur: number, wire = false) {
    const f = this.take(this.ballGeo);
    if (!f) return;
    this.start(f, at, color, dur, from, to, 2, false, wire);
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const e = 1 - Math.pow(1 - k, 3);
      f.mesh.scale.setScalar(f.from + (f.to - f.from) * e);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k * k;
      if (f.face) {
        f.ang += f.spin * dt;
        f.mesh.quaternion.copy(this.camera.quaternion);
        f.mesh.rotateZ(f.ang);
      } else f.mesh.rotation.y += f.spin * dt;
      if (k >= 1) {
        f.mesh.visible = false;
        this.scene.remove(f.mesh);
        this.live.splice(i, 1);
        this.pool.push(f);
      }
    }
  }

  dispose() {
    for (const f of [...this.pool, ...this.live]) (f.mesh.material as THREE.Material).dispose();
    this.arcGeo.dispose();
    this.ringGeo.dispose();
    this.ballGeo.dispose();
  }
}
