import { createComposedEndpoint } from './core.js'
import { createClientFirstPartyRoots } from './internal/client-first-party-roots.js'
import type { IWebRpcKernelSurface } from './core.js'
import type { IOutboundSurface } from './features/outbound.js'
import type { IWebRpcFeature, IWebRpcFeatureSurface } from './feature.js'
import type { IWebRpcFactoryConfig, IWebRpcMiddleware } from './typing.js'

/** Creates client preset using the statically selected outbound feature. */
function createClientEndpointRuntime<
  TTargetId extends string = string,
  TMiddlewares extends readonly IWebRpcMiddleware[] = readonly IWebRpcMiddleware[],
  TFeatures extends readonly IWebRpcFeature[] = readonly IWebRpcFeature[]
>(
  config: IWebRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures> & {
    readonly features?: import('./feature.js').IWebRpcFiniteFeatureTuple<TFeatures>
  }
): Promise<IWebRpcKernelSurface & IOutboundSurface & IWebRpcFeatureSurface<TFeatures>> {
  return createComposedEndpoint(
    config as unknown as IWebRpcFactoryConfig<string, readonly IWebRpcMiddleware[], readonly []>,
    createClientFirstPartyRoots()
  ) as Promise<IWebRpcKernelSurface & IOutboundSurface & IWebRpcFeatureSurface<TFeatures>>
}

import type { IChecked, ICheckedInput, IFeatures, ILegacyDefault } from './pipeline-contract.js'

/** Public client callable prevents unchecked component configurations from reaching the runtime. */
type IPublicCallable = {
  <const TConfig extends ICheckedInput>(
    config: TConfig & IChecked<TConfig>
  ): Promise<IWebRpcKernelSurface & IOutboundSurface & IWebRpcFeatureSurface<IFeatures<TConfig>>>
  <
    TTargetId extends string = string,
    TMiddlewares extends readonly IWebRpcMiddleware[] = readonly IWebRpcMiddleware[],
    TFeatures extends readonly IWebRpcFeature[] = readonly IWebRpcFeature[]
  >(
    config: ILegacyDefault<TTargetId, TMiddlewares, TFeatures>
  ): Promise<IWebRpcKernelSurface & IOutboundSurface & IWebRpcFeatureSurface<TFeatures>>
}

/** Checked public boundary delegates to the existing client runtime. */
export const createClientEndpoint = createClientEndpointRuntime as unknown as IPublicCallable
