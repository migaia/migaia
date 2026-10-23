import { defineConfig } from 'vite'
/** Explicit entries keep SDK and native filesystem imports away from the root factory. */
export default defineConfig({ build: { target: 'es2022', lib: { entry: { index: 'src/index.ts', fs: 'src/fs.ts', s3: 'src/s3.ts', 'features/presign': 'src/features/presign.ts' }, formats: ['es'], fileName: (_format, name) => `${name}.js` }, sourcemap: true, rollupOptions: { external: (id) => id.startsWith('@migaia/') || id.startsWith('@aws-sdk/') || id.startsWith('node:') } } })
