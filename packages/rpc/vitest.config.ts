import { configDefaults, defineConfig } from 'vitest/config'
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs'

export default defineConfig(
  withDistFreshness({
    test: {
      include: ['test/**/*.{test,spec}.ts'],
      exclude: [
        ...configDefaults.exclude,
        'test/process/conformance*.test.ts',
        'test/merge/suite-parity.test.ts'
      ],
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
          'src/process/adapters/**': {
            statements: 40,
            branches: 30,
            functions: 40,
            lines: 40
          },
          'src/core/internal/**': {
            branches: 85
          }
        }
      }
    }
  })
)
