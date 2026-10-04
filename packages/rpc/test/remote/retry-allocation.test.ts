import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createRemoteRetryPort } from '../../src/remote/retry.js'
import type { IRemoteGenerationEvents } from '../../src/remote/types.js'

/** Count only this original retry owner's readiness controllers, outside native endpoint setup. */
const allocations = vi.hoisted(() => ({ controllers: 0 }))
vi.mock('@migaia/lifecycle', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('@migaia/lifecycle')>()
  return {
    ...original,
    createAbortController: () => {
      allocations.controllers += 1
      return original.createAbortController()
    }
  }
})

it('[C4-fix:M2] successful unreplayed retry dispatch creates no readiness AbortController', async () => {
  /** This actual event contract never retires its observed original generation. */
  const events: IRemoteGenerationEvents = {
    current: () => ({ generation: 1, active: true }),
    onLeave: () => () => undefined,
    whenReady: () => {
      assert.fail('[C4-fix:M2] an unreplayed call never waits for a successor')
    }
  }
  const scheduler = createManualScheduler()
  const port = createRemoteRetryPort({
    events,
    scheduler,
    report: (error) => {
      throw error
    }
  })
  allocations.controllers = 0
  for (const idempotent of [false, true]) {
    const result = await port.dispatch({
      method: 'example.echo',
      mode: 'request',
      generation: 1,
      idempotent,
      events,
      sendOnce: async () => 42
    })
    assert.equal(result, 42)
  }
  assert.equal(
    allocations.controllers,
    0,
    '[C4-fix:M2] only real replay allocates a readiness controller'
  )
  assert.equal(scheduler.pendingCount, 0)
})
