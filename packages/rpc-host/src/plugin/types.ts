import type { IDefinedPluginConstraint } from '@migaia/plugin-host'
import type { IRpcFeature } from '../core/feature.js'
import type { createCanonicalChunkFeature } from '../core/features/canonical-chunk.js'
import type { IRpcAuthenticationConfig, IRpcPlugin } from '../core/typing.js'
import type { IRpcProbe } from '../core/probe/types.js'
import type { IRpcHost, IRpcHostFeatureContext } from '../host/types.js'
import type { IRemoteRetryPort } from '../remote/types.js'
import type { IRuntimePeer } from '../remote/runtime-api/peer.js'
import type { IAdapterDeployment } from '../runtime-adapter/deployment.js'

/** Physical source modes select the existing adapter preparation path. */
export const RpcTransportMode = {
  /** Launch a locally supervised remote resource. */ spawn: 'spawn',
  /** Connect one existing remote resource. */ connect: 'connect',
  /** Accept remote sessions on an existing listener. */ listen: 'listen',
  /** Attach to the parent that launched this runtime. */ 'connect-to-parent': 'connect-to-parent'
} as const

/** These keys are the supported physical preparation modes. */
export type RpcTransportMode = keyof typeof RpcTransportMode

/** One finite handshake budget is shared by the adapter's existing handshake stages. */
export type IRpcConnectOptions = Readonly<{ timeoutMs?: number }>

/** Transport definitions retain cold native deployment authority without acquiring a connection. */
export type IRpcTransportPluginDefinition = Readonly<{
  name: string
  expose?: readonly string[]
  mode: RpcTransportMode
  deployment: IAdapterDeployment
  connect?: IRpcConnectOptions
}>

/** Contributions configure existing endpoint owners before its single construction. */
export type IRpcHostContribution = Readonly<{
  /** Reuse the endpoint's unique canonical chunk root instead of installing a duplicate feature. */
  chunk?: ReturnType<typeof createCanonicalChunkFeature>
  features?: readonly IRpcFeature[]
  middlewares?: readonly IRpcPlugin[]
  authentication?: IRpcAuthenticationConfig
  defaultTimeoutMs?: number
  retryPort?: IRemoteRetryPort
  retry?: true
  probe?: IRpcProbe | readonly IRpcProbe[]
}>

/** A member projects one session of the host endpoint, without a second endpoint lifetime. */
export type IRpcHostMember = Omit<IRuntimePeer, 'self'> & Readonly<{ id: string }>

/** Assemblers open private members and return the one logical direct target published by the host. */
export type IRpcHostAssembleContext = Readonly<{
  host: IRpcHost<unknown>
  openMember(): Promise<IRpcHostMember>
  transport: Readonly<{ name: string; mode: RpcTransportMode }>
}>

/** Feature installation observes the real host and contributes only existing endpoint facilities. */
export type IRpcFeaturePluginDefinition = Readonly<{
  name: string
  probe?: IRpcProbe | readonly IRpcProbe[]
  contribution?: IRpcHostContribution
  assemble?(context: IRpcHostAssembleContext): Promise<IRpcHostMember>
  setup?(context: IRpcHostFeatureContext): void | Promise<void>
}>

/** The returned value is the native plugin definition, also usable by ordinary plugin-host Hosts. */
export type IRpcTransportPlugin = IDefinedPluginConstraint<
  Record<never, never>,
  never,
  Record<never, never>
> &
  Readonly<{ expose?: readonly string[] }>

/** Feature surfaces are metadata on this exact frozen native plugin definition. */
export type IRpcFeaturePlugin = IDefinedPluginConstraint<
  Record<never, never>,
  never,
  Record<never, never>
>

/** Host admission accepts registered native definitions, never user-declared discriminator fields. */
export type IRpcHostPlugin = IRpcTransportPlugin | IRpcFeaturePlugin
