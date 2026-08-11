import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://127.0.0.1:4178',
    browserName: 'chromium',
    launchOptions: {
      args: [
        '--allow-loopback-in-peer-connection',
        '--disable-features=WebRtcHideLocalIpsWithMdns',
        '--force-webrtc-ip-handling-policy=default'
      ]
    },
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command: '../../node_modules/.bin/vite --config e2e/vite.config.ts',
      cwd: new URL('..', import.meta.url).pathname,
      port: 4178,
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: '../../node_modules/.bin/vite --config e2e/vite.config.ts --port 4179',
      cwd: new URL('..', import.meta.url).pathname,
      port: 4179,
      reuseExistingServer: false,
      timeout: 30_000
    }
  ]
});
