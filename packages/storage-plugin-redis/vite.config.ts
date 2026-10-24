import { defineConfig } from 'vite'
/** Native clients remain confined to their selected adapter entry. */
export default defineConfig({
  build: {
    target: 'es2022',
    lib: {
      entry: {
        index: 'src/index.ts',
        ioredis: 'src/adapters/ioredis.ts',
        'node-redis': 'src/adapters/node-redis.ts',
        bun: 'src/adapters/bun.ts',
        'features/streams': 'src/features/streams.ts',
        'features/pubsub': 'src/features/pubsub.ts',
        'features/sorted-sets': 'src/features/sorted-sets.ts',
        'features/rate-limit': 'src/features/rate-limit.ts',
        'features/change-stream': 'src/features/change-stream.ts',
        'features/search': 'src/features/search.ts'
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`
    },
    sourcemap: true,
    rollupOptions: {
      external: (id) => id.startsWith('@migaia/') || id === 'redis' || id === 'ioredis'
    }
  }
})
