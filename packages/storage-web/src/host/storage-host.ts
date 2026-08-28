import {
  PluginHost,
  invokeCaptured,
  type IPlugin,
  type IPluginConstraint,
  type IPluginHostCore,
  type IPluginResource
} from '@migaia/plugin-host'
import {
  createAbortController,
  snapshotScheduler,
  systemScheduler,
  type ILifecycleScheduler
} from '@migaia/lifecycle'
import { snapshotKeyValueStoreDetailed } from '@migaia/storage-contract'
import { withTimeout } from '@migaia/utils/promise'
import { createStorageTypeError, StorageError, StorageErrorCode } from '../types/errors.js'
import { StorageErrorText } from '../error-text.js'
import { compileStorageFeatureTopology } from './feature-compiler.js'
import { readStorageBackendFeatureMetadata, readStorageBackendPluginMetadata } from './contracts.js'
import {
  pluginNameFromBackendId,
  reactiveAdapterNameFromBackendId,
  STORAGE_LIVE_QUERY_SERVICE_NAME
} from './names.js'
import {
  createStorageReactiveService,
  createStorageStoreCell,
  registerReactiveAdapter,
  storageReactiveServiceCellKey,
  type IStorageReactiveAdapter,
  type IStorageReactiveService,
  type IStorageStoreCell
} from './reactive.js'
import type { IKeyValueStore } from '@migaia/storage-contract'
import type { IRuntime } from '@migaia/reactive/runtime'
import type {
  IStorageBackendPluginHandle,
  IStorageHost,
  IStorageHostCreateOptions,
  IStorageHostOptions,
  IStoragePluginReactiveId,
  IPluginStoreMap,
  IRejectInstalledOrDuplicateIds,
  IReactiveBackendHandle,
  ILiveQuery,
  ILiveQueryOptions,
  IStorageReactiveFeatureMetadata
} from './types.js'

/** Minimal PluginHost domain core; storage materializers do not expose host mutation to plugins. */
type IStorageHostCore = object

/** Narrow lifecycle core required by a backend materializer. */
type IStorageInstallCore = { readonly onDispose: (resource: IPluginResource) => void }

/** Canonical lifecycle owner used by the R02 facade shell. */
class StoragePluginHost extends PluginHost<IStorageHostCore> {}

/** Internal facade state used to enforce one in-flight storage batch. */
type IStorageHostState = 'open' | 'installing' | 'closing' | 'closed'

/** Internal registry snapshot containing exact stores after a committed PluginHost batch. */
type IStorageRegistry = ReadonlyMap<string, IKeyValueStore>

/** Private extension shape used only during one successful materialization batch. */
type IStorageStoreExtension = { readonly [key: symbol]: IKeyValueStore }

/** Materialized backend plus its private shared identity cell and optional reactive feature. */
type IStorageMaterializedPlugin = {
  readonly plugin: IPlugin<IStorageInstallCore, IStorageStoreExtension>
  readonly storeCell: IStorageStoreCell
  readonly reactive: boolean
  readonly reactiveMetadata: IStorageReactiveFeatureMetadata | undefined
}

/** Narrows a factory result so preparation can require synchronous store ownership. */
const isStoragePromiseLike = (
  value: IKeyValueStore | PromiseLike<IKeyValueStore>
): value is PromiseLike<IKeyValueStore> =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  typeof (value as PromiseLike<IKeyValueStore>).then === 'function'

/** One facade-owned batch controller and its immutable start time. */
type IStorageBatchToken = {
  readonly controller: ReturnType<typeof createAbortController>
  readonly startedAt: number
  active: boolean
}

type IStorageHostOptionsSnapshot = {
  readonly installTimeoutMs: number | undefined
  readonly scheduler: IStorageHostOptions['scheduler']
  readonly report: IStorageHostOptions['report']
}

type IStorageHostCreateSnapshot = {
  readonly hostOptions: IStorageHostOptionsSnapshot
  readonly plugins: readonly IStorageBackendPluginHandle[] | undefined
}

