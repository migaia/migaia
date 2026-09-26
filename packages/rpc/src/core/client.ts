import { createComposedEndpoint } from './composed.js'
import { createClientFirstPartyRoots } from './internal/client-first-party-roots.js'
import type { IRpcKernelSurface } from './composed.js'
import type { IOutboundSurface } from './features/outbound.js'
import type { IRpcFeature, IRpcFeatureSurface } from './feature.js'
import type { IRpcFactoryConfig, IRpcMiddleware } from './typing.js'

/** Creates client preset using the statically selected outbound feature. */
function createClientEndpointRuntime<
  TTargetId extends string = string,
  TMiddlewares extends readonly IRpcMiddleware[] = readonly IRpcMiddleware[],
  TFeatures extends readonly IRpcFeature[] = readonly IRpcFeature[]
>(
  config: IRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures> & {
    readonly features?: import('./feature.js').IRpcFiniteFeatureTuple<TFeatures>
  }
): Promise<IRpcKernelSurface & IOutboundSurface & IRpcFeatureSurface<TFeatures>> {
  return createComposedEndpoint(
    config as unknown as IRpcFactoryConfig<string, readonly IRpcMiddleware[], readonly []>,
    createClientFirstPartyRoots()
  ) as Promise<IRpcKernelSurface & IOutboundSurface & IRpcFeatureSurface<TFeatures>>
}

import type { IChecked, ICheckedInput, IFeatures, ILegacyDefault } from './pipeline-contract.js'

/** Public client callable prevents unchecked component configurations from reaching the runtime. */
type IPublicCallable = {
  <const TConfig extends ICheckedInput>(
    config: TConfig & IChecked<TConfig>
  ): Promise<IRpcKernelSurface & IOutboundSurface & IRpcFeatureSurface<IFeatures<TConfig>>>
  <
    TTargetId extends string = string,
    TMiddlewares extends readonly IRpcMiddleware[] = readonly IRpcMiddleware[],
    TFeatures extends readonly IRpcFeature[] = readonly IRpcFeature[]
  >(
    config: ILegacyDefault<TTargetId, TMiddlewares, TFeatures>
  ): Promise<IRpcKernelSurface & IOutboundSurface & IRpcFeatureSurface<TFeatures>>
}

/** Checked public boundary delegates to the existing client runtime. */
export const createClientEndpoint = createClientEndpointRuntime as unknown as IPublicCallable
