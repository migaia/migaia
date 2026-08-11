import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/** Produces one runtime-neutral ESM entry; declarations are emitted by TypeScript. */
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/plugin-host', import.meta.url)),
  build: {
    target: 'es2020',
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js'
    },
    sourcemap: true
  }
});
