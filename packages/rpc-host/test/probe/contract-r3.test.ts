/** Original identity and filtering observations use genuine public Hosts and native controls. */
import { createRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'
import type { IRpcSessionHandle, IRpcTransportContext } from '@migaia/rpc-contract/interfaces'
import type { IRpcPortableValue } from '@migaia/rpc-contract/protocol'
import { assert, expect, it, vi } from 'vitest'
import {
  defineProbe,
  probe,
  RpcProbeDirection,
  RpcProbeKind,
  RpcProbeStage,
  RpcProbeStageName,
  type IRpcProbeEventView
} from '@migaia/rpc-host/plugins/probe'
import { MemoryCarrier } from '../fixtures/core-carrier.ts'
import { coreMemoryServer } from '../host/core-fixture.ts'

/** The original held business payload distinguishes active cancellation from ordinary echo. */
const held = 'held-variation'

/** Business entry and native signal observation stay with the same actual registered provider. */
class R3Provider {
  /** Genuine callback entry precedes the matching caller's cancellation. */
  started = false
  /** Only the genuine context signal listener records successful remote cancellation delivery. */
  aborted = false

  /** Hold only the original cancellation payload and return all other data unchanged. */
  readonly echo = async (value: IRpcPortableValue | undefined, context: IRpcContext) => {
    if (value === held) {
      this.started = true
      await new Promise<void>((resolve) => {
        context.signal.addEventListener(
          'abort',
          () => {
            this.aborted = true
            resolve()
          },
          { once: true }
        )
      })
    }
    return context.success(value)
  }
}

/** One real native attachment borrows its actual public SDK control ports after installation. */
type IR3NativeEndpoint = {
  carrier: MemoryCarrier
  context?: IRpcTransportContext
  handle?: IRpcSessionHandle
}

/** Attach the original medium without creating another control, Session or receiver implementation. */
function openR3Endpoint(endpoint: IR3NativeEndpoint, context: IRpcTransportContext) {
  endpoint.context = context
  endpoint.handle = context.attach(endpoint.carrier)
  return { dispose: () => undefined }
}

it('provides the actual serving endpoint identity', async () => {
  /** The existing native memory fixture keeps serving and sending Host identities distinct. */
  const listener = coreMemoryServer('r3-server')
  /** Provider identity comes from its actual executor context rather than the request sender. */
  const server = await createRpcHost({
    ...listener.options,
    provide: { identity: (_payload, context) => context.success(context.localEndpointId) }
  })
  /** Caller identity cannot accidentally satisfy the unchanged serving-endpoint assertion. */
  const client = await listener.connect('r3-client')
  try {
    expect(await client.host.memory.send('r3-server', 'identity', undefined)).toBe('r3-server')
  } finally {
    await Promise.all([client.host.close(), server.close()])
  }
})

it('preserves variation identity through both real Peer directions and method filtering', async () => {
  /** Snapshots retain only this explicit test consumer's copies from the two genuine emitters. */
  const observations: IRpcProbeEventView[][] = [[], []]
  /** Every original stage remains selected to detect stale subtype data in a reused view. */
  const probes = observations.map((events) =>
    defineProbe({
      stages: RpcProbeStageName,
      methods: ['echo'],
      emit: (view) => events.push(Object.freeze({ ...view }))
    })
  )
  /** The established medium drives real codec, Session and physical delivery in both directions. */
  const endpoints: readonly IR3NativeEndpoint[] = [
    { carrier: new MemoryCarrier('r3-a') },
    { carrier: new MemoryCarrier('r3-b') }
  ]
  endpoints[0]!.carrier.link(endpoints[1]!.carrier)
  endpoints[1]!.carrier.link(endpoints[0]!.carrier)
  /** Cold self identities remain different from both physical carrier ids. */
  const identities = ['test-pair-a', 'test-pair-b'] as const
  /** Each native Host registers its own original provider callback and cancellation witnesses. */
  const providers = [new R3Provider(), new R3Provider()] as const
  /** No old Peer, endpoint projection, variation registry or private outbound sender is recreated. */
  const hosts = await Promise.all(
    endpoints.map((endpoint, index) =>
      createRpcHost({
        self: { name: index === 0 ? 'a' : 'b', instanceId: identities[index]! },
        plugins: [
          probe(probes[index]!),
          defineTransportPlugin({
            name: `r3-memory-${index}`,
            namespace: 'memory',
            open: (context) => openR3Endpoint(endpoint, context)
          })
        ],
        provide: {
          echo: providers[index]!.echo,
          other: (value, context) => context.success(value)
        }
      })
    )
  )
  try {
    await Promise.all(endpoints.map((endpoint) => endpoint.handle!.ready))
    for (let index = 0; index < hosts.length; index++) {
      /** Each orientation proves outbound here and inbound on the other genuine emitter. */
      const sender = hosts[index]!.memory
      /** The configured opposite Host identity is admitted by its real handshake. */
      const target = identities[1 - index]!
      expect(await sender.send(target, 'echo', index)).toBe(index)
      expect(await sender.send(target, 'other', index)).toBe(index)
      /** Public native SDK checks keep the actual ping/pong exchange and rejection semantics. */
      await expect(
        endpoints[index]!.context!.ping(endpoints[index]!.handle!)
      ).resolves.toBeUndefined()
      /** Names the old announceClose/drain operation drain; this connection stays open. */
      await endpoints[index]!.context!.drain(endpoints[index]!.handle!, 0)
      /** The original cancellation observes rejection before the actual caller abort occurs. */
      const controller = new AbortController()
      /** The same original provider-entry and signal witnesses still precede CANCELLED. */
      const cancellation = expect(
        sender.send(target, 'echo', held, { signal: controller.signal, timeout: false })
      ).rejects.toMatchObject({ code: 'CANCELLED' })
      await vi.waitFor(() => expect(providers[1 - index]!.started).toBe(true))
      controller.abort()
      await cancellation
      await vi.waitFor(() => expect(providers[1 - index]!.aborted).toBe(true))
    }
    for (const events of observations) {
      for (const stage of [RpcProbeStage.message, RpcProbeStage.envelope])
        for (const direction of [RpcProbeDirection.outbound, RpcProbeDirection.inbound]) {
          for (const variation of ['ping', 'pong', 'drain']) {
            /** Real controls keep their subtype through both original observation boundaries. */
            const event = events.find(
              (entry) =>
                entry.stage === stage &&
                entry.direction === direction &&
                entry.variation === variation
            )
            expect(event).toBeDefined()
            if (stage === RpcProbeStage.message) expect(event!.kind).toBe(RpcProbeKind.control)
          }
          if (stage === RpcProbeStage.message) {
            /** Exposes cancel as its own logical kind rather than an abort variation subtype. */
            const cancellation = events.find(
              (entry) =>
                entry.stage === stage &&
                entry.direction === direction &&
                entry.kind === RpcProbeKind.cancel
            )
            expect(cancellation).toBeDefined()
            assert(cancellation)
            expect(cancellation.method).toBe('echo')
          }
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
    await Promise.all(hosts.map((host) => host.close()))
  }
})
