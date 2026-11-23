// ⚔️ 3D fight: the fighters, built in code from simple shapes (chibi, a bit silly rather than
// scary). Every model faces +z, has a `body` that the stage bobs / squashes, and its own idle motion
// (wings flap, legs scuttle, flames flicker) plus a `swing` pose for its attack (0 → 1).
import * as THREE from 'three';
import { G, add, eye, mat, part } from './kit';
import { clothTex, faceTex, furTex, hairTex, scaleTex, skinTex, softTex, stoneTex, wrapTex } from './paint';

export interface Model {
  root: THREE.Group;
  body: THREE.Group;
  /** Top of the model (for effects and the aim marker). */
  height: number;
  /** Floats in the air (bats, ghosts, flames): no feet on the ground. */
  hover: boolean;
  idle(t: number): void;
  swing(k: number): void;
}

export interface Look {
  skin: string;
  hair: string;
  top: string;
  bottom: string;
  shoes: string;
  eyes: string;
  /** ⚔️ Labirin gear tier colours: no weapon = bare fists, no shield = none. Undefined = both (old callers). */
  weapon?: string | null;
  shield?: string | null;
}

function base(height: number, hover = false): Model & { parts: Record<string, THREE.Object3D> } {
  const root = new THREE.Group();
  const body = part(root);
  return { root, body, height, hover, parts: {}, idle: () => {}, swing: () => {} };
}

// ------------------------------------------------------------------ players: chibi you
export function playerModel(look: Look): Model {
  const m = base(2.1);
  const b = m.body;
  const skin = mat(look.skin, { map: skinTex(look.skin) });
  const top = mat(look.top, { map: clothTex(look.top, 'top') });
  const bottom = mat(look.bottom, { map: clothTex(look.bottom, 'bottom') });
  const shoes = mat(look.shoes, { map: softTex(new THREE.Color(look.shoes).getHex()) });
  const hair = mat(look.hair, { map: hairTex(look.hair) });
  // Legs and shoes (a sole and a lighter toe cap).
  const legL = part(b, [-0.2, 0.55, 0]);
  const legR = part(b, [0.2, 0.55, 0]);
  for (const leg of [legL, legR]) {
    add(leg, G.capsule(), bottom, [0, -0.22, 0], [0.32, 0.45, 0.32]);
    add(leg, G.sphere(), shoes, [0, -0.5, 0.06], [0.2, 0.12, 0.27]);
    add(leg, G.box(), 0x1b1b1b, [0, -0.6, 0.06], [0.34, 0.04, 0.5]);
  }
  // Body (a belt line), neck, arms in sleeves with hands.
  add(b, G.capsule(), top, [0, 0.95, 0], [0.75, 0.6, 0.55]);
  add(b, G.torus(), mat(new THREE.Color(look.top).offsetHSL(0, 0, -0.2).getHex()), [0, 0.68, 0], [0.36, 0.3, 0.2], [Math.PI / 2, 0, 0]);
  add(b, G.cyl(), skin, [0, 1.32, 0], [0.13, 0.16, 0.13]);
  const armL = part(b, [-0.42, 1.15, 0]);
  const armR = part(b, [0.42, 1.15, 0]);
  for (const arm of [armL, armR]) {
    add(arm, G.capsule(), top, [0, -0.15, 0], [0.25, 0.3, 0.25]);
    add(arm, G.capsule(), skin, [0, -0.38, 0], [0.18, 0.22, 0.18]);
    add(arm, G.sphere(), skin, [0, -0.5, 0], 0.12);
  }
  // The keris (a gold-hilted blade with a blue sheen) in the right hand, a round shield on the left.
  if (look.weapon !== null) {
    const blade = part(armR, [0, -0.5, 0.05], [Math.PI / 2.4, 0, 0]);
    add(blade, G.cyl(), 0x6b3f1d, [0, 0, 0], [0.05, 0.25, 0.05]);
    add(blade, G.box(), mat(0xffd43b, { emissive: 0x7a5b00, glow: 0.4 }), [0, 0.14, 0], [0.22, 0.05, 0.08]);
    const edge = look.weapon ? new THREE.Color(look.weapon).getHex() : 0xdee2e6;
    add(blade, G.cone(), mat(edge, { emissive: 0x3b5bdb, glow: 0.3 }), [0, 0.55, 0], [0.07, 0.8, 0.03]);
  } else {
    // 👊 Bare fists: a bigger hand wrapped in white tape.
    add(armR, G.sphere(), 0xf1f3f5, [0, -0.5, 0], [0.15, 0.13, 0.15]);
  }
  if (look.shield !== null) {
    const rim = look.shield ? new THREE.Color(look.shield).getHex() : 0x8d6e3f;
    add(armL, G.cyl(), mat(rim, { map: stoneTex(rim) }), [-0.08, -0.4, 0.12], [0.3, 0.05, 0.3], [Math.PI / 2, 0, 0.3]);
    add(armL, G.sphere(), 0xced4da, [-0.08, -0.4, 0.16], [0.08, 0.08, 0.04]);
  }
  // The big chibi head: a painted face (irises, lashes, brows, blush), ears, hair.
  const head = part(b, [0, 1.62, 0]);
  add(head, G.sphere(), mat(look.skin, { map: faceTex(look.skin, look.eyes, look.hair) }), [0, 0, 0], [0.55, 0.52, 0.5]);
  add(head, G.sphere(), skin, [-0.53, -0.02, 0], [0.08, 0.12, 0.06]);
  add(head, G.sphere(), skin, [0.53, -0.02, 0], [0.08, 0.12, 0.06]);
  // Hair: a strand-painted cap, then locks (each a tapered strand clump) round the fringe, sides and back.
  add(head, G.sphere(), hair, [0, 0.12, -0.04], [0.59, 0.5, 0.56]);
  const lock = (pos: [number, number, number], len: number, rot: [number, number, number], w = 0.11) => add(head, G.cone(), hair, pos, [w, len, w * 0.45], rot);
  for (let i = 0; i < 7; i++) {
    const a = -0.9 + (i / 6) * 1.8; // across the forehead
    lock([Math.sin(a) * 0.42, 0.26, Math.cos(a) * 0.42], 0.34 + (i % 2) * 0.08, [Math.PI - 0.5, a, (i - 3) * 0.08]);
  }
  for (let i = 0; i < 6; i++) {
    const a = Math.PI * 0.55 + (i / 5) * Math.PI * 0.9; // round the back
    lock([Math.sin(a) * 0.5, -0.05, Math.cos(a) * 0.48], 0.5 + (i % 2) * 0.12, [Math.PI + 0.25, a, 0], 0.14);
  }
  for (const sx of [-1, 1]) lock([sx * 0.5, -0.02, 0.18], 0.45, [Math.PI, 0, sx * -0.15], 0.1);
  add(head, G.cone(), hair, [0.05, 0.6, -0.05], [0.07, 0.25, 0.04], [0.3, 0, -0.4]); // a stray tuft
  m.idle = (t) => {
    const s = Math.sin(t * 2.4);
    head.rotation.z = s * 0.04;
    armL.rotation.x = s * 0.08;
    armR.rotation.x = -0.25 + s * 0.06;
  };
  m.swing = (k) => {
    // Raise the blade, then slash down across.
    armR.rotation.x = -0.25 - Math.sin(k * Math.PI) * 2.4;
    armR.rotation.z = Math.sin(k * Math.PI) * 0.5;
    legL.rotation.x = Math.sin(k * Math.PI) * 0.5;
    legR.rotation.x = -Math.sin(k * Math.PI) * 0.5;
  };
  return m;
}

