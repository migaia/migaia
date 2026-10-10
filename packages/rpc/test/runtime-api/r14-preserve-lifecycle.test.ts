import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { connected, runtimeSources } from './fixture.js'
import * as runtimeApiEndpoint from '../../src/core/index.js'
import { createRuntimePeer } from '../../src/remote/runtime-api/peer.js'
import { setImmediate as nextTurn } from 'node:timers'
import type { IRpcEnvelope } from '../../src/contract/index.js'
import { getEndpointDebugSnapshotReader } from '../../src/core/internal/test-observer.js'
import { PendingRegistry } from '../../src/core/internal/pending.js'
import { createFullOneWayEndpoint } from '../../src/core/index.js'
import { connect } from '../../src/core/middleware/connect.js'
import type { IRpcInboundMessage } from '../../src/core/transport.js'

it('[R14-A7] borrowed public request preserves projected send Promise, getter capture and pending before dispatch', async () => {
  /** Observe caller capture and actual handler entry separately. */
  const events: string[] = []
  /** Only genuine business send returns are observed; setup and Promise reactions are excluded. */
  const projectedReturns: Promise<unknown>[] = []
  /** Preserve the original default factory rather than installing another endpoint owner. */
  const createEndpoint = runtimeApiEndpoint.createRuntimeApiEndpoint
  /** A cold inherited view observes the canonical send result without allocating a Promise. */
  const projected = vi
    .spyOn(runtimeApiEndpoint, 'createRuntimeApiEndpoint')
    .mockImplementation((...args) => {
      /** The genuine projection retains its original roots, providers and transport. */
      const endpoint = createEndpoint(...args)
      /** Inheritance retains the existing private owner/projection provenance. */
      const observed = Object.create(endpoint) as typeof endpoint
      /** Synchronous delegation returns the exact canonical projection Promise, without reactions. */
      const send: typeof endpoint.send = <T>(...sendArgs: Parameters<typeof endpoint.send>) => {
        /** This result comes from the actual canonical operation, before the Peer facade sees it. */
        const result = endpoint.send<T>(...sendArgs)
        if (sendArgs[1] === 'echo') projectedReturns.push(result)
        return result
      }
      Object.defineProperty(observed, 'send', { value: send })
      return Object.freeze(observed)
    })
  /** Both Peers still use actual factories, projection identities and transport. */
  const fixture = await connected(
    {},
    {
      echo: (value) => {
        events.push('handler')
        return value
      }
    }
  )
  /** Observe actual pending registration rather than a possibly partial debug projection. */
  const registrations = vi.spyOn(PendingRegistry.prototype, 'set')
  /** The public arrow remains callable without its receiver. */
  const request = fixture.peers[0].request
  try {
    /** Getter order is visible before either real handler can execute. */
    const payload = {
      get first() {
        events.push('first')
        return {
          get nested() {
            events.push('nested')
            return 1
          }
        }
      },
      get second() {
        events.push('second')
        return 2
      }
    }
    /**
     * Retain both original public operations and observe cancellation if a RED assertion closes
     * early.
     */
    const one = request('echo', payload, { timeoutMs: false })
    /** Second request independently enters the same actual pending registry. */
    const two = request('echo', { value: 2 }, { timeoutMs: false })
    void one.catch(() => undefined)
    void two.catch(() => undefined)
    assert.equal(projectedReturns.length, 2, '[R14-A7] two actual canonical send returns')
    assert.equal(one, projectedReturns[0], '[R14-A7] original projected send Promise identity')
    assert.equal(two, projectedReturns[1], '[R14-A7] second projected send Promise identity')
    assert.notEqual(one, two)
    assert.deepEqual(
      events,
      ['first', 'second', 'nested'],
      '[R14-A7] synchronous getter capture before handlers'
    )
    assert.equal(registrations.mock.calls.length, 2)
    /** Both business request IDs remain owned before either transport delivery. */
    const registry = registrations.mock.contexts[0] as PendingRegistry<unknown>
    assert.equal(registrations.mock.contexts[1], registry)
    assert.equal(registry.size, 2, '[R14-A7] pending registered before transport delivery')
    assert.deepEqual(await Promise.all([one, two]), [
      Object.assign(Object.create(null), {
        first: Object.assign(Object.create(null), { nested: 1 }),
        second: 2
      }),
      Object.assign(Object.create(null), { value: 2 })
    ])
    assert.deepEqual(events, ['first', 'second', 'nested', 'handler', 'handler'])
    assert.equal(registry.size, 0)
    /** Borrowed close retains the real terminal Promise on all repeated calls. */
    const close = fixture.peers[0].close
    /** The first closure owns idempotent disposal of the genuine Peer. */
    const closing = close()
    assert.equal(close(), closing, '[R14-A7] borrowed close preserves Promise and idempotency')
    await closing
  } finally {
    projected.mockRestore()
    registrations.mockRestore()
    await fixture.close()
  }
})

