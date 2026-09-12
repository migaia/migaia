/** Exact full/root runtime owners registered under one canonical kernel after construction. */
export const fullRuntimeOwnerKeys = Object.freeze([
  'chunk-assembler',
  'control-ping',
  'discovery-registry',
  'discovery-replay',
  'hook-registry',
  'inbound-identity',
  'kernel',
  'outbound-pipeline',
  'pending-registry',
  'provider-admission',
  'provider-controllers',
  'provider-executor',
  'provider-registry',
  'replay-window',
  'request-replay',
  'resource-scope',
  'time-port',
  'variation-coordinator'
] as const)

/** D34: every outbound-capable root owns one selected-framer bridge. */
export const defaultRuntimeOwnerKeys = fullRuntimeOwnerKeys

/** Exact outbound/client allocation closure; no concrete inbound feature owner is present. */
export const clientRuntimeOwnerKeys = Object.freeze([
  'chunk-assembler',
  'hook-registry',
  'inbound-identity',
  'kernel',
  'outbound-pipeline',
  'pending-registry',
  'replay-window',
  'resource-scope',
  'time-port',
  'variation-coordinator'
] as const)

/** Exact provider allocation closure including its inseparable security owners. */
export const providerRuntimeOwnerKeys = Object.freeze([
  'chunk-assembler',
  'hook-registry',
  'inbound-identity',
  'kernel',
  'outbound-pipeline',
  'pending-registry',
  'provider-admission',
  'provider-controllers',
  'provider-executor',
  'provider-registry',
  'replay-window',
  'request-replay',
  'resource-scope',
  'time-port',
  'variation-coordinator'
] as const)

/** Core composition uses the same outbound-only owner closure as the client preset. */
export const coreRuntimeOwnerKeys = clientRuntimeOwnerKeys

/** Custom composition of every first-party feature retains the canonical framer bridge. */
export const customRuntimeOwnerKeys = fullRuntimeOwnerKeys
import { createMemoryTransportPair } from '../../../src/adapters/memory.js'
import { createComposedEndpoint } from '../../../src/core.js'
import { createClientEndpoint } from '../../../src/client.js'
import { createFullEndpoint } from '../../../src/full.js'
import { createProviderEndpoint } from '../../../src/provider.js'
import { createClientFirstPartyRoots } from '../../../src/internal/client-first-party-roots.js'
import {
  createFirstPartyRoots,
  type IWebRpcFirstPartyRootName
} from '../../../src/internal/first-party-roots.js'
import { readEndpointDebugSnapshot } from '../../../src/internal/test-observer.js'
import { connect } from '../../../src/middleware/connect.js'

/** Immutable observed owner-key closure for every real endpoint consumer preset. */
export type IRuntimeOwnerAllocation = Readonly<
  Record<'core' | 'client' | 'provider' | 'full' | 'custom', readonly string[]>
>

/** Fixed consumer order keeps observation keys aligned with constructed endpoints. */
const runtimeOwnerConsumers = ['core', 'client', 'provider', 'full', 'custom'] as const

/** Endpoint shape needed to release every successfully constructed observation. */
type IObservedEndpoint = Readonly<{ dispose: () => Promise<unknown> }>

/** Constructs five real endpoints and returns their observed owner closures. */
export async function observeRuntimeOwnerAllocation(): Promise<IRuntimeOwnerAllocation> {
  /** Constructs one consumer endpoint using its production preset and canonical owner set. */
  const make = async (kind: (typeof runtimeOwnerConsumers)[number]) => {
    /** Isolates each observed endpoint under its own real transport pair. */
    const [transport] = createMemoryTransportPair()
    /** Binds the endpoint identity, transport, and physical connect middleware for this probe. */
    const config = { id: `runtime-owner-${kind}`, transport, middlewares: [connect({ transport })] }
    if (kind === 'core') return createComposedEndpoint(config, createClientFirstPartyRoots())
    if (kind === 'client') return createClientEndpoint(config)
    if (kind === 'provider') return createProviderEndpoint(config)
    if (kind === 'full') return createFullEndpoint(config)
    return createComposedEndpoint(
      config,
      createFirstPartyRoots(
        new Set<IWebRpcFirstPartyRootName>([
          'first-party-chunk',
          'first-party-outbound',
          'first-party-provider',
          'first-party-discovery',
          'first-party-control'
        ])
      )
    )
  }
  /** Retains each endpoint created before a later construction failure. */
  const endpoints: IObservedEndpoint[] = []
  /** Receives the complete observation only after every endpoint construction succeeds. */
  let observation: IRuntimeOwnerAllocation | undefined
  /** Retains a construction/read failure so disposal failures cannot make it unreachable. */
  let primaryFailure: unknown
  /** Distinguishes an actual thrown `undefined` from a successful observation. */
  let primaryFailed = false
  try {
    for (const consumer of runtimeOwnerConsumers) endpoints.push(await make(consumer))
    observation = Object.fromEntries(
      runtimeOwnerConsumers.map((consumer, index) => [
        consumer,
        readEndpointDebugSnapshot(endpoints[index])?.owners ?? []
      ])
    ) as IRuntimeOwnerAllocation
  } catch (error) {
    primaryFailed = true
    primaryFailure = error
  }
  /** Settles every constructed endpoint even when a peer disposal rejects. */
  const disposalResults = await Promise.allSettled(endpoints.map((endpoint) => endpoint.dispose()))
  /** Preserves each disposal failure after the construction/read failure, when present. */
  const disposalFailures = disposalResults.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : []
  )
  if (primaryFailed) {
    if (disposalFailures.length > 0) throw new AggregateError([primaryFailure, ...disposalFailures])
    throw primaryFailure
  }
  if (disposalFailures.length === 1) throw disposalFailures[0]
  if (disposalFailures.length > 1) throw new AggregateError(disposalFailures)
  return observation!
}
