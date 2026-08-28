import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/** Produces one runtime-neutral ESM entry; declarations are emitted by TypeScript. */
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/lifecycle', import.meta.url)),
  build: {
    target: 'es2022',
    rollupOptions: {
      preserveEntrySignatures: 'strict',
      input: {
        index: 'src/index.ts',
        abort: 'src/abort.ts',
        scheduler: 'src/scheduler.ts',
        'quiescence-tracker': 'src/quiescence-tracker.ts',
        'lifecycle-scope': 'src/lifecycle-scope.ts',
        'generation-controller': 'src/generation-controller.ts',
        disposal: 'src/disposal.ts',
        errors: 'src/errors.ts'
      },
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js'
      }
    },
    sourcemap: true
  }
});
