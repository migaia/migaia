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
        'features/memory-notifications': 'src/features/memory-notifications.ts',
        'features/memory-change-feed': 'src/features/memory-change-feed.ts',
        'authoring/change-controller': 'src/authoring/change-controller.ts',
        'authoring/change-iterator': 'src/authoring/change-iterator.ts',
        'authoring/capability': 'src/authoring/capability.ts',
        'authoring/store': 'src/authoring/store.ts',
        'authoring/blob': 'src/authoring/blob.ts',
        'authoring/counter': 'src/authoring/counter.ts',
        'authoring/ttl': 'src/authoring/ttl.ts',
        'authoring/sparql': 'src/authoring/sparql.ts',
        'authoring/rdf': 'src/authoring/rdf.ts',
        'authoring/context': 'src/authoring/context.ts',
        'authoring/resource': 'src/authoring/resource.ts',
        'authoring/key': 'src/authoring/key.ts',
        'authoring/sql': 'src/authoring/sql.ts',
        'authoring/query': 'src/authoring/query.ts',
        'authoring/transaction': 'src/authoring/transaction.ts',
        'authoring/concurrency': 'src/authoring/concurrency.ts',
        entity: 'src/entity.ts',
        'entity/query': 'src/entity/query.ts',
        'entity/unique': 'src/entity/unique.ts',
        'entity/migration': 'src/entity/migration.ts',
        'entity/indexes': 'src/entity/indexes.ts',
        'entity/keyset': 'src/entity/keyset.ts',
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