// ------------------------------------------------------------------ monsters
type Builder = (c: number) => Model;

const rat: Builder = (c) => {
  const C = mat(c, { map: furTex(c) });
  const m = base(1.2);
  const b = m.body;
  add(b, G.sphere(), C, [0, 0.55, 0], [0.62, 0.5, 0.8]);
  add(b, G.sphere(), new THREE.Color(c).offsetHSL(0, 0, 0.15).getHex(), [0, 0.45, 0.25], [0.45, 0.35, 0.5]);
  const head = part(b, [0, 0.75, 0.7]);
  add(head, G.sphere(), C, [0, 0, 0], [0.38, 0.34, 0.4]);
  add(head, G.cone(), C, [0, -0.04, 0.36], [0.2, 0.4, 0.2], [Math.PI / 2, 0, 0]);
  add(head, G.sphere(), 0xff8fab, [0, -0.04, 0.58], 0.07);
  eye(head, [-0.17, 0.1, 0.27], 0.09, 0x111111);
  eye(head, [0.17, 0.1, 0.27], 0.09, 0x111111);
  for (const s of [-1, 1]) {
    add(head, G.sphere(), C, [s * 0.28, 0.32, -0.05], [0.18, 0.2, 0.06]);
    add(head, G.sphere(), 0xff8fab, [s * 0.28, 0.32, -0.02], [0.12, 0.14, 0.04]);
    add(b, G.sphere(), 0xffc9de, [s * 0.3, 0.12, 0.45], [0.12, 0.08, 0.16]);
    add(b, G.sphere(), 0xffc9de, [s * 0.32, 0.12, -0.4], [0.12, 0.08, 0.16]);
  }
  const tail = part(b, [0, 0.5, -0.75]);
  const segs: THREE.Object3D[] = [];
  let p: THREE.Object3D = tail;
  for (let i = 0; i < 5; i++) {
    const s = part(p, [0, 0.05, -0.18]);
    add(s, G.sphere(), 0xff8fab, [0, 0, 0], 0.06);
    segs.push(s);
    p = s;
  }
  m.idle = (t) => {
    segs.forEach((s, i) => (s.rotation.y = Math.sin(t * 5 + i) * 0.35));
    head.rotation.x = Math.sin(t * 7) * 0.05;
  };
  m.swing = (k) => (head.rotation.x = -Math.sin(k * Math.PI) * 0.7);
  return m;
};

const bat: Builder = (c) => {
  const C = mat(c, { map: furTex(c) });
  const m = base(1.6, true);
  const b = m.body;
  add(b, G.sphere(), C, [0, 1.2, 0], [0.4, 0.42, 0.36]);
  eye(b, [-0.14, 1.3, 0.3], 0.08, 0xc92a2a, 0xffe066);
  eye(b, [0.14, 1.3, 0.3], 0.08, 0xc92a2a, 0xffe066);
  add(b, G.cone(), 0xffffff, [-0.07, 1.05, 0.32], [0.03, 0.1, 0.03], [Math.PI, 0, 0]);
  add(b, G.cone(), 0xffffff, [0.07, 1.05, 0.32], [0.03, 0.1, 0.03], [Math.PI, 0, 0]);
  add(b, G.cone(), C, [-0.2, 1.62, 0], [0.12, 0.35, 0.1]);
  add(b, G.cone(), C, [0.2, 1.62, 0], [0.12, 0.35, 0.1]);
  const wl = part(b, [-0.3, 1.25, 0]);
  const wr = part(b, [0.3, 1.25, 0]);
  const wm = mat(new THREE.Color(c).offsetHSL(0, 0, -0.08).getHex());
  add(wl, G.wing(), wm, [0, 0, 0], [1.3, 1.1, 1], [0, Math.PI, 0]);
  add(wr, G.wing(), wm, [0, 0, 0], [1.3, 1.1, 1]);
  m.idle = (t) => {
    const f = Math.sin(t * 14) * 0.9;
    wl.rotation.y = -f;
    wr.rotation.y = f;
  };
  m.swing = (k) => (b.rotation.x = Math.sin(k * Math.PI) * 0.8);
  return m;
};