/** Read public Host options once so hostile accessors cannot escape or be revisited later. */
const snapshotStorageHostCreateOptions = (
  options:
    | (IStorageHostOptions & {
        readonly plugins?: readonly IStorageBackendPluginHandle[]
      })
    | undefined
): IStorageHostCreateSnapshot => {
  try {
    return {
      hostOptions: {
        installTimeoutMs: options?.installTimeoutMs,
        scheduler: options?.scheduler,
        report: options?.report
      },
      plugins: options?.plugins
    }
  } catch (cause) {
    throw createStorageTypeError(
      StorageErrorCode.backendPluginInvalid,
      StorageErrorText.backendPluginInvalid,
      cause
    )
  }
}

/** Storage facade over the canonical PluginHost lifecycle owner and its batch transaction. */
export class StorageHostFacade<
  TStores extends Record<string, IKeyValueStore> = Record<never, never>,
  TReactiveIds extends keyof TStores & string = never
> {
  /** Canonical PluginHost owns lifecycle and eventual mutation queue semantics. */
  readonly #inner: StoragePluginHost
  /** Registry is swapped only after the complete inner batch has committed. */
  #registry: IStorageRegistry = new Map()
  /** Exact reactive adapters published only after their enclosing PluginHost batch commits. */
  #reactiveRegistry = new Map<string, IStorageReactiveAdapter>()
  /** One Host-wide service instance, created only when the first reactive feature is admitted. */
  #reactiveService: IStorageReactiveService | undefined
  /** Tracks whether the singleton service registration is already owned by PluginHost. */
  #reactiveServiceInstalled = false
  /** Single-flight state prevents a second feature graph from racing the first admission. */
  #state: IStorageHostState = 'open'
  /** Current batch promise, retained only while the facade is installing. */
  #installing: Promise<void> | undefined
  /** Ownership token invalidated synchronously when disposal wins an active batch race. */
  #activeBatchToken: IStorageBatchToken | undefined
  /** Stable idempotent disposal promise shared by every caller. */
  #disposePromise: Promise<void> | undefined
  /** One snapped scheduler shared by PluginHost and every factory deadline. */
  readonly #scheduler: ILifecycleScheduler
  /** Finite host-wide budget consumed by each install batch. */
  readonly #installTimeoutMs: number
  /** Caller diagnostics are observed without becoming a lifecycle rejection. */
  readonly #report: (error: unknown) => void

  /** Creates the shell and snapshots lifecycle/deadline inputs before any plugin runs. */
  constructor(options: IStorageHostOptions = {}) {
    const optionsSnapshot = snapshotStorageHostCreateOptions(options)
    const {
      installTimeoutMs: installTimeoutOption,
      scheduler: schedulerOption,
      report
    } = optionsSnapshot.hostOptions
    this.#scheduler =
      schedulerOption === undefined
        ? systemScheduler
        : (snapshotScheduler(schedulerOption) ?? systemScheduler)
    const installTimeoutMs = installTimeoutOption ?? 30_000
    if (!Number.isFinite(installTimeoutMs) || installTimeoutMs < 0) {
      throw createStorageTypeError(
        StorageErrorCode.backendPluginInvalid,
        StorageErrorText.backendPluginInvalid
      )
    }
    this.#installTimeoutMs = installTimeoutMs
    this.#report = (error) => {
      try {
        const result = report?.(error)
        if (result !== undefined) void Promise.resolve(result).catch(() => undefined)
      } catch {
        // Reporter failure is containment-only and cannot replace an install/dispose primary.
      }
    }
    this.#inner = new StoragePluginHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      scheduler: this.#scheduler,
      diagnostic: (_message) => {}
    })
    Object.defineProperty(this, 'liveQuery', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: (options: unknown): ILiveQuery<unknown> => this.#createLiveQuery(options)
    })
  }

  /** Materializes one immutable plugin tuple through the canonical PluginHost batch. */
  use<const TPlugins extends readonly IStorageBackendPluginHandle[]>(
    ...plugins: IRejectInstalledOrDuplicateIds<TStores, TPlugins>
  ): Promise<
    IStorageHost<
      TStores & IPluginStoreMap<TPlugins>,
      TReactiveIds | IStoragePluginReactiveId<TPlugins[number]>
    >
  > {
    this.#assertOpen()
    if (this.#state === 'installing') {
      throw new StorageError(StorageErrorCode.storageHostBusy, {}, StorageErrorText.storageHostBusy)
    }
    this.#state = 'installing'
    const batchToken: IStorageBatchToken = {
      controller: createAbortController(),
      startedAt: this.#scheduler.now(),
      active: true
    }
    this.#activeBatchToken = batchToken
    const assertBatchOwner = (): void => {
      if (
        !batchToken.active ||
        this.#activeBatchToken !== batchToken ||
        this.#state !== 'installing'
      ) {
        throw new StorageError(
          StorageErrorCode.storageHostDisposed,
          {},
          StorageErrorText.storageHostDisposed
        )
      }
    }
    const batch = Promise.resolve().then(async () => {
      assertBatchOwner()
      const metadata = plugins.map((plugin) => {
        const value = readStorageBackendPluginMetadata(plugin)
        if (value === undefined)
          throw new StorageError(
            StorageErrorCode.backendPluginInvalid,
            {},
            StorageErrorText.backendPluginInvalid
          )
        return value
      })
      compileStorageFeatureTopology({
        installedProviderIds: [...this.#registry.keys()],
        plugins
      })
      assertBatchOwner()
      const trustedStores = new Map<symbol, IKeyValueStore>()
      const entries = plugins.map((plugin, index) =>
        this.#materializePlugin(plugin, metadata[index]!, batchToken, trustedStores)
      )
      const pendingReactive = new Map<string, IStorageReactiveAdapter>()
      const hasReactiveFeature = entries.some((entry) => entry.reactive)
      if (hasReactiveFeature && this.#reactiveService === undefined)
        this.#reactiveService = createStorageReactiveService()
      const servicePlugin =
        hasReactiveFeature && !this.#reactiveServiceInstalled
          ? this.#createReactiveServicePlugin(this.#reactiveService!)
          : undefined
      const adapters = entries.flatMap((entry, index) =>
        entry.reactive
          ? [
              this.#createReactiveAdapterPlugin(
                plugins[index]!,
                entry.storeCell,
                this.#reactiveService!,
                entry.reactiveMetadata,
                pendingReactive
              )
            ]
          : []
      )
      const materialized = [
        ...entries.map((entry) => entry.plugin),
        ...(servicePlugin === undefined ? [] : [servicePlugin]),
        ...adapters
      ]
      await this.#inner.use(...(materialized as IPluginConstraint<IStorageHostCore>[]))
      assertBatchOwner()
      const nextRegistry = new Map(this.#registry)
      for (const [index, plugin] of plugins.entries()) {
        const extensionKey = metadata[index]!.extensionKey
        nextRegistry.set(plugin.id, trustedStores.get(extensionKey)!)
      }
      this.#registry = new Map(nextRegistry)
      if (servicePlugin !== undefined) this.#reactiveServiceInstalled = true
      for (const [index, plugin] of plugins.entries()) {
        if (!entries[index]!.reactive) continue
        if (trustedStores.has(metadata[index]!.extensionKey)) {
          const adapter = pendingReactive.get(plugin.id)
          if (adapter !== undefined) this.#reactiveRegistry.set(plugin.id, adapter)
        }
      }
    })
    this.#installing = batch
    const settled = batch.then(
      () => {
        assertBatchOwner()
        batchToken.active = false
        this.#activeBatchToken = undefined
        if (this.#state === 'installing') this.#state = 'open'
        this.#installing = undefined
        return this as unknown as IStorageHost<
          TStores & IPluginStoreMap<TPlugins>,
          TReactiveIds | IStoragePluginReactiveId<TPlugins[number]>
        >
      },
      (error: unknown) => {
        // Provisional trusted values are owned by PluginHost rollback, not by this local map.
        const primary = batchToken.active
          ? new StorageError(
              StorageErrorCode.backendInstallFailed,
              { cause: error },
              StorageErrorText.backendInstallFailed
            )
          : new StorageError(
              StorageErrorCode.storageHostDisposed,
              { cause: error },
              StorageErrorText.storageHostDisposed
            )
        batchToken.active = false
        this.#activeBatchToken = undefined
        if (this.#state === 'installing') this.#state = 'open'
        this.#installing = undefined
        throw primary
      }
    )
    return settled
  }

  /** Looks up an exact store from the last atomically published registry snapshot. */
  backend<TId extends keyof TStores & string>(id: TId): TStores[TId] {
    this.#assertOpen()
    const store = this.#registry.get(id)
    if (store === undefined)
      throw new StorageError(
        StorageErrorCode.backendNotInstalled,
        {},
        StorageErrorText.backendNotInstalled
      )
    return store as TStores[TId]
  }

  /** Narrows a lookup to IDs in the current immutable registry snapshot. */
  hasBackend(id: string): id is keyof TStores & string {
    this.#assertOpen()
    return this.#registry.has(id)
  }

  /** Returns a mutation-incapable copy of the current store registry. */
  backends(): ReadonlyMap<keyof TStores & string, TStores[keyof TStores]> {
    this.#assertOpen()
    return new Map(this.#registry) as unknown as ReadonlyMap<
      keyof TStores & string,
      TStores[keyof TStores]
    >
  }

  /** Reports whether the committed Host registry contains an exact reactive adapter. */
  hasReactiveBackend(id: string): id is TReactiveIds {
    this.#assertOpen()
    return this.#reactiveRegistry.has(id)
  }

  /** Returns exact adapter-bound store shell and delegates query state to Resource. */
  reactiveBackend<TId extends keyof TStores & string>(
    id: TId
  ): IReactiveBackendHandle<TStores[TId], TId> | undefined {
    this.#assertOpen()
    const adapter = this.#reactiveRegistry.get(id)
    if (adapter === undefined) return undefined
    return {
      id,
      store: adapter.store,
      liveQuery: (options: unknown) => this.#createLiveQuery(options, id)
    } as unknown as IReactiveBackendHandle<TStores[TId], TId>
  }

  /** Seals the facade once and delegates lifecycle cleanup to PluginHost. */
  dispose(): Promise<void> {
    if (this.#disposePromise !== undefined) return this.#disposePromise
    this.#state = 'closing'
    if (this.#activeBatchToken !== undefined) {
      const batchToken = this.#activeBatchToken
      this.#activeBatchToken.active = false
      this.#activeBatchToken = undefined
      try {
        batchToken.controller.abort(
          new StorageError(
            StorageErrorCode.storageHostDisposed,
            {},
            StorageErrorText.storageHostDisposed
          )
        )
      } catch (error) {
        this.#report(error)
      }
    }
    if (this.#installing !== undefined) this.#installing = undefined
    this.#registry = new Map()
    this.#disposePromise = this.#inner.dispose().then(async () => {
      await this.#reactiveService?.dispose()
      this.#reactiveRegistry.clear()
      this.#state = 'closed'
    })
    return this.#disposePromise
  }

  /** Rejects operations after seal while preserving the package-owned error contract. */
  #assertOpen(): void {
    if (this.#state === 'closing' || this.#state === 'closed') {
      throw new StorageError(
        StorageErrorCode.storageHostDisposed,
        {},
        StorageErrorText.storageHostDisposed
      )
    }
  }

  /** Creates one Resource-backed query after exact backend and runtime admission. */
  #createLiveQuery<T>(options: unknown, backendOverride?: string): ILiveQuery<T> {
    this.#assertOpen()
    const service = this.#reactiveService
    if (
      service === undefined ||
      options === null ||
      (typeof options !== 'object' && typeof options !== 'function')
    )
      throw new StorageError(
        StorageErrorCode.reactiveServiceNotInstalled,
        {},
        StorageErrorText.reactiveServiceNotInstalled
      )
    let backendId: unknown
    let runtime: unknown
    let query: unknown
    let scope: unknown
    let matches: unknown
    let keepPreviousData: unknown
    let equals: unknown
    let timeoutMs: unknown
    let signal: unknown
    let report: unknown
    try {
      const candidate = options as ILiveQueryOptions<Record<string, IKeyValueStore>, string, T>
      backendId = backendOverride ?? candidate.backendId
      runtime = candidate.runtime
      query = candidate.query
      scope = candidate.scope
      matches = candidate.matches
      keepPreviousData = candidate.keepPreviousData
      equals = candidate.equals
      timeoutMs = candidate.timeoutMs
      signal = candidate.signal
      report = candidate.report
    } catch (cause) {
      throw createStorageTypeError(
        StorageErrorCode.reactiveFeatureInvalid,
        StorageErrorText.reactiveFeatureInvalid,
        cause
      )
    }
    if (
      typeof backendId !== 'string' ||
      typeof runtime !== 'object' ||
      runtime === null ||
      typeof query !== 'function' ||
      (scope !== undefined && typeof scope !== 'string') ||
      (matches !== undefined && typeof matches !== 'function') ||
      (keepPreviousData !== undefined && typeof keepPreviousData !== 'boolean') ||
      (equals !== undefined && typeof equals !== 'function') ||
      (timeoutMs !== undefined &&
        (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 0)) ||
      (signal !== undefined &&
        (typeof signal !== 'object' ||
          signal === null ||
          typeof (signal as { readonly addEventListener?: unknown }).addEventListener !==
            'function' ||
          typeof (signal as { readonly removeEventListener?: unknown }).removeEventListener !==
            'function')) ||
      (report !== undefined && typeof report !== 'function')
    )
      throw new StorageError(
        StorageErrorCode.reactiveFeatureInvalid,
        {},
        StorageErrorText.reactiveFeatureInvalid
      )
    return service.createQuery({
      backendId,
      runtime: runtime as IRuntime,
      query: ({ store, signal }) =>
        (query as ILiveQueryOptions<Record<string, IKeyValueStore>, string, T>['query'])({
          store,
          signal,
          scope: scope as string | undefined
        }),
      scope: scope as string | undefined,
      matches: matches as ILiveQueryOptions<Record<string, IKeyValueStore>, string, T>['matches'],
      keepPreviousData: keepPreviousData as boolean | undefined,
      equals: equals as ILiveQueryOptions<Record<string, IKeyValueStore>, string, T>['equals'],
      timeoutMs: timeoutMs as number | undefined,
      signal: signal as ILiveQueryOptions<Record<string, IKeyValueStore>, string, T>['signal'],
      report: report as ILiveQueryOptions<Record<string, IKeyValueStore>, string, T>['report'],
      scheduler: this.#scheduler
    })
  }

  /** Builds one PluginHost descriptor whose factory owns deadline and late-settlement cleanup. */
  #materializePlugin(
    plugin: IStorageBackendPluginHandle,
    metadata: NonNullable<ReturnType<typeof readStorageBackendPluginMetadata>>,
    batchToken: IStorageBatchToken,
    trustedStores: Map<symbol, IKeyValueStore>
  ): IStorageMaterializedPlugin {
    const storeCell = createStorageStoreCell()
    const reactiveMetadata = metadata.features
      .map((feature) => readStorageBackendFeatureMetadata(feature)?.reactive)
      .find((feature) => feature !== undefined)
    const reactive = metadata.features.some((feature) => {
      const featureMetadata = readStorageBackendFeatureMetadata(feature)
      return featureMetadata?.capability === 'reactive'
    })
    const pluginDescriptor: IPlugin<IStorageInstallCore, IStorageStoreExtension> = {
      name: pluginNameFromBackendId(plugin.id),
      shared: () => ({ [storeCell.key]: storeCell }),
      install: async (core) => {
        const elapsed = Math.max(0, this.#scheduler.now() - batchToken.startedAt)
        const remaining = Math.max(0, this.#installTimeoutMs - elapsed)
        const effectiveTimeout =
          metadata.timeoutMs === undefined ? remaining : Math.min(remaining, metadata.timeoutMs)
        let factoryPromise: Promise<IKeyValueStore> | undefined
        let ownsLateValue = true
        const context = {
          signal: batchToken.controller.signal,
          report: this.#report
        }

        /** Registers one validated store before invoking its private preparation hook. */
        const registerStore = (store: IKeyValueStore): IStorageStoreExtension => {
          const snapshot = snapshotKeyValueStoreDetailed(store)
          if (!snapshot.valid) {
            throw createStorageTypeError(
              StorageErrorCode.backendPluginInvalid,
              StorageErrorText.backendPluginInvalid,
              snapshot.cause
            )
          }
          const disposer = (): Promise<void> =>
            invokeCaptured(snapshot.dispose, snapshot.receiver, [])
          try {
            core.onDispose(disposer)
          } catch (error) {
            ownsLateValue = false
            void this.#disposeLateStore(snapshot.store)
            throw error
          }
          ownsLateValue = false
          storeCell.set(snapshot.store)
          trustedStores.set(metadata.extensionKey, snapshot.store)
          return { [metadata.extensionKey]: snapshot.store }
        }

        if (metadata.prepare !== undefined) {
          let candidate: IKeyValueStore | PromiseLike<IKeyValueStore>
          try {
            candidate = metadata.create(context)
          } catch (error) {
            ownsLateValue = false
            throw error
          }
          if (isStoragePromiseLike(candidate)) {
            ownsLateValue = false
            throw createStorageTypeError(
              StorageErrorCode.backendPluginInvalid,
              StorageErrorText.backendPluginInvalid
            )
          }
          const extension = registerStore(candidate)
          await withTimeout(() => metadata.prepare!(candidate, context), {
            timeoutMs: effectiveTimeout,
            signals: [batchToken.controller.signal],
            scheduler: this.#scheduler,
            report: (error) => this.#report(error),
            zeroTimeoutBehavior: 'skip'
          })
          return extension
        }
        const startFactory = (): Promise<IKeyValueStore> => {
          if (factoryPromise !== undefined) return factoryPromise
          let candidate: IKeyValueStore | PromiseLike<IKeyValueStore>
          try {
            candidate = metadata.create(context)
          } catch (error) {
            factoryPromise = Promise.reject(error)
            return factoryPromise
          }
          factoryPromise = Promise.resolve(candidate)
          void factoryPromise.then(
            (value) => {
              if (ownsLateValue) return
              void this.#disposeLateStore(value)
            },
            () => undefined
          )
          return factoryPromise
        }
        let store: IKeyValueStore
        try {
          store = await withTimeout(() => startFactory(), {
            timeoutMs: effectiveTimeout,
            signals: [batchToken.controller.signal],
            scheduler: this.#scheduler,
            report: (error) => this.#report(error),
            zeroTimeoutBehavior: 'skip'
          })
        } catch (error) {
          ownsLateValue = false
          throw error
        }
        return registerStore(store)
      }
    }
    return { plugin: pluginDescriptor, storeCell, reactive, reactiveMetadata }
  }

  /** Materializes the Host-wide singleton service in the same PluginHost batch. */
  #createReactiveServicePlugin(
    service: IStorageReactiveService
  ): IPlugin<IStorageHostCore & IPluginHostCore<IStorageHostCore>, Record<string, never>> {
    return {
      name: STORAGE_LIVE_QUERY_SERVICE_NAME,
      shared: () => ({ [storageReactiveServiceCellKey]: service }),
      install: (core) => {
        core.onDispose(service.dispose)
        return {}
      }
    }
  }

  /** Materializes one backend-bound adapter with one synchronous controller subscription. */
  #createReactiveAdapterPlugin(
    plugin: IStorageBackendPluginHandle,
    storeCell: IStorageStoreCell,
    service: IStorageReactiveService,
    entryMetadata: IStorageReactiveFeatureMetadata | undefined,
    pending: Map<string, IStorageReactiveAdapter>
  ): IPlugin<IStorageHostCore & IPluginHostCore<IStorageHostCore>, Record<string, never>> {
    return {
      name: reactiveAdapterNameFromBackendId(plugin.id),
      install: (core) => {
        const sharedCell = core.getShared(storeCell.key)
        const sharedService = core.getShared(storageReactiveServiceCellKey)
        if (sharedCell !== storeCell || sharedService !== service)
          throw new StorageError(
            StorageErrorCode.reactiveFeatureInvalid,
            {},
            StorageErrorText.reactiveFeatureInvalid
          )
        const store = (sharedCell as IStorageStoreCell).get()
        const reactiveMetadata = entryMetadata
        if (reactiveMetadata === undefined)
          throw new StorageError(
            StorageErrorCode.reactiveFeatureInvalid,
            {},
            StorageErrorText.reactiveFeatureInvalid
          )
        const adapter = registerReactiveAdapter(
          sharedService as IStorageReactiveService,
          plugin.id,
          store,
          this.#report,
          reactiveMetadata,
          reactiveMetadata.subscribe
        )
        pending.set(plugin.id, adapter)
        core.onDispose(adapter.dispose)
        adapter.startSource()
        return {}
      }
    }
  }

  /** Best-effort cleanup for a factory value that lost publication ownership. */
  async #disposeLateStore(value: unknown): Promise<void> {
    const snapshot = snapshotKeyValueStoreDetailed(value)
    if (!snapshot.valid) {
      this.#report(
        createStorageTypeError(
          StorageErrorCode.backendPluginInvalid,
          StorageErrorText.backendPluginInvalid,
          snapshot.cause
        )
      )
      return
    }
    try {
      await invokeCaptured(snapshot.dispose, snapshot.receiver, [])
    } catch (error) {
      this.#report(error)
    }
  }
}

