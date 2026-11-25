import { defineConfig } from 'vitest/config'

/** Release every Qdrant test collection allocated during live runs, even on failure. */
export default defineConfig({
  test: {
    setupFiles: ['test/helpers/release-collections.ts']
  }
})