const snail: Builder = (c) => {
  const C = mat(c, { map: stoneTex(c) });
  const m = base(1.3);
  const b = m.body;
  add(b, G.capsule(), 0xc0a98e, [0, 0.25, 0.1], [0.5, 1.1, 0.45], [Math.PI / 2, 0, 0]);
  const shell = part(b, [0, 0.75, -0.15]);
  add(shell, G.sphere(), C, [0, 0, 0], [0.32, 0.6, 0.6]);
  add(shell, G.torus(), new THREE.Color(c).offsetHSL(0, 0, -0.12).getHex(), [0.3, 0, 0], [0.38, 0.38, 0.5], [0, Math.PI / 2, 0]);
  add(shell, G.torus(), new THREE.Color(c).offsetHSL(0, 0, -0.18).getHex(), [0.34, 0, 0], [0.2, 0.2, 0.4], [0, Math.PI / 2, 0]);
  const stalks: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const st = part(b, [s * 0.15, 0.45, 0.62]);
    add(st, G.cyl(), 0xc0a98e, [0, 0.2, 0], [0.04, 0.4, 0.04]);
    eye(st, [0, 0.43, 0], 0.09);
    stalks.push(st);
  }
  m.idle = (t) => stalks.forEach((s, i) => (s.rotation.z = Math.sin(t * 2 + i * 2) * 0.25));
  m.swing = (k) => (shell.rotation.x = Math.sin(k * Math.PI) * 0.6);
  return m;
};

const spider: Builder = (c) => {
  const C = mat(c, { map: furTex(c) });
  const m = base(1.2);
  const b = m.body;
  add(b, G.sphere(), C, [0, 0.65, -0.35], [0.55, 0.5, 0.6]);
  add(b, G.sphere(), new THREE.Color(c).offsetHSL(0, 0, 0.08).getHex(), [0, 0.6, 0.25], [0.36, 0.3, 0.36]);
  for (const [x, y] of [[-0.12, 0.72], [0.12, 0.72], [-0.2, 0.62], [0.2, 0.62]]) eye(b, [x, y, 0.55], 0.06, 0xc92a2a, 0xffe066);
  const legs: THREE.Object3D[] = [];
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? -1 : 1;
    const k = i % 4;
    const leg = part(b, [side * 0.25, 0.62, 0.35 - k * 0.22], [0, 0, side * 0.9]);
    const upper = part(leg);
    add(upper, G.cyl(), 0x5c3d2e, [0, 0.3, 0], [0.05, 0.6, 0.05]);
    const lower = part(upper, [0, 0.6, 0], [0, 0, -side * 2.1]);
    add(lower, G.cyl(), 0x7a5230, [0, 0.35, 0], [0.04, 0.7, 0.04]);
    leg.rotation.y = side * (k - 1.5) * 0.35;
    legs.push(leg);
  }
  m.idle = (t) => legs.forEach((l, i) => (l.rotation.x = Math.sin(t * 8 + i) * 0.12));
  m.swing = (k) => {
    legs[0].rotation.z = -0.9 - Math.sin(k * Math.PI) * 0.9;
    legs[4].rotation.z = 0.9 + Math.sin(k * Math.PI) * 0.9;
  };
  return m;
};

const worm: Builder = (c) => {
  const C = mat(c, { map: softTex(c) });
  const m = base(1.9);
  const b = m.body;
  const segs: THREE.Object3D[] = [];
  let p: THREE.Object3D = part(b, [0, 0.25, 0]);
  for (let i = 0; i < 7; i++) {
    const s = part(p, [0, i ? 0.27 : 0, 0]);
    add(s, G.sphere(), new THREE.Color(c).offsetHSL(0, 0, (i % 2) * 0.06).getHex(), [0, 0, 0], 0.36 - i * 0.02);
    segs.push(s);
    p = s;
  }
  const head = segs[segs.length - 1];
  add(head, G.torus(), 0x862e9c, [0, 0.05, 0.22], [0.16, 0.16, 0.2]);
  add(head, G.sphere(), 0x2b0a3d, [0, 0.05, 0.25], [0.12, 0.12, 0.05]);
  eye(head, [-0.14, 0.2, 0.2], 0.07);
  eye(head, [0.14, 0.2, 0.2], 0.07);
  m.idle = (t) => segs.forEach((s, i) => ((s.rotation.z = Math.sin(t * 3 + i * 0.7) * 0.12), (s.rotation.x = Math.cos(t * 2.5 + i * 0.6) * 0.08)));
  m.swing = (k) => segs.forEach((s, i) => (s.rotation.x = Math.sin(k * Math.PI) * 0.18 * (i / 6)));
  return m;
};

