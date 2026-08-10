import { defineConfig } from 'vite';

/** Produces one runtime-neutral ESM entry; declarations are emitted by TypeScript. */
export default defineConfig({
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
