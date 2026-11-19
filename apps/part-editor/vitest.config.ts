import { defineConfig } from 'vitest/config'

/** Tests start the catalog and the editor as Bun children and drive the page with Playwright. */
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], testTimeout: 300000, hookTimeout: 120000, fileParallelism: false }
})
