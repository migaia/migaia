import assert from 'node:assert/strict'
import { it } from 'vitest'
import { identityCodec } from '@migaia/serialize/codecs/identity/v1'
import { messageFramerV1 } from '@migaia/rpc-contract/framing'
import { createMemoryTransportPair } from '../fixtures/memory-transport.js'
import type { IRpcTransport } from '../../dist/core/transport.js'
import { createComposedEndpoint } from '../../dist/core/composed.js'
import { createCanonicalChunkFeature } from '../../dist/core/features/canonical-chunk.js'
import { createOutboundFeature } from '../../dist/core/features/outbound.js'
import { createProviderFeature } from '../../dist/core/internal/provider-feature.js'
import { createOneWayFeature } from '../../dist/core/features/one-way.js'
import { connect } from '../../dist/core/middleware/connect.js'
import { abort } from '../../dist/core/middleware/abort.js'
import { timeout } from '../../dist/core/middleware/timeout.js'
import { authentication } from '../../dist/core/middleware/authentication.js'
import { hooks } from '../../dist/core/middleware/hooks.js'
import { setImmediate as nextTurn } from 'node:timers/promises'
import {
  createIpcSendQueueFeature,
  createIpcSendQueueTransport
} from '../../dist/core/plugins/send-queue.js'
import { RuntimeApiFixtureText } from '../fixtures/runtime-api-text.js'

/** Select the real native owner graph, optionally with a controlled authentication preparation. */
function endpoint(
  id: string,
  transport: IRpcTransport,
  protection?: ReturnType<typeof authentication>,
  sendQueue?: ReturnType<typeof createIpcSendQueueFeature>['feature'],
  report?: (error: unknown) => void
) {
  /** The original chunk owner is shared by all endpoint roots in this fixture. */
  const chunk = createCanonicalChunkFeature()
  /** Provider and notification features depend on the same outbound/security closure. */
  const outbound = createOutboundFeature(chunk)
  return createComposedEndpoint(
    {
      id,
      transport,
      codec: identityCodec,
      framer: messageFramerV1,
      provider: { ready: (context) => context.success('ready') },
      middlewares: [
        connect({ transport }),
        abort(),
        timeout(),
        ...(protection ? [protection] : []),
        ...(report ? [hooks({ onHookError: report })] : [])
      ]
    },
    {
      'first-party-chunk': chunk,
      'first-party-outbound': outbound,
      'first-party-provider': createProviderFeature(outbound),
      'first-party-one-way': createOneWayFeature(outbound),
      ...(sendQueue ? { 'channel-send-queue': sendQueue } : {})
    }
  )
}

it('a cancelled one-way item leaves the canonical send queue without a frame or retry', async () => {
  /** One genuine host write holds the original gate while the next operation becomes queued. */
  const [base, providerTransport] = createMemoryTransportPair()
  /** Actual writes, including recovery, distinguish queue withdrawal from a dropped response. */
  let sends = 0
  /** The original host write stays live independently of the queued cancellation. */
  let release!: () => void
  /** A native adapter Promise exposes the supported writability boundary. */
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  /** The test observes entry into the physical transport before queuing the cancellable item. */
  let enter!: () => void
  /** This barrier has no fixture queue or RPC dispatcher. */
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  /** The same existing bounded gate is registered by its Feature and wrapped transport. */
  const queue = createIpcSendQueueFeature({ connectionId: 'real-queue' })
  /** Native delivery is retained, while completion of only the first write is deliberately held. */
  const transport = createIpcSendQueueTransport(
    {
      ...base,
      send: (message: unknown) => {
        sends += 1
        /** The original memory carrier still performs actual delivery independently of completion. */
        const delivery = base.send(message)
        if (sends === 1) {
          enter()
          return held
        }
        return delivery
      }
    },
    queue.gate
  )
  /** Ordinary endpoint construction installs the real canonical owner closure. */
  const [caller, provider] = await Promise.all([
    endpoint('caller', transport, undefined, queue.feature),
    endpoint('provider', providerTransport)
  ])
  try {
    /** The first accepted write holds the gate without a response waiter. */
    const first = caller.sendOneWay('provider', 'ready', null)
    await entered
    /** The second item has an independent caller cancellation reason. */
    const reason = new Error(RuntimeApiFixtureText.queuedAbort)
    /** Only the queued item owns this signal; the held physical write remains independent. */
    const controller = new AbortController()
    /** Observe rejection before aborting so the expected error cannot become unhandled. */
    const cancelled = Promise.allSettled([
      caller.sendOneWay('provider', 'ready', null, { signal: controller.signal })
    ])
    await nextTurn()
    controller.abort(reason)
    /** Cancellation settles while the first physical write is still held. */
    const [result] = await cancelled
    assert.equal(result?.status, 'rejected', 'queued cancellation is local and immediate')
    if (result?.status === 'rejected') {
      assert.equal(result.reason.code, 'CANCELLED')
      assert.equal(result.reason.cause, reason)
    }
    release()
    await first
    await caller.sendOneWay('provider', 'ready', null)
    await queue.gate.whenIdle()
    assert.equal(sends, 2, 'only the original and explicit later sends reach the carrier')
  } finally {
    release()
    await caller.dispose()
    await provider.dispose()
    base.close()
  }
})
