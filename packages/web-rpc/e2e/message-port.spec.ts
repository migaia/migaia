import { expect, test } from '@playwright/test';

test('browser MessagePort performs RPC and closes owned ports', async ({ page }) => {
  await page.goto('/e2e/fixtures/index.html?scenario=message-port');
  await page.evaluate(() => globalThis.e2eReady);
  const result = await page.evaluate(() => globalThis.runMessagePortScenario());
  expect(result).toMatchObject({
    result: { value: 42 },
    errors: [],
    portsClosed: [1, 1],
    snapshots: {
      left: { phase: 'disposed', pending: 0, resources: 0 },
      right: { phase: 'disposed', pending: 0, resources: 0 }
    }
  });
});

test('browser MessagePort borrowed ownership leaves port closure to its caller', async ({
  page
}) => {
  await page.goto('/e2e/fixtures/index.html?scenario=message-port');
  await page.evaluate(() => globalThis.e2eReady);
  const result = await page.evaluate(() => globalThis.runBorrowedMessagePortScenario());
  expect(result).toMatchObject({
    result: 'borrowed',
    errors: [],
    portsClosed: [0, 1],
    snapshots: {
      left: { phase: 'disposed', pending: 0, resources: 0 },
      right: { phase: 'disposed', pending: 0, resources: 0 }
    }
  });
});
