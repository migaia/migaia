import {
  defineFeature,
  type IStorageFeature,
  type IStorageFeatureOutput
} from '@migaia/storage-host'
import { indexedDbBackendKind } from '../host/builtin-kinds.ts'
import type { IIndexedDbAssemblyPlan } from '../backends/indexed-db-assembly.ts'
/** Backend-native assembly contributes implementation ports without allocating another store. */
export type IIndexedDbAssemblyOutput = IStorageFeatureOutput<
  readonly [],
  {},
  { readonly store: {}; readonly transaction: {} }
>
/** Feature factories retain immutable named owners; each installation owns its own assembly plan. */
export function createIndexedDbAssemblyFeature<K extends keyof IIndexedDbAssemblyPlan>(
  name: K,
  owner: NonNullable<IIndexedDbAssemblyPlan[K]>
): IStorageFeature<typeof indexedDbBackendKind, IIndexedDbAssemblyOutput> {
  return defineFeature(indexedDbBackendKind, ({ featureExpose }) => {
    featureExpose.installAssembly(name, owner)
    return { capabilities: [] as const, chain: {}, api: { store: {}, transaction: {} } }
  })
}

/** Named public result prevents private provider symbols from escaping inferred declarations. */
export type IIndexedDbAssemblyFeature = IStorageFeature<
  typeof indexedDbBackendKind,
  IIndexedDbAssemblyOutput
>
