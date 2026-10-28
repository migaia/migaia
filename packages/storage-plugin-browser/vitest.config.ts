import { configDefaults, defineConfig } from 'vitest/config';
import { withDistFreshness } from '../../scripts/vitest-dist-freshness.mjs';

export default defineConfig(withDistFreshness({
  test: {
    environment: 'jsdom',
    setupFiles: ['test/setup.ts'],
    // e2e/*.spec.ts 用的是 @playwright/test 的 test()，只能由 playwright 自己的
    // runner 执行（见 e2e/playwright.config.ts）；vitest 默认的 testMatch 会
    // 误把它们当成自己的测试文件，必须显式排除。
    exclude: [...configDefaults.exclude, 'e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/testing/**'],
      reporter: ['text-summary', 'json-summary', 'json'],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
        'src/backends/**': {
          statements: 90,
          branches: 85,
          functions: 90,
          lines: 90
        },
        'src/utils/**': {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95
        },
        'src/serialize/**': {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95
        },
        'src/schema/**': {
          statements: 90,
          branches: 85,
          functions: 90,
          lines: 90
        },
        'src/entity/**': {
          statements: 90,
          branches: 85,
          functions: 90,
          lines: 90
        }
      }
    }
  }
}));
