import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { RuntimePluginKey } from '@migaia/rpc-host/plugin'
import { runtimeTestHost } from '../../../rpc-host/test/runtime-api/fixture.js'
import { readRuntimeOutletConnection } from '../../../rpc-host/dist/remote/runtime-api/outlet.js'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it, vi } from 'vitest'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../../rpc-plugin-thread/dist/threads/adapters/node.js'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcStreamOwner } from '../../../rpc-host/dist/core/internal/stream/owner.js'

/** Both cases load the same actual managed Worker and original launcher/channel/registration. */
const entry = fileURLToPath(new URL('./fixtures/managed-worker.mjs', import.meta.url))

it.each([undefined, 80])(
  'real managed Worker applies cap %s without restoring the core request default',
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
    /** The real native Host owns installation and rollback for this managed connection. */
    const host = runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    /** The committed outlet lends its genuine managed Peer and original iterator/call contracts. */
    const peer = await host
      .use(
        threadPlugin({
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
      )
      .then(() => readRuntimeOutletConnection(host.thread, RuntimePluginKey.thread)!.peer)
    /** Observe admission at the actual shared Host stream owner, with its original call-through. */
    const opening = vi.spyOn(RpcStreamOwner.prototype, 'openRuntime')
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
          'false cannot silently restore the advanced core 1000ms timer'
        )
      } else await assert.rejects(request, { code: RpcCoreErrorCode.deadlineExceeded })
      delays.length = 0
      const stream = peer.stream('delayedValues', 120, { timeoutMs: false })
      assert.deepEqual(delays, [], 'creating a managed stream starts no deadline')
      // Direct native streams may create an inert consumer; the original oracle forbids a timer.
      if (cap === undefined) {
        assert.deepEqual(await stream.next(), { done: false, value: 7 })
        await stream.return!(undefined)
      } else await assert.rejects(stream.next(), { code: RpcCoreErrorCode.deadlineExceeded })
      assert.equal(opening.mock.calls.length, 1)
      assert.equal(opening.mock.calls[0]![1], 'delayedValues')
      assert.equal(
        opening.mock.calls[0]![4]?.timeoutMs,
        cap ?? false,
        'the canonical stream receives the exact launcher cap or explicit disabled timeout'
      )
    } finally {
      opening.mockRestore()
      await host.dispose()
    }
    assert.equal(budget.inUse, 0)
  }
)
