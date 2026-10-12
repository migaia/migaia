import { MessageChannel } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { systemScheduler } from '@migaia/utils/scheduler'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { RpcCapability, rpcProtocolV1, type IRpcEnvelope } from '@migaia/rpc-contract'
import { messageFramerV1 } from '@migaia/rpc-contract/framing'
import { RpcBinaryProfile } from '@migaia/rpc-contract/wire'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import * as core from '../../dist/core/index.js'
import * as adapterSdk from '../../dist/adapter.js'
import * as adapter from '../../dist/adapter/internal-advanced.js'
import * as remote from '../../dist/remote/index.js'
import * as provider from '../../dist/core/features/provider.js'
import { createClientEndpoint } from '../../dist/core/client.js'
import type { IRpcContext, IRpcEndpoint, IRpcTransport } from '../../dist/core/index.js'
import { EndpointOwnerKey } from '../../dist/core/endpoint-kernel.js'
import { readEndpointOwner } from '../../dist/core/internal/endpoint-projection.js'
import { hasBatchAgreement, hasCloneTransferCarrier } from '../../dist/core/internal/batch-frame.js'
import * as fast from '../../dist/core/internal/fast-path.js'
import { nativeReplayReceipt } from '../../dist/core/internal/native-replay.js'
import { readJsonObjectPort } from '../../dist/core/internal/json-object-port.js'
import { readOwnedJsonSnapshot } from '../../dist/core/internal/outbound-owned-codec.js'
import {
  readProviderBulkAdmission,
  readProviderPreflight,
  type ProviderRegistry
} from '../../dist/core/internal/provider.js'

/** Resolve the moved public adapter entry through the existing integration fixture's dependencies. */
const adapterRequire = createRequire(
  new URL('../../../rpc-integration/package.json', import.meta.url)
)
/** Only the declared adapter entry is loaded; no Core reverse production dependency is introduced. */
const threads = (await import(
  adapterRequire.resolve('@migaia/rpc-threads')
)) as typeof import('../../../rpc-threads/dist/threads/index.js')

/** The foreign-language adapter is observed through its declared package entry. */
const jsonrpc = (await import(
  adapterRequire.resolve('@migaia/rpc-bridge-jsonrpc')
)) as typeof import('../../../rpc-bridge-jsonrpc/dist/bridge/jsonrpc/index.js')

/** Every assertion observes only public construction and private read-only facts, never a writer. */
const publicEntries = [core, adapterSdk, adapter, jsonrpc, threads, remote, provider]

/** An ordinary entry cannot expose the private operation that would qualify an arbitrary target. */
function expectPrivateWriter(name: string): void {
  for (const entry of publicEntries) expect(Object.hasOwn(entry, name), name).toBe(false)
}

/** Reuse one real native resource shape; cleanup releases both the Core channel and actual ports. */
async function withHeldChannel(
  check: (channel: remote.IRuntimePeerSourceResult) => Promise<void>
): Promise<void> {
  /** Genuine postMessage and native lifetime observations come from these two held ports. */
  const ports = new MessageChannel()
  /** The complete constructor retains raw I/O; the open operation constructs its own transport. */
  const parent = new threads.AdapterNodeThreadParentChannel(ports.port1)
  /** No transport is supplied as a qualification target. */
  const channel = await parent.open('boundary-peer', { scheduler: systemScheduler })
  try {
    await check(channel)
  } finally {
    await channel.close()
    ports.port1.close()
    ports.port2.close()
  }
}

/** Matching metadata and copied public methods do not copy the original transport's private facts. */
function foreignTransport(owned: IRpcTransport): IRpcTransport {
  return {
    ...owned,
    capabilities: [RpcCapability.batch],
    batch: true,
    fast: true,
    nativeReplay: { alive: () => true, exclusive: () => true }
  } as IRpcTransport
}

