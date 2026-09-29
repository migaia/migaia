import type { IEndpointKernelHost } from '../endpoint-kernel.js'
import type { IPreparedEndpoint } from './endpoint-bootstrap.js'
import type { IRpcPluginInstallScope } from '../typing.js'
import type {
  IRpcCandidatePingPort,
  IRpcDiscoveryResolverPort,
  IRpcInboundIdentityPort,
  IRpcOutboundCommand,
  IRpcOutboundOperationsPort,
  IRpcTimePort,
  IRpcVariationCoordinatorPort
} from './plugin-shared-keys.js'
import type { IOutboundSurface } from '../features/outbound.js'
import type { IDiscoverySurface } from '../features/discovery.js'
import type { IControlSurface } from '../features/control.js'
import type { IProviderRegistrationSurface } from '../features/provider.js'
import type { IOneWaySurface } from '../features/one-way.js'
import type { IRpcStreamSurface } from '../features/stream.js'

/** Explicit first-party operations available through Feature expose, never a broad Plugin core. */
export type IRpcFeatureExpose = Readonly<{
  readonly getKernel: () => IEndpointKernelHost
  readonly getPrepared: () => IPreparedEndpoint<string>
  readonly getTime: () => IRpcTimePort
  readonly getCandidatePing: () => IRpcCandidatePingPort | undefined
  /** Observes real outbound command results only in bounded internal fixture construction. */
  readonly observeOutboundCommand?: (observation: IRpcOutboundCommandObservation) => void
}>

/** Preserves native outbound result identity while allowing diagnostic-only fixture observation. */
export type IRpcOutboundCommandObservation = Readonly<{
  readonly command: IRpcOutboundCommand
  readonly result: void | Promise<void>
  readonly error?: unknown
}>

/** One prepared outbound attachment and its exact public and internal ports. */
export type IOutboundInstallation = Readonly<{
  readonly public: IOutboundSurface
  readonly inboundIdentity: IRpcInboundIdentityPort
  readonly outboundOperations: IRpcOutboundOperationsPort
  readonly variationCoordinator: IRpcVariationCoordinatorPort
  readonly activate: () => void
}>

/** First-party outbound capability is explicitly prepared by the composition Plugin. */
export type IOutboundCapability = Readonly<{
  readonly prepare: (scope: IRpcPluginInstallScope) => IOutboundInstallation
  readonly connectResolver: (port: IRpcDiscoveryResolverPort) => void
  /** Reads the attachment-owned hook registrar without publishing it as a Feature root key. */
  readonly getHooks: () => { on(listener: import('../typing.js').IRpcHook): () => void }
}>

/** Prepared discovery capability retains its explicit public controls and resolver port. */
export type IDiscoveryInstallation = Readonly<{
  readonly public: IDiscoverySurface
  readonly resolver: IRpcDiscoveryResolverPort
  /** Private disposal target retains endpoint-scoped injected cleanup faults. */
  readonly cleanupTarget: object
}>

/** First-party discovery prepares after its direct outbound dependency. */
export type IDiscoveryCapability = Readonly<{
  readonly prepare: (scope: IRpcPluginInstallScope) => IDiscoveryInstallation
}>

/** Prepared control capability keeps the conditional ping surface separate from internal ports. */
export type IControlInstallation = Readonly<{
  readonly public: IControlSurface
}>

/** First-party control is prepared after outbound and discovery direct dependencies. */
export type IControlCapability = Readonly<{
  readonly prepare: (scope: IRpcPluginInstallScope) => IControlInstallation
}>

/** Prepared provider capability exposes only registration; outbound stays owned by its dependency. */
export type IProviderInstallation = Readonly<{
  readonly public: IProviderRegistrationSurface
  readonly registerStream: (
    method: string,
    handler: (message: unknown) => void | Promise<void>
  ) => () => void
}>

/** First-party provider prepares against direct outbound ports. */
export type IProviderCapability = Readonly<{
  readonly prepare: (scope: IRpcPluginInstallScope) => IProviderInstallation
}>

/** One-way projection remains a thin direct outbound port consumer. */
export type IOneWayInstallation = Readonly<{ readonly public: IOneWaySurface }>

/** Optional one-way Feature prepares only when the caller selected the legacy module token. */
export type IOneWayCapability = Readonly<{
  readonly prepare: (scope: IRpcPluginInstallScope) => IOneWayInstallation
}>

/** Optional stream Feature publishes a single namespaced runtime surface. */
export type IStreamInstallation = Readonly<{ readonly public: IRpcStreamSurface }>
export type IStreamCapability = Readonly<{
  readonly prepare: (scope: IRpcPluginInstallScope) => IStreamInstallation
}>