/** Creates an async R02 facade shell; constructor sync work never reads platform globals. */
export const createStorageHost = async <
  const TPlugins extends readonly IStorageBackendPluginHandle[] = readonly []
>(
  options?: IStorageHostCreateOptions<TPlugins>
): Promise<
  IStorageHost<
    IPluginStoreMap<TPlugins>,
    Extract<IStoragePluginReactiveId<TPlugins[number]>, keyof IPluginStoreMap<TPlugins> & string>
  >
> => {
  const optionsSnapshot = snapshotStorageHostCreateOptions(options)
  const facade = new StorageHostFacade(optionsSnapshot.hostOptions)
  const plugins = optionsSnapshot.plugins
  if (plugins !== undefined && plugins.length > 0) {
    try {
      return (await facade.use(...(plugins as TPlugins))) as IStorageHost<
        IPluginStoreMap<TPlugins>,
        Extract<
          IStoragePluginReactiveId<TPlugins[number]>,
          keyof IPluginStoreMap<TPlugins> & string
        >
      >
    } catch (error) {
      try {
        await facade.dispose()
      } catch {
        // Preserve the initial install primary; PluginHost has already reported rollback failures.
      }
      throw error
    }
  }
  return facade as unknown as IStorageHost<
    IPluginStoreMap<TPlugins>,
    Extract<IStoragePluginReactiveId<TPlugins[number]>, keyof IPluginStoreMap<TPlugins> & string>
  >
}
