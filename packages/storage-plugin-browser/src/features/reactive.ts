import { snapshotBrowserConfig } from '../utils/config-snapshot.ts'
import {
  type IStorageBackendType,
  type IStorageFeature,
  type IStorageFeatureDefiner,
  type IStorageFeatureExpose,
  type IStorageFeatureOutput,
  type IStorageFeatureTarget,
  type IStorageReactiveProfileExpose
} from '@migaia/storage-host'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import {
  createStorageOperationReporter,
  defineStorageFeature,
  reportCleanupError
} from '@migaia/storage-host/sdk'
import type {
  IOperationContext,
  IQueryResultOf,
  IQueryShape,
  IStorageResource
} from '@migaia/storage-contract'
import { createStorageReactiveService, type IStorageReactiveAdapter } from '../host/reactive.ts'
import { defaultReactiveProfile } from '../host/reactive-profile.ts'
import type { ILiveQuery, ILiveQueryOptions } from '../host/types.ts'
import { StorageErrorText } from '../error-text.ts'
import { StorageError } from '../types/errors.ts'

export type { ILiveQuery, ILiveQueryOptions } from '../host/types.ts'

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

/** Executable query terminals accept the existing operation signal while the shape stays type-only. */
type IReactiveLiveQueryTerminal<TResult> = {
  all(context: Pick<IOperationContext, 'signal'>): Promise<TResult>
}

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

/** What the reactive Feature reads from any backend; a backend may state its own profile. */
type IReactiveFeatureExpose = IStorageFeatureExpose<IStorageBackendType> &
  Partial<IStorageReactiveProfileExpose>

/** Validate live-query options synchronously before source admission or Resource allocation. */
const validateLiveOptions = <T>(options: IChainLiveQueryOptions<T>): void => {
  if (options === null || (typeof options !== 'object' && typeof options !== 'function'))
    throw new StorageError(
      StorageBrowserErrorCode.reactiveFeatureInvalid,
      {},
      StorageErrorText.reactiveFeatureInvalid
    )
  /** The borrowed signal must provide the existing native subscription surface. */
  const signalValid =
    options.signal === undefined ||
    (typeof options.signal === 'object' &&
      options.signal !== null &&
      typeof options.signal.addEventListener === 'function' &&
      typeof options.signal.removeEventListener === 'function')
  if (
    typeof options.runtime !== 'object' ||
    options.runtime === null ||
    (options.scope !== undefined && typeof options.scope !== 'string') ||
    (options.matches !== undefined && typeof options.matches !== 'function') ||
    (options.keepPreviousData !== undefined && typeof options.keepPreviousData !== 'boolean') ||
    (options.equals !== undefined && typeof options.equals !== 'function') ||
    (options.timeoutMs !== undefined &&
      (typeof options.timeoutMs !== 'number' ||
        !Number.isFinite(options.timeoutMs) ||
        options.timeoutMs < 0)) ||
    !signalValid ||
    (options.report !== undefined && typeof options.report !== 'function')
  )
    throw new StorageError(
      StorageBrowserErrorCode.reactiveFeatureInvalid,
      {},
      StorageErrorText.reactiveFeatureInvalid
    )
}

/** One Feature installation owns its service, selected adapter and stable abort listener. */
type IReactiveFeatureContext = {
  /** Original registration controls when store, client and lifecycle access is allowed. */
  readonly featureExpose: IReactiveFeatureExpose
  /** Original scheduler drives Resource requests without a new scheduling owner. */
  readonly scheduler: ReturnType<IReactiveFeatureExpose['getScheduler']>
  /** Original registration signal starts the same service cleanup before LIFO disposal. */
  readonly signal: ReturnType<IReactiveFeatureExpose['getLifecycle']>['signal']
  /** Service owns adapters and their Resource query lifetimes for this one Feature. */
  readonly service: ReturnType<typeof createStorageReactiveService>
  /** Original operation reporter handles asynchronous cleanup failures. */
  readonly reporter: ReturnType<typeof createStorageOperationReporter>
  /** The exact callback identity is shared by native registration and removal. */
  stop: () => void
  /** Adapter selection is lazy and reused by every live query on this installation. */
  adapter: IStorageReactiveAdapter | undefined
}
/** Own one original reactive service per installed Feature and attach its source on first live. */
export const reactiveFeature = <
  T extends IStorageFeatureTarget = IStorageBackendType
