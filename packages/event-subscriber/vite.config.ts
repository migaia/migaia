import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/** Builds the single runtime-neutral event-subscriber entry. */
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/event-subscriber', import.meta.url)),
  build: {
    target: 'es2020',
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },
    sourcemap: true
  }
});
