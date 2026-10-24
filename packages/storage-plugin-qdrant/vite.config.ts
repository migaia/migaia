import { defineConfig } from 'vite'
/** The genuine SDK is used only through the client adapter boundary. */
export default defineConfig({
  build: {
    target: 'es2022',
    lib: {
      entry: {
        index: 'src/index.ts',
        http: 'src/http.ts',
        client: 'src/client.ts',
        'features/hybrid': 'src/features/hybrid.ts',
        'features/recommend': 'src/features/recommend.ts',
        'features/group-by': 'src/features/group-by.ts',
        'features/management': 'src/features/management.ts',
        'features/rescore': 'src/features/rescore.ts'
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`
    },
    sourcemap: true,
    rollupOptions: {
      external: (id) => id.startsWith('@migaia/') || id === '@qdrant/js-client-rest'
    }
  }
})