const golem: Builder = (c) => {
  const m = base(2.0);
  const b = m.body;
  const crystal = mat(c, { emissive: c, glow: 0.35, flat: true });
  const stone = mat(0x6c757d, { flat: true });
  add(b, G.rock(), stone, [0, 0.95, 0], [0.62, 0.62, 0.5]);
  add(b, G.rock(), stone, [0, 1.6, 0.05], [0.34, 0.3, 0.3]);
  eye(b, [-0.12, 1.64, 0.3], 0.06, 0x111111, c);
  eye(b, [0.12, 1.64, 0.3], 0.06, 0x111111, c);
  for (const [x, y, s] of [[-0.3, 1.35, 0.25], [0.15, 1.45, 0.3], [0.38, 1.2, 0.2], [0, 1.9, 0.18]] as const) add(b, G.octa(), crystal, [x, y, -0.15], [s * 0.6, s * 1.4, s * 0.6], [0, 0, x]);
  const armL = part(b, [-0.72, 1.2, 0]);
  const armR = part(b, [0.72, 1.2, 0]);
  add(armL, G.rock(), stone, [0, -0.35, 0], [0.26, 0.42, 0.26]);
  add(armR, G.rock(), stone, [0, -0.35, 0], [0.26, 0.42, 0.26]);
  add(armL, G.octa(), crystal, [0, -0.8, 0], 0.22);
  add(armR, G.octa(), crystal, [0, -0.8, 0], 0.22);
  add(b, G.rock(), stone, [-0.28, 0.3, 0], [0.24, 0.32, 0.24]);
  add(b, G.rock(), stone, [0.28, 0.3, 0], [0.24, 0.32, 0.24]);
  m.idle = (t) => ((armL.rotation.x = Math.sin(t * 1.5) * 0.1), (armR.rotation.x = -Math.sin(t * 1.5) * 0.1));
  m.swing = (k) => ((armR.rotation.x = -Math.sin(k * Math.PI) * 2.6), (armL.rotation.x = -Math.sin(k * Math.PI) * 2.6));
  return m;
};

const cricket: Builder = (c) => {
  const C = mat(c, { map: softTex(c) });
  const m = base(1.2);
  const b = m.body;
  add(b, G.capsule(), C, [0, 0.55, -0.1], [0.42, 0.9, 0.42], [Math.PI / 2, 0, 0]);
  add(b, G.sphere(), C, [0, 0.72, 0.45], [0.3, 0.3, 0.28]);
  eye(b, [-0.16, 0.82, 0.6], 0.09, 0x111111, 0xffe066);
  eye(b, [0.16, 0.82, 0.6], 0.09, 0x111111, 0xffe066);
  const ants: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const a = part(b, [s * 0.1, 0.95, 0.55], [-0.6, 0, s * 0.3]);
    add(a, G.cyl(), 0x2b8a3e, [0, 0.45, 0], [0.015, 0.9, 0.015]);
    ants.push(a);
    const leg = part(b, [s * 0.3, 0.55, -0.35], [0, 0, s * 0.4]);
    add(leg, G.cyl(), new THREE.Color(c).offsetHSL(0, 0, -0.1).getHex(), [0, 0.3, -0.1], [0.06, 0.7, 0.06], [-0.9, 0, 0]);
    add(b, G.cyl(), 0x2b8a3e, [s * 0.25, 0.3, 0.25], [0.04, 0.5, 0.04], [0.3, 0, s * 0.4]);
    add(b, G.wing(), mat(0xd3f9d8, { opacity: 0.55 }), [s * 0.05, 0.8, 0], [0.6, 0.4, 1], [Math.PI / 2, s > 0 ? 0 : Math.PI, -Math.PI / 2]);
  }
  m.idle = (t) => ants.forEach((a, i) => (a.rotation.z = (i ? 1 : -1) * 0.3 + Math.sin(t * 9 + i) * 0.2));
  m.swing = (k) => (b.rotation.x = -Math.sin(k * Math.PI) * 0.5);
  return m;
};

const flame: Builder = (c) => {
  const m = base(1.8, true);
  const b = m.body;
  const core = mat(0xfff3bf, { emissive: 0xffd43b, glow: 1 });
  const mid = mat(c, { emissive: c, glow: 0.9 });
  const out = mat(0xe8590c, { emissive: 0xe8590c, glow: 0.8, opacity: 0.8 });
  const tongues: THREE.Mesh[] = [];
  tongues.push(add(b, G.cone(), out, [0, 1.0, 0], [0.6, 1.4, 0.6]));
  tongues.push(add(b, G.cone(), mid, [0, 0.95, 0.05], [0.42, 1.1, 0.42]));
  tongues.push(add(b, G.cone(), core, [0, 0.8, 0.1], [0.24, 0.7, 0.24]));
  add(b, G.sphere(), out, [0, 0.55, 0], [0.6, 0.45, 0.6]);
  eye(b, [-0.14, 0.85, 0.42], 0.08, 0x111111, 0xfff3bf);
  eye(b, [0.14, 0.85, 0.42], 0.08, 0x111111, 0xfff3bf);
  m.idle = (t) => tongues.forEach((x, i) => ((x.scale.y = (1.4 - i * 0.3) * (1 + Math.sin(t * 11 + i * 2) * 0.12)), (x.rotation.z = Math.sin(t * 7 + i) * 0.08)));
  m.swing = (k) => b.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.35);
  return m;
};

