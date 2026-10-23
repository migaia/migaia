import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/** Runtime package owners that must remain external through every exported subpath. */
const runtimeExternals = [
  '@migaia/capability',
  '@migaia/event-subscriber',
  '@migaia/lifecycle',
  '@migaia/plugin-host',
  '@migaia/reactive',
  '@migaia/resource',
  '@migaia/storage-contract',
  '@migaia/storage-host',
  '@migaia/utils'
] as const

/** Prevents Rollup from inlining a second owner copy when source imports a package subpath. */
const isRuntimeExternal = (id: string): boolean =>
  runtimeExternals.some((dependency) => id === dependency || id.startsWith(`${dependency}/`))

/** Produces runtime-neutral ESM entries; declarations are emitted by TypeScript. */
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/storage-web', import.meta.url)),
  build: {
    target: 'es2020',
    lib: {
      entry: {
        index: 'src/index.ts',
        'local-storage': 'src/local-storage.ts',
        'session-storage': 'src/session-storage.ts',
        cookies: 'src/cookies.ts',
        'indexed-db': 'src/indexed-db.ts',
        'plugins/local-storage': 'src/plugins/local-storage.ts',
        'plugins/session-storage': 'src/plugins/session-storage.ts',
        'plugins/cookies': 'src/plugins/cookies.ts',
        'plugins/indexed-db': 'src/plugins/indexed-db.ts',
        'features/reactive': 'src/features/reactive.ts',
        'features/blobs': 'src/features/blobs.ts'
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    sourcemap: true,
    rollupOptions: {
      /** Preserve public plugin factory names in the current Rolldown emitter. */
      output: { keepNames: true },
      external: isRuntimeExternal
    }
  }
})
