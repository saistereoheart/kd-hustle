// ⚔️ Pictures of the 3D monsters for the flat (2D) fight cards: each model is rendered once, small,
// into an image, and the graphics are freed straight after. Only used when the fight is in 2D, so
// the two never run at once.
import * as THREE from 'three';
import { disposeKit } from './kit';
import { monsterModel } from './models';

export async function snapshotMonsters(list: Array<{ key: string; kind?: string; icon?: string; boss?: boolean }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!list.length) return out;
  const S = 200;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(S, S, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xb8c8ff, 0x2a2338, 2.2));
  const key = new THREE.DirectionalLight(0xfff0dd, 2.4);
  key.position.set(-3, 5, 6);
  const back = new THREE.DirectionalLight(0x8fb0ff, 2.5); // the rim from behind
  back.position.set(3, 3, -5);
  scene.add(key, back);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  try {
    for (const it of list) {
      const m = monsterModel(it.kind, it.icon, !!it.boss);
      m.root.rotation.y = -0.6; // turned towards your party (bottom left of the cards)
      m.idle(0.4);
      if (m.hover) m.root.position.y = 0.4;
      scene.add(m.root);
      const box = new THREE.Box3().setFromObject(m.root);
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const r = Math.max(size.x, size.y, size.z) * 0.62;
      const dist = r / Math.tan((cam.fov * Math.PI) / 360);
      cam.position.set(c.x + dist * 0.15, c.y + dist * 0.28, c.z + dist);
      cam.lookAt(c);
      renderer.render(scene, cam);
      out.set(it.key, renderer.domElement.toDataURL('image/png'));
      scene.remove(m.root);
    }
  } finally {
    disposeKit();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return out;
}
