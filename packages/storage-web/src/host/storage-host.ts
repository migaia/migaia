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
import { readStorageNativePluginDefinition, readStorageNativePluginMetadata } from './contracts.js'
import { reactiveAdapterNameFromBackendId, STORAGE_LIVE_QUERY_SERVICE_NAME } from './names.js'
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
  IStoragePluginExtensions,
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

/** One native registration's single-assignment store bridge into its PluginHost core. */
type IStorageNativeRegistrationContext = {
  readonly id: string
  readonly storeKey: symbol
  readonly storeCell: IStorageStoreCell
  readonly reactive: boolean
  readonly reactiveBundleKey: symbol | undefined
  readonly runInstall: <T>(operation: () => Promise<T>) => Promise<T>
  readonly isInstallExpired: () => boolean
  readonly registerStore: (store: IKeyValueStore, core: IStorageInstallCore) => void
}

/** Canonical lifecycle owner used by the R02 facade shell. */
class StoragePluginHost extends PluginHost<IStorageHostCore> {
  /** Registration-order bridge used only while PluginHost initializes one Storage-native batch. */
  #nativeContexts: Array<IStorageNativeRegistrationContext | undefined> = []

  /** Queues one optional Storage bridge for every immediately following PluginHost registration. */
  setNativeContexts(contexts: Array<IStorageNativeRegistrationContext | undefined>): void {
    this.#nativeContexts = contexts
  }

  /** Supplies the otherwise-private Store bridge only to the matching native plugin registration. */
  protected override createPluginDomainCore(): IStorageHostCore {
    const context = this.#nativeContexts.shift()
    if (context === undefined) return {}
    let registrationCore: IStorageInstallCore | undefined
    return {
      setStorageRegistrationCore: (core: IStorageInstallCore) => {
        registrationCore = core
      },
      getStore: context.storeCell.get,
      getBackendId: () => context.id,
      runStorageInstall: context.runInstall,
      isStorageInstallExpired: context.isInstallExpired,
      registerStore: (store: IKeyValueStore) => {
        if (registrationCore === undefined)
          throw new StorageError(
            StorageErrorCode.backendPluginInvalid,
            {},
            StorageErrorText.backendPluginInvalid
          )
        context.registerStore(store, registrationCore)
      }
    }
  }
}

/** Internal facade state used to enforce one in-flight storage batch. */
type IStorageHostState = 'open' | 'installing' | 'closing' | 'closed'

/** Internal registry snapshot containing exact stores after a committed PluginHost batch. */
type IStorageRegistry = ReadonlyMap<string, IKeyValueStore>

