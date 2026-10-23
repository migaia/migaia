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
        bun: 'src/adapters/bun.ts'
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
