import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  workers: 1,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4181', browserName: 'chromium' },
  webServer: {
    command: '../../node_modules/.bin/vite --config e2e/vite.config.ts',
    cwd: new URL('..', import.meta.url).pathname,
    port: 4181,
    reuseExistingServer: false,
    timeout: 30_000
  }
});
