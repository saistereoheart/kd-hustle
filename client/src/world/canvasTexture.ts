import type Phaser from 'phaser';

/**
 * Adds a finished canvas as a texture. Phaser's `addCanvas` makes a CanvasTexture, which reads
 * every pixel back out (`getImageData`) when it's created. That's ~40 ms for a map chunk, and
 * we never need the pixels, so register the canvas as a plain image source instead.
 */
export function addCanvasTexture(scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement): Phaser.Textures.Texture | null {
  return scene.textures.addImage(key, canvas as unknown as HTMLImageElement);
}
