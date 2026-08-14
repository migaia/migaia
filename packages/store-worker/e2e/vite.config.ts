import { defineConfig } from 'vite';

export default defineConfig({
  root: 'e2e',
  resolve: { alias: { '@migaia/store-worker': '../src/index.ts' } }
});
