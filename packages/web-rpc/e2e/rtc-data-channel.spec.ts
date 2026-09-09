import { expect, test } from '@playwright/test'

test('RTCDataChannel loopback performs RPC and reaches terminal state', async ({ page }) => {
  await page.goto('/e2e/fixtures/index.html?scenario=rtc-data-channel')
  await page.evaluate(() => globalThis.e2eReady)
  const result = (await page.evaluate(() => globalThis.runRtcScenario())) as {
    result: string
    chunkedRequest: string
    chunkedRemoteError: string
    chunkedTimeout: string
    chunkedAbort: string
    chunkedSchemaError: string
    dispatchPayload: string
    remoteError: string
    timeoutResult: string
    aborted: string
    schemaError: string
    pingSuccess: boolean
    pingTimeout: boolean
    pingAborted: boolean
    terminal: string
    activeSnapshots: {
      left: { phase: string; pending: number; chunks: number; activeControllers: number }
      right: { phase: string; pending: number; chunks: number; activeControllers: number }
    }
    errors: string[]
    snapshots: {
      left: { phase: string; pending: number; resources: number }
      right: { phase: string; pending: number; resources: number }
    }
  }
  expect(result.result).toBe('rtc-ok')
  expect(result.chunkedRequest).toBe('rtc-chunked-request-😀')
  expect(result.chunkedRemoteError).toBe('REMOTE_FAILURE')
  expect(result.chunkedTimeout).toBe('DEADLINE_EXCEEDED')
  expect(result.chunkedAbort).toBe('CANCELLED')
  expect(result.chunkedSchemaError).toBe('SCHEMA_INVALID')
  expect(result.dispatchPayload).toBe('rtc-chunked-dispatch-😀')
  expect(result.remoteError).toBe('REMOTE_FAILURE')
  expect(result.timeoutResult).toBe('DEADLINE_EXCEEDED')
  expect(result.aborted).toBe('CANCELLED')
  expect(result.schemaError).toBe('SCHEMA_INVALID')
  expect(result.pingSuccess).toBe(true)
  expect(result.pingTimeout).toBe(false)
  expect(result.pingAborted).toBe(false)
  expect(result.terminal).toBe('TRANSPORT')
  expect(result.activeSnapshots).toMatchObject({
    left: { phase: 'active', pending: 0, chunks: undefined, activeControllers: 0 },
    right: { phase: 'active', pending: 0, chunks: undefined }
  })
  expect(result.errors).toEqual([])
  expect(result.snapshots).toMatchObject({
    left: { phase: 'disposed', pending: 0, resources: 0 },
    right: { phase: 'disposed', pending: 0, resources: 0 }
  })
})
