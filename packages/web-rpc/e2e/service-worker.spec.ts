import { expect, test } from '@playwright/test';

test('two controlled pages keep ServiceWorker Client identities isolated', async ({ context }) => {
  const pageA = await context.newPage();
  const pageErrors: Error[] = [];
  const consoleErrors: string[] = [];
  pageA.on('pageerror', (error) => pageErrors.push(error));
  pageA.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await pageA.goto('/e2e/fixtures/index.html?scenario=service-worker');
  await pageA.evaluate(() => globalThis.e2eReady);
  const clientA = await pageA.evaluate(() => globalThis.connectServiceWorker('page-a'));
  expect(await pageA.evaluate(() => globalThis.serviceWorkerControllerChanges())).toBeGreaterThan(
    0
  );
  const pageB = await context.newPage();
  pageB.on('pageerror', (error) => pageErrors.push(error));
  pageB.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await pageB.goto('/e2e/fixtures/index.html?scenario=service-worker');
  await pageB.evaluate(() => globalThis.e2eReady);
  const clientB = await pageB.evaluate(() => globalThis.connectServiceWorker('page-b'));
  expect(clientA).not.toBe(clientB);
  await expect(pageA.evaluate(() => globalThis.sendServiceWorker('A'))).resolves.toBe('A');
  await expect(pageB.evaluate(() => globalThis.sendServiceWorker('B'))).resolves.toBe('B');
  await pageB.evaluate(() => globalThis.injectServiceWorkerSpoof());
  await expect(pageA.evaluate(() => globalThis.sendServiceWorker('after-spoof'))).resolves.toBe(
    'after-spoof'
  );
  await pageA.close();
  await expect(pageB.evaluate(() => globalThis.sendServiceWorker('still-B'))).resolves.toBe(
    'still-B'
  );
  const pageC = await context.newPage();
  pageC.on('pageerror', (error) => pageErrors.push(error));
  pageC.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await pageC.goto('/e2e/fixtures/index.html?scenario=service-worker');
  await pageC.evaluate(() => globalThis.e2eReady);
  await pageC.evaluate(() => globalThis.connectServiceWorker('page-c'));
  await expect(pageC.evaluate(() => globalThis.sendServiceWorker('after-reconnect'))).resolves.toBe(
    'after-reconnect'
  );
  await expect(pageC.evaluate(() => globalThis.sendServiceWorkerTerminal())).resolves.toEqual({
    chunkedRequest: 'service-worker-chunked-request-😀',
    activePageSnapshot: expect.objectContaining({
      phase: 'active',
      pending: 0,
      chunks: 0,
      activeControllers: 0
    }),
    dispatchPayload: 'service-worker-chunked-dispatch-😀',
    remoteError: 'REMOTE_FAILURE',
    timeout: 'DEADLINE_EXCEEDED',
    aborted: 'CANCELLED',
    schemaError: 'SCHEMA_INVALID',
    pingSuccess: true,
    pingTimeout: false,
    pingAborted: false
  });
  expect(await pageC.evaluate(() => globalThis.disposeServiceWorker())).toEqual([]);
  await pageC.close();
  expect(await pageB.evaluate(() => globalThis.disposeServiceWorker())).toEqual([]);
  expect(await pageB.evaluate(() => globalThis.serviceWorkerSnapshots())).toEqual({
    page: expect.objectContaining({ phase: 'disposed', pending: 0, resources: 0 }),
    server: expect.objectContaining({
      phase: 'disposed',
      pending: 0,
      resources: 0,
      providerCalls: 6
    }),
    serverErrors: []
  });
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
