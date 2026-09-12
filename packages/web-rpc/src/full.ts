import {
  createComposedEndpoint,
  type IRecursiveProvideSurface,
  type IWebRpcKernelSurface
} from './core.js'
import type { IOutboundSurface } from './features/outbound.js'
import type { IProviderRegistrationSurface } from './features/provider.js'
import type { IDiscoverySurface } from './features/discovery.js'
import type { IControlSurface } from './features/control.js'
import {
  createFirstPartyRoots,
  type IWebRpcFirstPartyRootName
} from './internal/first-party-roots.js'
import type {
  IFactoryPingCapability,
  IFactoryDiscoveryMode,
  IWebRpcEndpoint,
  IWebRpcPingEndpointSurface,
  IWebRpcFactoryConfig,
  IWebRpcMiddleware
} from './typing.js'
import type { IWebRpcFeature, IWebRpcFeatureSurface } from './feature.js'
import type { IWebRpcNativeMiddleware } from './middleware.js'

/** Intersects selected tuple contributions without widening their keys. */
type IUnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer I
) => void
  ? I
  : never

/** Projects only public output declared by native middleware tuple members. */
type INativeMiddlewareMemberSurface<TMiddleware> =
  TMiddleware extends IWebRpcNativeMiddleware<infer TExtension, infer TPublic>
    ? string extends keyof TExtension | keyof TPublic
      ? Record<never, never>
      : TExtension & TPublic
    : never
type INativeMiddlewareSurface<TMiddlewares extends readonly IWebRpcMiddleware[]> =
  IUnionToIntersection<INativeMiddlewareMemberSurface<TMiddlewares[number]>>

/** Full surface narrows discovery controls from the configured native plugin tuple. */
type IFullEndpointSurface<
  TTargetId extends string,
  TMode extends 'automatic' | 'manual',
  TPing extends boolean,
  TMiddlewares extends readonly IWebRpcMiddleware[],
  TFeatures extends readonly IWebRpcFeature[]
> = Omit<
  IWebRpcKernelSurface &
    IOutboundSurface &
    IProviderRegistrationSurface &
    IDiscoverySurface &
    IControlSurface,
  'connect' | 'discovery' | 'ping' | 'pingAll'
> &
  Pick<IWebRpcEndpoint<TTargetId, TMode>, 'connect' | 'discovery'> &
  IWebRpcPingEndpointSurface<TPing> &
  IWebRpcFeatureSurface<TFeatures> &
  INativeMiddlewareSurface<TMiddlewares>

/**
 * Creates the complete endpoint through one canonical kernel and attachment closure. The `ping`/
 * `pingAll` surface remains conditional on the selected `TMiddlewares` tuple, matching the legacy
 * factory's middleware-derived capability typing (`WRC-C-D31`); the runtime `ping()` gate lives in
 * `WebRpcControlAttachment` and throws `MIDDLEWARE_MISSING` when the type says the capability is
 * absent, so the type and the runtime observable contract stay in agreement.
 */
function createFullEndpointRuntime<
  TTargetId extends string = string,
  TMiddlewares extends readonly IWebRpcMiddleware[] = readonly IWebRpcMiddleware[],
  TFeatures extends readonly IWebRpcFeature[] = readonly IWebRpcFeature[]
>(
  config: IWebRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures> & {
    readonly features?: import('./feature.js').IWebRpcFiniteFeatureTuple<TFeatures>
  }
): Promise<
  IRecursiveProvideSurface<
    IFullEndpointSurface<
      TTargetId,
      IFactoryDiscoveryMode<TMiddlewares>,
      IFactoryPingCapability<TMiddlewares>,
      TMiddlewares,
      TFeatures
    >
  >
>
function createFullEndpointRuntime(config: IWebRpcFactoryConfig): Promise<object> {
  return createComposedEndpoint(
    config as unknown as IWebRpcFactoryConfig<string, readonly IWebRpcMiddleware[], readonly []>,
    createFirstPartyRoots(
      new Set<IWebRpcFirstPartyRootName>([
        'first-party-provider',
        'first-party-discovery',
        'first-party-control'
      ])
    )
  ) as Promise<object>
}

import type {
  IChecked,
  ICheckedInput,
  IFeatures,
  ILegacyDefault,
  IMiddlewares,
  ITarget
} from './pipeline-contract.js'

/** Public full-endpoint callable preserves checked inferred and legacy-default forms. */
type IPublicCallable = {
  <const TConfig extends ICheckedInput>(
    config: TConfig & IChecked<TConfig>
  ): Promise<
    IRecursiveProvideSurface<
      IFullEndpointSurface<
        ITarget<TConfig>,
        IFactoryDiscoveryMode<IMiddlewares<TConfig>>,
        IFactoryPingCapability<IMiddlewares<TConfig>>,
        IMiddlewares<TConfig>,
        IFeatures<TConfig>
      >
    >
  >
  <
    TTargetId extends string = string,
    TMiddlewares extends readonly IWebRpcMiddleware[] = readonly IWebRpcMiddleware[],
    TFeatures extends readonly IWebRpcFeature[] = readonly IWebRpcFeature[]
  >(
    config: ILegacyDefault<TTargetId, TMiddlewares, TFeatures>
  ): Promise<
    IRecursiveProvideSurface<
      IFullEndpointSurface<
        TTargetId,
        IFactoryDiscoveryMode<TMiddlewares>,
        IFactoryPingCapability<TMiddlewares>,
        TMiddlewares,
        TFeatures
      >
    >
  >
}

/** Checked public boundary delegates to the original runtime without a second lifecycle path. */
export const createFullEndpoint = createFullEndpointRuntime as unknown as IPublicCallable
