import { defineStorageBackendFeature } from './host/contracts.js'
import type {
  IStorageBackendFeature,
  IStorageBackendKind,
  IStorageBackendKindStore,
  IStorageReactiveFeatureMetadata,
  IStorageReactiveSourceDisposer
} from './host/types.js'
import type { IAbortSignal, ILifecycleScheduler } from '@migaia/lifecycle'
import type { IStorageChange, IKeyValueStore } from '@migaia/storage-contract'

/** Advanced adapter source context; built-in backend factories are intentionally absent. */
export type IReactiveAdapterContext<TStore extends IKeyValueStore> = {
  readonly store: TStore
  readonly scheduler: ILifecycleScheduler
  readonly signal: IAbortSignal
  readonly invalidate: (change?: IStorageChange) => void
  readonly report: (error: unknown) => void
}

/** Advanced custom adapter definition bound to one opaque backend kind token. */
export type IReactiveAdapterDefinition<
  TBackendKind extends IStorageBackendKind<string, IKeyValueStore>
> = {
  readonly backendKind: TBackendKind
  readonly mode: 'push' | 'hybrid' | 'polling'
  readonly pollIntervalMs?: number
  readonly visibility:
    | 'instance'
    | 'document-eventual'
    | 'top-level-context-eventual'
    | 'origin-js-visible-eventual'
    | 'origin-eventual'
  readonly subscribe: (
    context: IReactiveAdapterContext<IStorageBackendKindStore<TBackendKind>>
  ) => IStorageReactiveSourceDisposer | PromiseLike<unknown>
}

/** Creates the canonical reactive feature descriptor without exposing Host internals. */
export const defineReactiveAdapterFeature = <
  TBackendKind extends IStorageBackendKind<string, IKeyValueStore>
>(
  definition: IReactiveAdapterDefinition<TBackendKind>
): IStorageBackendFeature<IStorageBackendKindStore<TBackendKind>, TBackendKind, 'reactive'> => {
  const metadata: IStorageReactiveFeatureMetadata<IStorageBackendKindStore<TBackendKind>> = {
    mode: definition.mode,
    pollIntervalMs: definition.pollIntervalMs,
    visibility: definition.visibility,
    subscribe: (context) =>
      definition.subscribe({
        store: context.store as IStorageBackendKindStore<TBackendKind>,
        scheduler: undefined as unknown as ILifecycleScheduler,
        signal: context.signal,
        invalidate: (change) => {
          if (change !== undefined) context.onChange(change)
        },
        report: context.report
      })
  }
  return defineStorageBackendFeature(definition.backendKind, 'reactive', metadata)
}

export type {
  IStorageBackendFeature,
  IStorageBackendKind,
  IStorageBackendKindStore,
  IStorageReactiveFeatureMetadata,
  IStorageReactiveSourceDisposer
} from './host/types.js'
