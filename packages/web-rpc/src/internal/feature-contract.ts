import type { IEndpointKernelHost } from '../endpoint-kernel.js'
import type { IPreparedEndpoint } from './endpoint-bootstrap.js'
import type { IWebRpcPluginInstallScope } from '../typing.js'
import type {
  IWebRpcCandidatePingPort,
  IWebRpcDiscoveryResolverPort,
  IWebRpcInboundIdentityPort,
  IWebRpcOutboundCommand,
  IWebRpcOutboundOperationsPort,
  IWebRpcTimePort,
  IWebRpcVariationCoordinatorPort
} from './plugin-shared-keys.js'
import type { IOutboundSurface } from '../features/outbound.js'
import type { IDiscoverySurface } from '../features/discovery.js'
import type { IControlSurface } from '../features/control.js'
import type { IProviderRegistrationSurface } from '../features/provider.js'
import type { IOneWaySurface } from '../features/one-way.js'

/** Explicit first-party operations available through Feature expose, never a broad Plugin core. */
export type IRpcFeatureExpose = Readonly<{
  readonly getKernel: () => IEndpointKernelHost
  readonly getPrepared: () => IPreparedEndpoint<string>
  readonly getTime: () => IWebRpcTimePort
  readonly getCandidatePing: () => IWebRpcCandidatePingPort | undefined
  /** Observes real outbound command results only in bounded internal fixture construction. */
  readonly observeOutboundCommand?: (observation: IWebRpcOutboundCommandObservation) => void
}>

/** Preserves native outbound result identity while allowing diagnostic-only fixture observation. */
export type IWebRpcOutboundCommandObservation = Readonly<{
  readonly command: IWebRpcOutboundCommand
  readonly result: void | Promise<void>
  readonly error?: unknown
}>

/** One prepared outbound attachment and its exact public and internal ports. */
export type IOutboundInstallation = Readonly<{
  readonly public: IOutboundSurface
  readonly inboundIdentity: IWebRpcInboundIdentityPort
  readonly outboundOperations: IWebRpcOutboundOperationsPort
  readonly variationCoordinator: IWebRpcVariationCoordinatorPort
  readonly activate: () => void
}>

/** First-party outbound capability is explicitly prepared by the composition Plugin. */
export type IOutboundCapability = Readonly<{
  readonly prepare: (scope: IWebRpcPluginInstallScope) => IOutboundInstallation
  readonly connectResolver: (port: IWebRpcDiscoveryResolverPort) => void
  /** Reads the attachment-owned hook registrar without publishing it as a Feature root key. */
  readonly getHooks: () => { on(listener: import('../typing.js').IWebRpcHook): () => void }
}>

/** Prepared discovery capability retains its explicit public controls and resolver port. */
export type IDiscoveryInstallation = Readonly<{
  readonly public: IDiscoverySurface
  readonly resolver: IWebRpcDiscoveryResolverPort
  /** Private disposal target retains endpoint-scoped injected cleanup faults. */
  readonly cleanupTarget: object
}>

/** First-party discovery prepares after its direct outbound dependency. */
export type IDiscoveryCapability = Readonly<{
  readonly prepare: (scope: IWebRpcPluginInstallScope) => IDiscoveryInstallation
}>

/** Prepared control capability keeps the conditional ping surface separate from internal ports. */
export type IControlInstallation = Readonly<{
  readonly public: IControlSurface
}>

/** First-party control is prepared after outbound and discovery direct dependencies. */
export type IControlCapability = Readonly<{
  readonly prepare: (scope: IWebRpcPluginInstallScope) => IControlInstallation
}>

/** Prepared provider capability exposes only registration; outbound stays owned by its dependency. */
export type IProviderInstallation = Readonly<{
  readonly public: IProviderRegistrationSurface
}>

/** First-party provider prepares against direct outbound ports. */
export type IProviderCapability = Readonly<{
  readonly prepare: (scope: IWebRpcPluginInstallScope) => IProviderInstallation
}>

/** One-way projection remains a thin direct outbound port consumer. */
export type IOneWayInstallation = Readonly<{ readonly public: IOneWaySurface }>

/** Optional one-way Feature prepares only when the caller selected the legacy module token. */
export type IOneWayCapability = Readonly<{
  readonly prepare: (scope: IWebRpcPluginInstallScope) => IOneWayInstallation
}>
