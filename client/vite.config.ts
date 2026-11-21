import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        // Phaser (most of the download) in its own file: it rarely changes, so browsers keep it
        // cached and an update only re-downloads the game's own code.
        // three.js gets its own chunk: only the 3D Labirin fight loads it (not at startup).
        manualChunks: (id) => (id.includes('node_modules/phaser') ? 'phaser' : id.includes('node_modules/three') ? 'three' : id.includes('node_modules/') ? 'vendor' : undefined),
      },
    },
  },
  // Pre-bundle big deps up front so the first page load in dev doesn't trigger a reload.
  optimizeDeps: { include: ['phaser', 'socket.io-client', 'zod'] },
  server: { fs: { allow: ['..'] } },
});
