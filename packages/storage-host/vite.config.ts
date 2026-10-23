import { defineConfig } from 'vite'
/** Neutral owners remain external across the public host entry. */
const dependencies = [
  '@migaia/storage-contract',
  '@migaia/plugin-host',
  '@migaia/lifecycle',
  '@migaia/event-subscriber',
  '@migaia/utils',
  '@migaia/serialize'
]
/** Emit a browser-safe host without bundling another lifecycle or capability owner. */
export default defineConfig({
  build: {
    target: 'es2020',
    lib: {
      entry: { index: 'src/index.ts', entity: 'src/entity.ts' },
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
