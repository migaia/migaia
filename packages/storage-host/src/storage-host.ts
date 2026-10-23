import {
  defineHost,
  asyncDisposeKey,
  PluginHostErrorCode,
  getPluginRuntimeIntegration,
  type IHostHandle,
  type IPluginHostOptions,
  type IPlugin,
  type IPluginConstraint,
  type IPluginResource
} from '@migaia/plugin-host'
import { createAbortController, snapshotScheduler, mergeCleanupResults } from '@migaia/lifecycle'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { snapshotStorageBaseDetailed } from '@migaia/storage-contract'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { withTimeout } from '@migaia/utils/promise'
import {
  createStorageTypeError,
  createStorageAggregateError,
  StorageError,
  StorageErrorCode
} from './errors.js'
import { StorageErrorText } from './error-text.js'
import { readStorageNativePluginDefinition, readStorageNativePluginMetadata } from './contracts.js'
import { forwardStorageExecution } from './execution.js'
import { createStorageStoreCell, type IStorageStoreCell } from './store-cell.js'
import type { IStorageBase, IStorageBaseAdmission } from '@migaia/storage-contract'
import type {
  IStorageBackendPluginHandle,
  IStorageHost,
  IStorageHostCreateOptions,
  IStorageHostOptions,
  IPluginStoreMap,
  IRejectInstalledOrDuplicateIds,
  IStoragePipelineInput,
  IStorageBackendKind
} from './types.js'

/** Minimal PluginHost domain core; storage materializers do not expose host mutation to plugins. */
type IStorageHostCore = object

/** Narrow lifecycle core required by a backend materializer. */
type IStorageInstallCore = { readonly onDispose: (resource: IPluginResource) => void }

/** One native registration's single-assignment store bridge into its PluginHost core. */
type IStorageNativeRegistrationContext = {
  readonly id: string
  readonly scheduler: IScheduler
  readonly getKind: () => IStorageBackendKind | undefined
  readonly setKind: (kind: IStorageBackendKind | undefined) => void
  readonly storeCell: IStorageStoreCell
  readonly runInstall: <T>(operation: () => Promise<T>) => Promise<T>
  readonly isInstallExpired: () => boolean
  readonly registerStore: (store: IStorageBase, core: IStorageInstallCore) => void
}

/**
 * Canonical lifecycle owner used by the facade shell.
 *
 * Built with `defineHost` rather than by extending `PluginHost`: the shell needed one domain-core
 * hook and one extra setter, and inheritance handed it the host's entire surface as well.
 */
type IStoragePluginHost = IHostHandle<IStorageHostCore, IStoragePipelineInput, readonly []> &
  Readonly<{
    setNativeContexts(
      contexts: Array<IStorageNativeRegistrationContext | undefined>,
      expectedEntries: number
    ): void
  }>

