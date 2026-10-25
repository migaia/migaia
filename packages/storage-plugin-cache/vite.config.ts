import { defineConfig } from 'vite'
/** Cache orchestration consumes only original neutral contracts and the peer host. */
export default defineConfig({ build: { target: 'es2022', lib: { entry: { index: 'src/index.ts', 'features/semantic': 'src/features/semantic.ts' }, formats: ['es'], fileName: (_format, name) => `${name}.js` }, sourcemap: true, rollupOptions: { external: (id) => id.startsWith('@migaia/') } } })
