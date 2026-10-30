import { configDefaults, defineConfig } from 'vitest/config'

/** Bun's real test harness is invoked explicitly by its native runtime. */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'test/runtime/**'],
    /** Release every Redis namespace a test file allocated (test/helpers/namespaces.ts). */
    setupFiles: ['test/helpers/release-namespaces.ts']
  }
})
