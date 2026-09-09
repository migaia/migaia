import {
  createComposedEndpoint,
  type IWebRpcComposedModuleSurface,
  type IWebRpcEndpointModule,
  type IWebRpcKernelSurface
} from './core.js'
import { provider, type IProviderSurface } from './features/provider.js'
import { discovery, type IDiscoverySurface } from './features/discovery.js'
import { control } from './features/control.js'
import type {
  IFactoryPingCapability,
  IFactoryDiscoveryMode,
  IWebRpcEndpoint,
  IWebRpcPingEndpointSurface,
  IWebRpcFactoryConfig,
  IWebRpcPlugin
} from './typing.js'
import type { IWebRpcFeature, IWebRpcFeatureSurface } from './feature.js'

type IFullModuleTuple = readonly [
  IWebRpcEndpointModule<IProviderSurface>,
  IWebRpcEndpointModule<IDiscoverySurface>,
  IWebRpcEndpointModule<object>,
  IWebRpcEndpointModule<object>
]

/** Full surface narrows discovery controls from the configured native plugin tuple. */
type IFullEndpointSurface<
  TTargetId extends string,
  TMode extends 'automatic' | 'manual',
  TPing extends boolean,
  TFeatures extends readonly IWebRpcFeature[]
> = Omit<
  IWebRpcKernelSurface & IWebRpcComposedModuleSurface<IFullModuleTuple>,
  'connect' | 'discovery'
> &
  Pick<IWebRpcEndpoint<TTargetId, TMode>, 'connect' | 'discovery'> &
  IWebRpcPingEndpointSurface<TPing> &
  IWebRpcFeatureSurface<TFeatures>

/**
 * Creates the complete endpoint through one canonical kernel and attachment closure. The `ping`/
 * `pingAll` surface remains conditional on the selected `TMiddlewares` tuple, matching the legacy
 * factory's middleware-derived capability typing (`WRC-C-D31`); the runtime `ping()` gate lives in
 * `WebRpcControlAttachment` and throws `MIDDLEWARE_MISSING` when the type says the capability is
 * absent, so the type and the runtime observable contract stay in agreement.
 */
function createFullEndpointRuntime<
  TTargetId extends string = string,
  TMiddlewares extends readonly IWebRpcPlugin[] = readonly IWebRpcPlugin[],
  TFeatures extends readonly IWebRpcFeature[] = readonly IWebRpcFeature[]
>(
  config: IWebRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures> & {
    readonly features?: import('./feature.js').IWebRpcFiniteFeatureTuple<TFeatures>
  }
): Promise<
  IFullEndpointSurface<
    TTargetId,
    IFactoryDiscoveryMode<TMiddlewares>,
    IFactoryPingCapability<TMiddlewares>,
    TFeatures
  >
>
function createFullEndpointRuntime(
  config: IWebRpcFactoryConfig
): Promise<IWebRpcKernelSurface & IWebRpcComposedModuleSurface<IFullModuleTuple>> {
  return createComposedEndpoint(
    config as unknown as IWebRpcFactoryConfig<string, readonly IWebRpcPlugin[], readonly []>,
    [provider(), discovery(), control()] as const
  )
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
    IFullEndpointSurface<
      ITarget<TConfig>,
      IFactoryDiscoveryMode<IMiddlewares<TConfig>>,
      IFactoryPingCapability<IMiddlewares<TConfig>>,
      IFeatures<TConfig>
    >
  >
  <
    TTargetId extends string = string,
    TMiddlewares extends readonly IWebRpcPlugin[] = readonly IWebRpcPlugin[],
    TFeatures extends readonly IWebRpcFeature[] = readonly IWebRpcFeature[]
  >(
    config: ILegacyDefault<TTargetId, TMiddlewares, TFeatures>
  ): Promise<
    IFullEndpointSurface<
      TTargetId,
      IFactoryDiscoveryMode<TMiddlewares>,
      IFactoryPingCapability<TMiddlewares>,
      TFeatures
    >
  >
}

/** Checked public boundary delegates to the original runtime without a second lifecycle path. */
export const createFullEndpoint = createFullEndpointRuntime as unknown as IPublicCallable
