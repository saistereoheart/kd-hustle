// Static vector art (rooms, furniture, counters) drawn with Phaser Graphics is re-triangulated and
// re-drawn EVERY frame, which slow devices feel (90 pieces of furniture in a room!). Baking draws
// it once into a texture and shows a plain image instead. Pieces that look the same (same kind,
// same colour) share one texture, so they also draw in one batch.
import Phaser from 'phaser';

/** Draws `draw` once into a w × h texture called `key` (kept for reuse) and returns the key. */
export function bake(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void): string {
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({}, false);
  draw(g);
  g.generateTexture(key, Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
  g.destroy();
  return key;
}

/**
 * A piece drawn by `draw(g, cx, cy)` around a centre, baked with room around it: `padL/padT` how
 * far it may reach left/up of its centre, `w/h` the whole box. Returns an image placed so the
 * piece's centre lands on (cx, cy).
 */
export function bakedPiece(
  scene: Phaser.Scene,
  key: string,
  box: { w: number; h: number; padL: number; padT: number },
  cx: number,
  cy: number,
  draw: (g: Phaser.GameObjects.Graphics, x: number, y: number) => void,
): Phaser.GameObjects.Image {
  bake(scene, key, box.w, box.h, (g) => draw(g, box.padL, box.padT));
  return scene.add.image(cx - box.padL, cy - box.padT, key).setOrigin(0, 0);
}
