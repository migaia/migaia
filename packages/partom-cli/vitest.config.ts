import { defineConfig } from 'vitest/config'

/** CLI tests spawn Bun processes and a headless browser; they run one file at a time with a long timeout. */
export default defineConfig({
  test: { testTimeout: 300000, fileParallelism: false }
})
