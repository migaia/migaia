import { describe, expect, it } from 'vitest'
import { createFullEndpoint } from '../src/full.js'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { readEndpointDebugSnapshot } from '../src/internal/test-observer.js'
import { connect } from '../src/middleware/connect.js'
import { codec } from '../src/middleware/codec.js'
import { framer } from '../src/middleware/framer.js'
import { WebRpcPlatform, WebRpcTransportOwnership } from '../src/transport-constants.js'
import type { IWebRpcInboundMessage } from '../src/transport.js'
import { fullRuntimeOwnerKeys } from './fixtures/tree-shaking/runtime-owner-topology.js'
import { createStringFramer, type IRpcFrameContext } from '@migaia/rpc-contract/framing'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'

/** Separates the four observable pipeline stages required by the public wire oracle. */
type IWireStageCounts = {
  encode: number
  decode: number
  frame: number
  accept: number
}

describe('endpoint test-only lifecycle observer', () => {
  it('closes the selected framer once through root disposal and retains its failure', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    /** Counts selected-framer close ownership rather than a legacy chunk cleanup path. */
    let closeCalls = 0
    /** Preserves the primary close failure for the Host disposal error chain. */
    const closeFailure = new Error('selected framer close failed')
    const nativeFramer = createStringFramer({ chunkBytes: 1024 })
    const client = await createFullEndpoint({
      id: 'close-client',
      transport: clientTransport,
      middlewares: [
        codec(defineJsonCodec({ version: 1 })),
        framer({
          ...nativeFramer,
          close: (reason?: unknown) => {
            closeCalls += 1
            nativeFramer.close(reason)
            throw closeFailure
          }
        }),
        connect({ transport: clientTransport })
      ]
    })
    const server = await createFullEndpoint({
      id: 'close-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport })]
    })
    await expect(client.dispose()).rejects.toMatchObject({ cause: closeFailure })
    await client.dispose().catch(() => undefined)
    await server.dispose()
    expect(closeCalls).toBe(1)
  })

  it('requires warmed public request-response traffic to traverse all four wire stages twice', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    /** Counts stage work at one endpoint; construction and warmup are excluded before measuring. */
    const clientStages: IWireStageCounts = { encode: 0, decode: 0, frame: 0, accept: 0 }
    /** Counts stage work at one endpoint; construction and warmup are excluded before measuring. */
    const serverStages: IWireStageCounts = { encode: 0, decode: 0, frame: 0, accept: 0 }
    /** Builds public middleware descriptors without bypassing factory typing. */
    const createObservedComponents = (stages: IWireStageCounts) => {
      const jsonCodec = defineJsonCodec({ version: 1 })
      const stringFramer = createStringFramer({ chunkBytes: 1024 })
      return {
        codec: {
          ...jsonCodec,
          encode: (...args: Parameters<typeof jsonCodec.encode>) => {
            stages.encode += 1
            return jsonCodec.encode(...args)
          },
          decode: (...args: Parameters<typeof jsonCodec.decode>) => {
            stages.decode += 1
            return jsonCodec.decode(...args)
          }
        },
        framer: {
          ...stringFramer,
          frame: (...args: Parameters<typeof stringFramer.frame>) => {
            stages.frame += 1
            return stringFramer.frame(...args)
          },
          accept: (...args: Parameters<typeof stringFramer.accept>) => {
            stages.accept += 1
            return stringFramer.accept(...args)
          }
        }
      }
    }
    /** Adds two endpoints' counters because one measured RPC traverses both endpoints. */
    const aggregate = (): IWireStageCounts => ({
      encode: clientStages.encode + serverStages.encode,
      decode: clientStages.decode + serverStages.decode,
      frame: clientStages.frame + serverStages.frame,
      accept: clientStages.accept + serverStages.accept
    })
    /** Clears discovery and warmup traffic before the one request-response under test. */
    const reset = (): void => {
      clientStages.encode = 0
      clientStages.decode = 0
      clientStages.frame = 0
      clientStages.accept = 0
      serverStages.encode = 0
      serverStages.decode = 0
      serverStages.frame = 0
      serverStages.accept = 0
    }
    const clientComponents = createObservedComponents(clientStages)
    const serverComponents = createObservedComponents(serverStages)
    const server = await createFullEndpoint({
      id: 'observer-server',
      transport: serverTransport,
      middlewares: [
        codec(serverComponents.codec),
        framer(serverComponents.framer),
        connect({ transport: serverTransport })
      ],
      provider: { echo: (context) => context.success(context.data) }
    })
    const client = await createFullEndpoint({
      id: 'observer-client',
      transport: clientTransport,
      middlewares: [
        codec(clientComponents.codec),
        framer(clientComponents.framer),
        connect({ transport: clientTransport })
      ]
    })
    try {
      await expect(client.send('observer-server', 'echo', 'warm')).resolves.toBe('warm')
      /** Keeps lifecycle/discovery traffic separate from the measured request-response. */
      const warmupTraffic = aggregate()
      reset()

      await expect(client.send('observer-server', 'echo', 'measured')).resolves.toBe('measured')
      expect(aggregate()).toEqual({ encode: 2, decode: 2, frame: 2, accept: 2 })
      expect(warmupTraffic).toEqual({ encode: 4, decode: 4, frame: 4, accept: 4 })
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('requires a native framer structural copy to fragment public traffic without replacing its callables', async () => {
    const [rawClientTransport, rawServerTransport] = createMemoryTransportPair()
    /** Counts physical client-to-server carriers after the selected native framer runs. */
    let clientPhysicalFrames = 0
    /** Captures measured client physical carriers after native framing. */
    const clientCarriers: unknown[] = []
    /** Counts physical server-to-client carriers after the selected native framer runs. */
    let serverPhysicalFrames = 0
    /** Captures measured server physical carriers after native framing. */
    const serverCarriers: unknown[] = []
    /**
     * Observes carrier delivery while leaving each transport's identity and lifecycle methods
     * intact.
     */
    const clientTransport = {
      ...rawClientTransport,
      send(message: unknown) {
        clientPhysicalFrames += 1
        clientCarriers.push(message)
        return rawClientTransport.send(message)
      }
    }
    /**
     * Observes reverse carrier delivery while leaving each transport's identity and lifecycle
     * methods intact.
     */
    const serverTransport = {
      ...rawServerTransport,
      send(message: unknown) {
        serverPhysicalFrames += 1
        serverCarriers.push(message)
        return rawServerTransport.send(message)
      }
    }
    /** Keeps one package-native frame/accept pair per endpoint through descriptor spreading. */
    const copiedServerNativeFramer = { ...createStringFramer({ chunkBytes: 64 }) }
    /** Prevents reassembly and close state from crossing the endpoint isolation boundary. */
    const copiedClientNativeFramer = { ...createStringFramer({ chunkBytes: 64 }) }
    const server = await createFullEndpoint({
      id: 'native-copy-server',
      transport: serverTransport,
      middlewares: [
        codec(defineJsonCodec({ version: 1 })),
        framer(copiedServerNativeFramer),
        connect({ transport: serverTransport })
      ],
      provider: { echo: (context) => context.success(context.data) }
    })
    const client = await createFullEndpoint({
      id: 'native-copy-client',
      transport: clientTransport,
      middlewares: [
        codec(defineJsonCodec({ version: 1 })),
        framer(copiedClientNativeFramer),
        connect({ transport: clientTransport })
      ]
    })
    try {
      await expect(client.send('native-copy-server', 'echo', 'warm')).resolves.toBe('warm')
      clientPhysicalFrames = 0
      serverPhysicalFrames = 0
      clientCarriers.length = 0
      serverCarriers.length = 0
      /** Forces fragmentation only when the selected structural copy executes. */
      const payload = 'native-copy-'.repeat(32)
      await expect(client.send('native-copy-server', 'echo', payload)).resolves.toBe(payload)
      expect(clientPhysicalFrames).toBeGreaterThan(1)
      expect(serverPhysicalFrames).toBeGreaterThan(1)
      for (const carrier of clientCarriers) expect(carrier).toMatchObject({ kind: 'rpc.frame.v1' })
      for (const carrier of serverCarriers) expect(carrier).toMatchObject({ kind: 'rpc.frame.v1' })
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('requires public endpoints to preserve opaque custom frames through both sources with the same key', async () => {
    /** Captures the public endpoint subscriber so the fixture injects real transport ingress. */
    let receive: ((message: IWebRpcInboundMessage) => void) | undefined
    /** Identifies physical source A independently from the equal custom frame key. */
    const sourceA = Object.freeze({ id: 'opaque-a' })
    /** Identifies physical source B independently from the equal custom frame key. */
    const sourceB = Object.freeze({ id: 'opaque-b' })
    /** Collects provider payloads after real public ingress routes completed opaque frames. */
    const received: string[] = []
    /** Supplies one real multiplexed public transport with a captured subscriber. */
    const serverTransport = {
      platform: WebRpcPlatform.memory,
      topology: 'multiplexed' as const,
      ownership: WebRpcTransportOwnership.borrowed,
      sourceProof: (source: unknown) => source === sourceA || source === sourceB,
      send: () => undefined,
      subscribe(listener: (message: IWebRpcInboundMessage) => void) {
        receive = listener
        return () => {
          receive = undefined
        }
      }
    }
    /** Records custom-framer calls by endpoint so equal frame keys cannot conceal a bypass. */
    const serverFrames = { frame: 0, accept: 0 }
    /** Preserves the opaque framer's own pending/complete sequence without WebRPC reflection. */
    const serverAcceptStates: string[] = []
    /** Records the common opaque ingress key without reading carrier fields. */
    const opaqueMessageIds: string[] = []
    /** Makes custom-framer pending ownership observable after both physical sources complete. */
    const pendingBySource = new Map<string, string[]>()
    /** Keeps opaque fragment fields outside the carrier object exposed to WebRPC. */
    const opaqueFragments = new WeakMap<
      object,
      { readonly index: number; readonly value: string }
    >()
    /** Detects any WebRPC reflection over opaque custom carriers. */
    const opaqueReflection = { get: 0, ownKeys: 0, descriptor: 0 }
    /** Stable fixture diagnostic for invalid opaque carrier identity. */
    const opaqueRejectText = 'opaque fixture rejected carrier'
    /** Reused native error required by rejected custom-framer results. */
    const opaqueRejectError = new Error(opaqueRejectText)
    /** Creates a custom framer whose opaque frame shape must not be interpreted by WebRPC. */
    const createOpaqueFramer = (counts: { frame: number; accept: number }, states?: string[]) => {
      return {
        id: 'observer-opaque',
        version: 1,
        inputEncodedType: 'string' as const,
        outputEncodedType: 'unknown' as const,
        frame: (value: string) => {
          counts.frame += 1
          return [value] as const
        },
        accept: (value: unknown, context: IRpcFrameContext) => {
          counts.accept += 1
          if (typeof value === 'string') return { status: 'complete' as const, value }
          opaqueMessageIds.push(context.messageId)
          if (!value || typeof value !== 'object')
            return { status: 'rejected' as const, error: opaqueRejectError }
          const frame = opaqueFragments.get(value)
          if (!frame) return { status: 'rejected' as const, error: opaqueRejectError }
          const pending = pendingBySource.get(context.source) ?? []
          pending[frame.index] = frame.value
          pendingBySource.set(context.source, pending)
          if (pending.length !== 2) {
            states?.push('pending')
            return { status: 'pending' as const }
          }
          const complete = pending.join('')
          pendingBySource.delete(context.source)
          states?.push('complete')
          return { status: 'complete' as const, value: complete }
        },
        close: () => undefined
      }
    }
    const serverFramer = createOpaqueFramer(serverFrames, serverAcceptStates)
    const server = await createFullEndpoint({
      id: 'opaque-server',
      transport: serverTransport,
      middlewares: [
        codec(defineJsonCodec({ version: 1 })),
        framer(serverFramer),
        connect({ transport: serverTransport })
      ],
      provider: {
        echo: (context) => {
          received.push(context.data as string)
          return context.success(context.data)
        }
      }
    })
    try {
      /** Builds one legal canonical request with its physical-peer logical sender binding. */
      const encodeRequest = (id: string, senderId: string, payload: string) =>
        JSON.stringify({
          kind: 'request',
          id,
          method: 'echo',
          data: {
            webRpc: {
              profile: 'web-rpc.route.v1',
              type: 'request',
              applicationVersion: '1.0',
              senderId,
              targetId: 'opaque-server',
              receiverId: 'opaque-server',
              dispatchOnly: true,
              sentAt: 0
            },
            payload
          }
        })
      /** Delivers one opaque physical fragment without exposing its business fields. */
      const inject = (source: unknown, peerId: string, value: string, index: number) => {
        const opaque = new Proxy(Object.freeze({}), {
          get() {
            opaqueReflection.get += 1
            return undefined
          },
          ownKeys() {
            opaqueReflection.ownKeys += 1
            return []
          },
          getOwnPropertyDescriptor() {
            opaqueReflection.descriptor += 1
            return undefined
          }
        })
        opaqueFragments.set(opaque, { index, value })
        receive?.({ data: opaque, source, peerId })
      }
      const controlRequest = encodeRequest('control-a', 'opaque-a', 'control-a')
      const requestA = encodeRequest('request-a', 'opaque-a', 'opaque-a')
      const requestB = encodeRequest('request-b', 'opaque-b', 'opaque-b')
      receive?.({ data: controlRequest, source: sourceA, peerId: 'opaque-a' })
      await expect.poll(() => received).toEqual(['control-a'])
      received.length = 0
      serverFrames.accept = 0
      serverAcceptStates.length = 0
      /** Produces two real carrier fragments for the custom-framer ingress oracle. */
      const split = (value: string) =>
        [
          value.slice(0, Math.floor(value.length / 2)),
          value.slice(Math.floor(value.length / 2))
        ] as const
      const [a1, a2] = split(requestA)
      const [b1, b2] = split(requestB)
      inject(sourceA, 'opaque-a', a1, 0)
      inject(sourceB, 'opaque-b', b1, 0)
      inject(sourceA, 'opaque-a', a2, 1)
      inject(sourceB, 'opaque-b', b2, 1)
      await expect.poll(() => received).toEqual(['opaque-a', 'opaque-b'])
      expect(serverFrames).toEqual({ frame: 0, accept: 4 })
      expect(serverAcceptStates).toEqual(['pending', 'pending', 'complete', 'complete'])
      expect(opaqueMessageIds).toEqual(['whole', 'whole', 'whole', 'whole'])
      expect(opaqueReflection).toEqual({ get: 0, ownKeys: 0, descriptor: 0 })
      expect(pendingBySource.size).toBe(0)
    } finally {
      await server.dispose()
    }
  })

  it('proves request and registry resources return to zero after disposal', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createFullEndpoint({
      id: 'server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport })],
      provider: { echo: (context) => context.success(context.data) }
    })
    const client = await createFullEndpoint({
      id: 'client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport })]
    })

    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      phase: 'active',
      pending: 0,
      pingPending: 0,
      activeControllers: 0,
      chunks: 0,
      owners: fullRuntimeOwnerKeys
    })
    await expect(client.send('server', 'echo', 'value')).resolves.toBe('value')
    await client.dispose()
    await server.dispose()

    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      pingPending: 0,
      activeControllers: 0,
      chunks: 0,
      providers: 0,
      events: 0,
      hooks: 0,
      resources: 0,
      discovery: {
        local: 0,
        remote: 0,
        waiters: 0,
        tasks: 0,
        timers: 0,
        manualWaiters: 0,
        inboundQueries: 0,
        inboundTimers: 0
      }
    })
  })
})