const lizard: Builder = (c) => {
  const C = mat(c, { map: scaleTex(c) });
  const m = base(1.0);
  const b = m.body;
  add(b, G.capsule(), C, [0, 0.4, 0], [0.5, 1.1, 0.42], [Math.PI / 2, 0, 0]);
  const head = part(b, [0, 0.5, 0.75]);
  add(head, G.sphere(), C, [0, 0, 0], [0.3, 0.22, 0.38]);
  eye(head, [-0.17, 0.12, 0.12], 0.08, 0x111111, 0xffe066);
  eye(head, [0.17, 0.12, 0.12], 0.08, 0x111111, 0xffe066);
  const glow = mat(0xff922b, { emissive: 0xff6b00, glow: 1 });
  for (let i = 0; i < 4; i++) add(b, G.sphere(), glow, [(i % 2 ? 0.12 : -0.12), 0.62, 0.35 - i * 0.25], 0.07);
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const l = part(b, [x * 0.3, 0.32, z * 0.38]);
    add(l, G.capsule(), C, [x * 0.1, -0.12, 0], [0.13, 0.3, 0.13], [0, 0, x * 0.8]);
    legs.push(l);
  }
  const tail = part(b, [0, 0.4, -0.7]);
  add(tail, G.cone(), C, [0, 0, -0.4], [0.18, 0.9, 0.18], [-Math.PI / 2, 0, 0]);
  m.idle = (t) => {
    tail.rotation.y = Math.sin(t * 3) * 0.4;
    legs.forEach((l, i) => (l.rotation.x = Math.sin(t * 6 + i * Math.PI) * 0.15));
  };
  m.swing = (k) => (head.rotation.x = -Math.sin(k * Math.PI) * 0.6);
  return m;
};

const ghost: Builder = (c) => {
  const C = mat(c, { map: softTex(c) });
  const m = base(1.9, true);
  const b = m.body;
  const cloth = mat(c, { opacity: 0.92, map: softTex(c) });
  add(b, G.sphere(), cloth, [0, 1.3, 0], [0.5, 0.55, 0.48]);
  add(b, G.cone(), cloth, [0, 0.62, 0], [0.55, 1.1, 0.52], [Math.PI, 0, 0]);
  add(b, G.sphere(), 0x111111, [-0.16, 1.34, 0.42], [0.09, 0.13, 0.05]);
  add(b, G.sphere(), 0x111111, [0.16, 1.34, 0.42], [0.09, 0.13, 0.05]);
  add(b, G.sphere(), 0x111111, [0, 1.1, 0.45], [0.1, 0.12, 0.05]);
  const armL = part(b, [-0.42, 1.05, 0.1]);
  const armR = part(b, [0.42, 1.05, 0.1]);
  add(armL, G.capsule(), cloth, [0, -0.1, 0.18], [0.16, 0.35, 0.16], [1.2, 0, 0]);
  add(armR, G.capsule(), cloth, [0, -0.1, 0.18], [0.16, 0.35, 0.16], [1.2, 0, 0]);
  m.idle = (t) => ((armL.rotation.z = Math.sin(t * 2) * 0.2), (armR.rotation.z = -Math.sin(t * 2) * 0.2));
  m.swing = (k) => ((armL.rotation.x = -Math.sin(k * Math.PI) * 0.8), (armR.rotation.x = -Math.sin(k * Math.PI) * 0.8));
  return m;
};

const pocong: Builder = (c) => {
  const C = mat(c, { map: wrapTex(c) });
  const m = base(1.9);
  const b = m.body;
  const cloth = mat(c, { map: wrapTex(c) });
  add(b, G.capsule(), cloth, [0, 0.9, 0], [0.62, 1.25, 0.55]);
  add(b, G.sphere(), 0xf1e3c6, [0, 1.35, 0.25], [0.26, 0.24, 0.1]);
  eye(b, [-0.09, 1.38, 0.33], 0.05, 0xc92a2a);
  eye(b, [0.09, 1.38, 0.33], 0.05, 0xc92a2a);
  for (const y of [0.45, 0.85, 1.15]) add(b, G.torus(), 0xced4da, [0, y, 0], [0.3, 0.3, 0.3], [Math.PI / 2, 0, 0]);
  add(b, G.sphere(), cloth, [0, 1.82, 0], [0.12, 0.14, 0.12]);
  add(b, G.cone(), cloth, [-0.08, 1.98, 0], [0.06, 0.2, 0.06], [0, 0, 0.5]);
  add(b, G.cone(), cloth, [0.08, 1.98, 0], [0.06, 0.2, 0.06], [0, 0, -0.5]);
  m.idle = (t) => (b.position.y = Math.abs(Math.sin(t * 3.5)) * 0.25);
  m.swing = (k) => (b.rotation.x = Math.sin(k * Math.PI) * 0.4);
  return m;
};

const imp: Builder = (c) => {
  const C = mat(c, { map: softTex(c) });
  const m = base(1.3);
  const b = m.body;
  add(b, G.capsule(), C, [0, 0.45, 0], [0.4, 0.4, 0.35]);
  const head = part(b, [0, 0.95, 0]);
  add(head, G.sphere(), C, [0, 0, 0], [0.42, 0.4, 0.38]);
  eye(head, [-0.15, 0.04, 0.3], 0.11, 0xc92a2a, 0xffe066);
  eye(head, [0.15, 0.04, 0.3], 0.11, 0xc92a2a, 0xffe066);
  add(head, G.sphere(), 0x2b0a0a, [0, -0.18, 0.34], [0.12, 0.05, 0.03]);
  add(head, G.cone(), C, [-0.38, 0.12, 0], [0.08, 0.3, 0.08], [0, 0, 1.2]);
  add(head, G.cone(), C, [0.38, 0.12, 0], [0.08, 0.3, 0.08], [0, 0, -1.2]);
  add(head, G.sphere(), 0x2b0a0a, [0, 0.36, 0], [0.05, 0.08, 0.05]);
  const sack = part(b, [0.35, 0.55, 0.1]);
  add(sack, G.sphere(), 0xc9a227, [0, 0, 0], [0.2, 0.22, 0.2]);
  add(sack, G.sphere(), 0xffe066, [0, 0.18, 0], 0.07);
  m.idle = (t) => ((head.rotation.y = Math.sin(t * 2.2) * 0.3), (sack.rotation.z = Math.sin(t * 4) * 0.2));
  m.swing = (k) => (sack.rotation.x = -Math.sin(k * Math.PI) * 1.4);
  return m;
};

