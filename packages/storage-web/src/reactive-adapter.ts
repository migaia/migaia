import type { INativeAbortSignal } from '@migaia/utils/promise'
import { defineNativeReactiveFeature } from './host/contracts.js'
import { createStorageTypeError, StorageErrorCode } from './types/errors.js'
import { StorageErrorText } from './error-text.js'
import type { IFeature } from '@migaia/plugin-host'
import type {
  IStorageReactiveFeatureMetadata,
  IStorageReactiveSourceDisposer
} from './host/types.js'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IStorageChange, IKeyValueStore } from '@migaia/storage-contract'
import type { IStorageNativeFeatureExpose } from './host/contracts.js'
import type { IStorageReactiveAdapter, IStorageReactiveService } from './host/reactive.js'

/** Advanced adapter source context; built-in backend factories are intentionally absent. */
export type IReactiveAdapterContext<TStore extends IKeyValueStore> = {
  /** Exact Store registered by the plugin carrying this Feature. */
  readonly store: TStore
  /**
   * Host-snapshotted scheduler for source timing; the adapter does not acquire a separate clock
   * owner.
   */
  readonly scheduler: IScheduler
  /** Original source lifetime signal used to retire listeners and scheduled work. */
  readonly signal: INativeAbortSignal
  /** Notify queries of a known storage change, or omit the change to invalidate all adapter queries. */
  readonly invalidate: (change?: IStorageChange) => void
  /** Report source failures without replacing already committed writes or query outcomes. */
  readonly report: (error: unknown) => void
}

/** Advanced custom adapter definition; Plugin installation supplies its exact Store. */
export type IReactiveAdapterDefinition<TStore extends IKeyValueStore = IKeyValueStore> = {
  /** Push, hybrid or polling consistency policy; this required field has no default. */
  readonly mode: 'push' | 'hybrid' | 'polling'
  /** Positive finite interval required for hybrid/polling and forbidden for push. */
  readonly pollIntervalMs?: number
  /**
   * Required scope: instance, document-eventual, top-level-context-eventual,
   * origin-js-visible-eventual or origin-eventual.
   */
  readonly visibility:
    | 'instance'
    | 'document-eventual'
    | 'top-level-context-eventual'
    | 'origin-js-visible-eventual'
    | 'origin-eventual'
  /**
   * Start the source and synchronously return its disposer. A Promise-like result is an admission
   * failure, with late cleanup still observed.
   */
  readonly subscribe: (
    context: IReactiveAdapterContext<TStore>
  ) => IStorageReactiveSourceDisposer | PromiseLike<unknown>
}

/**
 * Capture and validate a custom reactive source Feature. Push forbids a poll interval;
 * hybrid/polling require a positive finite interval. Installation requires subscribe to return a
 * synchronous disposer; invalid definitions or source results fail REACTIVE_FEATURE_INVALID, with
 * late results still observed for cleanup.
 */
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
          context.onChange(change)
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
