import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/control-plane/**/*.test.ts'],
    exclude: configDefaults.exclude
  }
})
