import { expect, test } from '@playwright/test';

test('repeated Window realm creation and disposal leaves no page errors or resources', async ({
  page
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/e2e/fixtures/index.html?scenario=window-iframe');
  await page.evaluate(() => globalThis.e2eReady);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = (await page.evaluate(() => globalThis.runWindowIframeScenario())) as {
      echo: string;
      errors: string[];
      snapshot: {
        phase: string;
        pending: number;
        activeControllers: number;
        resources: number;
        discovery: { remote: number; waiters: number; tasks: number; timers: number };
      };
    };
    expect(result.echo).toBe('window-ok');
    expect(result.errors).toEqual([]);
    expect(result.snapshot).toMatchObject({
      phase: 'disposed',
      pending: 0,
      activeControllers: 0,
      resources: 0,
      discovery: { remote: 0, waiters: 0, tasks: 0, timers: 0 }
    });
  }

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
