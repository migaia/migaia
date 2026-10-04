import assert from 'node:assert/strict'
import { it } from 'vitest'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { messageFramerV1 } from '../../src/contract/framing/index.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import type { IRpcTransport } from '../../src/core/transport.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { createCanonicalChunkFeature } from '../../src/core/features/canonical-chunk.js'
import { createOutboundFeature } from '../../src/core/features/outbound.js'
import { createProviderFeature } from '../../src/core/features/provider.js'
import { createOneWayFeature } from '../../src/core/features/one-way.js'
import { connect } from '../../src/core/middleware/connect.js'
import { abort } from '../../src/core/middleware/abort.js'
import { timeout } from '../../src/core/middleware/timeout.js'
import { authentication } from '../../src/core/middleware/authentication.js'
import { hooks } from '../../src/core/middleware/hooks.js'
import { createHmac } from 'node:crypto'
import { setImmediate as nextTurn } from 'node:timers/promises'
import {
  createIpcSendQueueFeature,
  createIpcSendQueueTransport
} from '../../src/core/plugins/send-queue.js'
import { RuntimeApiFixtureText } from './fixture.js'

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
      codec: identityCodecV1,
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

it('[A56] a pre-aborted one-way send keeps its reason and produces no physical frame', async () => {
  /** Both endpoints execute the current canonical provider/outbound/one-way graph. */
  const [callerTransport, providerTransport] = createMemoryTransportPair()
  /** This counter observes the real carrier, rather than client in-flight bookkeeping. */
  let sent = 0
  /** Capture the original receiver through an arrow instead of receiver-mutating helpers. */
  const observed = {
    ...callerTransport,
    send: (message: unknown) => {
      sent += 1
      return callerTransport.send(message)
    }
  }
  /** Construction and a round-trip must succeed before testing the cancellation predicate. */
  const [caller, provider] = await Promise.all([
    endpoint('caller', observed),
    endpoint('provider', providerTransport)
  ])
  try {
    assert.equal(await caller.send('provider', 'ready', null), 'ready')
    sent = 0
    /** The native reason instance must remain reachable through the canonical local abort error. */
    const reason = new Error(RuntimeApiFixtureText.preAbort)
    /** Native cancellation is applied before the existing one-way entry point is called. */
    const controller = new AbortController()
    controller.abort(reason)
    /** The production option retains the supported signal and its original reason. */
    const [result] = await Promise.allSettled([
      Promise.resolve().then(() =>
        caller.sendOneWay('provider', 'ready', null, { signal: controller.signal })
      )
    ])
    assert.equal(sent, 0, '[A56] pre-aborted notify must not reach the physical transport')
    assert.equal(result?.status, 'rejected', '[A56] cancellation is observable to the sender')
    if (result?.status !== 'rejected') return
    assert.equal(result.reason.code, 'CANCELLED', '[A56] the original abort code is preserved')
    assert.equal(result.reason.cause, reason, '[A56] the caller reason keeps local identity')
  } finally {
    await caller.dispose()
    await provider.dispose()
    callerTransport.close()
  }
})

it('[A56] a cancelled one-way item leaves the canonical send queue without a frame or retry', async () => {
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
  const queue = createIpcSendQueueFeature({ connectionId: 'a56-real-queue' })
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
    assert.equal(result?.status, 'rejected', '[A56] queued cancellation is local and immediate')
    if (result?.status === 'rejected') {
      assert.equal(result.reason.code, 'CANCELLED')
      assert.equal(result.reason.cause, reason)
    }
    release()
    await first
    await caller.sendOneWay('provider', 'ready', null)
    await queue.gate.whenIdle()
    assert.equal(sends, 2, '[A56] only the original and explicit later sends reach the carrier')
  } finally {
    release()
    await caller.dispose()
    await provider.dispose()
    base.close()
  }
})

