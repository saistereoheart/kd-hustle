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
  },
  // Pre-bundle big deps up front so the first page load in dev doesn't trigger a reload.
  optimizeDeps: { include: ['phaser', 'socket.io-client', 'zod'] },
  server: { fs: { allow: ['..'] } },
});
