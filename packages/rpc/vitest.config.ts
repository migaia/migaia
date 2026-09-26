import { defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

export default defineConfig(
  withDistFreshness({
    test: {
      include: ['test/**/*.{test,spec}.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        reporter: ['text-summary', 'json-summary', 'json'],
        thresholds: {
          statements: 85,
          branches: 80,
          functions: 85,
          lines: 85,
          'src/{core,browser}/adapters/**': {
            statements: 80,
            branches: 70,
            functions: 70,
            lines: 80
          },
          'src/core/internal/**': {
            branches: 85
          }
        }
      }
    }
  })
)
