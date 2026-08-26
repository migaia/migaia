import { expect, test } from '@playwright/test'

test('browser MessagePort performs RPC and closes owned ports', async ({ page }) => {
  await page.goto('/e2e/fixtures/index.html?scenario=message-port')
  await page.evaluate(() => globalThis.e2eReady)
  const result = await page.evaluate(() => globalThis.runMessagePortScenario())
  expect(result).toMatchObject({
    result: { value: 42 },
    chunkedRequest: 'chunked-request-😀-payload',
    chunkedRemoteError: 'REMOTE_FAILURE',
    chunkedTimeout: 'DEADLINE_EXCEEDED',
    chunkedAbort: 'CANCELLED',
    chunkedSchemaError: 'SCHEMA_INVALID',
    dispatchPayload: 'chunked-dispatch-😀-payload',
    errors: [],
    portsClosed: [1, 1],
    snapshots: {
      left: { phase: 'disposed', pending: 0, resources: 0 },
      right: { phase: 'disposed', pending: 0, resources: 0 }
    }
  })
})

test('browser MessagePort converges remote error, timeout, and caller abort', async ({ page }) => {
  await page.goto('/e2e/fixtures/index.html?scenario=message-port')
  await page.evaluate(() => globalThis.e2eReady)
  const result = (await page.evaluate(() => globalThis.runMessagePortScenario())) as {
    remoteError: string
    timeout: string
    aborted: string
    schemaError: string
    transportError: string
    pingSuccess: boolean
    pingTimeout: boolean
    pingAborted: boolean
    providerTerminalSnapshot: { activeControllers: number; providers: number }
    transportTerminalSnapshot: { phase: string; pending: number; chunks: number }
    errors: string[]
  }
  expect(result.remoteError).toBe('REMOTE_FAILURE')
  expect(result.timeout).toBe('DEADLINE_EXCEEDED')
  expect(result.aborted).toBe('CANCELLED')
  expect(result.schemaError).toBe('SCHEMA_INVALID')
  expect(result.transportError).toBe('TRANSPORT')
  expect(result.transportTerminalSnapshot).toMatchObject({
    phase: 'active',
    pending: 0,
    chunks: 0
  })
  expect(result.pingSuccess).toBe(true)
  expect(result.pingTimeout).toBe(false)
  expect(result.pingAborted).toBe(false)
  expect(result.providerTerminalSnapshot).toMatchObject({ activeControllers: 0 })
  expect(result.errors).toEqual([])
})

test('browser MessagePort borrowed ownership leaves port closure to its caller', async ({
  page
}) => {
  await page.goto('/e2e/fixtures/index.html?scenario=message-port')
  await page.evaluate(() => globalThis.e2eReady)
  const result = await page.evaluate(() => globalThis.runBorrowedMessagePortScenario())
  expect(result).toMatchObject({
    result: 'borrowed',
    errors: [],
    portsClosed: [0, 1],
    snapshots: {
      left: { phase: 'disposed', pending: 0, resources: 0 },
      right: { phase: 'disposed', pending: 0, resources: 0 }
    }
  })
})
