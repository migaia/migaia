import { defineHost, type IDefinedPluginConstraint } from '@migaia/plugin-host'
import type {
  IRuntimeDynamicSurface,
  IRuntimePluginTyping
} from '../../dist/remote/runtime-api/typing.js'
import { identityCodec } from '@migaia/serialize/codecs/identity/v1'
import { systemScheduler } from '@migaia/utils/scheduler'
import { messageFramerV1 } from '@migaia/rpc-contract/framing'
import { createMemoryTransportPair } from '../fixtures/memory-transport.ts'
import { registerBatchAgreement } from '../../dist/core/internal/batch-frame.js'
import {
  createRuntimePeer,
  type IRuntimePeerSourceContext,
  type IRuntimePeerProvide
} from '../../dist/remote/runtime-api/peer.js'

import { createComposedEndpoint } from '../../dist/core/composed.js'
import { createCanonicalChunkFeature } from '../../dist/core/features/canonical-chunk.js'
import { createOutboundFeature } from '../../dist/core/features/outbound.js'
import { createProviderFeature } from '../../dist/core/internal/provider-feature.js'
import { connect } from '../../dist/core/middleware/connect.js'
import { RpcCapability } from '@migaia/rpc-contract'

/** Independent narrow offers keep explicit capability-AND tests separate from production defaults. */
export const RUNTIME_API_FIXTURE_BASE_CAPABILITIES = Object.freeze([
  RpcCapability.ping,
  RpcCapability.close,
  RpcCapability.abort,
  RpcCapability.stream,
  RpcCapability.batch,
  RpcCapability.runtimeApi,
  RpcCapability.forwardRoute
])

/**
 * The loaded legacy owner establishes the actual callable business baseline before the new owner
 * exists.
 */
export async function legacyEndpoint(
  id: string,
  transport: ReturnType<typeof createMemoryTransportPair>[number]
) {
  /** Provider and caller share the original security closure and canonical receiver routing. */
  const chunk = createCanonicalChunkFeature()
  /** No discovery request is needed on this known two-party connection. */
  const outbound = createOutboundFeature(chunk)
  return createComposedEndpoint(
    {
      id,
      transport,
      codec: identityCodec,
      framer: messageFramerV1,
      middlewares: [connect({ transport })]
    },
    {
      'first-party-chunk': chunk,
      'first-party-outbound': outbound,
      'first-party-provider': createProviderFeature(outbound)
    }
  )
}

/**
 * This fixture joins actual source offers; its transport remains the existing reference memory
 * owner.
 */
export function runtimeSources(
  leftCapabilities?: readonly string[],
  rightCapabilities?: readonly string[]
) {
  return new RuntimeSourcePair(leftCapabilities, rightCapabilities).value
}

