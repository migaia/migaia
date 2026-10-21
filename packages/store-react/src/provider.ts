import { useContext } from 'react'
import type { IReactiveStore, IStoreShape } from '@migaia/store-light'
import type { IRuntime } from '@migaia/reactive'
import { StoreRegistryContext } from './provider-context.js'
import type { IStoreToken } from './provider-registry.js'
import { useStore } from './useStore.js'
import { createStoreReactError } from './errors.js'
import { StoreReactErrorCode } from './error-code.js'
import { StoreReactErrorText } from './error-text.js'

export { StoreProvider } from './StoreProvider.js'
export type { IStoreProviderProps } from './StoreProvider.js'
export { StoreRegistry, createStoreRegistry, createStoreToken } from './provider-registry.js'
export type { IStoreRegistrationOptions, IStoreToken } from './provider-registry.js'
export {
  assertStoreFeature,
  normalizeStoreConfig,
  readStoreFeature,
  useAssertStoreFeature,
  useStoreConfig,
  useStoreFeature
} from './store-config.js'
export type {
  IStoreFeatureExperimental,
  IStoreFeaturePath,
  IStoreFeatures,
  IStoreProviderConfig,
  IStoreProviderDefaults,
  IStoreReadyBarrier,
  IStoreConfigValue
} from './store-config.js'

/** Read the nearest Provider registry synchronously; absence throws PROVIDER_REQUIRED in render. */
export function useStoreRegistry() {
  const registry = useContext(StoreRegistryContext)
  if (!registry) {
    throw createStoreReactError(
      StoreReactErrorCode.providerRequired,
      StoreReactErrorText.requiresProvider
    )
  }
  return registry
}

/** Read the nearest registry's borrowed Runtime; absence of StoreProvider throws PROVIDER_REQUIRED. */
export function useStoreRuntime(): IRuntime {
  return useStoreRegistry().runtime
}

/**
 * Require the exact token from the nearest registry. Missing Provider/token and closed registry
 * failures propagate during render. This lookup does not itself subscribe to registry replacement.
 */
export function useStoreFromProvider<T>(token: IStoreToken<T>): T {
  return useStoreRegistry().require(token)
}

/**
 * Resolve a Store token, then use its Runtime for a selective React subscription. Equality defaults
 * to Object.is through useStore; asynchronous Stores may suspend until ready.
 * Store/registry/Runtime remain owned by their existing owners, not this hook.
 */
export function useProvidedStore<S extends Record<string, unknown>, Result>(
  token: IStoreToken<IReactiveStore<S>>,
  selector: (state: IStoreShape<S>) => Result,
  isEqual?: (left: Result, right: Result) => boolean
): Result {
  const store = useStoreFromProvider(token)
  return useStore(store, selector, isEqual)
}
