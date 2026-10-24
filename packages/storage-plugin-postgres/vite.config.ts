import { defineConfig } from 'vite'
/** Only explicit adapter entries load their native client peers. */
export default defineConfig({
  build: {
    target: 'es2022',
    lib: {
      entry: {
        index: 'src/index.ts',
        pg: 'src/pg.ts',
        'postgres-js': 'src/postgres-js.ts',
        bun: 'src/bun.ts',
        'features/listen': 'src/features/listen.ts',
        'features/copy': 'src/features/copy.ts',
        'features/quantized': 'src/features/quantized.ts',
        'features/pgvector': 'src/features/pgvector.ts',
        'features/logical-replication': 'src/features/logical-replication.ts'
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`
    },
    sourcemap: true,
    rollupOptions: {
      external: (id) =>
        id.startsWith('@migaia/') ||
        ['pg', 'postgres', 'pg-copy-streams', 'pg-logical-replication', 'bun'].includes(id) ||
        id.startsWith('node:')
    }
  }
})
