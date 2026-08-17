import { useContext } from 'react';
import type { IReactiveStore, IStoreShape } from '@migaia/store-light';
import type { IRuntime } from '@migaia/reactive';
import { StoreRegistryContext } from './provider-context.js';
import type { IStoreToken } from './provider-registry.js';
import { useStore } from './useStore.js';
import { createStoreReactError } from './errors.js';
import { StoreReactErrorCode } from './error-code.js';

export { StoreProvider } from './StoreProvider.js';
export type { IStoreProviderProps } from './StoreProvider.js';
export { StoreRegistry, createStoreRegistry, createStoreToken } from './provider-registry.js';
export type { IStoreRegistrationOptions, IStoreToken } from './provider-registry.js';
export {
  assertStoreFeature,
  normalizeStoreConfig,
  readStoreFeature,
  useAssertStoreFeature,
  useStoreConfig,
  useStoreFeature
} from './store-config.js';
export type {
  IStoreFeatureExperimental,
  IStoreFeaturePath,
  IStoreFeatures,
  IStoreProviderConfig,
  IStoreProviderDefaults,
  IStoreReadyBarrier,
  IStoreConfigValue
} from './store-config.js';

export function useStoreRegistry() {
  const registry = useContext(StoreRegistryContext);
  if (!registry) {
    throw createStoreReactError(
      StoreReactErrorCode.providerRequired,
      '[store] hook requires a StoreProvider'
    );
  }
  return registry;
}

export function useStoreRuntime(): IRuntime {
  return useStoreRegistry().runtime;
}

export function useStoreFromProvider<T>(token: IStoreToken<T>): T {
  return useStoreRegistry().require(token);
}

export function useProvidedStore<S extends Record<string, unknown>, Result>(
  token: IStoreToken<IReactiveStore<S>>,
  selector: (state: IStoreShape<S>) => Result,
  isEqual?: (left: Result, right: Result) => boolean
): Result {
  const store = useStoreFromProvider(token);
  return useStore(store, selector, isEqual);
}
