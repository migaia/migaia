import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/** Builds all stable public subpath entries as runtime-neutral ESM. */
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/utils', import.meta.url)),
  build: {
    target: 'es2022',
    lib: {
      entry: {
        index: 'src/index.ts',
        promise: 'src/promise.ts',
        error: 'src/error.ts',
        bytes: 'src/bytes.ts',
        object: 'src/object.ts',
        config: 'src/config.ts',
        function: 'src/function.ts'
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    sourcemap: true
  }
});
