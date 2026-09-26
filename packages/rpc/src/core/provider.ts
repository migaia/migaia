import { createComposedEndpoint, type IRecursiveProvideSurface } from './composed.js'
import { createProviderFirstPartyRoots } from './internal/provider-first-party-roots.js'
import type { IRpcKernelSurface } from './composed.js'
import type { IProviderSurface } from './features/provider.js'
import type { IRpcFeature, IRpcFeatureSurface } from './feature.js'
import type { IRpcFactoryConfig, IRpcMiddleware } from './typing.js'

/** Internal bridge retains the public provider call's generic feature tuple through composition. */
type IProviderComposition = {
  <
    TTargetId extends string,
    TMiddlewares extends readonly IRpcMiddleware[],
    TFeatures extends readonly IRpcFeature[]
  >(
    config: IRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures> & {
      readonly features?: import('./feature.js').IRpcFiniteFeatureTuple<TFeatures>
    },
    roots: ReturnType<typeof createProviderFirstPartyRoots>
  ): Promise<
    IRecursiveProvideSurface<IRpcKernelSurface & IProviderSurface & IRpcFeatureSurface<TFeatures>>
  >
}

/** Preserves the composition runtime's proven projection without exporting an unchecked core entry. */
const composeProviderEndpoint = createComposedEndpoint as unknown as IProviderComposition

/** Creates one provider runtime whose token includes the inseparable outbound closure. */
function createProviderEndpointRuntime<
  TTargetId extends string = string,
  TMiddlewares extends readonly IRpcMiddleware[] = readonly IRpcMiddleware[],
  TFeatures extends readonly IRpcFeature[] = readonly IRpcFeature[]
>(
  config: IRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures> & {
    readonly features?: import('./feature.js').IRpcFiniteFeatureTuple<TFeatures>
  }
): Promise<
  IRecursiveProvideSurface<IRpcKernelSurface & IProviderSurface & IRpcFeatureSurface<TFeatures>>
> {
  return composeProviderEndpoint<TTargetId, TMiddlewares, TFeatures>(
    config,
    createProviderFirstPartyRoots()
  ) as Promise<
    IRecursiveProvideSurface<IRpcKernelSurface & IProviderSurface & IRpcFeatureSurface<TFeatures>>
  >
}

import type { IChecked, ICheckedInput, IFeatures, ILegacyDefault } from './pipeline-contract.js'

/** Public provider callable prevents unchecked component configurations from reaching the runtime. */
type IPublicCallable = {
  <const TConfig extends ICheckedInput>(
    config: TConfig & IChecked<TConfig>
  ): Promise<
    IRecursiveProvideSurface<
      IRpcKernelSurface & IProviderSurface & IRpcFeatureSurface<IFeatures<TConfig>>
    >
  >
  <
    TTargetId extends string = string,
    TMiddlewares extends readonly IRpcMiddleware[] = readonly IRpcMiddleware[],
    TFeatures extends readonly IRpcFeature[] = readonly IRpcFeature[]
  >(
    config: ILegacyDefault<TTargetId, TMiddlewares, TFeatures>
  ): Promise<
    IRecursiveProvideSurface<IRpcKernelSurface & IProviderSurface & IRpcFeatureSurface<TFeatures>>
  >
}

/** Checked public boundary delegates to the existing provider runtime. */
export const createProviderEndpoint = createProviderEndpointRuntime as unknown as IPublicCallable
