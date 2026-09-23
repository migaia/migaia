import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs';

/** Produces the runtime-neutral middleware executor entry. */
export default defineConfig(withDistFreshness({
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/middleware-pipeline', import.meta.url)),
  build: {
    target: 'es2020',
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },
    sourcemap: true
  }
}));
