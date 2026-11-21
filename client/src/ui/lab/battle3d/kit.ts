// ⚔️ 3D fight: small helpers for building chibi, low-poly models out of simple shapes. Shapes and
// materials are shared (one sphere, one box... scaled per use), so a whole fight is a handful of
// buffers on the graphics card, and everything is freed with disposeKit() when the fight ends.
import * as THREE from 'three';

const geos = new Map<string, THREE.BufferGeometry>();
const mats = new Map<string, THREE.Material>();

function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geos.get(key);
  if (!g) geos.set(key, (g = make()));
  return g as T;
}

export const G = {
  sphere: () => geo('sphere', () => new THREE.SphereGeometry(1, 14, 10)),
  lowSphere: () => geo('lowSphere', () => new THREE.IcosahedronGeometry(1, 1)),
  rock: () => geo('rock', () => new THREE.DodecahedronGeometry(1, 0)),
  box: () => geo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  cyl: () => geo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 10)),
  cone: () => geo('cone', () => new THREE.ConeGeometry(1, 1, 10)),
  capsule: () => geo('capsule', () => new THREE.CapsuleGeometry(0.5, 1, 4, 10)),
  torus: () => geo('torus', () => new THREE.TorusGeometry(1, 0.28, 8, 18)),
  octa: () => geo('octa', () => new THREE.OctahedronGeometry(1, 0)),
  plane: () => geo('plane', () => new THREE.PlaneGeometry(1, 1)),
  wing: () =>
    geo('wing', () => {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.quadraticCurveTo(0.5, 0.55, 1, 0.35);
      s.lineTo(0.82, 0.08);
      s.lineTo(0.62, 0.2);
      s.lineTo(0.45, -0.05);
      s.lineTo(0.25, 0.08);
      s.lineTo(0, -0.1);
      return new THREE.ShapeGeometry(s);
    }),
};

/** A flat-shaded cartoon material (Lambert: cheap on weak graphics). */
export function mat(color: number | string, o: { emissive?: number; glow?: number; flat?: boolean; opacity?: number } = {}): THREE.MeshLambertMaterial {
  const key = `${color}|${o.emissive ?? 0}|${o.glow ?? 0}|${o.flat ? 1 : 0}|${o.opacity ?? 1}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color: new THREE.Color(color as THREE.ColorRepresentation),
      emissive: new THREE.Color(o.emissive ?? 0x000000),
      emissiveIntensity: o.glow ?? 1,
      flatShading: !!o.flat,
      transparent: (o.opacity ?? 1) < 1,
      opacity: o.opacity ?? 1,
      side: THREE.DoubleSide,
    });
    mats.set(key, m);
  }
  return m as THREE.MeshLambertMaterial;
}

/** A shape, placed: add(parent, G.sphere(), color, [x,y,z], [sx,sy,sz], [rx,ry,rz]). */
export function add(
  parent: THREE.Object3D,
  g: THREE.BufferGeometry,
  m: THREE.Material | number | string,
  pos: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] | number = 1,
  rot: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const mesh = new THREE.Mesh(g, typeof m === 'object' ? m : mat(m));
  mesh.position.set(...pos);
  if (typeof scale === 'number') mesh.scale.setScalar(scale);
  else mesh.scale.set(...scale);
  mesh.rotation.set(...rot);
  parent.add(mesh);
  return mesh;
}

/** A group (a moving part), placed. */
export function part(parent: THREE.Object3D, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0]) {
  const g = new THREE.Group();
  g.position.set(...pos);
  g.rotation.set(...rot);
  parent.add(g);
  return g;
}

/** A cartoon eye (white, pupil, a shine), looking forward (+z). */
export function eye(parent: THREE.Object3D, pos: [number, number, number], r: number, pupil = 0x111111, white = 0xffffff) {
  const e = part(parent, pos);
  add(e, G.sphere(), white, [0, 0, 0], r);
  add(e, G.sphere(), pupil, [0, 0, r * 0.62], [r * 0.55, r * 0.6, r * 0.4]);
  add(e, G.sphere(), 0xffffff, [r * 0.2, r * 0.25, r * 0.95], r * 0.18);
  return e;
}

/** Frees every shared shape and material (the fight is over). */
export function disposeKit() {
  for (const g of geos.values()) g.dispose();
  for (const m of mats.values()) m.dispose();
  geos.clear();
  mats.clear();
}
