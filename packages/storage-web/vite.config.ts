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
  '@migaia/utils'
] as const

/** Prevents Rollup from inlining a second owner copy when source imports a package subpath. */
const isRuntimeExternal = (id: string): boolean =>
  runtimeExternals.some((dependency) => id === dependency || id.startsWith(`${dependency}/`))

/** Produces runtime-neutral ESM entries; declarations are emitted by TypeScript. */
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/storage-web', import.meta.url)),
  /** Preserve the five canonical reactive factory names in emitted artifacts. */
  esbuild: {
    keepNames: true
  },
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
        host: 'src/host.ts',
        'reactive-adapter': 'src/reactive-adapter.ts',
        'plugins/memory': 'src/plugins/memory.ts',
        'plugins/local-storage': 'src/plugins/local-storage.ts',
        'plugins/session-storage': 'src/plugins/session-storage.ts',
        'plugins/cookies': 'src/plugins/cookies.ts',
        'plugins/indexed-db': 'src/plugins/indexed-db.ts',
        'plugins/reactive/index': 'src/plugins/reactive/index.ts',
        'plugins/reactive/memory': 'src/plugins/reactive/memory.ts',
        'plugins/reactive/local-storage': 'src/plugins/reactive/local-storage.ts',
        'plugins/reactive/session-storage': 'src/plugins/reactive/session-storage.ts',
        'plugins/reactive/cookies': 'src/plugins/reactive/cookies.ts',
        'plugins/reactive/indexed-db': 'src/plugins/reactive/indexed-db.ts',
        entity: 'src/entity.ts',
        schema: 'src/schema.ts',
        serialize: 'src/serialize.ts',
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    sourcemap: true,
    rollupOptions: {
      external: isRuntimeExternal
    }
  }
})
