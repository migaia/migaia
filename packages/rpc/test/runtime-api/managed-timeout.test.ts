import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createThreadPeer } from '../../src/threads/index.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../src/threads/adapters/node.js'
import type { IRuntimeDynamicSurface } from '../../src/remote/runtime-api/typing.js'
import { RpcCoreErrorCode } from '../../src/core/errors.js'

/** Both cases load the same actual managed Worker and original launcher/channel/registration. */
const entry = fileURLToPath(new URL('./fixtures/managed-worker.mjs', import.meta.url))

it.each([undefined, 80])(
  '[A79][A80] real managed Worker applies cap %s without restoring the core request default',
  async (cap) => {
    /** The real scheduler records registrations while retaining its original clock and callbacks. */
    const delays: number[] = []
    const scheduler = {
      now: () => systemScheduler.now(),
      schedule: (callback: () => void, delay: number) => {
        delays.push(delay)
        return systemScheduler.schedule(callback, delay)
      }
    }
    /** Original native resource accounting proves cleanup independently from facade close. */
    const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
    const peer = await createThreadPeer<IRuntimeDynamicSurface>({
      defaultTimeoutMs: 40,
      spawn: {
        spec: { entry, ...(cap === undefined ? {} : { limits: { callWallTimeMs: cap } }) },
        budget,
        scheduler,
        launcher: createNodeThreadLauncher(),
        channelFactory: createNodeThreadChannelFactory({ scheduler }),
        report: () => undefined
      },
      report: () => undefined
    })
    try {
      delays.length = 0
      await assert.rejects(peer.request('delay', 120), {
        code: RpcCoreErrorCode.deadlineExceeded
      })
      delays.length = 0
      const request = peer.request('delay', 120, { timeoutMs: false })
      if (cap === undefined) {
        assert.equal(await request, 7)
        assert.equal(
          delays.some((delay) => delay > 900 && delay <= 1000),
          false,
          '[A79] false cannot silently restore the advanced core 1000ms timer'
        )
      } else await assert.rejects(request, { code: RpcCoreErrorCode.deadlineExceeded })
      delays.length = 0
      const stream = peer.stream('delayedValues', 120, { timeoutMs: false })
      assert.deepEqual(delays, [], '[A80] creating a managed stream starts no deadline')
      if (cap === undefined) {
        assert.deepEqual(await stream.next(), { done: false, value: 7 })
        await stream.return!(undefined)
      } else await assert.rejects(stream.next(), { code: RpcCoreErrorCode.deadlineExceeded })
      if (cap !== undefined) assert.ok(delays.some((delay) => delay > cap * 0.9 && delay <= cap))
    } finally {
      await peer.close()
    }
    assert.equal(budget.inUse, 0)
  }
)
