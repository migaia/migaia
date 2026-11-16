import { type IStorageFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import { defineIndexedDbFeature, type IIndexedDbBackend } from '../host/builtin-backends.ts'
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
): IStorageFeature<IIndexedDbBackend, IIndexedDbAssemblyOutput> {
  return defineIndexedDbFeature(({ featureExpose }) => {
    featureExpose.installAssembly(name, owner)
    return { capabilities: [] as const, chain: {}, api: { store: {}, transaction: {} } }
  })
}

/** Named public result prevents private provider symbols from escaping inferred declarations. */
export type IIndexedDbAssemblyFeature = IStorageFeature<IIndexedDbBackend, IIndexedDbAssemblyOutput>
