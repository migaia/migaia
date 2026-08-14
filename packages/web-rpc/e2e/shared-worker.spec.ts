import { expect, test } from '@playwright/test';

test('two pages isolate same sender/task through one SharedWorker', async ({ context }) => {
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const pageErrors: Error[] = [];
  const consoleErrors: string[] = [];
  pageA.on('pageerror', (error) => pageErrors.push(error));
  pageB.on('pageerror', (error) => pageErrors.push(error));
  pageA.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  pageB.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await Promise.all([
    pageA.goto('/e2e/fixtures/index.html?scenario=shared-worker'),
    pageB.goto('/e2e/fixtures/index.html?scenario=shared-worker')
  ]);
  await Promise.all([
    pageA.evaluate(() => globalThis.e2eReady),
    pageB.evaluate(() => globalThis.e2eReady)
  ]);
  const [connectionA, connectionB] = await Promise.all([
    pageA.evaluate(() => globalThis.connectSharedWorker('client-a')),
    pageB.evaluate(() => globalThis.connectSharedWorker('client-b'))
  ]);
  expect(new Set([connectionA, connectionB]).size).toBe(2);
  const [resultA, resultB] = await Promise.all([
    pageA.evaluate(() => globalThis.sendSharedWorker('A')),
    pageB.evaluate(() => globalThis.sendSharedWorker('B'))
  ]);
  expect(resultA).toBe('A');
  expect(resultB).toBe('B');
  await pageB.evaluate(() => globalThis.injectSharedWorkerSpoof());
  await expect(pageA.evaluate(() => globalThis.sendSharedWorker('after-spoof'))).resolves.toBe(
    'after-spoof'
  );
  await pageA.close();
  const pageC = await context.newPage();
  pageC.on('pageerror', (error) => pageErrors.push(error));
  pageC.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await pageC.goto('/e2e/fixtures/index.html?scenario=shared-worker');
  await pageC.evaluate(() => globalThis.e2eReady);
  await pageC.evaluate(() => globalThis.connectSharedWorker('client-c'));
  await expect(pageC.evaluate(() => globalThis.sendSharedWorker('after-reconnect'))).resolves.toBe(
    'after-reconnect'
  );
  await expect(pageC.evaluate(() => globalThis.sendSharedWorkerTerminal())).resolves.toEqual({
    chunkedRequest: 'shared-worker-chunked-request-😀',
    chunkedTimeout: 'DEADLINE_EXCEEDED',
    dispatchPayload: 'shared-worker-chunked-dispatch-😀',
    remoteError: 'REMOTE_FAILURE',
    aborted: 'CANCELLED',
    schemaError: 'SCHEMA_INVALID',
    pingSuccess: true,
    pingTimeout: false,
    pingAborted: false,
    activePageSnapshot: expect.objectContaining({
      phase: 'active',
      pending: 0,
      chunks: 0,
      activeControllers: 0
    })
  });
  expect(await pageC.evaluate(() => globalThis.disposeSharedWorker())).toEqual([]);
  await pageC.close();
  await expect(pageB.evaluate(() => globalThis.sendSharedWorker('still-B'))).resolves.toBe(
    'still-B'
  );
  expect(await pageB.evaluate(() => globalThis.disposeSharedWorker())).toEqual([]);
  expect(await pageB.evaluate(() => globalThis.sharedWorkerSnapshots())).toEqual({
    page: expect.objectContaining({ phase: 'disposed', pending: 0, resources: 0 }),
    server: expect.objectContaining({ phase: 'disposed', pending: 0, resources: 0 }),
    serverErrors: []
  });
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
