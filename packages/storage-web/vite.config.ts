import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/** Produces runtime-neutral ESM entries; declarations are emitted by TypeScript. */
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/storage-web', import.meta.url)),
  build: {
    target: 'es2020',
    lib: {
      entry: {
        index: 'src/index.ts',
        memory: 'src/memory.ts'
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    sourcemap: true
  }
});
