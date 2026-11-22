// ⚔️ Pictures of the 3D monsters for the 2D fights (the cards, and the pixel-art stage): each model
// is rendered once, into a few poses (two idle frames, wind-up, strike, hurt: from the model's own
// idle and attack motion), and the graphics are freed straight after. Only used when no 3D stage is
// running, so the two never share the 3D parts at once.
import * as THREE from 'three';
import { disposeKit } from './kit';
import { monsterModel } from './models';

export type MonsterPose = 'idle0' | 'idle1' | 'windup' | 'strike' | 'hurt';
export const MONSTER_POSES: MonsterPose[] = ['idle0', 'idle1', 'windup', 'strike', 'hurt'];

/** One picture per monster (`poses` false: just the idle one, for the cards) or one per pose. */
export async function snapshotMonsters(list: Array<{ key: string; kind?: string; icon?: string; boss?: boolean }>, S = 200, poses = false): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!list.length) return out;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: S > 120, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(S, S, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  // Lit like the dungeon: a dim cold fill, warm lamp light from the front-left, a cool rim behind.
  scene.add(new THREE.HemisphereLight(0x7d86b8, 0x1a1424, poses ? 1.4 : 2.2));
  const key = new THREE.DirectionalLight(0xffc48a, poses ? 2.2 : 2.4);
  key.position.set(-4, 4, 5);
  const back = new THREE.DirectionalLight(0x9fb4ff, 2.6);
  back.position.set(3, 3, -5);
  scene.add(key, back);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  try {
    for (const it of list) {
      const m = monsterModel(it.kind, it.icon, !!it.boss);
      m.root.rotation.y = -0.6; // turned towards your party (bottom left)
      if (m.hover) m.root.position.y = 0.4;
      scene.add(m.root);
      // Frame it on its widest pose so every pose fits the same picture.
      m.idle(0.4);
      m.swing(0.5);
      const box = new THREE.Box3().setFromObject(m.root);
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const r = Math.max(size.x, size.y, size.z) * 0.66;
      const dist = r / Math.tan((cam.fov * Math.PI) / 360);
      cam.position.set(c.x + dist * 0.15, c.y + dist * 0.28, c.z + dist);
      cam.lookAt(c);
      const shot = (pose: MonsterPose | null) => {
        m.root.rotation.z = 0;
        m.body.rotation.x = 0;
        m.swing(0);
        if (pose === 'idle0' || pose === null) m.idle(0.4);
        if (pose === 'idle1') m.idle(1.15);
        if (pose === 'windup') (m.idle(0.4), m.swing(0.28), (m.body.rotation.x = -0.25));
        if (pose === 'strike') (m.idle(0.4), m.swing(0.75), (m.body.rotation.x = 0.3));
        if (pose === 'hurt') (m.idle(0.4), (m.root.rotation.z = 0.28), (m.body.rotation.x = -0.35));
        renderer.render(scene, cam);
        return renderer.domElement.toDataURL('image/png');
      };
      if (poses) for (const p of MONSTER_POSES) out.set(`${it.key}#${p}`, shot(p));
      else out.set(it.key, shot(null));
      scene.remove(m.root);
    }
  } finally {
    disposeKit();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return out;
}