const book: Builder = (c) => {
  const C = mat(c, { map: stoneTex(c) });
  const m = base(1.4, true);
  const b = m.body;
  const cover = mat(c, { map: stoneTex(c) });
  const page = mat(0xfff9db);
  const spine = part(b, [0, 1.0, 0]);
  add(spine, G.box(), cover, [0, 0, -0.04], [0.9, 0.12, 0.08]);
  const top = part(spine, [0, 0, 0]);
  const bot = part(spine, [0, 0, 0]);
  add(top, G.box(), cover, [0, 0.0, 0.32], [0.9, 0.06, 0.66]);
  add(top, G.box(), page, [0, -0.06, 0.3], [0.82, 0.08, 0.6]);
  add(bot, G.box(), cover, [0, 0, 0.32], [0.9, 0.06, 0.66]);
  add(bot, G.box(), page, [0, 0.06, 0.3], [0.82, 0.08, 0.6]);
  for (let i = 0; i < 5; i++) add(bot, G.cone(), 0xffffff, [-0.3 + i * 0.15, 0.13, 0.6], [0.05, 0.1, 0.05]);
  eye(top, [-0.18, 0.08, 0.45], 0.1, 0xc92a2a, 0xffe066);
  eye(top, [0.18, 0.08, 0.45], 0.1, 0xc92a2a, 0xffe066);
  m.idle = (t) => {
    const o = 0.25 + Math.abs(Math.sin(t * 4)) * 0.4;
    top.rotation.x = -o;
    bot.rotation.x = o * 0.5;
  };
  m.swing = (k) => (top.rotation.x = -0.2 - Math.sin(k * Math.PI) * 1.1);
  return m;
};

const candle: Builder = (c) => {
  const m = base(1.8);
  const b = m.body;
  add(b, G.cyl(), 0xfff4e6, [0, 0.6, 0], [0.32, 1.2, 0.32]);
  for (const [x, y] of [[0.2, 1.1], [-0.25, 0.8], [0.05, 0.5]]) add(b, G.capsule(), 0xfff4e6, [x, y, 0.27], [0.1, 0.25, 0.1]);
  add(b, G.cyl(), 0x343a40, [0, 1.28, 0], [0.02, 0.15, 0.02]);
  const fl = add(b, G.cone(), mat(c, { emissive: c, glow: 1 }), [0, 1.48, 0], [0.12, 0.35, 0.12]);
  add(b, G.sphere(), 0x111111, [-0.11, 0.95, 0.31], [0.06, 0.09, 0.03]);
  add(b, G.sphere(), 0x111111, [0.11, 0.95, 0.31], [0.06, 0.09, 0.03]);
  add(b, G.sphere(), 0x111111, [0, 0.78, 0.32], [0.09, 0.05, 0.03]);
  m.idle = (t) => ((fl.scale.y = 0.35 * (1 + Math.sin(t * 13) * 0.2)), (fl.rotation.z = Math.sin(t * 9) * 0.15));
  m.swing = (k) => (fl.scale.setScalar(0.12 + Math.sin(k * Math.PI) * 0.5));
  return m;
};

const skeleton: Builder = (c) => {
  const C = mat(c, { map: stoneTex(c) });
  const m = base(2.0);
  const b = m.body;
  const bone = mat(c, { map: stoneTex(c) });
  add(b, G.cyl(), bone, [0, 0.95, 0], [0.07, 0.8, 0.07]);
  for (let i = 0; i < 4; i++) add(b, G.torus(), bone, [0, 1.25 - i * 0.14, 0], [0.3 - i * 0.03, 0.22, 0.3 - i * 0.03], [Math.PI / 2, 0, 0]);
  const head = part(b, [0, 1.68, 0]);
  add(head, G.sphere(), bone, [0, 0, 0], [0.36, 0.34, 0.34]);
  add(head, G.box(), bone, [0, -0.25, 0.08], [0.32, 0.12, 0.26]);
  add(head, G.sphere(), 0x111111, [-0.13, 0.02, 0.29], [0.1, 0.11, 0.05]);
  add(head, G.sphere(), 0x111111, [0.13, 0.02, 0.29], [0.1, 0.11, 0.05]);
  add(head, G.sphere(), mat(0x74c0fc, { emissive: 0x4dabf7, glow: 1 }), [-0.13, 0.02, 0.31], 0.035);
  add(head, G.sphere(), mat(0x74c0fc, { emissive: 0x4dabf7, glow: 1 }), [0.13, 0.02, 0.31], 0.035);
  const armR = part(b, [0.32, 1.3, 0]);
  add(armR, G.cyl(), bone, [0, -0.3, 0], [0.05, 0.6, 0.05]);
  const sword = part(armR, [0, -0.62, 0.05], [Math.PI / 2.4, 0, 0]);
  add(sword, G.box(), 0xadb5bd, [0, 0.5, 0], [0.08, 1.0, 0.03]);
  add(sword, G.box(), 0x845ef7, [0, 0.0, 0], [0.3, 0.06, 0.06]);
  const armL = part(b, [-0.32, 1.3, 0]);
  add(armL, G.cyl(), bone, [0, -0.3, 0], [0.05, 0.6, 0.05]);
  add(armL, G.cyl(), 0x5c3d2e, [0, -0.6, 0.15], [0.32, 0.05, 0.32], [Math.PI / 2, 0, 0]);
  add(b, G.cyl(), bone, [-0.14, 0.3, 0], [0.05, 0.6, 0.05]);
  add(b, G.cyl(), bone, [0.14, 0.3, 0], [0.05, 0.6, 0.05]);
  add(b, G.cone(), 0xffd43b, [0, 1.98, 0], [0.22, 0.18, 0.22]);
  m.idle = (t) => ((head.rotation.z = Math.sin(t * 3) * 0.08), (armR.rotation.x = -0.2 + Math.sin(t * 2) * 0.05));
  m.swing = (k) => (armR.rotation.x = -0.2 - Math.sin(k * Math.PI) * 2.5);
  return m;
};

