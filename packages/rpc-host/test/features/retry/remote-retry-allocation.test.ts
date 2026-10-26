import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import type { IRpcAvailableAttempt } from '@migaia/rpc-contract/interfaces'
import { retry } from '@migaia/rpc-host/features/retry'

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

it('successful unreplayed retry dispatch creates no readiness AbortController', async () => {
  /** This actual strategy input never retires its observed original generation. */
  const available: IRpcAvailableAttempt = {
    carrierId: 'original',
    generation: 1,
    onLeave: () => () => undefined,
    whenReady: () => {
      assert.fail('an unreplayed call never waits for a successor')
    }
  }
  const scheduler = createManualScheduler()
  /** User key factories receive no immutable retry-policy receiver. */
  const keyReceivers: unknown[] = []
  const strategy = retry({
    scheduler,
    keyFactory(this: unknown) {
      keyReceivers.push(this)
      return 'receiver-free-key'
    },
    report: (error) => {
      throw error
    }
  })
  /** Required parent cancellation is independent of the counted lifecycle readiness factory. */
  const signal = new AbortController().signal
  allocations.controllers = 0
  for (const idempotent of [false, true]) {
    const result = await strategy.run({
      signal,
      facts: {
        method: 'example.echo',
        idempotent,
        availability: { current: () => available }
      },
      invoke: async () => 42
    })
    assert.equal(result, 42)
  }
  assert.deepEqual(keyReceivers, [undefined])
  assert.equal(allocations.controllers, 0, 'only real replay allocates a readiness controller')
  assert.equal(scheduler.pendingCount, 0)
})
