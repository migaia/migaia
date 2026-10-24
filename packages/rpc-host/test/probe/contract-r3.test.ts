import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { RpcCapability } from '@migaia/rpc-contract'
import { runtimeSources } from '../runtime-api/fixture.js'
import { RUNTIME_API_CAPABILITIES } from '../../dist/remote/runtime-api/constants.js'
import { createRuntimePeer } from '../../dist/remote/runtime-api/peer.js'
import { expect, it, vi } from 'vitest'

import { connect } from '../../dist/core/middleware/connect.js'
import { createMemoryTransportPair } from '../fixtures/memory-transport.js'
import {
  defineProbe,
  readProbeStages,
  subscribeProbeStages,
  RpcProbeDirection,
  RpcProbeKind,
  RpcProbeStage,
  RpcProbeStageName,
  type IRpcProbeEventView
} from '../../dist/core/probe/index.js'
import { RpcEnvelopeKind, RpcRouteProfile, RpcRouteType } from '@migaia/rpc-contract'
import { readRuntimePeerEndpoint } from '../../dist/remote/runtime-api/peer.js'
import { readEndpointOwner } from '../../dist/core/internal/endpoint-projection.js'
import { EndpointOwnerKey } from '../../dist/core/endpoint-kernel.js'
import type { RpcOutboundAttachment } from '../../dist/core/internal/outbound-attachment.js'

it('reads frozen host stages and releases one notification per change', () => {
  /** Host-form public fields remain initial while the canonical state tracks active stages. */
  const probe = defineProbe({ stages: ['message'], emit: () => undefined }, {})
  /** Cold notifications must fire only for actual changes and stop after release. */
  const changed = vi.fn()
  /** Subscription release is idempotent and owns no business-path work. */
  const release = subscribeProbeStages(probe, changed)
  probe.setStages(['message', 'frame'])
  probe.setStages(['message', 'frame'])
  expect(probe.stageMask).toBe(2)
  expect(readProbeStages(probe)).toBe(18)
  expect(changed).toHaveBeenCalledTimes(1)
  release()
  release()
  probe.setStages([])
  expect(readProbeStages(probe)).toBe(0)
  expect(changed).toHaveBeenCalledTimes(1)
})

