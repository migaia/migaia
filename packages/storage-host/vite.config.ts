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
        sdk: 'src/sdk.ts',
        'plugins/memory': 'src/plugins/memory.ts',
        journal: 'src/journal.ts',
        'plugins/probe': 'src/plugins/probe/index.ts',
        'features/memory-notifications': 'src/features/memory-notifications.ts',
        'features/memory-change-feed': 'src/features/memory-change-feed.ts',
        entity: 'src/entity.ts',
        'entity/query': 'src/entity/query.ts',
        'entity/unique': 'src/entity/unique.ts',
        'entity/migration': 'src/entity/migration.ts',
        'entity/indexes': 'src/entity/indexes.ts',
        'entity/keyset': 'src/entity/keyset.ts'
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
