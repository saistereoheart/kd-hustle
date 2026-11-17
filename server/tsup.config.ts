import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle the shared TS package; keep real npm deps (and dev-only Vite) external.
  noExternal: ['@kh/shared'],
  external: ['vite'],
});