it('provides the actual serving endpoint identity', async () => {
  /** Existing memory transport exercises the provider context through the public endpoint. */
  const [left, right] = createMemoryTransportPair()
  /** Provider identity comes from its executor rather than the request sender. */
  const server = await createRuntimeEndpointComposition(
    {
      id: 'r3-server',
      transport: right,
      middlewares: [connect()],
      provider: { identity: (context) => context.success(context.localEndpointId) }
    },
    { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
  ).installing
  /** Caller retains a distinct identity to detect accidental sender-id forwarding. */
  const client = await createRuntimeEndpointComposition(
    {
      id: 'r3-client',
      transport: left,
      middlewares: [connect()]
    },
    { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
  ).installing
  try {
    expect(await client.send('r3-server', 'identity', undefined)).toBe('r3-server')
  } finally {
    await Promise.all([client.dispose(), server.dispose()])
  }
})

it('preserves variation identity through both real Peer directions and method filtering', async () => {
  /** Snapshots retain only the explicit test consumer's view copies from the two original emitters. */
  const observations: IRpcProbeEventView[][] = [[], []]
  /** Every stage is observed to detect a variation leaking into a later reused view. */
  const probes = observations.map((events) =>
    defineProbe({
      stages: RpcProbeStageName,
      methods: ['echo'],
      emit: (view) => events.push(Object.freeze({ ...view }))
    })
  )
  /** Existing side spreading forwards the original probes without widening the public pair helper. */
  const configurations = {
    a: { provide: {}, probe: probes[0]! },
    b: { provide: {}, probe: probes[1]! }
  }
  /** The public pair creates original runtime Peers on the canonical reference memory carrier. */
  const pairOptions = configurations
  /** Reuse the independently negotiated sources and actual canonical Peer constructors. */
  const pairChannel = runtimeSources(RUNTIME_API_CAPABILITIES, RUNTIME_API_CAPABILITIES)
  const [a, b] = await Promise.all([
    createRuntimePeer({
      ...pairOptions.a,
      self: { name: 'a', instanceId: 'test-pair-a' },
      connect: pairChannel.sources[0]
    }),
    createRuntimePeer({
      ...pairOptions.b,
      self: { name: 'b', instanceId: 'test-pair-b' },
      connect: pairChannel.sources[1]
    })
  ])
  const pair = { a, b }
  /** Stable local fixture data distinguishes a registered subtype from the cancelled echo payload. */
  const variationFixture = { user: 'user-observation', held: 'held-variation' } as const
  /** Existing private readers expose the genuine controls without installing a test dispatcher. */
  const peers = [pair.a, pair.b] as const
  /** Public endpoint controls supply legacy variation traffic on each genuine Peer connection. */
  const endpoints = peers.map((peer) => readRuntimePeerEndpoint(peer).endpoint)
  /** The original outbound attachment already owns user variation registration and physical sends. */
  const outbound = endpoints.map((endpoint) =>
    readEndpointOwner<RpcOutboundAttachment>(endpoint, EndpointOwnerKey.outboundAttachment)!
  )
  /** Provider-start evidence prevents an abort before its actual request reaches the other endpoint. */
  const started = [false, false]
  /** Provider signal evidence proves each abort was delivered, rather than only rejected locally. */
  const aborted = [false, false]
  /** One explicitly registered subtype has its own real receiver completion evidence. */
  const customReceived = [0, 0]
  /** Release handles belong to the canonical registration owner and are closed before the Peers. */
  const releases = outbound.map((owner, index) =>
    owner.variations.register(variationFixture.user, () => {
      customReceived[index]++
    })
  )
  for (let index = 0; index < endpoints.length; index++) {
    /** Echo remains the selected business method, including the actively cancelled invocation. */
    endpoints[index]!.provide('echo', async (context) => {
      if (context.data === variationFixture.held) {
        started[index] = true
        await new Promise<void>((resolve) => {
          context.signal.addEventListener(
            'abort',
            () => {
              aborted[index] = true
              resolve()
            },
            { once: true }
          )
        })
      }
      return context.success(context.data)
    })
    /** This second method executes normally but is excluded by the compiled observation filter. */
    endpoints[index]!.provide('other', (context) => context.success(context.data))
  }
  try {
    for (let index = 0; index < peers.length; index++) {
      /** Each orientation proves outbound on one emitter and inbound on the other. */
      const sender = endpoints[index]!
      /** The target identity comes from the actual Peer pair, not a fabricated route registry. */
      const target = peers[1 - index]!.self.instanceId
      expect(await sender.send(target, 'echo', index)).toBe(index)
      expect(await sender.send(target, 'other', index)).toBe(index)
      expect(await sender.ping(target)).toBe(true)
      await sender.announceClose(target, { drainMs: 0 })
      /**
       * Existing caller cancellation emits the canonical abort variation only after execution
       * starts.
       */
      const controller = new AbortController()
      /** Attach rejection observation before the native signal settles the genuine caller operation. */
      const cancellation = expect(
        sender.send(target, 'echo', variationFixture.held, {
          signal: controller.signal,
          timeoutMs: false
        })
      ).rejects.toMatchObject({ code: 'CANCELLED' })
      await vi.waitFor(() => expect(started[1 - index]).toBe(true))
      controller.abort()
      await cancellation
      await vi.waitFor(() => expect(aborted[1 - index]).toBe(true))
      /** Custom traffic passes through the same production pipeline and registered receiver owner. */
      const receiver = await outbound[index]!.resolveReceiver(target)
      await outbound[index]!.sendFrame({
        kind: RpcEnvelopeKind.variation,
        id: `${variationFixture.user}-${index}`,
        data: {
          route: {
            profile: RpcRouteProfile,
            type: RpcRouteType.variation,
            applicationVersion: '1',
            senderId: peers[index]!.self.instanceId,
            targetId: target,
            receiverId: receiver.receiverId,
            sentAt: Date.now(),
            variation: variationFixture.user
          }
        }
      })
      await vi.waitFor(() => expect(customReceived[1 - index]).toBe(1))
    }
    for (const events of observations) {
      for (const stage of [RpcProbeStage.message, RpcProbeStage.envelope])
        for (const direction of [RpcProbeDirection.outbound, RpcProbeDirection.inbound])
          for (const variation of ['ping', 'pong', 'close', 'abort', variationFixture.user]) {
            /** One real event in each direction retains the original route's subtype identity. */
            const event = events.find(
              (entry) =>
                entry.stage === stage &&
                entry.direction === direction &&
                entry.variation === variation
            )
            expect(event).toBeDefined()
            if (stage === RpcProbeStage.message)
              expect(event!.kind).toBe(
                variation === 'abort' ? RpcProbeKind.cancel : RpcProbeKind.control
              )
          }
      expect(events.some((event) => event.method === 'echo')).toBe(true)
      expect(
        events.some(
          (event) =>
            (event.stage === RpcProbeStage.message || event.stage === RpcProbeStage.envelope) &&
            event.method === 'other'
        )
      ).toBe(false)
      for (const event of events) {
        if (
          (event.stage !== RpcProbeStage.message && event.stage !== RpcProbeStage.envelope) ||
          event.kind === RpcProbeKind.request ||
          event.kind === RpcProbeKind.response
        )
          expect(event.variation).toBeUndefined()
      }
    }
  } finally {
    for (const release of releases) release()
    await Promise.all(peers.map((peer) => peer.close()))
  }
})
