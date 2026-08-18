import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  webServer: {
    command:
      '../../node_modules/.bin/vite --config e2e/vite.config.ts --host 127.0.0.1 --port 4182 --strictPort',
    cwd: new URL('..', import.meta.url).pathname,
    port: 4182,
    reuseExistingServer: !process.env.CI
  },
  use: { baseURL: 'http://127.0.0.1:4182', browserName: 'chromium' }
});
