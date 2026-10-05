import { defineHost, type IDefinedPluginConstraint } from '@migaia/plugin-host'
import type {
  IRuntimeDynamicSurface,
  IRuntimePluginTyping
} from '../../src/remote/runtime-api/typing.js'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { systemScheduler } from '@migaia/utils/scheduler'
import { messageFramerV1 } from '../../src/contract/framing/index.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { registerBatchAgreement } from '../../src/core/internal/batch-frame.js'
import {
  createRuntimePeer,
  type IRuntimePeerSourceContext,
  type IRuntimePeerProvide
} from '../../src/remote/runtime-api/peer.js'

import { createComposedEndpoint } from '../../src/core/composed.js'
import { createCanonicalChunkFeature } from '../../src/core/features/canonical-chunk.js'
import { createOutboundFeature } from '../../src/core/features/outbound.js'
import { createProviderFeature } from '../../src/core/features/provider.js'
import { connect } from '../../src/core/middleware/connect.js'
import { RpcCapability } from '../../src/contract/wire-constants.js'

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

/** Native fixture messages are local test data, with one owner and unchanged RED spellings. */
export const RuntimeApiFixtureText = {
  /** Tests the result wrapper's preservation of its child summary secret boundary. */
  resultGetterFailure: 'a7-private-result-marker',
  /** Distinguishes local cancellation after a notify send has already completed. */
  postCommitCancellation: 'post-commit fixture cancellation',
  /** This native business cause must keep its original name, message and stack. */
  businessRange: 'business range fixture',
  /** A handler-created serialization error must retain the original INTERNAL classification. */
  businessSerialization: 'business serialization fixture',
  /** Identity of a caller's already-aborted native reason is independently asserted. */
  preAbort: 'one-way cancellation fixture',
  /** Identity of cancellation while the canonical physical queue is occupied is asserted. */
  queuedAbort: 'queued one-way cancellation fixture',
  /** A sign failure after cancellation must remain reported through the original cause. */
  lateAuthentication: 'late authentication fixture failure',
  /** Native caller cancellation during asynchronous signing must not become a transport failure. */
  signingAbort: 'signing cancellation fixture',
  /** A notify business rejection is independent from successful physical send completion. */
  notifyFailure: 'a5-notify-business-rejection',
  /** Ordered native children prove AggregateError.errors transfer rather than only a cause chain. */
  aggregateType: 'a10-aggregate-type',
  /** The second native child must retain its distinct identity and serialized stack. */
  aggregateRange: 'a10-aggregate-range',
  /** The aggregate's message and original native type are retained in both directions. */
  aggregateFailure: 'a10-aggregate-business-failure'
} as const

/** The loaded legacy owner establishes the actual callable business baseline before C2 exists. */
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
      codec: identityCodecV1,
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
  /** Each endpoint subscribes to one real physical side. */
  const transports = createMemoryTransportPair()
  /**
   * Source preparation waits for both independently supplied offers rather than echoing a local
   * list.
   */
  const offers: (IRuntimePeerSourceContext | undefined)[] = []
  /** Both construction calls must participate before their source agreement is published. */
  let accept!: () => void
  /** This cold fixture barrier is not a production request or lifecycle owner. */
  const agreed = new Promise<void>((resolve) => {
    accept = resolve
  })
  /** Build only the canonical shared Peer; there is no fixture dispatcher or provider registry. */
  const source = (index: number) => async (context: IRuntimePeerSourceContext) => {
    offers[index] = context
    if (offers[0] && offers[1]) accept()
    await agreed
    /** The fixture intentionally lets one side omit a capability to test the genuine AND boundary. */
    const left = leftCapabilities ?? RUNTIME_API_FIXTURE_BASE_CAPABILITIES
    /** The remote side's actual offer is independent from the local side. */
    const right = rightCapabilities ?? RUNTIME_API_FIXTURE_BASE_CAPABILITIES
    /** Static platform agreement enters the original sender/receiver capability owner as well. */
    const capabilities = left.filter((value) => right.includes(value))
    registerBatchAgreement(transports[index]!, capabilities)
    return {
      transport: transports[index]!,
      peerId: offers[1 - index]!.self.instanceId,
      scheduler: systemScheduler,
      agreement: {
        source: 'static' as const,
        codec: identityCodecV1.id,
        capabilities
      },
      pipeline: { codec: identityCodecV1, framer: messageFramerV1 },
      features: [],
      close: async () => undefined
    }
  }
  return {
    sources: [source(0), source(1)] as const,
    transports,
    close: () => transports[0].close()
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