describe('C3 public adapter resource boundaries', () => {
  it('[C3-B1-registerBatchAgreement] constructs a qualified channel without qualifying its public copy', async () => {
    expectPrivateWriter('registerBatchAgreement')
    await withHeldChannel(async (channel) => {
      expect(hasBatchAgreement(channel.transport)).toBe(true)
      expect(hasCloneTransferCarrier(channel.transport)).toBe(true)
      /** This adapter copy was never constructed by Core. */
      const foreign = foreignTransport(channel.transport)
      /** Ordinary endpoint admission must not convert its labels into transport qualification. */
      const endpoint = await createClientEndpoint({
        id: 'boundary-copy',
        transport: foreign,
        middlewares: [core.connect()]
      })
      try {
        expect(hasBatchAgreement(foreign)).toBe(false)
        expect(hasCloneTransferCarrier(foreign)).toBe(false)
      } finally {
        await endpoint.dispose()
      }
    })
  })

  it.each(['registerFastCodec', 'registerFastFramer'] as const)(
    '[C3-B1-%s] rejects matching descriptor copies at actual endpoint component admission',
    async (writer) => {
      expectPrivateWriter(writer)
      await withHeldChannel(async (channel) => {
        /** Observe the existing private reader on the actual selected snapshot, without altering it. */
        const proof = vi.spyOn(fast, 'hasFastComponents')
        /** The copied descriptor keeps every public property and method but not its owner identity. */
        const copiedCodec = { ...identityCodecV1 }
        /** The same method objects cannot supply the original framer's private identity. */
        const copiedFramer = { ...messageFramerV1 }
        /** The real qualified carrier ensures construction consults the fast-component reader. */
        /** Restore the observer even if the ordinary component constructor rejects. */
        let endpoint: Awaited<ReturnType<typeof createClientEndpoint>> | undefined
        try {
          endpoint = await createClientEndpoint({
            id: 'boundary-components',
            transport: channel.transport,
            codec: writer === 'registerFastCodec' ? copiedCodec : identityCodecV1,
            framer: writer === 'registerFastFramer' ? copiedFramer : messageFramerV1,
            middlewares: [core.connect()]
          })
          expect(proof.mock.calls.length).toBeGreaterThan(0)
          /** Freeze observed calls before rechecking, since the spy records those checks too. */
          const observedCalls = proof.mock.calls.slice()
          for (const [snapshot] of observedCalls)
            expect(fast.hasFastComponents(snapshot)).toBe(false)
        } finally {
          proof.mockRestore()
          await endpoint?.dispose()
        }
      })
    }
  )

  it.each([
    'registerNativeReplayOwner',
    'registerLazyNativeReplayOwner',
    'bindNativeReplayTransport'
  ] as const)(
    '[C3-B1-%s] preserves real replay ownership while public copies receive none',
    async (writer) => {
      expectPrivateWriter(writer)
      await withHeldChannel(async (channel) => {
        /** Ordinary endpoint construction claims the exact Core-created transport's real owner. */
        const owner = await createClientEndpoint({
          id: 'boundary-owner',
          transport: channel.transport,
          middlewares: [core.connect()]
        })
        /** A fake initializer is descriptive user data, not a call into a trust writer. */
        const initialize = vi.fn(() => ({ alive: () => true, exclusive: () => true }))
        /** The copied methods still address the real resource, without copying its private receipt. */
        const foreign = Object.assign(foreignTransport(channel.transport), { initialize })
        try {
          expect(nativeReplayReceipt(channel.transport)?.qualified).toBe(true)
          /** A normal operation over the foreign transport cannot bind the original private receipt. */
          const endpoint = await createClientEndpoint({
            id: 'boundary-foreign',
            transport: foreign,
            middlewares: [core.connect()]
          })
          try {
            expect(nativeReplayReceipt(foreign)).toBeUndefined()
            expect(initialize).not.toHaveBeenCalled()
          } finally {
            await endpoint.dispose()
          }
        } finally {
          await owner.dispose()
        }
      })
    }
  )

  it('[C3-B1-registerJsonObjectPort] public descriptor and transport fields cannot supply an object port', async () => {
    expectPrivateWriter('registerJsonObjectPort')
    await withHeldChannel(async (channel) => {
      /** A field with the complete public-looking port shape has no private registration identity. */
      const foreign = Object.assign(foreignTransport(channel.transport), {
        objectPort: { protocol: rpcProtocolV1, codec: identityCodecV1, framer: messageFramerV1 }
      })
      /** Its normal endpoint still selects the public frame path. */
      const endpoint = await createClientEndpoint({
        id: 'boundary-object',
        transport: foreign,
        middlewares: [core.connect()]
      })
      try {
        expect(
          readJsonObjectPort(foreign, rpcProtocolV1, identityCodecV1, messageFramerV1)
        ).toBeUndefined()
      } finally {
        await endpoint.dispose()
      }
    })
  })

  it.each(['attachProviderBulkAdmission', 'attachProviderPreflight'] as const)(
    '[C3-B1-%s] ordinary provider registration does not adopt forged policy metadata',
    async (writer) => {
      expectPrivateWriter(writer)
      await withHeldChannel(async (channel) => {
        /** Copying a genuine channel's agreement cannot qualify the new resource governor. */
        const copiedChannel = { ...channel, transport: foreignTransport(channel.transport) }
        expect(() =>
          adapter.createRuntimeProviderGovernor(
            copiedChannel,
            {
              maxCallsPerMinute: 10,
              maxPayloadBytes: 1024,
              maxConsecutiveTimeouts: 3,
              idleTimeoutMs: 1000,
              violationLimit: 3,
              overflow: { source: 'fixture', code: 'OVERFLOW', message: 'fixture overflow' }
            },
            async () => undefined,
            () => undefined
          )
        ).toThrowError(expect.objectContaining({ code: core.RpcCoreErrorCode.invalidConfig }))
        /** Metadata and a same-description global symbol cannot reproduce a private policy symbol. */
        const policy = vi.fn(() => undefined)
        /** This business callback was never constructed by a native admission owner. */
        const foreign = Object.assign((context: IRpcContext) => context.success(undefined), {
          bulkAdmission: policy,
          preflight: policy
        })
        Object.defineProperty(foreign, Symbol.for('rpc-provider-preflight'), { value: policy })
        Object.defineProperty(foreign, Symbol.for('rpc-provider-bulk-admission'), { value: policy })
        /** The ordinary provider API stores the actual supplied callback in its normal registry. */
        const endpoint = await core.createFullEndpoint({
          id: 'boundary-provider',
          transport: channel.transport,
          middlewares: [core.connect()]
        })
        try {
          endpoint.provide('foreign', foreign)
          /** This is the original private registry reader, not an alternate test admission seam. */
          const registry = readEndpointOwner<ProviderRegistry>(
            endpoint,
            EndpointOwnerKey.providerRegistry
          )!
          expect(registry.getProvider('foreign')).toBe(foreign)
          expect(readProviderBulkAdmission(foreign)).toBeUndefined()
          expect(readProviderPreflight(foreign)).toBeUndefined()
          expect(policy).not.toHaveBeenCalled()
        } finally {
          await endpoint.dispose()
        }
      })
    }
  )

  it('[C3-B1-OwnedCodec] caller captureJsonData cannot inject the sender private JSON snapshot owner', async () => {
    expectPrivateWriter('prepareOwnedJsonSnapshot')
    expectPrivateWriter('prepareOwnedBinaryJsonSnapshot')
    /** Real native ports provide both directions of the ordinary runtime Peer operation. */
    const ports = new MessageChannel()
    /**
     * Both explicitly configured parties support the batch baseline, generation and portable
     * binary, without native auth claims.
     */
    const capabilities = [
      RpcCapability.runtimeApi,
      RpcCapability.batch,
      RpcCapability.generation,
      RpcCapability.portableBinary
    ]
    /** The caller can describe a snapshot shape but cannot acquire its Core-private class field. */
    const counterfeit = Object.freeze({ value: { forged: true }, byteUpperBound: 0 })
    /** An ordinary codec operation is never the Core sender's private capture owner. */
    const captureJsonData = vi.fn(() => counterfeit)
    /** Observe actual encoding inputs so the assertion proves the binary sender was reached. */
    const encoded: unknown[] = []
    /** Keep successfully constructed resources for deterministic failure and normal cleanup. */
    const peers: remote.IRuntimePeer[] = []
    /**
     * These raw-resource operations construct their own channel identities, with no private writer
     * call.
     */
    const channels = await Promise.all([
      adapter.createEventEmitterMessageResource(ports.port1).open({
        peerId: 'boundary-right',
        scheduler: systemScheduler,
        offer: capabilities,
        control: rpcMessageCapabilityControl
      }),
      adapter.createEventEmitterMessageResource(ports.port2).open({
        peerId: 'boundary-left',
        scheduler: systemScheduler,
        offer: capabilities,
        control: rpcMessageCapabilityControl
      })
    ] as const)
    try {
      /** Concurrent preparation reaches the real bilateral describe and generation owners. */
      const preparing = [
        remote.createRuntimePeer({
          self: { name: 'left', instanceId: 'boundary-left' },
          connect: async () => channels[0],
          report: (error) => {
            throw error
          },
          endpointFactory: async (channel) => {
            /** The additional public property attempts the exact former owned-codec forgery. */
            const codec = {
              ...channel.pipeline.codec,
              captureJsonData,
              encode(value: unknown) {
                encoded.push(value)
                return channel.pipeline.codec.encode(value)
              },
              /** Identity decoding keeps the original business value in its public envelope domain. */
              decode(value: unknown): IRpcEnvelope {
                return channel.pipeline.codec.decode(value) as IRpcEnvelope
              }
            }
            /**
             * Only normal configuration enters Core; no private class or snapshot helper is
             * supplied.
             */
            const endpoint = core.createRuntimeApiEndpoint(
              {
                id: 'boundary-left',
                transport: channel.transport,
                targetIds: [channel.peerId],
                codec,
                framer: channel.pipeline.framer,
                middlewares: [core.abort(), core.timeout(), core.hooks(), core.connect()]
              },
              channel
            )
            await endpoint.ready
            return {
              endpoint: endpoint as unknown as IRpcEndpoint,
              oneWay: endpoint,
              stream: endpoint.stream
            }
          }
        }),
        remote.createRuntimePeer({
          self: { name: 'right', instanceId: 'boundary-right' },
          provide: { sink: () => undefined },
          connect: async () => channels[1],
          report: (error) => {
            throw error
          }
        })
      ] as const
      /** A refused startup closes actual raw ports before joining the other pending startup. */
      try {
        peers.push(...(await Promise.all(preparing)))
      } catch (primary) {
        ports.port1.close()
        ports.port2.close()
        const results = await Promise.allSettled(preparing)
        for (const result of results) if (result.status === 'fulfilled') peers.push(result.value)
        throw primary
      }
      await peers[0]!.notify('sink', new Uint8Array([1, 2]), { timeoutMs: false })
      /** A real manifest, rather than only directory traffic, must have reached the selected codec. */
      const manifests = encoded.filter(
        (value) =>
          value !== null &&
          typeof value === 'object' &&
          Reflect.get(value, 'profile') === RpcBinaryProfile
      )
      expect(manifests.length).toBeGreaterThan(0)
      expect(captureJsonData).not.toHaveBeenCalled()
      expect(readOwnedJsonSnapshot(counterfeit)).toBeUndefined()
      for (const manifest of manifests) expect(readOwnedJsonSnapshot(manifest)).toBeUndefined()
    } finally {
      for (const peer of peers.toReversed()) await peer.close()
      await channels[0].close()
      await channels[1].close()
      ports.port1.close()
      ports.port2.close()
    }
  })
})
