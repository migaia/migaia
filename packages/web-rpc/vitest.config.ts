import { configDefaults, defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

export default defineConfig(withDistFreshness({
  test: {
    include: ['test/**/*.{test,spec}.ts'],
    exclude: [...configDefaults.exclude, 'test/control-plane/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'json-summary', 'json'],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 85,
        'src/adapters/**': {
          statements: 80,
          branches: 70,
          functions: 70,
          lines: 80
        },
        'src/wire.ts': {
          branches: 85
        },
        'src/internal/**': {
          branches: 85
        },
        'src/endpoint.ts': {
          branches: 85
        }
      }
    }
  }
}))
