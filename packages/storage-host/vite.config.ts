import { defineConfig } from 'vite'
/** Neutral owners remain external across the public host entry. */
const dependencies = [
  '@migaia/storage-contract',
  '@migaia/plugin-host',
  '@migaia/lifecycle',
  '@migaia/event-subscriber',
  '@migaia/utils',
  '@migaia/serialize',
  '@migaia/logger'
]
/** Emit a browser-safe host without bundling another lifecycle or capability owner. */
export default defineConfig({
  build: {
    target: 'es2022',
    lib: {
      entry: {
        index: 'src/index.ts',
        entity: 'src/entity.ts',
        journal: 'src/journal.ts',
        'authoring/backend': 'src/authoring/backend.ts',
        'authoring/codec': 'src/authoring/codec.ts',
        'authoring/migration': 'src/authoring/migration.ts',
        'authoring/vector': 'src/authoring/vector.ts',
        'vector/mmr': 'src/vector/mmr.ts'
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`
    },
    sourcemap: true,
    rollupOptions: {
      external: (id) =>
        dependencies.some((dependency) => id === dependency || id.startsWith(`${dependency}/`))
    }
  }
})
