import { expect, test } from '@playwright/test'

test('WebTransport datagrams converge remote error, timeout, and caller abort', async ({
  page
}) => {
  await page.goto('/e2e/fixtures/index.html?scenario=web-transport')
  await page.evaluate(() => globalThis.e2eReady)
  const result = (await page.evaluate(() => globalThis.runWebTransportScenario())) as {
    result: { value: number }
    unsupportedChunkResult: string
    dispatchCalls: number
    remoteError: string
    timeout: string
    aborted: string
    schemaError: string
    pingSuccess: boolean
    pingTimeout: boolean
    pingAborted: boolean
    transportError: string
    transportTerminalSnapshot: { phase: string; pending: number; chunks: number }
    cleanup: string[]
    errors: string[]
    snapshots: {
      left: { phase: string; pending: number; resources: number }
      right: { phase: string; pending: number; resources: number }
    }
  }
  expect(result.result).toEqual({ value: 42 })
  expect(result.unsupportedChunkResult).toBe('INVALID_CONFIG')
  expect(result.dispatchCalls).toBe(1)
  expect(result.remoteError).toBe('REMOTE_FAILURE')
  expect(result.timeout).toBe('DEADLINE_EXCEEDED')
  expect(result.aborted).toBe('CANCELLED')
  expect(result.schemaError).toBe('SCHEMA_INVALID')
  expect(result.pingSuccess).toBe(true)
  expect(result.pingTimeout).toBe(false)
  expect(result.pingAborted).toBe(false)
  expect(result.transportError).toBe('TRANSPORT')
  expect(result.transportTerminalSnapshot).toMatchObject({
    phase: 'active',
    pending: 0,
    chunks: 0
  })
  expect(result.cleanup).toEqual(['ok', 'ok'])
  expect(result.errors).toEqual([])
  expect(result.snapshots.left).toMatchObject({ phase: 'disposed', pending: 0, resources: 0 })
  expect(result.snapshots.right).toMatchObject({ phase: 'disposed', pending: 0, resources: 0 })
})
