import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/** Runtime package owners that must remain external through every exported subpath. */
const runtimeExternals = [
  '@migaia/event-subscriber',
  '@migaia/lifecycle',
  '@migaia/reactive',
  '@migaia/storage-contract',
  '@migaia/utils'
] as const;

/** Prevents Rollup from inlining a second owner copy when source imports a package subpath. */
const isRuntimeExternal = (id: string): boolean =>
  runtimeExternals.some((dependency) => id === dependency || id.startsWith(`${dependency}/`));

/** Produces runtime-neutral ESM entries; declarations are emitted by TypeScript. */
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/storage-web', import.meta.url)),
  build: {
    target: 'es2020',
    lib: {
      entry: {
        index: 'src/index.ts',
        memory: 'src/memory.ts',
        'local-storage': 'src/local-storage.ts',
        'session-storage': 'src/session-storage.ts',
        cookies: 'src/cookies.ts',
        'indexed-db': 'src/indexed-db.ts',
        entity: 'src/entity.ts',
        schema: 'src/schema.ts',
        serialize: 'src/serialize.ts',
        reactive: 'src/reactive.ts'
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    sourcemap: true,
    rollupOptions: {
      external: isRuntimeExternal
    }
  }
});
