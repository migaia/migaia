import {
  defineFeature,
  memoryBackendKind,
  type IStorageBackendKind,
  type IStorageFeature,
  type IStorageFeatureOutput,
  type IStorageFeatureTarget
} from '@migaia/storage-host'
import {
  createStorageOperationReporter,
  reportCleanupError
} from '@migaia/storage-host/authoring/backend'
import type { IQueryResultOf, IQueryShape, IStorageResource } from '@migaia/storage-contract'
import {
  cookieBackendKind,
  indexedDbBackendKind,
  localStorageBackendKind,
  sessionStorageBackendKind
} from '../host/builtin-kinds.js'
import { createStorageReactiveService, type IStorageReactiveAdapter } from '../host/reactive.js'
import type {
  ILiveQuery,
  ILiveQueryOptions,
  IStorageReactiveFeatureMetadata
} from '../host/types.js'
import { StorageReactiveVisibility } from '../host/state-constants.js'
import { StorageErrorText } from '../error-text.js'
import { createStorageTypeError, StorageError, StorageErrorCode } from '../types/errors.js'

export type { ILiveQuery, ILiveQueryOptions } from '../host/types.js'

/** The existing query captures its backend and terminal; the runtime remains caller-owned. */
export type IChainLiveQueryOptions<TResult> = Pick<
  ILiveQueryOptions<never, never, TResult>,
  | 'runtime'
  | 'scope'
  | 'matches'
  | 'keepPreviousData'
  | 'equals'
  | 'timeoutMs'
  | 'signal'
  | 'report'
>

/** Only an existing all terminal can become live, retaining its exact result type. */
export type IReactiveLiveMethods = {
  live<TQuery extends IQueryShape>(
    this: TQuery,
    options: IChainLiveQueryOptions<IQueryResultOf<TQuery>>
  ): ILiveQuery<IQueryResultOf<TQuery>> & IStorageResource
}

/** Reactive adds terminal methods without publishing capabilities or a second query source. */
export type IReactiveFeatureOutput = IStorageFeatureOutput<
  readonly [],
  {
    readonly query: IReactiveLiveMethods
    readonly vector: IReactiveLiveMethods
    readonly rdf: IReactiveLiveMethods
  },
  { readonly store: {}; readonly transaction: {} }
>

/** Original native reconciliation interval shared by the four browser profiles. */
const browserPollIntervalMs = 1000

/** Preserve the native observation domains by opaque kind identity, never a backend label. */
const nativeConsistency = (
  kind: IStorageBackendKind,
  hasController: boolean
): IStorageReactiveFeatureMetadata => {
  if (kind === memoryBackendKind)
    return { mode: 'push', visibility: StorageReactiveVisibility.instance }
  if (kind === localStorageBackendKind)
    return {
      mode: 'hybrid',
      visibility: StorageReactiveVisibility.documentEventual,
      pollIntervalMs: browserPollIntervalMs
    }
  if (kind === sessionStorageBackendKind)
    return {
      mode: 'hybrid',
      visibility: StorageReactiveVisibility.topLevelContextEventual,
      pollIntervalMs: browserPollIntervalMs
    }
  if (kind === cookieBackendKind)
    return {
      mode: 'hybrid',
      visibility: StorageReactiveVisibility.originJsVisibleEventual,
      pollIntervalMs: browserPollIntervalMs
    }
  if (kind === indexedDbBackendKind)
    return {
      mode: 'hybrid',
      visibility: StorageReactiveVisibility.originEventual,
      pollIntervalMs: browserPollIntervalMs
    }
  return hasController
    ? { mode: 'push', visibility: StorageReactiveVisibility.instance }
    : {
        mode: 'polling',
        visibility: StorageReactiveVisibility.instance,
        pollIntervalMs: browserPollIntervalMs
      }
}

