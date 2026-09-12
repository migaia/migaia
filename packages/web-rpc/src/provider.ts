import { createComposedEndpoint, type IRecursiveProvideSurface } from './core.js'
import { createProviderFirstPartyRoots } from './internal/provider-first-party-roots.js'
import type { IWebRpcKernelSurface } from './core.js'
import type { IProviderSurface } from './features/provider.js'
import type { IWebRpcFeature, IWebRpcFeatureSurface } from './feature.js'
import type { IWebRpcFactoryConfig, IWebRpcMiddleware } from './typing.js'

/** Internal bridge retains the public provider call's generic feature tuple through composition. */
type IProviderComposition = {
  <
    TTargetId extends string,
    TMiddlewares extends readonly IWebRpcMiddleware[],
    TFeatures extends readonly IWebRpcFeature[]
  >(
    config: IWebRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures> & {
      readonly features?: import('./feature.js').IWebRpcFiniteFeatureTuple<TFeatures>
    },
    roots: ReturnType<typeof createProviderFirstPartyRoots>
  ): Promise<
    IRecursiveProvideSurface<
      IWebRpcKernelSurface & IProviderSurface & IWebRpcFeatureSurface<TFeatures>
    >
  >
}

/** Preserves the composition runtime's proven projection without exporting an unchecked core entry. */
const composeProviderEndpoint = createComposedEndpoint as unknown as IProviderComposition

/** Creates one provider runtime whose token includes the inseparable outbound closure. */
function createProviderEndpointRuntime<
  TTargetId extends string = string,
  TMiddlewares extends readonly IWebRpcMiddleware[] = readonly IWebRpcMiddleware[],
  TFeatures extends readonly IWebRpcFeature[] = readonly IWebRpcFeature[]
>(
  config: IWebRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures> & {
    readonly features?: import('./feature.js').IWebRpcFiniteFeatureTuple<TFeatures>
  }
): Promise<
  IRecursiveProvideSurface<
    IWebRpcKernelSurface & IProviderSurface & IWebRpcFeatureSurface<TFeatures>
  >
> {
  return composeProviderEndpoint<TTargetId, TMiddlewares, TFeatures>(
    config,
    createProviderFirstPartyRoots()
  ) as Promise<
    IRecursiveProvideSurface<
      IWebRpcKernelSurface & IProviderSurface & IWebRpcFeatureSurface<TFeatures>
    >
  >
}

import type { IChecked, ICheckedInput, IFeatures, ILegacyDefault } from './pipeline-contract.js'

/** Public provider callable prevents unchecked component configurations from reaching the runtime. */
type IPublicCallable = {
  <const TConfig extends ICheckedInput>(
    config: TConfig & IChecked<TConfig>
  ): Promise<
    IRecursiveProvideSurface<
      IWebRpcKernelSurface & IProviderSurface & IWebRpcFeatureSurface<IFeatures<TConfig>>
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
      IWebRpcKernelSurface & IProviderSurface & IWebRpcFeatureSurface<TFeatures>
    >
  >
}

/** Checked public boundary delegates to the existing provider runtime. */
export const createProviderEndpoint = createProviderEndpointRuntime as unknown as IPublicCallable
