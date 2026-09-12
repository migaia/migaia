import { defineNativeReactiveFeature } from './host/contracts.js'
import { createStorageTypeError, StorageErrorCode } from './types/errors.js'
import { StorageErrorText } from './error-text.js'
import type { IFeature } from '@migaia/plugin-host'
import type {
  IStorageReactiveFeatureMetadata,
  IStorageReactiveSourceDisposer
} from './host/types.js'
import type { IAbortSignal, ILifecycleScheduler } from '@migaia/lifecycle'
import type { IStorageChange, IKeyValueStore } from '@migaia/storage-contract'
import type { IStorageNativeFeatureExpose } from './host/contracts.js'
import type { IStorageReactiveAdapter, IStorageReactiveService } from './host/reactive.js'

/** Advanced adapter source context; built-in backend factories are intentionally absent. */
export type IReactiveAdapterContext<TStore extends IKeyValueStore> = {
  readonly store: TStore
  readonly scheduler: ILifecycleScheduler
  readonly signal: IAbortSignal
  readonly invalidate: (change?: IStorageChange) => void
  readonly report: (error: unknown) => void
}

/** Advanced custom adapter definition; Plugin installation supplies its exact Store. */
export type IReactiveAdapterDefinition<TStore extends IKeyValueStore = IKeyValueStore> = {
  readonly mode: 'push' | 'hybrid' | 'polling'
  readonly pollIntervalMs?: number
  readonly visibility:
    | 'instance'
    | 'document-eventual'
    | 'top-level-context-eventual'
    | 'origin-js-visible-eventual'
    | 'origin-eventual'
  readonly subscribe: (
    context: IReactiveAdapterContext<TStore>
  ) => IStorageReactiveSourceDisposer | PromiseLike<unknown>
}

/** Creates the canonical reactive feature descriptor without exposing Host internals. */
export const defineReactiveAdapterFeature = <TStore extends IKeyValueStore>(
  definition: IReactiveAdapterDefinition<TStore>
): IFeature<
  IStorageNativeFeatureExpose<Record<never, never>, TStore>,
  {
    readonly attach: (
      service: IStorageReactiveService,
      report: (error: unknown) => void
    ) => IStorageReactiveAdapter
  }
> => {
  let mode: IReactiveAdapterDefinition<TStore>['mode']
  let pollIntervalMs: number | undefined
  let visibility: IReactiveAdapterDefinition<TStore>['visibility']
  let subscribe: IReactiveAdapterDefinition<TStore>['subscribe']
  try {
    mode = definition.mode
    pollIntervalMs = definition.pollIntervalMs
    visibility = definition.visibility
    subscribe = definition.subscribe
  } catch (cause) {
    throw createStorageTypeError(
      StorageErrorCode.reactiveFeatureInvalid,
      StorageErrorText.reactiveFeatureInvalid,
      cause
    )
  }
  if (
    typeof subscribe !== 'function' ||
    !['push', 'hybrid', 'polling'].includes(mode) ||
    ![
      'instance',
      'document-eventual',
      'top-level-context-eventual',
      'origin-js-visible-eventual',
      'origin-eventual'
    ].includes(visibility) ||
    (mode === 'push' && pollIntervalMs !== undefined) ||
    (mode !== 'push' &&
      (!Number.isFinite(pollIntervalMs) || pollIntervalMs === undefined || pollIntervalMs <= 0))
  )
    throw createStorageTypeError(
      StorageErrorCode.reactiveFeatureInvalid,
      StorageErrorText.reactiveFeatureInvalid
    )
  const metadata: IStorageReactiveFeatureMetadata<TStore> = Object.freeze({
    mode,
    ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
    visibility,
    subscribe: (context) =>
      subscribe({
        store: context.store,
        scheduler: context.scheduler,
        signal: context.signal,
        invalidate: (change) => {
          if (change !== undefined) context.onChange(change)
        },
        report: context.report
      })
  })
  return defineNativeReactiveFeature(metadata)
}

export type {
  IStorageReactiveFeatureMetadata,
  IStorageReactiveSourceDisposer
} from './host/types.js'