/** Private extension shape used only during one successful materialization batch. */
type IStorageStoreExtension = { readonly [key: symbol]: IKeyValueStore }

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
  /** Native PluginHost extension projection published only with the matching Store registry. */
  #extensions: Readonly<Record<PropertyKey, unknown>> = Object.freeze({})
  /** Every committed private native Store key, retained so later batches cannot leak old internals. */
  #nativeStoreKeys = new Set<symbol>()
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
      TReactiveIds | IStoragePluginReactiveId<TPlugins[number]>,
      IStoragePluginExtensions<TPlugins[number]>
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
      const nativeMetadata = plugins.map((plugin) => {
        const metadata = readStorageNativePluginMetadata(plugin)
        if (metadata === undefined)
          throw new StorageError(
            StorageErrorCode.backendPluginInvalid,
            {},
            StorageErrorText.backendPluginInvalid
          )
        return metadata
      })
      /**
       * Storage owns duplicate backend admission before any backend factory or PluginHost install
       * runs.
       */
      const admittedBackendIds = new Set(this.#registry.keys())
      for (const [index] of plugins.entries()) {
        const backendId = nativeMetadata[index]!.id
        if (admittedBackendIds.has(backendId))
          throw new StorageError(
            StorageErrorCode.reactiveTopologyInvalid,
            {},
            StorageErrorText.reactiveTopologyInvalid
          )
        admittedBackendIds.add(backendId)
      }
      /** First-party reactive Features bind to one opaque kind before descriptor construction. */
      for (const native of nativeMetadata) {
        if (
          native !== undefined &&
          native.reactiveExpectedKinds.some((kind) => native.backendKind !== kind)
        )
          throw new StorageError(
            StorageErrorCode.reactiveFeatureInvalid,
            {},
            StorageErrorText.reactiveFeatureInvalid
          )
      }
      assertBatchOwner()
      const trustedStores = new Map<symbol, IKeyValueStore>()
      const nativeContexts = new Map<number, IStorageNativeRegistrationContext>()
      const entries = plugins.map((plugin, index) => {
        const native = nativeMetadata[index]!
        const storeCell = createStorageStoreCell()
        let installExpired = false
        const context: IStorageNativeRegistrationContext = {
          id: native.id,
          storeKey: native.storeKey,
          storeCell,
          reactive: native.reactiveFeatureName !== undefined,
          reactiveBundleKey: native.reactiveBundleKey,
          runInstall: async <T>(operation: () => Promise<T>): Promise<T> => {
            const elapsed = Math.max(0, this.#scheduler.now() - batchToken.startedAt)
            const pending = operation()
            let operationSettled = false
            void pending.then(
              () => {
                operationSettled = true
              },
              () => {
                operationSettled = true
              }
            )
            try {
              return await withTimeout(() => pending, {
                timeoutMs: Math.max(0, this.#installTimeoutMs - elapsed),
                signals: [batchToken.controller.signal],
                scheduler: this.#scheduler,
                report: (error) => this.#report(error),
                zeroTimeoutBehavior: 'skip'
              })
            } catch (error) {
              installExpired = !operationSettled
              throw error
            }
          },
          isInstallExpired: () => installExpired,
          registerStore: (store, core) => {
            const snapshot = snapshotKeyValueStoreDetailed(store)
            if (!snapshot.valid)
              throw createStorageTypeError(
                StorageErrorCode.backendPluginInvalid,
                StorageErrorText.backendPluginInvalid,
                snapshot.cause
              )
            if (!batchToken.active || this.#activeBatchToken !== batchToken) {
              void this.#disposeLateStore(snapshot.store)
              throw new StorageError(
                StorageErrorCode.storageHostDisposed,
                {},
                StorageErrorText.storageHostDisposed
              )
            }
            try {
              core.onDispose(() => invokeCaptured(snapshot.dispose, snapshot.receiver, []))
            } catch (error) {
              void this.#disposeLateStore(snapshot.store)
              throw error
            }
            storeCell.set(snapshot.store)
            trustedStores.set(native.storeKey, snapshot.store)
          }
        }
        nativeContexts.set(index, context)
        const definition = readStorageNativePluginDefinition(plugin)
        if (definition === undefined)
          throw new StorageError(
            StorageErrorCode.backendPluginInvalid,
            {},
            StorageErrorText.backendPluginInvalid
          )
        return {
          plugin: definition as IPlugin<IStorageInstallCore, IStorageStoreExtension>,
          storeCell,
          reactive: context.reactive,
          reactiveMetadata: context.reactive
            ? ({ mode: 'push', visibility: 'instance' } as IStorageReactiveFeatureMetadata)
            : undefined,
          reactiveAttach: undefined
        }
      })
      const pendingReactive = new Map<string, IStorageReactiveAdapter>()
      const hasReactiveFeature = entries.some((entry) => entry.reactive)
      const servicePlugin =
        hasReactiveFeature && !this.#reactiveServiceInstalled
          ? this.#createReactiveServicePlugin()
          : undefined
      const adapters = entries.flatMap((entry, index) =>
        entry.reactive
          ? [
              this.#createReactiveAdapterPlugin(
                nativeContexts.get(index)?.id ?? plugins[index]!.id,
                entry.storeCell,
                entry.reactiveMetadata,
                pendingReactive,
                entry.reactiveAttach,
                nativeContexts.get(index)?.reactiveBundleKey,
                nativeContexts.get(index)?.storeKey,
                trustedStores
              )
            ]
          : []
      )
      const materialized = [
        ...entries.map((entry) => entry.plugin),
        ...(servicePlugin === undefined ? [] : [servicePlugin]),
        ...adapters
      ]
      this.#inner.setNativeContexts(entries.map((_, index) => nativeContexts.get(index)))
      const innerView = await this.#inner.use(
        ...(materialized as IPluginConstraint<IStorageHostCore>[])
      )
      assertBatchOwner()
      const nextRegistry = new Map(this.#registry)
      const internalExtensionKeys = new Set(this.#nativeStoreKeys)
      for (const context of nativeContexts.values()) internalExtensionKeys.add(context.storeKey)
      const nextExtensions = Object.create(null) as Record<PropertyKey, unknown>
      for (const source of [this.#extensions, innerView.extensions])
        for (const key of Reflect.ownKeys(source)) {
          if (internalExtensionKeys.has(key as symbol)) continue
          Object.defineProperty(nextExtensions, key, Object.getOwnPropertyDescriptor(source, key)!)
        }
      for (const [index] of plugins.entries()) {
        const native = nativeContexts.get(index)
        nextRegistry.set(native!.id, trustedStores.get(native!.storeKey)!)
      }
      const nextReactiveRegistry = new Map(this.#reactiveRegistry)
      for (const [index] of plugins.entries()) {
        if (!entries[index]!.reactive) continue
        const native = nativeContexts.get(index)
        const backendId = native!.id
        const adapter = pendingReactive.get(backendId)
        if (adapter !== undefined) nextReactiveRegistry.set(backendId, adapter)
      }
      this.#registry = new Map(nextRegistry)
      this.#extensions = Object.freeze(nextExtensions)
      this.#reactiveRegistry = nextReactiveRegistry
      this.#nativeStoreKeys = internalExtensionKeys
      if (servicePlugin !== undefined) this.#reactiveServiceInstalled = true
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
          TReactiveIds | IStoragePluginReactiveId<TPlugins[number]>,
          IStoragePluginExtensions<TPlugins[number]>
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

  /** Returns the current immutable extension plane after its corresponding batch has committed. */
  get extensions(): Readonly<Record<PropertyKey, unknown>> {
    this.#assertOpen()
    return this.#extensions
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
    this.#extensions = Object.freeze({})
    this.#nativeStoreKeys.clear()
    this.#reactiveRegistry.clear()
    this.#disposePromise = this.#inner.dispose().then(async () => {
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

  /** Materializes the Host-wide singleton service in the same PluginHost batch. */
  #createReactiveServicePlugin(): IPlugin<
    IStorageHostCore & IPluginHostCore<IStorageHostCore>,
    Record<string, never>
  > {
    let service: IStorageReactiveService | undefined
    return {
      name: STORAGE_LIVE_QUERY_SERVICE_NAME,
      shared: () => {
        if (service === undefined)
          throw new StorageError(
            StorageErrorCode.reactiveFeatureInvalid,
            {},
            StorageErrorText.reactiveFeatureInvalid
          )
        return { [storageReactiveServiceCellKey]: service }
      },
      install: (core) => {
        service = createStorageReactiveService(this.#scheduler)
        this.#reactiveService = service
        try {
          core.onDispose(async () => {
            try {
              await service!.dispose()
            } catch (error) {
              this.#report(error)
              throw error
            } finally {
              if (this.#reactiveService === service) this.#reactiveService = undefined
            }
          })
        } catch (error) {
          this.#reactiveService = undefined
          void service.dispose().catch((cleanupError: unknown) => this.#report(cleanupError))
          throw error
        }
        return {}
      }
    }
  }

  /** Materializes one backend-bound adapter with one synchronous controller subscription. */
  #createReactiveAdapterPlugin(
    backendId: string,
    storeCell: IStorageStoreCell,
    entryMetadata: IStorageReactiveFeatureMetadata | undefined,
    pending: Map<string, IStorageReactiveAdapter>,
    attach:
      | ((
          service: IStorageReactiveService,
          report: (error: unknown) => void
        ) => IStorageReactiveAdapter)
      | undefined,
    bundleKey: symbol | undefined,
    storeKey: symbol | undefined,
    trustedStores: ReadonlyMap<symbol, IKeyValueStore>
  ): IPlugin<IStorageHostCore & IPluginHostCore<IStorageHostCore>, Record<string, never>> {
    return {
      name: reactiveAdapterNameFromBackendId(backendId),
      install: (core) => {
        const sharedService = core.getShared(storageReactiveServiceCellKey)
        if (sharedService !== this.#reactiveService)
          throw new StorageError(
            StorageErrorCode.reactiveFeatureInvalid,
            {},
            StorageErrorText.reactiveFeatureInvalid
          )
        const store = storeCell.get()
        const reactiveMetadata = entryMetadata
        if (reactiveMetadata === undefined)
          throw new StorageError(
            StorageErrorCode.reactiveFeatureInvalid,
            {},
            StorageErrorText.reactiveFeatureInvalid
          )
        const bundle =
          bundleKey === undefined
            ? undefined
            : (core.getShared(bundleKey) as
                | { readonly store?: unknown; readonly attach?: unknown }
                | undefined)
        const trustedStore = storeKey === undefined ? undefined : trustedStores.get(storeKey)
        if (
          bundleKey !== undefined &&
          (bundle?.store !== store || trustedStore !== store || typeof bundle.attach !== 'function')
        ) {
          throw new StorageError(
            StorageErrorCode.reactiveFeatureInvalid,
            {},
            StorageErrorText.reactiveFeatureInvalid
          )
        }
        const featureAttach =
          bundleKey === undefined ? attach : (bundle!.attach as NonNullable<typeof attach>)
        const adapter =
          featureAttach === undefined
            ? registerReactiveAdapter(
                sharedService as IStorageReactiveService,
                backendId,
                store,
                this.#report,
                reactiveMetadata,
                reactiveMetadata.subscribe
              )
            : featureAttach(sharedService as IStorageReactiveService, this.#report)
        pending.set(backendId, adapter)
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
    Extract<IStoragePluginReactiveId<TPlugins[number]>, keyof IPluginStoreMap<TPlugins> & string>,
    IStoragePluginExtensions<TPlugins[number]>
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
        >,
        IStoragePluginExtensions<TPlugins[number]>
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
    Extract<IStoragePluginReactiveId<TPlugins[number]>, keyof IPluginStoreMap<TPlugins> & string>,
    IStoragePluginExtensions<TPlugins[number]>
  >
}