it('[R14-A7] synchronous transport response reentry sees pending before every physical send', async () => {
  /** The fixture connects two accepted transport callbacks synchronously. */
  const listeners: ((message: IRpcInboundMessage) => void)[] = []
  /** Pending counts are sampled at actual physical invocation before response reentry. */
  const observed: boolean[] = []
  /** Check the genuine pending registry, independently from any diagnostics projection. */
  const registrations = vi.spyOn(PendingRegistry.prototype, 'set')
  /** Supported synchronous transport ports exercise the canonical core without another dispatcher. */
  const transports = [0, 1].map((index) => ({
    platform: 'Memory' as const,
    topology: 'exclusive' as const,
    ownership: 'borrowed' as const,
    subscribe: (listener: (message: IRpcInboundMessage) => void) => {
      listeners[index] = listener
      return () => undefined
    },
    send: (data: unknown) => {
      if (
        index === 0 &&
        Reflect.get(data as object, 'kind') === 'request' &&
        Reflect.get(data as object, 'method') === 'echo'
      ) {
        /** The actual physical request retains its original correlation ID. */
        const id = Reflect.get(data as object, 'id') as string
        /** Locate the actual synchronous registration preceding this exact physical invocation. */
        const at = registrations.mock.calls.findIndex(([registered]) => registered === id)
        /** Check the owning Map, not a diagnostic default or fixture count. */
        const registry = registrations.mock.contexts[at] as PendingRegistry<unknown> | undefined
        observed.push(registry?.has(id) === true)
      }
      listeners[1 - index]!({ data })
    }
  }))
  /** Actual caller owns the two original request IDs and their pending entries. */
  const caller = await createFullOneWayEndpoint({
    id: 'r14-sync-a',
    transport: transports[0]!,
    middlewares: [connect({ transport: transports[0]! })]
  })
  /** Actual provider returns responses through the same production sender. */
  const provider = await createFullOneWayEndpoint({
    id: 'r14-sync-b',
    transport: transports[1]!,
    middlewares: [connect({ transport: transports[1]! })],
    provider: { echo: (context) => context.success(context.data) }
  })
  try {
    assert.deepEqual(
      await Promise.all([
        caller.send('r14-sync-b', 'echo', 1, { timeoutMs: false }),
        caller.send('r14-sync-b', 'echo', 2, { timeoutMs: false })
      ]),
      [1, 2]
    )
    assert.deepEqual(
      observed,
      [true, true],
      '[R14-A7] pending precedes synchronous transport reentry'
    )
    assert.equal(getEndpointDebugSnapshotReader(caller)!().pending, 0)
  } finally {
    registrations.mockRestore()
    await Promise.all([caller.dispose(), provider.dispose()])
  }
})

it('[R14-A26] physical response delivery settles public observers in the original turn, FIFO and once', async () => {
  /** Public Promise reactions, not an inner resolver or one timer API, decide settlement timing. */
  const reactions: number[] = []
  /**
   * Each physical business response creates one observation fence before entering the real
   * receiver.
   */
  const fences: Promise<void>[] = []
  /** Preserve the original source and transport identities throughout preparation and business. */
  const channel = runtimeSources()
  /** Existing subscription is delegated verbatim after the real delivery boundary is observed. */
  const subscribe = channel.transports[0].subscribe
  channel.transports[0].subscribe = (listener) =>
    subscribe((message) => {
      /** Identity carrier carries actual provider envelopes or their actual physical batch. */
      const frame = message.data as IRpcEnvelope | { kind: string; envelopes: IRpcEnvelope[] }
      /** Count physical delivery separately from the genuine response members. */
      const members =
        frame.kind === 'batch'
          ? (frame as { envelopes: IRpcEnvelope[] }).envelopes
          : [frame as IRpcEnvelope]
      /** Preparation directory replies do not belong to this business turn observation. */
      const wanted = members
        .filter((member) => member.kind === 'response' && member.data.route.method === 'echo')
        .map((member) => member.data.payload as number)
      if (wanted.length) {
        /**
         * Native check-phase fence is queued before receive; a later setImmediate settlement cannot
         * overtake it.
         */
        const fence = new Promise<void>((resolve, reject) => {
          nextTurn(() => {
            try {
              for (const value of wanted)
                assert.equal(
                  reactions.includes(value),
                  true,
                  '[R14-A26] public response observer runs before the delivery turn fence'
                )
              resolve()
            } catch (error) {
              reject(error)
            }
          })
        })
        void fence.catch(() => undefined)
        fences.push(fence)
      }
      return listener(message)
    })
  /**
   * Both callables remain real Runtime Peers; no dispatcher, async clock or lifecycle owner is
   * replaced.
   */
  const peers = await Promise.all([
    createRuntimePeer({
      self: { name: 'parent', instanceId: 'parent-1' },
      connect: channel.sources[0],
      report: () => undefined
    }),
    createRuntimePeer({
      self: { name: 'child', instanceId: 'child-1' },
      connect: channel.sources[1],
      provide: { echo: (value) => value },
      report: () => undefined
    })
  ])
  /** Late abort is independent of response success and must not produce another observation. */
  const controller = new AbortController()
  try {
    /** The observers attach to the actual exported Promise before any transport callback. */
    const one = peers[0].request('echo', 1, { signal: controller.signal, timeoutMs: false })
    /** Second real request detects FIFO independently from response frame packing. */
    const two = peers[0].request('echo', 2, { timeoutMs: false })
    one.then(
      (value) => reactions.push(value as number),
      () => undefined
    )
    two.then(
      (value) => reactions.push(value as number),
      () => undefined
    )
    assert.deepEqual(await Promise.all([one, two]), [1, 2])
    await Promise.all(fences)
    assert.ok(fences.length > 0, '[R14-A26] actual physical response delivery was observed')
    assert.deepEqual(
      reactions,
      [1, 2],
      '[R14-A26] real response reactions preserve FIFO and settle once'
    )
    controller.abort(new Error('r14-late-abort'))
    /** Original close ownership remains stable after successful response and late cancellation. */
    const closing = peers[0].close()
    assert.equal(peers[0].close(), closing)
    await closing
    assert.deepEqual(reactions, [1, 2])
  } finally {
    await Promise.all(peers.map((peer) => peer.close()))
    channel.close()
  }
})