export function createStoragePluginHost(options: IPluginHostOptions): IStoragePluginHost {
  /** Registration-order bridge, used only while one Storage-native batch initializes. */
  let nativeContexts: Array<IStorageNativeRegistrationContext | undefined> = []
  /** Each registration consumes its bridge once without shifting the remaining batch. */
  let contextIndex = 0
  /** One original managed host owns registrations and the shared pipeline entries. */
  const host: IHostHandle<IStorageHostCore, IStoragePipelineInput, readonly []> = defineHost<
    IStorageHostCore,
    IStoragePipelineInput
  >({
    host: options,
    /** Supplies the otherwise-private Store bridge only to the matching native registration. */
    domainCore: (): object => {
      /** Bind the next domain core to its matching entry in this install batch. */
      const context = nativeContexts[contextIndex++]
      if (context === undefined) return {}
      /** Capture the original core so callers cannot substitute resource authority. */
      let registrationCore: IStorageInstallCore | undefined
      return {
        setStorageRegistrationCore: (core: IStorageInstallCore) => {
          registrationCore = core
        },
        getStore: context.storeCell.get,
        getBackendId: () => context.id,
        getScheduler: () => context.scheduler,
        setStorageKind: context.setKind,
        execution: forwardStorageExecution(
          host,
          () => {
            if (registrationCore !== undefined)
              getPluginRuntimeIntegration(registrationCore).assertCurrent()
          },
          () => ({ backendId: context.id, backend: context.getKind()?.name ?? context.id })
        ),
        runStorageInstall: context.runInstall,
        isStorageInstallExpired: context.isInstallExpired,
        registerStore: (store: IStorageBase) => {
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
  })
  return Object.freeze({
    ...host,
    /**
     * Queues one optional Storage bridge for every entry registration of the next batch.
     *
     * `expectedEntries` is the batch's entry count, and a queue that does not cover it exactly is
     * rejected here rather than becoming an empty core later: `shift()` returning `undefined` reads
     * identically to "this registration needs no bridge", so a short queue would otherwise surface
     * as a backend that silently never registered its store.
     */
    setNativeContexts: (
      contexts: Array<IStorageNativeRegistrationContext | undefined>,
      expectedEntries: number
    ): void => {
      if (contexts.length !== expectedEntries)
        throw new StorageError(
          StorageErrorCode.backendPluginInvalid,
          {},
          StorageErrorText.backendPluginInvalid
        )
      nativeContexts = contexts
      contextIndex = 0
    }
  }) as IStoragePluginHost
}

/** Internal facade state used to enforce one in-flight storage batch. */
type IStorageHostState = 'open' | 'installing' | 'closing' | 'closed'

/** Internal registry snapshot containing exact stores after a committed PluginHost batch. */
type IStorageRegistry = ReadonlyMap<string, IStorageBase>

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
export class StorageHostFacade<P extends readonly IStorageBackendPluginHandle[] = readonly []> {
  /** Canonical PluginHost owns lifecycle and eventual mutation queue semantics. */
  readonly #inner: IStoragePluginHost
  /** Registry is swapped only after the complete inner batch has committed. */
  #registry: IStorageRegistry = new Map()
  /** Native PluginHost extension projection published only with the matching Store registry. */
  #extensions: Readonly<Record<PropertyKey, unknown>> = Object.freeze({})
  /** Single-flight state prevents a second feature graph from racing the first admission. */
  #state: IStorageHostState = 'open'
  /** Current batch promise, retained only while the facade is installing. */
  #installing: Promise<void> | undefined
  /** Ownership token invalidated synchronously when disposal wins an active batch race. */
  #activeBatchToken: IStorageBatchToken | undefined
  /** Stable idempotent disposal promise shared by every caller. */
  #disposePromise: Promise<void> | undefined
  /** Symbol cleanup reports the same actual failure without suppressing an outer primary. */
  #symbolDisposePromise: Promise<void> | undefined
  /** One snapped scheduler shared by PluginHost and every factory deadline. */
  readonly #scheduler: IScheduler
  /** Finite host-wide budget consumed by each install batch. */
  readonly #installTimeoutMs: number
  /** Caller diagnostics are observed without becoming a lifecycle rejection. */
  readonly #report: (error: unknown) => void

  /** Creates the shell and snapshots lifecycle/deadline inputs before any plugin runs. */
  constructor(options: IStorageHostOptions = {}) {
    /** Read constructor options once before any plugin can execute. */
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
    /** One finite deadline applies to the entire native install batch. */
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
        if (report === undefined) {
          observeThenableRejection(undefined, { error }, (failure) => {
            throw failure
          })
          return
        }
        /** Preserve the actual callback result while observing its failure channel. */
        const result = report(error)
        observeThenableRejection(result, inspectThenable(result), (failure) => {
          throw failure
        })
      } catch (reporterError) {
        observeThenableRejection(undefined, { error: reporterError }, (failure) => {
          throw failure
        })
      }
    }

    this.#inner = createStoragePluginHost({
      pipeline: { mode: 'async' },
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      scheduler: this.#scheduler,
      diagnostic: (_message, code, error) => {
        // Provisional rollback returns original cleanup failures through its existing diagnostic.
        if (
          code === PluginHostErrorCode.pluginInstallRollbackFailed &&
          error instanceof AggregateError
        )
          for (const failure of error.errors) this.#report(failure)
      }
    })
  }

  /**
   * Install one atomic native plugin batch; publication happens only after complete success. A
   * concurrent mutation throws STORAGE_HOST_BUSY synchronously, while setup/timeout failures reject
   * and roll back newly owned Stores.
   */
  use<const TPlugins extends readonly IStorageBackendPluginHandle[]>(
    ...plugins: IRejectInstalledOrDuplicateIds<{ [N in P[number]['id']]: true }, TPlugins>
  ): Promise<IStorageHost<readonly [...P, ...TPlugins]>> {
    this.#assertOpen()
    if (this.#state === 'installing') {
      throw new StorageError(StorageErrorCode.storageHostBusy, {}, StorageErrorText.storageHostBusy)
    }
    this.#state = 'installing'
    /** Only this live batch token can publish its native install results. */
    const batchToken: IStorageBatchToken = {
      controller: createAbortController(),
      startedAt: this.#scheduler.now(),
      active: true
    }
    this.#activeBatchToken = batchToken
    /** Reject a cancelled or losing batch before the next publication step. */
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
    /** This Promise owns native installation and the one atomic store publication. */
    const batch = Promise.resolve().then(async () => {
      assertBatchOwner()
      /** Resolve only trusted plugin identities before constructing backends. */
      const nativeMetadata = plugins.map((plugin) => {
        /** Read the captured storage-owned metadata without invoking native getters. */
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
        /** Check duplicate public ids independently of native name encoding. */
        const backendId = nativeMetadata[index]!.id
        if (admittedBackendIds.has(backendId))
          throw new StorageError(
            StorageErrorCode.backendDuplicate,
            {},
            StorageErrorText.backendDuplicate
          )
        admittedBackendIds.add(backendId)
      }
      assertBatchOwner()
      /** Each batch entry retains exactly one original store handoff. */
      const nativeContexts = new Map<number, IStorageNativeRegistrationContext>()
      /** Materialize original definitions in the same order as native registration. */
      const entries = plugins.map((plugin, index) => {
        /** Retain only this entry original trusted definition metadata. */
        const native = nativeMetadata[index]!
        /** Preserve the exact admitted store with one single-assignment handoff. */
        const storeCell = createStorageStoreCell()
        /** A late installation cannot regain authority after its deadline. */
        let installExpired = false
        /** Kind is captured per registration, never in reusable definition metadata. */
        let kind: IStorageBackendKind | undefined
        /** Bind the next domain core to its matching entry in this install batch. */
        const context: IStorageNativeRegistrationContext = {
          id: native.id,
          scheduler: this.#scheduler,
          getKind: () => kind,
          setKind: (value) => {
            kind = value
          },
          storeCell,
          runInstall: async <T>(operation: () => Promise<T>): Promise<T> => {
            /** Consume the original batch deadline instead of resetting it per backend. */
            const elapsed = Math.max(0, this.#scheduler.now() - batchToken.startedAt)
            /** Observe the actual native work even when timeout wins first. */
            const pending = operation()
            /** Distinguish an operation failure from work still running after expiry. */
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
            /** Use contract-owned admission and its captured original disposal receiver. */
            const snapshot = snapshotStorageBaseDetailed(store, { asyncDisposeKey })
            if (!snapshot.valid)
              throw createStorageTypeError(
                StorageErrorCode.backendPluginInvalid,
                StorageErrorText.backendPluginInvalid,
                snapshot.cause
              )
            if (!batchToken.active || this.#activeBatchToken !== batchToken) {
              void this.#disposeLateStore(snapshot)
              throw new StorageError(
                StorageErrorCode.storageHostDisposed,
                {},
                StorageErrorText.storageHostDisposed
              )
            }
            try {
              core.onDispose(() => Reflect.apply(snapshot.dispose, snapshot.receiver, []))
            } catch (error) {
              void this.#disposeLateStore(snapshot)
              throw error
            }
            if (kind === undefined || snapshot.backend !== kind.name)
              throw createStorageTypeError(
                StorageErrorCode.backendKindMismatch,
                StorageErrorText.backendKindMismatch
              )
            storeCell.set(snapshot.store)
          }
        }
        nativeContexts.set(index, context)
        /** The original PluginHost definition remains the registration and lifecycle owner. */
        const definition = readStorageNativePluginDefinition(plugin)
        if (definition === undefined)
          throw new StorageError(
            StorageErrorCode.backendPluginInvalid,
            {},
            StorageErrorText.backendPluginInvalid
          )
        return {
          plugin: definition as IPlugin<IStorageInstallCore, Record<string, unknown>>,
          storeCell
        }
      })
      /** Pass only the original definitions to the canonical install batch. */
      const materialized = entries.map((entry) => entry.plugin)
      this.#inner.setNativeContexts(
        entries.map((_, index) => nativeContexts.get(index)),
        entries.length
      )
      /** Committed native handles retain their original guarded extension methods. */
      const innerHandles = await this.#inner.use(
        ...(materialized as IPluginConstraint<IStorageHostCore>[])
      )
      assertBatchOwner()
      /** Prepare the next store registry before its atomic public swap. */
      const nextRegistry = new Map(this.#registry)
      /** Merge original guarded descriptors without rebuilding extension methods. */
      const nextExtensions = Object.create(null) as Record<PropertyKey, unknown>
      for (const source of [this.#extensions, ...innerHandles.map((handle) => handle.extensions)])
        for (const key of Reflect.ownKeys(source)) {
          Object.defineProperty(nextExtensions, key, Object.getOwnPropertyDescriptor(source, key)!)
        }
      for (const [index] of plugins.entries()) {
        /** Retain only this entry original trusted definition metadata. */
        const native = nativeContexts.get(index)
        if (native!.getKind() !== undefined)
          nextRegistry.set(native!.id, entries[index]!.storeCell.get())
      }
      this.#registry = new Map(nextRegistry)
      this.#extensions = Object.freeze(nextExtensions)
    })
    this.#installing = batch
    /** Only the current batch may reopen admission and return the narrowed host. */
    const settled = batch.then(
      () => {
        assertBatchOwner()
        batchToken.active = false
        this.#activeBatchToken = undefined
        if (this.#state === 'installing') this.#state = 'open'
        this.#installing = undefined
        return this as unknown as IStorageHost<readonly [...P, ...TPlugins]>
      },
      (error: unknown) => {
        // Provisional trusted values are owned by PluginHost rollback, not by this local map.
        /** Preserve the original failure under the correct host boundary identity. */
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
  backend<TId extends keyof IPluginStoreMap<P> & string>(id: TId): IPluginStoreMap<P>[TId] {
    this.#assertOpen()
    /** Use the original admitted backend object instead of creating a replacement. */
    const store = this.#registry.get(id)
    if (store === undefined)
      throw new StorageError(
        StorageErrorCode.backendNotInstalled,
        {},
        StorageErrorText.backendNotInstalled
      )
    return store as IPluginStoreMap<P>[TId]
  }

  /** Narrows a lookup to IDs in the current immutable registry snapshot. */
  hasBackend(id: string): id is keyof IPluginStoreMap<P> & string {
    this.#assertOpen()
    return this.#registry.has(id)
  }

  /** Return a detached Map copy, typed readonly; mutating the copy cannot change this registry. */
  backends(): ReadonlyMap<
    keyof IPluginStoreMap<P> & string,
    IPluginStoreMap<P>[keyof IPluginStoreMap<P>]
  > {
    this.#assertOpen()
    return new Map(this.#registry) as unknown as ReadonlyMap<
      keyof IPluginStoreMap<P> & string,
      IPluginStoreMap<P>[keyof IPluginStoreMap<P>]
    >
  }

  /** Seals the facade once and delegates lifecycle cleanup to PluginHost. */
  dispose(): Promise<void> {
    if (this.#disposePromise !== undefined) return this.#disposePromise
    this.#state = 'closing'
    if (this.#activeBatchToken !== undefined) {
      /** Only this live batch token can publish its native install results. */
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
    this.#disposePromise = mergeCleanupResults([this.#inner.dispose()])
      .then(({ cleanupErrors }) => {
        if (cleanupErrors.length !== 0)
          throw createStorageAggregateError(
            StorageErrorCode.storageHostDisposeFailed,
            StorageErrorText.storageHostDisposeFailed,
            cleanupErrors
          )
      })
      .finally(() => {
        this.#state = 'closed'
      })
    return this.#disposePromise
  }

  /** Resource syntax owns a stable reporting projection of the same one cleanup. */
  [asyncDisposeKey](): Promise<void> {
    return (this.#symbolDisposePromise ??= this.dispose().catch((error) => {
      this.#report(error)
    }))
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

  /** Best-effort cleanup for a factory value that lost publication ownership. */
  async #disposeLateStore(
    snapshot: Extract<IStorageBaseAdmission, { readonly valid: true }>
  ): Promise<void> {
    try {
      await Reflect.apply(snapshot.dispose, snapshot.receiver, [])
    } catch (error) {
      this.#report(error)
    }
  }
}

/**
 * Create a Host and atomically install the optional initial plugin tuple. Defaults to no backends
 * and a 30000 ms install budget. Browser storage is acquired only by selected backend plugins;
 * failed initial installation disposes its newly created facade before rejecting.
 */
export const createStorageHost = async <
  const TPlugins extends readonly IStorageBackendPluginHandle[] = readonly []
>(
  options?: IStorageHostCreateOptions<TPlugins>
): Promise<IStorageHost<TPlugins>> => {
  /** Read constructor options once before any plugin can execute. */
  const optionsSnapshot = snapshotStorageHostCreateOptions(options)
  /** The storage facade retains the one canonical native lifecycle owner. */
  const facade = new StorageHostFacade(optionsSnapshot.hostOptions)
  /** Capture the literal initial tuple before installation can begin. */
  const plugins = optionsSnapshot.plugins
  if (plugins !== undefined && plugins.length > 0) {
    try {
      return (await facade.use(...(plugins as TPlugins))) as IStorageHost<TPlugins>
    } catch (error) {
      try {
        await facade.dispose()
      } catch (cleanupError) {
        throw createStorageAggregateError(
          StorageErrorCode.backendInstallFailed,
          StorageErrorText.backendInstallFailed,
          [error, cleanupError]
        )
      }
      throw error
    }
  }
  return facade as unknown as IStorageHost<TPlugins>
}