const mummy: Builder = (c) => {
  const C = mat(c, { map: wrapTex(c) });
  const m = base(2.0);
  const b = m.body;
  const wrap = mat(c, { map: wrapTex(c) });
  const dark = mat(new THREE.Color(c).offsetHSL(0, 0, -0.15).getHex());
  add(b, G.capsule(), wrap, [0, 1.0, 0], [0.65, 0.9, 0.5]);
  for (let i = 0; i < 6; i++) add(b, G.torus(), dark, [0, 0.55 + i * 0.17, 0], [0.33, 0.27, 0.12], [Math.PI / 2, 0, i * 0.3]);
  const head = part(b, [0, 1.75, 0]);
  add(head, G.sphere(), wrap, [0, 0, 0], [0.36, 0.38, 0.36]);
  add(head, G.box(), 0x111111, [0, 0.03, 0.3], [0.4, 0.08, 0.06]);
  eye(head, [0.1, 0.03, 0.33], 0.05, 0x111111, 0xffe066);
  const armL = part(b, [-0.36, 1.32, 0]);
  const armR = part(b, [0.36, 1.32, 0]);
  add(armL, G.capsule(), wrap, [0, 0, 0.32], [0.2, 0.6, 0.2], [Math.PI / 2, 0, 0]);
  add(armR, G.capsule(), wrap, [0, 0, 0.32], [0.2, 0.6, 0.2], [Math.PI / 2, 0, 0]);
  add(b, G.capsule(), wrap, [-0.17, 0.3, 0], [0.24, 0.5, 0.24]);
  add(b, G.capsule(), wrap, [0.17, 0.3, 0], [0.24, 0.5, 0.24]);
  m.idle = (t) => ((armL.rotation.x = Math.sin(t * 1.6) * 0.15), (armR.rotation.x = -Math.sin(t * 1.6) * 0.15), (b.rotation.z = Math.sin(t * 1.2) * 0.05));
  m.swing = (k) => ((armL.rotation.x = -Math.sin(k * Math.PI) * 1.2), (armR.rotation.x = -Math.sin(k * Math.PI) * 1.2));
  return m;
};

const dragon: Builder = (c) => {
  const C = mat(c, { map: scaleTex(c) });
  const m = base(1.9);
  const b = m.body;
  const belly = new THREE.Color(c).offsetHSL(0.05, 0, 0.2).getHex();
  add(b, G.sphere(), C, [0, 0.75, 0], [0.6, 0.55, 0.75]);
  add(b, G.sphere(), belly, [0, 0.65, 0.3], [0.42, 0.42, 0.45]);
  const neck = part(b, [0, 1.05, 0.45], [-0.5, 0, 0]);
  add(neck, G.capsule(), C, [0, 0.25, 0], [0.26, 0.5, 0.26]);
  const head = part(neck, [0, 0.6, 0], [0.5, 0, 0]);
  add(head, G.sphere(), C, [0, 0, 0.05], [0.34, 0.3, 0.42]);
  add(head, G.sphere(), belly, [0, -0.1, 0.35], [0.22, 0.14, 0.2]);
  eye(head, [-0.17, 0.1, 0.25], 0.09, 0x111111, 0xffe066);
  eye(head, [0.17, 0.1, 0.25], 0.09, 0x111111, 0xffe066);
  add(head, G.cone(), 0xfff3bf, [-0.16, 0.32, -0.12], [0.06, 0.32, 0.06], [-0.6, 0, -0.2]);
  add(head, G.cone(), 0xfff3bf, [0.16, 0.32, -0.12], [0.06, 0.32, 0.06], [-0.6, 0, 0.2]);
  const wl = part(b, [-0.4, 1.05, -0.1]);
  const wr = part(b, [0.4, 1.05, -0.1]);
  const wm = mat(new THREE.Color(c).offsetHSL(0, 0.1, -0.1).getHex());
  add(wl, G.wing(), wm, [0, 0, 0], [1.4, 1.2, 1], [0, Math.PI, 0]);
  add(wr, G.wing(), wm, [0, 0, 0], [1.4, 1.2, 1]);
  const tail = part(b, [0, 0.6, -0.7]);
  add(tail, G.cone(), C, [0, 0, -0.5], [0.22, 1.1, 0.22], [-Math.PI / 2, 0, 0]);
  for (const x of [-0.3, 0.3]) for (const z of [0.35, -0.35]) add(b, G.capsule(), C, [x, 0.25, z], [0.18, 0.35, 0.18]);
  m.idle = (t) => {
    wl.rotation.y = -0.3 - Math.sin(t * 3) * 0.4;
    wr.rotation.y = 0.3 + Math.sin(t * 3) * 0.4;
    tail.rotation.y = Math.sin(t * 2) * 0.35;
    neck.rotation.x = -0.5 + Math.sin(t * 2.2) * 0.06;
  };
  m.swing = (k) => (neck.rotation.x = -0.5 + Math.sin(k * Math.PI) * 0.9);
  return m;
};

