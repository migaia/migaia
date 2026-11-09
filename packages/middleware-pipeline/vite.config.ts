import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs';

/** Produces the runtime-neutral middleware executor entry. */
export default defineConfig(withDistFreshness({
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/middleware-pipeline', import.meta.url)),
  build: {
    target: 'es2022',
    lib: { entry: {
        "index": "src/index.ts",
        "modes/sync": "src/modes/sync.ts",
        "modes/async": "src/modes/async.ts",
        "modes/generator": "src/modes/generator.ts",
        "modes/async-generator": "src/modes/async-generator.ts",
        "option-admission": "src/option-admission.ts"
}, formats: ['es'], fileName: () => 'index.js' },
    sourcemap: true,
    rollupOptions: {
      /** Shared error and utility ownership stays with the published dependency. */
      external: (id) => id === '@migaia/utils' || id.startsWith('@migaia/utils/'),
      preserveEntrySignatures: 'strict',
      output: { preserveModules: true, preserveModulesRoot: 'src', entryFileNames: '[name].js' }
    }
  }
}));
