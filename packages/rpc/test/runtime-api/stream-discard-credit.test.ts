import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { readRuntimeCarrier } from '../../src/contract/runtime-api/carrier.js'
import type { IRpcRuntimeEnvelope } from '../../src/contract/runtime-api/types.js'
import { readRuntimePeerConnection } from '../../src/remote/runtime-api/peer.js'
import { connected, RUNTIME_API_FIXTURE_BASE_CAPABILITIES } from './fixture.js'

it.each([false, true])(
  '[A67] late item completion keeps one discard credit with another pull %s',
  async (pulled) => {
    /**
     * Real iterator calls expose concurrent credit without an async generator hiding it in its
     * queue.
     */
    let calls = 0
    /** Count business next operations that have not completed. */
    let active = 0
    /** Preserve any overlap even if the extra next finishes before the assertion. */
    let peak = 0
    /** Before-start discard must not interrupt the business iterator through return. */
    let returns = 0
    /** The second business next remains outstanding while the earlier physical item write finishes. */
    let releaseBusiness!: () => void
    /** The original next awaits this fixture-owned business completion barrier. */
    const business = new Promise<void>((resolve) => {
      releaseBusiness = resolve
    })
    /** Delay only physical completion after the original transport has delivered the actual item. */
    let releaseWrite!: () => void
    /** Delivery is real; only the transport's completion Promise remains outstanding. */
    const writing = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    /** A finite supported async iterator runs inside the one canonical producer. */
    const producer: AsyncIterableIterator<number> = {
      /** Hold only the second credit so another driver becomes independently observable. */
      async next() {
        /** Distinguish each actual business next, including overlapping calls. */
        const ordinal = ++calls
        active++
        peak = Math.max(peak, active)
        try {
          if (ordinal === 2) await business
          return ordinal < 4 ? { done: false, value: ordinal } : { done: true, value: 42 }
        } finally {
          active--
        }
      },
      /** Record interruption independently from the true natural terminal. */
      async return() {
        returns++
        return { done: true, value: 42 }
      },
      [Symbol.asyncIterator]() {
        return this
      }
    }
    /** Bilateral offers select only the original before-start stream and generation owners. */
    const capabilities = [
      ...RUNTIME_API_FIXTURE_BASE_CAPABILITIES,
      RpcCapability.generation,
      RpcCapability.cancelBeforeStart
    ]
    const fixture = await connected(
      {},
      { values: () => producer, barrier: () => 7 },
      capabilities,
      capabilities
    )
    /** The original memory send uses captured carrier state rather than a mutable receiver. */
    const transport = readRuntimePeerConnection(fixture.peers[1]).channel.transport
    const physicalSend = transport.send
    /** Retain every real frame; delay one completion, never replace routing or provider execution. */
    const send = vi.spyOn(transport, 'send').mockImplementation((message, options) => {
      /** Delegate delivery through the supported original carrier before holding completion. */
      const delivered = physicalSend(message, options)
      /** Inspect the existing selector only to identify the one physical item completion. */
      const envelope = readRuntimeCarrier(message)?.frame as IRpcRuntimeEnvelope | undefined
      if (
        envelope?.kind === 'runtime-control' &&
        envelope.operation === 'stream' &&
        envelope.stream.event === 'item' &&
        envelope.stream.seq === 0
      )
        return Promise.resolve(delivered).then(() => writing)
      return delivered
    })
    /** The consumer still owns its original lazy iterator and finish-without-items terminal. */
    const iterator = fixture.peers[0].stream('values', undefined, { cancel: 'before-start' })
    /** Attach cleanup to the genuine pending return even if the regression assertion fails. */
    let returned: Promise<IteratorResult<unknown>> | undefined
    /** A later actual pull can already own next while the earlier physical write remains pending. */
    let pendingNext: Promise<IteratorResult<unknown>> | undefined
    try {
      assert.deepEqual(await iterator.next(), { done: false, value: 1 })
      if (pulled) {
        pendingNext = iterator.next()
        void pendingNext.catch(() => undefined)
        await vi.waitFor(() => assert.equal(calls, 2), { interval: 5 })
      }
      returned = iterator.return!()
      void returned.catch(() => undefined)
      /** Later actual RPC traffic passes the same ingress after the finish intent. */
      assert.equal(await fixture.peers[0].request('barrier'), 7)
      releaseWrite()
      await vi.waitFor(() => assert.ok(calls >= 2), { interval: 5 })
      assert.equal(await fixture.peers[0].request('barrier'), 7)
      assert.equal(peak, 1, '[A67] physical completion cannot create another discard drain')
      assert.equal(active, 1)
      releaseBusiness()
      assert.deepEqual(await returned, { done: true, value: 42 })
      if (pendingNext) assert.deepEqual(await pendingNext, { done: true, value: 42 })
      assert.equal(calls, 4)
      assert.equal(
        returns,
        0,
        '[A67] discard must reach real done without interrupting the iterator'
      )
      assert.equal(fixture.failures.length, 0)
    } finally {
      releaseWrite()
      releaseBusiness()
      await fixture.close()
      await returned?.catch(() => undefined)
      await pendingNext?.catch(() => undefined)
      send.mockRestore()
    }
  }
)