const ogre: Builder = (c) => {
  const C = mat(c, { map: softTex(c) });
  const m = base(2.2);
  const b = m.body;
  add(b, G.sphere(), C, [0, 1.0, 0], [0.75, 0.75, 0.6]);
  add(b, G.box(), 0x5c3d2e, [0, 0.6, 0], [1.3, 0.3, 1.05]);
  const head = part(b, [0, 1.75, 0.05]);
  add(head, G.sphere(), C, [0, 0, 0], [0.4, 0.36, 0.38]);
  eye(head, [-0.14, 0.06, 0.32], 0.09, 0x111111, 0xffe066);
  eye(head, [0.14, 0.06, 0.32], 0.09, 0x111111, 0xffe066);
  add(head, G.cone(), 0xfff3bf, [-0.25, 0.35, 0], [0.07, 0.3, 0.07], [0, 0, 0.4]);
  add(head, G.cone(), 0xfff3bf, [0.25, 0.35, 0], [0.07, 0.3, 0.07], [0, 0, -0.4]);
  add(head, G.cone(), 0xfff3bf, [-0.1, -0.15, 0.33], [0.04, 0.12, 0.04]);
  add(head, G.cone(), 0xfff3bf, [0.1, -0.15, 0.33], [0.04, 0.12, 0.04]);
  const armR = part(b, [0.75, 1.3, 0]);
  add(armR, G.capsule(), C, [0, -0.3, 0], [0.3, 0.6, 0.3]);
  const club = part(armR, [0, -0.7, 0.1], [Math.PI / 2.3, 0, 0]);
  add(club, G.cyl(), 0x5c3d2e, [0, 0.4, 0], [0.08, 0.9, 0.08]);
  add(club, G.capsule(), mat(0xff6b00, { emissive: 0xff4500, glow: 0.6 }), [0, 0.9, 0], [0.3, 0.4, 0.3]);
  const armL = part(b, [-0.75, 1.3, 0]);
  add(armL, G.capsule(), C, [0, -0.3, 0], [0.3, 0.6, 0.3]);
  add(b, G.capsule(), C, [-0.3, 0.3, 0], [0.32, 0.5, 0.32]);
  add(b, G.capsule(), C, [0.3, 0.3, 0], [0.32, 0.5, 0.32]);
  m.idle = (t) => ((armL.rotation.z = Math.sin(t * 1.8) * 0.08), (head.rotation.y = Math.sin(t * 1.2) * 0.15));
  m.swing = (k) => (armR.rotation.x = -Math.sin(k * Math.PI) * 2.8);
  return m;
};

/** Which body each monster (and boss) gets, and its colour. */
const BY_KIND: Record<string, [Builder, number]> = {
  tikus_lumut: [rat, 0x6f9a54], kelawar: [bat, 0x4b3f63], siput_batu: [snail, 0x868e96], labah_akar: [spider, 0x6b4f2a],
  cacing_gergasi: [worm, 0xd6a2c4], kristal_jalan: [golem, 0x66d9e8], pelesit: [cricket, 0x51cf66], api_liar: [flame, 0xfd7e14],
  salamander: [lizard, 0xc92a2a], pocong_taman: [pocong, 0xf8f9fa], toyol_kebun: [imp, 0x69db7c], buku_hidup: [book, 0x862e9c],
  hantu_pustaka: [candle, 0x74c0fc], jerangkung_raja: [skeleton, 0xf1e3c6], mumia: [mummy, 0xd8c8a8], naga_kecil: [dragon, 0xfab005],
};
const BY_ICON: Record<string, [Builder, number]> = {
  '🐀': [rat, 0x5c8a45], '🕷️': [spider, 0x5c3d2e], '🗿': [golem, 0x3bc9db], '👹': [ogre, 0xc92a2a], '👻': [ghost, 0xe7f5ff],
  '📚': [book, 0x5f3dc4], '💀': [skeleton, 0xe9ecef], '🐉': [dragon, 0xf59f00], '🦇': [bat, 0x4b3f63], '🔥': [flame, 0xfd7e14],
};

export function monsterModel(kind: string | undefined, icon: string | undefined, boss: boolean): Model {
  const [build, color] = (kind && BY_KIND[kind]) || (icon && BY_ICON[icon]) || [ghost, 0xced4da];
  const m = build(color);
  m.root.scale.setScalar(1.3);
  if (boss) {
    // Bosses: much bigger, with a gold crown floating over them.
    m.root.scale.setScalar(2.1);
    const crown = part(m.body, [0, m.height + 0.15, 0]);
    const gold = mat(0xffd43b, { emissive: 0xf59f00, glow: 0.5 });
    add(crown, G.cyl(), gold, [0, 0, 0], [0.28, 0.12, 0.28]);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      add(crown, G.cone(), gold, [Math.cos(a) * 0.24, 0.15, Math.sin(a) * 0.24], [0.06, 0.2, 0.06]);
    }
    m.height += 0.4;
  }
  return m;
}