/** Capture borrowed live options once before source admission or Resource allocation. */
const snapshotLiveOptions = <T>(options: IChainLiveQueryOptions<T>): IChainLiveQueryOptions<T> => {
  if (options === null || (typeof options !== 'object' && typeof options !== 'function'))
    throw new StorageError(
      StorageErrorCode.reactiveFeatureInvalid,
      {},
      StorageErrorText.reactiveFeatureInvalid
    )
  /** Retain original values while keeping accessor failures inside the Web error boundary. */
  let captured: IChainLiveQueryOptions<T>
  /** Borrowed signal method access belongs to the same option-accessor failure boundary. */
  let signalValid: boolean
  try {
    captured = {
      runtime: options.runtime,
      scope: options.scope,
      matches: options.matches,
      keepPreviousData: options.keepPreviousData,
      equals: options.equals,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      report: options.report
    }
    signalValid =
      captured.signal === undefined ||
      (typeof captured.signal === 'object' &&
        captured.signal !== null &&
        typeof captured.signal.addEventListener === 'function' &&
        typeof captured.signal.removeEventListener === 'function')
  } catch (cause) {
    throw createStorageTypeError(
      StorageErrorCode.reactiveFeatureInvalid,
      StorageErrorText.reactiveFeatureInvalid,
      cause
    )
  }
  if (
    typeof captured.runtime !== 'object' ||
    captured.runtime === null ||
    (captured.scope !== undefined && typeof captured.scope !== 'string') ||
    (captured.matches !== undefined && typeof captured.matches !== 'function') ||
    (captured.keepPreviousData !== undefined && typeof captured.keepPreviousData !== 'boolean') ||
    (captured.equals !== undefined && typeof captured.equals !== 'function') ||
    (captured.timeoutMs !== undefined &&
      (typeof captured.timeoutMs !== 'number' ||
        !Number.isFinite(captured.timeoutMs) ||
        captured.timeoutMs < 0)) ||
    !signalValid ||
    (captured.report !== undefined && typeof captured.report !== 'function')
  )
    throw new StorageError(
      StorageErrorCode.reactiveFeatureInvalid,
      {},
      StorageErrorText.reactiveFeatureInvalid
    )
  return captured
}

/** Own one original reactive service per installed Feature and attach its source on first live. */
export const reactiveFeature = <const T extends IStorageFeatureTarget>(
  target: T
): IStorageFeature<T, IReactiveFeatureOutput> =>
  defineFeature(target, ({ featureExpose }) => {
    /** Timing and closure belong to the original registration, captured before source access. */
    const scheduler = featureExpose.getScheduler()
    const signal = featureExpose.getLifecycle().signal
    const service = createStorageReactiveService(scheduler)
    const reporter = createStorageOperationReporter()
    /** Lifecycle notification starts the same cleanup before the original LIFO releases resources. */
    const stop = (): void => {
      void service.dispose().catch((error) => reportCleanupError(reporter, error))
    }
    try {
      featureExpose.onDispose(async () => {
        signal.removeEventListener('abort', stop)
        await service.dispose()
      })
      signal.addEventListener('abort', stop, { once: true })
      if (signal.aborted) stop()
    } catch (error) {
      stop()
      throw error
    }
    /** The original service owns its sole adapter; no host-wide reactive registry is introduced. */
    let adapter: IStorageReactiveAdapter | undefined
    /** Shared methods remain configuration-only until the caller invokes this live terminal. */
    const methods: IReactiveLiveMethods = {
      live<TQuery extends IQueryShape>(
        this: TQuery,
        options: IChainLiveQueryOptions<IQueryResultOf<TQuery>>
      ) {
        /** Admission still checks the original expose window even after the source was attached. */
        const store = featureExpose.getStore()
        const backendId = featureExpose.getBackendId()
        const captured = snapshotLiveOptions(options)
        /** Capture the existing terminal with its original receiver; never create a query facade. */
        let terminal: TQuery['all']
        try {
          terminal = this.all
        } catch (cause) {
          throw createStorageTypeError(
            StorageErrorCode.reactiveFeatureInvalid,
            StorageErrorText.reactiveFeatureInvalid,
            cause
          )
        }
        if (typeof terminal !== 'function')
          throw new StorageError(
            StorageErrorCode.reactiveFeatureInvalid,
            {},
            StorageErrorText.reactiveFeatureInvalid
          )
        if (adapter === undefined) {
          try {
            const controller = featureExpose.getChangeController()
            adapter = service.registerAdapter({
              backendId,
              store,
              controller,
              consistency: nativeConsistency(featureExpose.getKind(), controller !== undefined),
              subscribe: undefined,
              report: (error) => reportCleanupError(reporter, error)
            })
            adapter.startSource()
          } catch (error) {
            stop()
            throw error
          }
        }
        return service.createQuery<IQueryResultOf<TQuery>>({
          ...captured,
          backendId,
          scheduler,
          query: ({ signal }) => Reflect.apply(terminal, this, [{ signal }])
        })
      }
    }
    return {
      capabilities: [] as const,
      chain: { query: methods, vector: methods, rdf: methods },
      api: { store: {}, transaction: {} }
    }
  })
