import { useContext } from 'react';
import type { IReactiveStore, IStoreShape } from '@migaia/store-light';
import type { IRuntime } from '@migaia/reactive';
import { StoreRegistryContext } from './provider-context';
import type { StoreToken } from './provider-registry';
import { useStore } from './useStore';

export { StoreProvider } from './StoreProvider';
export type { IStoreProviderProps } from './StoreProvider';
export { StoreRegistry, createStoreRegistry, createStoreToken } from './provider-registry';
export type { IStoreRegistrationOptions, StoreToken } from './provider-registry';
export {
  assertStoreFeature,
  normalizeStoreConfig,
  readStoreFeature,
  useAssertStoreFeature,
  useStoreConfig,
  useStoreFeature
} from './store-config';
export type {
  IStoreFeatureExperimental,
  IStoreFeaturePath,
  IStoreFeatures,
  IStoreProviderConfig,
  IStoreProviderDefaults,
  IStoreReadyBarrier,
  IStoreConfigValue
} from './store-config';

export function useStoreRegistry() {
  const registry = useContext(StoreRegistryContext);
  if (!registry) {
    throw new Error('[store] hook requires a StoreProvider');
  }
  return registry;
}

export function useStoreRuntime(): IRuntime {
  return useStoreRegistry().runtime;
}

export function useStoreFromProvider<T>(token: StoreToken<T>): T {
  return useStoreRegistry().require(token);
}

export function useProvidedStore<S extends Record<string, unknown>, Result>(
  token: StoreToken<IReactiveStore<S>>,
  selector: (state: IStoreShape<S>) => Result,
  isEqual?: (left: Result, right: Result) => boolean
): Result {
  const store = useStoreFromProvider(token);
  return useStore(store, selector, isEqual);
}
