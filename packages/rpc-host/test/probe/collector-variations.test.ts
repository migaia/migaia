import { expect, it, vi } from 'vitest'
import {
  defineProbe,
  RpcProbeDirection,
  RpcProbeKind,
  RpcProbeStage,
  type IRpcProbeEventView
} from '../../dist/core/probe/index.js'
import { RpcEnvelopeKind, RpcRouteProfile, RpcRouteType } from '@migaia/rpc-contract'
import {
  createRuntimePeer,
  readRuntimePeerEndpoint,
  type IRuntimePeer
} from '../../dist/remote/runtime-api/peer.js'
import type { IRpcContext } from '../../dist/core/typing.js'
import { readEndpointOwner } from '../../dist/core/internal/endpoint-projection.js'
import { EndpointOwnerKey } from '../../dist/core/endpoint-kernel.js'
import type { RpcOutboundAttachment } from '../../dist/core/internal/outbound-attachment.js'
import { RUNTIME_API_CAPABILITIES } from '../../dist/remote/runtime-api/constants.js'
import { runtimeSources } from '../runtime-api/fixture.js'
import { devtoolsPlugin } from '../../../rpc-plugin-devtools/src/index.js'

/** The genuine endpoint oracle owns private variation controls and their collector assertions. */
class CollectorVariationScenario {
  /** One collector sees the two actual canonical endpoint emitters. */
  readonly #devtools = devtoolsPlugin({ methods: ['echo'] }).collector
  /** Test-owned shallow snapshots preserve exact observations from the reusable source view. */
  readonly #coreEvents: IRpcProbeEventView[] = []
  /** Both filters receive genuine emissions without a synthetic forwarding callback. */
  readonly #coreProbe = defineProbe({
    stages: ['message', 'envelope'],
    methods: ['echo'],
    emit: (view) => this.#coreEvents.push(Object.freeze({ ...view }))
  })
  /** Recording starts before construction so complete sequence includes handshake observations. */
  readonly #recording = this.#devtools.record({ maxEvents: 256 })
  /** Custom subtype and held payload are distinct one-off fixture data. */
  readonly #fixture = { user: 'user-observation', held: 'held-variation' } as const
  /** Provider-start evidence precedes each original caller abort. */
  readonly #started = [false, false]
  /** Actual receive-side provider signals establish delivery of the abort. */
  readonly #aborted = [false, false]
  /** Both canonical peers negotiate their independent offers on existing fixture transports. */
  readonly #channel = runtimeSources(RUNTIME_API_CAPABILITIES, RUNTIME_API_CAPABILITIES)
  /** Original peers retain their actual endpoint and connection provenance. */
  #peers: IRuntimePeer[] = []
  /** These borrowed controls operate on the exact endpoints used for business calls. */
  #endpoints: ReturnType<typeof readRuntimePeerEndpoint>['endpoint'][] = []
  /** The original attachment owns variation registration and physical sends. */
  #outbound: RpcOutboundAttachment[] = []
  /** Registered receiver completions prove subtype delivery. */
  readonly #received = [0, 0]
  /** Original coordinator release receipts precede endpoint cleanup. */
  #releases: (() => void)[] = []

  /** Construct only canonical peers, retaining their independently negotiated physical sources. */
  async open(): Promise<void> {
    this.#peers = await Promise.all(
      [0, 1].map((index) =>
        createRuntimePeer({
          self: { name: `collector-${index}`, instanceId: `collector-variation-${index}` },
          connect: this.#channel.sources[index]!,
          probe: [this.#coreProbe, this.#devtools],
          provide: {
            echo: async (input: string, context: IRpcContext) => {
              if (input === this.#fixture.held) {
                this.#started[index] = true
                await new Promise<void>((resolve) =>
                  context.signal.addEventListener(
                    'abort',
                    () => {
                      this.#aborted[index] = true
                      resolve()
                    },
                    { once: true }
                  )
                )
              }
              return input
            },
            other: (input: string) => input
          }
        })
      )
    )
    this.#endpoints = this.#peers.map((peer) => readRuntimePeerEndpoint(peer).endpoint)
    this.#outbound = this.#endpoints.map((endpoint) =>
      readEndpointOwner<RpcOutboundAttachment>(endpoint, EndpointOwnerKey.outboundAttachment)!
    )
    this.#releases = this.#outbound.map((owner, index) =>
      owner.variations.register(this.#fixture.user, () => {
        this.#received[index]++
      })
    )
  }

  /** Drive both genuine orientations through ping, close, abort and registered subtype owners. */
  async exercise(): Promise<void> {
    expect(await this.#peers[0]!.request('echo', 'selected')).toBe('selected')
    expect(await this.#peers[0]!.request('other', 'excluded')).toBe('excluded')
    for (let index = 0; index < this.#peers.length; index++) {
      /** Each orientation produces genuine outbound and inbound observations on the two hosts. */
      const sender = this.#endpoints[index]!
      /** Routing uses the target's actual runtime Peer identity and receiver selection. */
      const target = this.#peers[1 - index]!.self.instanceId
      // Public ping emits ping and its actual pong response.
      expect(await sender.ping(target)).toBe(true)
      // Public close announcement emits the close variation without disposing the connection.
      await sender.announceClose(target, { drainMs: 0 })
      /** The public signal aborts only after this echo has started on the remote endpoint. */
      const controller = new AbortController()
      /** Rejection observation is attached before the original caller cancellation settles. */
      const cancellation = expect(
        sender.send(target, 'echo', this.#fixture.held, {
          signal: controller.signal,
          timeoutMs: false
        })
      ).rejects.toMatchObject({ code: 'CANCELLED' })
      await vi.waitFor(() => expect(this.#started[1 - index]).toBe(true))
      controller.abort()
      await cancellation
      await vi.waitFor(() => expect(this.#aborted[1 - index]).toBe(true))
      /** The user subtype is sent by the same owner that emits built-in normalized variations. */
      const receiver = await this.#outbound[index]!.resolveReceiver(target)
      await this.#outbound[index]!.sendFrame({
        kind: RpcEnvelopeKind.variation,
        id: `${this.#fixture.user}-${index}`,
        data: {
          route: {
            profile: RpcRouteProfile,
            type: RpcRouteType.variation,
            applicationVersion: '1',
            senderId: this.#peers[index]!.self.instanceId,
            targetId: target,
            receiverId: receiver.receiverId,
            sentAt: Date.now(),
            variation: this.#fixture.user
          }
        }
      })
      await vi.waitFor(() => expect(this.#received[1 - index]).toBe(1))
    }
  }

  /** Compare exact normalized variation/filter identities and stable record codec rows. */
  assertObservations(): void {
    /** Actual wire rows prove both control directions survive the collector's own filter. */
    const events = this.#devtools.query({ stages: ['message'] }).events
    expect(events.some((event) => event.method === 'echo')).toBe(true)
    expect(events.some((event) => event.method === 'other')).toBe(false)
    for (const variation of ['ping', 'pong', 'close', 'abort', this.#fixture.user])
      for (const direction of ['outbound', 'inbound']) {
        /** Both filters preserve the subtype and its existing cancel/control kind. */
        const event = events.find(
          (entry) => entry.variation === variation && entry.direction === direction
        )
        expect(event).toBeDefined()
        expect(event!.kind).toBe(variation === 'abort' ? 'cancel' : 'control')
        for (const stage of [RpcProbeStage.message, RpcProbeStage.envelope]) {
          /** Core observes the same real subtype even though its whitelist selects only echo. */
          const observed = this.#coreEvents.find(
            (entry) =>
              entry.stage === stage &&
              entry.variation === variation &&
              entry.direction ===
                (direction === 'outbound' ? RpcProbeDirection.outbound : RpcProbeDirection.inbound)
          )
          expect(observed).toBeDefined()
          if (stage === RpcProbeStage.message)
            expect(observed!.kind).toBe(
              variation === 'abort' ? RpcProbeKind.cancel : RpcProbeKind.control
            )
        }
      }
    expect(this.#coreEvents.some((event) => event.method === 'echo')).toBe(true)
    expect(this.#coreEvents.some((event) => event.method === 'other')).toBe(false)
    for (const event of events)
      if (event.kind === 'request' || event.kind === 'response')
        expect(event.variation).toBeUndefined()
    for (const event of this.#coreEvents)
      if (event.kind === RpcProbeKind.request || event.kind === RpcProbeKind.response)
        expect(event.variation).toBeUndefined()
    /** The existing record codec preserves exact sequence, direction, kind and variation identity. */
    const decoded = this.#devtools.importRecord(this.#devtools.exportRecord(this.#recording.stop()))
    expect(
      decoded.events
        .filter((event) => event.stage === 'message')
        .map((event) => [event.seq, event.direction, event.kind, event.method, event.variation])
    ).toEqual(
      events.map((event) => [event.seq, event.direction, event.kind, event.method, event.variation])
    )
  }

  /** Release original subtype registrations, then actual peer and fixture transport owners. */
  async close(): Promise<void> {
    for (const release of this.#releases) release()
    await Promise.all(this.#peers.map((peer) => peer.close()))
    this.#channel.close()
    this.#devtools.close()
  }
}

it('keeps all genuine variations through Core and collector echo filters', async () => {
  /** This scenario retains the original collector case while moving private controls to their owner. */
  const scenario = new CollectorVariationScenario()
  try {
    await scenario.open()
    await scenario.exercise()
    scenario.assertObservations()
  } finally {
    await scenario.close()
  }
})