/** Both cancellation paths must withdraw the same genuine preparation before commit. */
for (const control of ['abort', 'deadline', 'late-failure'] as const) {
  it(`[A56] ${control} during asynchronous signing withdraws the one-way frame before physical send`, async () => {
    /** Actual caller writes are counted after the canonical authentication transform. */
    const [callerTransport, providerTransport] = createMemoryTransportPair()
    /** Count the actual transport boundary independently of the operation's settled Promise. */
    let sent = 0
    /** Preserve the adapter's native receiver through an arrow. */
    const observed = {
      ...callerTransport,
      send: (message: unknown) => {
        sent += 1
        return callerTransport.send(message)
      }
    }
    /** Only the notification's sign operation is held after the successful business baseline. */
    let hold = false
    /** The test releases genuine authentication work; it never substitutes a send or provider owner. */
    let release!: () => void
    /** Signature preparation remains in progress when the caller requests cancellation. */
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    /** Observe the exact asynchronous phase without sleeps or speculative timing. */
    let enter!: () => void
    /** No cancellation occurs until the real authentication callback has started. */
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    /** A public fixture key gives a real complete-frame signature with no private credential. */
    const signature = (value: unknown) =>
      createHmac('sha256', 'a56-public-fixture-key').update(JSON.stringify(value)).digest('hex')
    /** The native transform failure arrives only after the caller has already cancelled. */
    const lateFailure = new RangeError(RuntimeApiFixtureText.lateAuthentication)
    /** Reporting is observed through the original failure hook without any per-request listener. */
    const failures: unknown[] = []
    /** Both sides verify actual protected counter/nonce content through the existing auth owner. */
    const protection = (caller: boolean) =>
      authentication({
        sign: async (value) => {
          if (caller && hold) {
            hold = false
            enter()
            await held
            if (control === 'late-failure') throw lateFailure
          }
          return { value, signature: signature(value) }
        },
        verify: (value) => {
          /** The fixture assertion applies to real signed values rather than a claimed auth field. */
          const frame = value as { value: unknown; signature: string }
          assert.equal(frame.signature, signature(frame.value))
          return frame.value
        }
      })
    /** The adapter has no outbound gate, so admission must survive the original normal sender path. */
    const [caller, provider] = await Promise.all([
      endpoint('caller', observed, protection(true), undefined, (error) => {
        failures.push(error)
      }),
      endpoint('provider', providerTransport, protection(false))
    ])
    try {
      assert.equal(await caller.send('provider', 'ready', null), 'ready')
      sent = 0
      /** Keep the original cancellation reason identity after asynchronous preparation has begun. */
      const reason = new Error(RuntimeApiFixtureText.signingAbort)
      /** Cancellation during real signing is owned by the caller's native signal. */
      const controller = new AbortController()
      hold = true
      /** Cancellation reaches the actual sender while its authentication owner is preparing. */
      const pending = caller.sendOneWay(
        'provider',
        'ready',
        null,
        control !== 'deadline' ? { signal: controller.signal } : { timeoutMs: 10 }
      )
      /** Attach observation before abort so an expected rejection cannot become unhandled. */
      const settlement = Promise.allSettled([pending])
      await entered
      if (control !== 'deadline') controller.abort(reason)
      await settlement
      release()
      /** A full later real round-trip proves all prior authentication microtasks have completed. */
      await nextTurn()
      assert.equal(await caller.send('provider', 'ready', null), 'ready')
      /** Only the later baseline request may be physically emitted. */
      assert.equal(sent, 1, '[A56] an aborted signing operation emits zero notification frames')
      if (control === 'late-failure') {
        /** The late failure does not replace cancellation, disappear, or trigger a retry. */
        const reported = failures.find(
          (error) => (error as { cause?: unknown }).cause === lateFailure
        ) as { source?: string; code?: string; name?: string } | undefined
        assert.ok(reported, '[A56] late transform failure is reported with its original cause')
        assert.equal(reported.source, '@migaia/rpc/core')
        assert.equal(reported.code, 'AUTHENTICATION_FAILED')
      }
      /** Cancellation uses the native code and exact local cause. */
      const [result] = await settlement
      assert.equal(result?.status, 'rejected', '[A56] abort during signing remains observable')
      if (result?.status === 'rejected') {
        assert.equal(result.reason.code, control !== 'deadline' ? 'CANCELLED' : 'DEADLINE_EXCEEDED')
        if (control !== 'deadline') assert.equal(result.reason.cause, reason)
      }
    } finally {
      release()
      await caller.dispose()
      await provider.dispose()
      callerTransport.close()
    }
  })
}
