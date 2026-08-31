import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/** Runtime dependencies that must stay external to preserve one owner per package boundary. */
const runtimeExternals = [
  '@migaia/lifecycle',
  '@migaia/middleware-pipeline',
  '@migaia/utils'
] as const

/** Keeps exact package imports and their subpaths external to the publication graph. */
const isRuntimeExternal = (id: string): boolean =>
  runtimeExternals.some((dependency) => id === dependency || id.startsWith(`${dependency}/`))

/** Produces one runtime-neutral ESM entry; declarations are emitted by TypeScript. */
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite/plugin-host', import.meta.url)),
  build: {
    target: 'es2020',
    lib: {
      entry: {
        index: 'src/index.ts',
        'composition-entry': 'src/composition-entry.ts',
        defined: 'src/defined.ts',
        structural: 'src/structural.ts'
      },
      formats: ['es'],
      fileName: () => 'index.js'
    },
    sourcemap: true,
    rollupOptions: {
      external: isRuntimeExternal,
      preserveEntrySignatures: 'strict',
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js'
      }
    }
  }
})
