/**
 * Native RPC definition types describe real installed behavior; transport and flow algorithms
 * remain with plugins.
 */
import type { IDefinedPluginConstraint, IPluginHostCore } from '@migaia/plugin-host'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcDirectory } from '@migaia/rpc-contract/protocol'
import type { ICallCommand } from '../call/types.js'
import type { IRpcCallOptions } from '../namespace/types.js'
import type {
  IRpcCallFeature,
  IRpcDispose,
  IRpcObservation,
  IRpcProbeDescriptor
} from '@migaia/rpc-contract/interfaces'
import type { IRpcTransportContext } from '@migaia/rpc-contract/interfaces'
import type { IRpcFlowStages } from './flow-pipelines.js'

/** Native source policy borrows its genuine installation core, including dependency liquidation. */
export type IRpcTransportSetupContext = IRpcTransportContext &
  Readonly<{
    owner: IPluginHostCore
    /** Native notice coalescing borrows the original optional reporter, never a default wrapper. */
    configuredReport?: (error: unknown) => void
  }>

/**
 * Shared erased metadata carries namespace inference without mutable fields or installation
 * authority.
 */
declare const rpcNamespaceSurface: unique symbol

/** Native definitions share one static scope/extension shape; their actual kind remains distinct. */
export type IRpcNamespacePlugin<
  N extends string = string,
  E extends object = object,
  K extends 'transport' | 'flow' = 'transport' | 'flow'
> = IDefinedPluginConstraint<Record<never, never>, never, Record<never, never>> &
  Readonly<{ [rpcNamespaceSurface]: Readonly<{ kind: K; namespace: N; extensions: E }> }>

/** A transport remains an actual native plugin definition with one host-local namespace. */
export type IRpcTransportPlugin<
  N extends string = string,
  E extends object = Record<never, never>
> = IRpcNamespacePlugin<N, E, 'transport'>

/** Native flow/link-policy definitions participate in the same installation and rollback. */
export type IRpcFlowPlugin<
  E extends object = Record<never, never>,
  N extends string = string
> = IRpcNamespacePlugin<N, E, 'flow'>

/**
 * Host accepts genuine SDK registrations only; structural metadata grants no installation
 * authority.
 */
export type IRpcHostPlugin = IRpcTransportPlugin | IRpcFlowPlugin

/** Per-host setup receives cancellation and reporting without mutable host work tables. */
export type IRpcFlowSetupContext = Readonly<{
  signal: IAbortSignal
  report(error: unknown): void
  /** Observation borrows actual current identity without a mutable Session or host facade. */
  self?(): IRpcDirectory['self']
  /** Actual plugin stages may publish readonly facts through the existing observer boundary. */
  observe?(event: IRpcObservation): void
  /** Namespace extensions can originate a normal host call without accessing mutable work tables. */
  call(namespace: string, command: ICallCommand, options?: IRpcCallOptions): Promise<unknown>
  /** Policy owners retire an observed exact carrier through the actual Session lifecycle owner. */
  retire(carrierId: string, reason?: unknown): Promise<void>
}>

/** Each installation contributes native stages and exact cleanup, never an RPC-owned runner. */
export type IRpcFlowInstallation<E extends object = Record<never, never>> = Readonly<{
  stages?: IRpcFlowStages
  observe?(event: IRpcObservation): void
  extensions?: readonly string[]
  requiredExtensions?: readonly string[]
  /** Only a genuine installed protection owner describes its observable authentication mode. */
  observationFacts?: Readonly<Pick<IRpcProbeDescriptor, 'authentication'>>
  dispose?: IRpcDispose
  /** Native namespace publication rejects collisions with host methods. */
  namespaceExtensions?(namespace: string): Readonly<E>
}>

/** Cold reusable flow configuration constructs installation-local resources in its native hook. */
export type IRpcFlowDefinition<E extends object = Record<never, never>> = Readonly<{
  name: string
  namespaces?: readonly string[]
  setup(context: IRpcFlowSetupContext): IRpcFlowInstallation<E> | Promise<IRpcFlowInstallation<E>>
}>

/** A link policy supplies only complete feature instances; host contains no concrete strategies. */
export type IRpcLinkPolicyDefinition = Readonly<{
  name: string
  features: readonly IRpcCallFeature[]
}>