>(): IStorageFeature<T, IReactiveFeatureOutput> =>
  (defineStorageFeature as IStorageFeatureDefiner<T>)(({ featureExpose }) =>
    createReactiveFeature(featureExpose as IReactiveFeatureExpose)
  )

/** Attach the Feature's service to its original lifecycle before publishing terminal methods. */
function createReactiveFeature(featureExpose: IReactiveFeatureExpose): IReactiveFeatureOutput {
  /** Constructor admission selects these original ports before any source can subscribe. */
  const scheduler = featureExpose.getScheduler()
  const signal = featureExpose.getLifecycle().signal
  const service = createStorageReactiveService()
  const reporter = createStorageOperationReporter()
  /** No callback runs until the one stable listener is attached below. */
  const context = { featureExpose, scheduler, signal, service, reporter } as IReactiveFeatureContext
  Object.assign(context, { stop: () => stopReactiveFeature(context) })
  try {
    featureExpose.onDispose(async () => {
      signal.removeEventListener('abort', context.stop)
      await service.dispose()
    })
    signal.addEventListener('abort', context.stop, { once: true })
    if (signal.aborted) context.stop()
  } catch (error) {
    context.stop()
    throw error
  }
  /**
   * Fluent methods configure original query nodes; Resource requests invoke their existing all
   * terminal.
   */
  const methods: IReactiveLiveMethods = {
    live<TQuery extends IQueryShape>(
      this: TQuery,
      options: IChainLiveQueryOptions<IQueryResultOf<TQuery>>
    ) {
      return createReactiveLiveQuery(context, this, options)
    }
  }
  return {
    capabilities: [] as const,
    chain: { query: methods, vector: methods, rdf: methods },
    api: { store: {}, transaction: {} }
  }
}

/** Start idempotent service cleanup without replacing the registration's failure outcome. */
function stopReactiveFeature(context: IReactiveFeatureContext): void {
  void context.service.dispose().catch((error) => reportCleanupError(context.reporter, error))
}

/** Admit one original query and lazily bind its actual native consistency/source adapter. */
function createReactiveLiveQuery<TQuery extends IQueryShape>(
  context: IReactiveFeatureContext,
  query: TQuery,
  requested: IChainLiveQueryOptions<IQueryResultOf<TQuery>>
): ILiveQuery<IQueryResultOf<TQuery>> & IStorageResource {
  /** Options are read once; validation and the created query use this same copy. */
  const options = snapshotBrowserConfig(requested, StorageBrowserErrorCode.reactiveFeatureInvalid)
  /** The expose window is checked even after this installation selected its adapter. */
  const store = context.featureExpose.getStore()
  const backendId = context.featureExpose.getBackendId()
  validateLiveOptions(options)
  if (typeof query.all !== 'function')
    throw new StorageError(
      StorageBrowserErrorCode.reactiveFeatureInvalid,
      {},
      StorageErrorText.reactiveFeatureInvalid
    )
  if (context.adapter === undefined) {
    try {
      const controller = context.featureExpose.getChangeController()
      context.adapter = context.service.registerAdapter({
        backendId,
        store,
        controller,
        consistency:
          context.featureExpose.reactiveProfile?.(controller !== undefined) ??
          defaultReactiveProfile(controller !== undefined),
        report: (error) => reportCleanupError(context.reporter, error)
      })
      context.adapter.startSource()
    } catch (error) {
      context.stop()
      throw error
    }
  }
  /** This query's options must remain stable while Resource generations await native IO. */
  return context.service.createQuery<IQueryResultOf<TQuery>>({
    ...options,
    backendId,
    scheduler: context.scheduler,
    query: ({ signal }) =>
      (query as unknown as IReactiveLiveQueryTerminal<IQueryResultOf<TQuery>>).all({ signal })
  })
}
