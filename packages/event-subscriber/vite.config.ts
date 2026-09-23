import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs';

/** Builds runtime-neutral root and focused subscription-helper entries. */
export default defineConfig(withDistFreshness({
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/event-subscriber', import.meta.url)),
  build: {
    target: 'es2020',
    lib: {
      entry: {
        index: 'src/index.ts',
        subscriber: 'src/subscriber.ts'
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    sourcemap: true,
    rollupOptions: {
      external: [/^@migaia\/utils(?:\/|$)/],
      preserveEntrySignatures: 'strict'
    }
  }
}));
