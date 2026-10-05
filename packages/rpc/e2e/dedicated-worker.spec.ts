import { expect, test } from '@playwright/test'

test('DedicatedWorker supports concurrent RPC and terminal convergence', async ({ page }) => {
  const pageErrors: Error[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.goto('/e2e/fixtures/index.html?scenario=dedicated-worker')
  await page.evaluate(() => globalThis.e2eReady)
  const result = (await page.evaluate(() => globalThis.runDedicatedWorkerScenario())) as {
    values: number[]
    chunkedRequest: string
    chunkedTimeout: string
    dispatchPayload: string
    remoteError: string
    abortedResult: string
    schemaError: string
    pingSuccess: boolean
    pingTimeout: boolean
    pingAborted: boolean
    activePageSnapshot: {
      phase: string
      pending: number
      chunks: number
      activeControllers: number
    }
    terminal: string
    errors: string[]
    workerErrors: string[]
    workerSnapshot: { phase: string; pending: number; resources: number }
    pageSnapshot: { phase: string; pending: number; resources: number }
  }
  expect(result.values).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  expect(result.chunkedRequest).toBe('worker-chunked-request-😀')
  expect(result.chunkedTimeout).toBe('DEADLINE_EXCEEDED')
  expect(result.dispatchPayload).toBe('worker-chunked-dispatch-😀')
  expect(result.remoteError).toBe('REMOTE_FAILURE')
  expect(result.abortedResult).toBe('CANCELLED')
  expect(result.schemaError).toBe('SCHEMA_INVALID')
  expect(result.pingSuccess).toBe(true)
  expect(result.pingTimeout).toBe(false)
  expect(result.pingAborted).toBe(false)
  expect(result.activePageSnapshot).toMatchObject({
    phase: 'active',
    pending: 0,
    chunks: undefined,
    activeControllers: 0
  })
  expect(result.terminal).toBe('DEADLINE_EXCEEDED')
  expect(result.errors).toEqual([])
  expect(result.workerErrors).toEqual([])
  expect(result.workerSnapshot).toMatchObject({ phase: 'disposed', pending: 0, resources: 0 })
  expect(result.pageSnapshot).toMatchObject({ phase: 'disposed', pending: 0, resources: 0 })
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

// Existing dedicated-worker.spec.ts receives this required C3 case; no new test infrastructure.
test('[A2][A17][A65][A67][A74] actual Web Worker adopts library bootstrap and executes reverse and atomic operations', async ({
  page
}) => {
  /** A real browser context independently observes script exceptions. */
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/e2e/fixtures/index.html?scenario=automatic-thread')
  await page.evaluate(() => globalThis.e2eReady)
  const receipt = (await page.evaluate(() => globalThis.runAutomaticThreadScenario())) as {
    result: { value: string; self: { name: string; instanceId: string }; parent: string }
    reverseCalls: number
    fingerprint: string
    failures: string[]
    exited: boolean
    resources: { status: string; reason: string }
    atomic: {
      group: string[]
      replayed: unknown[]
      sealed: { state: string }
      notified: { state: string }
      first: { done: boolean; value: number }
      terminal: { done: boolean; value: number }
      streamed: { state: string; outcome: { completion: unknown } }
    }
  }
  expect(receipt.result.value, '[A2] actual child business').toBe('browser-ready')
  expect(receipt.result.self.name, '[A17] actual launcher name').toBe('browser-automatic-child')
  expect(receipt.result.self.instanceId, '[A17] exact launcher fingerprint').toBe(
    receipt.fingerprint
  )
  expect(receipt.result.parent, '[A2] genuine reverse business').toBe('browser-automatic-parent')
  expect(receipt.reverseCalls, '[A2] exact parent dispatch count').toBe(1)
  expect(receipt.atomic.group).toEqual(['success', 'failure', 'not-executed'])
  expect(receipt.atomic.replayed).toEqual([2, 2])
  expect(receipt.atomic.sealed.state).toBe('done')
  expect(receipt.atomic.notified.state).toBe('done')
  expect(receipt.atomic.first).toEqual({ done: false, value: 1 })
  expect(receipt.atomic.terminal).toEqual({ done: true, value: 99 })
  expect(receipt.atomic.streamed).toMatchObject({
    state: 'done',
    outcome: { completion: { ok: true, result: 99 } }
  })
  expect(receipt.exited, '[A3] unsupported actual exit is never fabricated').toBe(false)
  expect(
    receipt.resources,
    '[A45][A55] unsupported local Web Worker resources are explicit'
  ).toMatchObject({ status: 'unavailable' })
  expect('rssBytes' in receipt.resources, '[A45] parent process RSS is never a Worker sample').toBe(
    false
  )
  expect(receipt.failures).toEqual([])
  expect(pageErrors).toEqual([])
})
