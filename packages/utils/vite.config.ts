import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs';

/** Builds all stable public subpath entries as runtime-neutral ESM. */
export default defineConfig(withDistFreshness({
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
        'object-path': 'src/object-path.ts',
        typing: 'src/typing.ts',
        config: 'src/config.ts',
        function: 'src/function.ts',
        value: 'src/value.ts',
        string: 'src/string.ts',
        number: 'src/number.ts'
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    sourcemap: true
  }
}));