/** One cold two-sided offer barrier retains the original memory resources and source identities. */
class RuntimeSourcePair {
  /** Each real endpoint subscribes to its same independently owned physical side. */
  readonly #transports = createMemoryTransportPair()
  /** Actual source contexts remain separate until both original offers have arrived. */
  readonly #offers: (IRuntimePeerSourceContext | undefined)[] = []
  /** The original one-shot agreement receipt resolves only after both sources participate. */
  readonly #agreed: Promise<void>
  /** Only the second original offer settles the same native agreement Promise. */
  #accept!: () => void
  /** Optional caller-selected left capabilities retain original array identity and duplicate order. */
  readonly #left: readonly string[] | undefined
  /** Optional right capabilities remain independent of the local side's proposal. */
  readonly #right: readonly string[] | undefined
  /** Original own sources/transports/close key order remains the public fixture surface. */
  readonly value
  /** Construct only a cold native pair and its original agreement barrier. */
  constructor(leftCapabilities?: readonly string[], rightCapabilities?: readonly string[]) {
    this.#left = leftCapabilities
    this.#right = rightCapabilities
    this.#agreed = new Promise<void>((resolve) => {
      this.#accept = resolve
    })
    this.value = {
      sources: [this.#source(0), this.#source(1)] as const,
      transports: this.#transports,
      close: () => this.#transports[0].close()
    }
  }
  /** Each immutable end index delegates its original source callback to this one pair owner. */
  #source(index: 0 | 1) {
    return (context: IRuntimePeerSourceContext) => this.#open(index, context)
  }
  /** Complete the original two-offer transaction without adding another negotiation or lifetime. */
  async #open(index: 0 | 1, context: IRuntimePeerSourceContext) {
    this.#offers[index] = context
    if (this.#offers[0] && this.#offers[1]) (0, this.#accept)()
    await this.#agreed
    /**
     * Left order and duplicates are retained while each right membership check becomes constant
     * work.
     */
    const left = this.#left ?? RUNTIME_API_FIXTURE_BASE_CAPABILITIES
    /** A fresh per-source index preserves the original supported mutable input-array read boundary. */
    const right = new Set(this.#right ?? RUNTIME_API_FIXTURE_BASE_CAPABILITIES)
    /** Total work is linear in both actual capability arrays and output multiplicity. */
    const capabilities = left.filter((value) => right.has(value))
    registerBatchAgreement(this.#transports[index], capabilities)
    return {
      transport: this.#transports[index],
      peerId: this.#offers[1 - index]!.self.instanceId,
      scheduler: systemScheduler,
      agreement: { source: 'static' as const, codec: identityCodec.id, capabilities },
      pipeline: { codec: identityCodec, framer: messageFramerV1 },
      features: [],
      close: async () => undefined
    }
  }
}

/** Construct two genuine callable owners over the independently agreed fixture sources. */
export async function connected(
  leftProvide: IRuntimePeerProvide,
  rightProvide: IRuntimePeerProvide,
  leftCapabilities?: readonly string[],
  rightCapabilities?: readonly string[],
  report?: (error: unknown) => void
) {
  /** Both Peers and Plugin acceptance fixtures use the same real agreement boundary. */
  const channel = runtimeSources(leftCapabilities, rightCapabilities)
  /** Rejections remain visible to the assertions that exercise notification failure reporting. */
  const failures: unknown[] = []
  /** Different directories and identities are established concurrently by the actual factory. */
  const peers = await Promise.all([
    createRuntimePeer({
      self: { name: 'parent', instanceId: 'parent-1' },
      provide: leftProvide,
      connect: channel.sources[0],
      report: (error) => {
        failures.push(error)
        report?.(error)
      }
    }),
    createRuntimePeer({
      self: { name: 'child', instanceId: 'child-1' },
      provide: rightProvide,
      connect: channel.sources[1],
      report: (error) => {
        failures.push(error)
        report?.(error)
      }
    })
  ])
  return {
    peers,
    failures,
    close: async () => {
      await peers[0].close()
      await peers[1].close()
      channel.close()
    }
  }
}

/** These behavior fixtures explicitly opt into dynamic surfaces; strict type cases are separate. */
export type IRuntimeTestRegistry = readonly [
  IDefinedPluginConstraint &
    IRuntimePluginTyping<
      IRuntimeDynamicSurface,
      Record<never, never>,
      string,
      readonly [],
      'process'
    >,
  IDefinedPluginConstraint &
    IRuntimePluginTyping<
      IRuntimeDynamicSurface,
      Record<never, never>,
      string,
      readonly [],
      'thread'
    >,
  IDefinedPluginConstraint<
    any,
    any,
    any,
    any,
    any,
    string,
    Readonly<
      Record<
        string,
        import('@migaia/plugin-host').IFeature<any, Record<string, (payload: any) => any>>
      >
    >
  >
]

/** Dynamic fixture registration metadata adds no runtime Host wrapper or dispatch path. */
export const runtimeTestHost = defineHost<Record<string, never>, never, IRuntimeTestRegistry>
