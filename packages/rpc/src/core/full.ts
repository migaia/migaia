import {
  createComposedEndpoint,
  type IRecursiveProvideSurface,
  type IRpcKernelSurface
} from './composed.js'
import type { IOutboundSurface } from './features/outbound.js'
import type { IProviderRegistrationSurface } from './features/provider.js'
import type { IDiscoverySurface } from './features/discovery.js'
import type { IControlSurface } from './features/control.js'
import type { IOneWaySurface } from './features/one-way.js'
import { createFirstPartyRoots, type IRpcFirstPartyRootName } from './internal/first-party-roots.js'
import type {
  IFactoryPingCapability,
  IFactoryDiscoveryMode,
  IRpcEndpoint,
  IRpcPingEndpointSurface,
  IRpcFactoryConfig,
  IRpcMiddleware
} from './typing.js'
import type { IRpcFeature, IRpcFeatureSurface } from './feature.js'
import type { IRpcNativeMiddleware } from './middleware.js'

/** Intersects selected tuple contributions without widening their keys. */
type IUnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer I
) => void
  ? I
  : never

/** Projects only public output declared by native middleware tuple members. */
type INativeMiddlewareMemberSurface<TMiddleware> =
  TMiddleware extends IRpcNativeMiddleware<infer TExtension, infer TPublic>
    ? string extends keyof TExtension | keyof TPublic
      ? Record<never, never>
      : TExtension & TPublic
    : never
type INativeMiddlewareSurface<TMiddlewares extends readonly IRpcMiddleware[]> =
  IUnionToIntersection<INativeMiddlewareMemberSurface<TMiddlewares[number]>>

/** Full surface narrows discovery controls from the configured native plugin tuple. */
type IFullEndpointSurface<
  TTargetId extends string,
  TMode extends 'automatic' | 'manual',
  TPing extends boolean,
  TMiddlewares extends readonly IRpcMiddleware[],
  TFeatures extends readonly IRpcFeature[]
> = Omit<
  IRpcKernelSurface &
    IOutboundSurface &
    IProviderRegistrationSurface &
    IDiscoverySurface &
    IControlSurface,
  'connect' | 'discovery' | 'ping' | 'pingAll'
> &
  Pick<IRpcEndpoint<TTargetId, TMode>, 'connect' | 'discovery'> &
  IRpcPingEndpointSurface<TPing> &
  IRpcFeatureSurface<TFeatures> &
  INativeMiddlewareSurface<TMiddlewares>

/**
 * Creates the complete endpoint through one canonical kernel and attachment closure. The `ping`/
 * `pingAll` surface remains conditional on the selected `TMiddlewares` tuple, matching the legacy
 * factory's middleware-derived capability typing (`WRC-C-D31`); the runtime `ping()` gate lives in
 * `RpcControlAttachment` and throws `MIDDLEWARE_MISSING` when the type says the capability is
 * absent, so the type and the runtime observable contract stay in agreement.
 */
function createFullEndpointRuntime<
  TTargetId extends string = string,
  TMiddlewares extends readonly IRpcMiddleware[] = readonly IRpcMiddleware[],
  TFeatures extends readonly IRpcFeature[] = readonly IRpcFeature[]
>(
  config: IRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures> & {
    readonly features?: import('./feature.js').IRpcFiniteFeatureTuple<TFeatures>
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
function createFullEndpointRuntime(config: IRpcFactoryConfig): Promise<object> {
  return createFullEndpointWithRoots(config, false)
}

/** Creates the full endpoint preset with the explicit one-way root included. */
function createFullOneWayEndpointRuntime<
  TTargetId extends string = string,
  TMiddlewares extends readonly IRpcMiddleware[] = readonly IRpcMiddleware[],
  TFeatures extends readonly IRpcFeature[] = readonly IRpcFeature[]
>(
  config: IRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures> & {
    readonly features?: import('./feature.js').IRpcFiniteFeatureTuple<TFeatures>
  }
): Promise<
  IRecursiveProvideSurface<
    IFullEndpointSurface<
      TTargetId,
      IFactoryDiscoveryMode<TMiddlewares>,
      IFactoryPingCapability<TMiddlewares>,
      TMiddlewares,
      TFeatures
    > &
      IOneWaySurface
  >
>
function createFullOneWayEndpointRuntime(config: IRpcFactoryConfig): Promise<object> {
  return createFullEndpointWithRoots(config, true)
}

/** Selects the package-owned roots for the full endpoint presets. */
function createFullEndpointWithRoots(
  config: IRpcFactoryConfig,
  includeOneWay: boolean
): Promise<object> {
  const roots: IRpcFirstPartyRootName[] = [
    'first-party-provider',
    'first-party-discovery',
    'first-party-control'
  ]
  if (includeOneWay) roots.push('first-party-one-way')
  return createComposedEndpoint(
    config as unknown as IRpcFactoryConfig<string, readonly IRpcMiddleware[], readonly []>,
    createFirstPartyRoots(new Set(roots))
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
type IPublicCallable<TAdditionalSurface extends object = Record<never, never>> = {
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
      > &
        TAdditionalSurface
    >
  >
  <
    TTargetId extends string = string,
    TMiddlewares extends readonly IRpcMiddleware[] = readonly IRpcMiddleware[],
    TFeatures extends readonly IRpcFeature[] = readonly IRpcFeature[]
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
      > &
        TAdditionalSurface
    >
  >
}

/** Checked public boundary delegates to the original runtime without a second lifecycle path. */
export const createFullEndpoint = createFullEndpointRuntime as unknown as IPublicCallable

/** Creates the full endpoint preset with physical one-way delivery. */
export const createFullOneWayEndpoint =
  createFullOneWayEndpointRuntime as unknown as IPublicCallable<IOneWaySurface>
