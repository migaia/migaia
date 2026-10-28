import { createStorageHooks, type IStorageHookEmitter } from './hooks.ts'
import type { IStorageHooks } from './hook-types.ts'
import { createStorageObservers, type IStorageObserverSet } from './stages.ts'
import { StorageHookName as Hook } from './hook-names.ts'
import { borrowStorageBackend } from './borrow.ts'
import {
  STORAGE_DEFAULT_ORG,
  STORAGE_JOURNAL_PLUGIN_ID,
  STORAGE_PROBE_PLUGIN_ID
} from './state-constants.ts'
import type { IBackendStageBindings } from '@migaia/storage-contract'
import {
  asyncDisposeKey,
  PluginHostErrorCode,
  type IHostHandle,
  type IPlugin,
  type IPluginHostCore
} from '@migaia/plugin-host'
import { createAbortController, snapshotScheduler, mergeCleanupResults } from '@migaia/lifecycle'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { assertOperationContext } from '@migaia/storage-contract'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import { observeThenableRejection } from '@migaia/utils/function'
import { createStorageTypeError, createStorageAggregateError, StorageError } from './errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from './error-text.ts'
import { readStorageNativePluginDefinition, readStorageNativePluginMetadata } from './contracts.ts'
import type { IStorageStoreCell } from './store-cell.ts'
import type { IStorageBase, IStorageBaseAdmission } from '@migaia/storage-contract'
import type {
  IStorageBackendPluginHandle,
  IStorageHost,
  IStorageHostCreateOptions,
  IStorageHostOptions,
  IPluginStoreMap,
  IRejectInstalledOrDuplicateIds,
  IStoragePipelineInput,
  IStorageBackendKind,
  IStoragePluginCore,
  IStorageEnvelopeStages,
  IStorageOrgView,
  IStorageBackendOrgContext,
  IStorageBorrowedBackend
} from './types.ts'
import { pluginNameFromBackendId } from './names.ts'
import { readStorageProbeHandlers } from './plugins/probe/handlers.ts'
import type { IStorageHookMap } from './hook-types.ts'
import { storageJournalAccess, type IStorageJournalBackendAccess } from './journal/binding.ts'
import type { IStorageJournalExecutionPort } from './journal/types.ts'
import { StorageHostJournal } from './host-journal.ts'
import { StorageHostInstaller } from './host-install.ts'
import { createStoragePluginHost } from './host-ports.ts'
import { StorageHostBatch } from './host-batch.ts'
import { StorageHostProjection } from './host-projection.ts'

/** Deliver final reporter failures through the existing utility host exception boundary. */
function reportStorageUnhandledFailure(error: unknown): void {
  observeThenableRejection(undefined, { error }, (failure) => {
    throw failure
  })
}

/** Minimal PluginHost domain core; storage materializers do not expose host mutation to plugins. */
export type IStorageHostCore = object

/** Narrow lifecycle core required by a backend materializer. */
export type IStorageInstallCore = Pick<
  IPluginHostCore<IStoragePipelineInput>,
  'onDispose' | 'operation' | 'config' | 'lifecycle'
>

/** A check retains only its original callback and currently running work for lifecycle draining. */
export type IStorageDetectCheck = {
  readonly check: (signal: INativeAbortSignal) => Promise<void>
  pending?: Promise<void>
}

/** One native registration's single-assignment store bridge into its PluginHost core. */
export type IStorageNativeRegistrationContext = {
  readonly registerJournalRuntime: IStoragePluginCore['registerJournalRuntime']
  readonly getJournal: (orgId: string) => IStorageJournalExecutionPort | undefined
  readonly observeExecution?: <R>(
    orgId: string,
    describe: () => IStoragePipelineInput,
    invoke: (observing: boolean) => Promise<R>
  ) => Promise<R>
  readonly id: string
  readonly defaultOrgId: string
  readonly assertCurrent: () => void
  readonly assertExecution: () => void
  readonly getPublishedBackend: IStoragePluginCore['getPublishedBackend']
  readonly registerDetect: IStoragePluginCore['registerDetect']
  readonly runDetect: () => Promise<void>
  readonly completeDetect: () => void
  readonly isDetected: () => boolean
  readonly setRegistrationCore: (core: IStorageInstallCore) => void
  readonly getStageBindings: () => IBackendStageBindings
  readonly getObservers: (store: IStorageBase, orgId?: string) => IStorageObserverSet
  readonly getEnvelopeStages: (
    operation: Readonly<{ operation: string; targetVersion: number }>,
    orgId?: string
  ) => IStorageEnvelopeStages
  readonly hooks: IStorageHooks
  readonly emit: IStorageHookEmitter
  readonly scheduler: IScheduler
  readonly getKind: () => IStorageBackendKind | undefined
  readonly setKind: (kind: IStorageBackendKind | undefined) => void
  readonly storeCell: IStorageStoreCell
  readonly runInstall: <T>(operation: () => Promise<T>) => Promise<T>
  readonly isInstallExpired: () => boolean
  readonly registerStore: (store: IStorageBase, core: IStorageInstallCore) => void
  readonly getOrgContext: (orgId: string) => IStorageBackendOrgContext
}

/**
 * Canonical lifecycle owner used by the facade shell.
 *
 * Built with `defineHost` rather than by extending `PluginHost`: the shell needed one domain-core
 * hook and one extra setter, and inheritance handed it the host's entire surface as well.
 */
export type IStoragePluginHost = IHostHandle<IStorageHostCore, IStoragePipelineInput, readonly []> &
  Readonly<{
    setNativeContexts(contexts: ReadonlyMap<string, IStorageNativeRegistrationContext>): void
  }>

/** One native registration retains only its install core and original construction context. */
export type IStorageRegistrationAssembly = {
  /** The native batch entry owns store, org and stage authority. */
  readonly context: IStorageNativeRegistrationContext
  /** The canonical PluginHost owns the existing pipeline and resource scope. */
  readonly host: IHostHandle<IStorageHostCore, IStoragePipelineInput, readonly []>
  /** Installation supplies this core before invoking registration callbacks. */
  registrationCore: IStorageInstallCore | undefined
}

/** Internal facade state used to enforce one in-flight storage batch. */
export type IStorageHostState = 'open' | 'installing' | 'closing' | 'closed'

/** Internal registry snapshot containing exact stores after a committed PluginHost batch. */
type IStorageRegistry = ReadonlyMap<string, IStorageBase>

/**
 * Marks one install batch as the live one. Disposal or a newer batch clears `active`, so a batch
 * that resumes after `await` cannot publish. Timeouts belong to PluginHost, not to this token.
 */
export type IStorageBatchToken = {
  active: boolean
}

/** One install batch shares only journal-preparation authority and its ordered registration bridge. */
export type IStorageInstallBatchContext = {
  /** Original token selects the sole live batch and retains its deadline origin. */
  readonly batchToken: IStorageBatchToken
  /** Final journal bootstrap temporarily admits already-materialized native candidates. */
  preparingJournal: boolean
  /** Only a successful native batch can publish its selected journal pipeline. */
  installedJournalPipeline: boolean
  /** Each original PluginHost definition consumes one matching registration context. */
  nativeContexts: Map<number, IStorageNativeRegistrationContext>
}
/** One materialized native definition retains the single original store handoff. */
export type IStorageInstallEntryResult = {
  readonly plugin: IPlugin<IStorageInstallCore, Record<string, unknown>>
  readonly storeCell: IStorageStoreCell
}
/** One original registration owns its store handoff, dependency borrows and native context ports. */
export type IStorageInstallEntryContext = {
  /** Original installState is captured before native construction begins. */
  readonly installState: IStorageInstallBatchContext
  /**
   * Set when this plugin's install work settles. An install that has not settled while its
   * registration is no longer current timed out; only that case may hand over a late store.
   */
  installSettled: boolean
  /** Original plugin is captured before native construction begins. */
  readonly plugin: IStorageBackendPluginHandle
  /** Original metadata is captured before native construction begins. */
  readonly metadata: NonNullable<ReturnType<typeof readStorageNativePluginMetadata>>
  /** Original index is captured before native construction begins. */
  readonly index: number

  /** Retain only this entry original trusted definition metadata. */
  native: NonNullable<ReturnType<typeof readStorageNativePluginMetadata>>

  /** Preserve the exact admitted store with one single-assignment handoff. */
  storeCell: IStorageStoreCell

  /** Kind is captured per registration, never in reusable definition metadata. */
  kind: IStorageBackendKind | undefined

  /** The original core supplies registration and installation admission for all bound ports. */
  registrationCore: IStorageInstallCore | undefined

  /** Construction bindings are allocated only when a backend actually requests them. */
  stageBindings: IBackendStageBindings | undefined

  /** The original installation owns only its captured dependency handles, never their resources. */
  borrowed: Map<object, IStorageBase> | undefined

  /** Checks belong to this original registration and retain registration order. */
  checks: Set<IStorageDetectCheck>

  /** A successful complete host pass admits this registration's real execution endpoints. */
  detected: boolean

  /** Immutable identity does not retain a shared current-store or current-organization slot. */
  observerBinding: Parameters<typeof createStorageObservers>[0]

  /** Bind the next domain core to its matching entry in this install batch. */
  context: IStorageNativeRegistrationContext

  /** The original PluginHost definition remains the registration and lifecycle owner. */
  definition: ReturnType<typeof readStorageNativePluginDefinition>
}
/** Storage facade over the canonical PluginHost lifecycle owner and its batch transaction. */
export class StorageHost<P extends readonly IStorageBackendPluginHandle[] = readonly []> {
  /** True once any install batch has started; journal configuration is admitted only before it. */
  #batchStarted = false
  /** Canonical PluginHost owns lifecycle and eventual mutation queue semantics. */
  readonly #inner: IStoragePluginHost
  /** Registry is swapped only after the complete inner batch has committed. */
  #registry: IStorageRegistry = new Map()
  /** Native PluginHost extension projection published only with the matching Store registry. */
  #extensions: Readonly<Record<PropertyKey, unknown>> = {}
  /** Single-flight state prevents a second feature graph from racing the first admission. */
  #state: IStorageHostState = 'open'
  /** Current batch promise, retained only while the facade is installing. */
  #installing: Promise<void> | undefined
  /** Settlement of the last queued `use` or `unUse` call; undefined while the queue is idle. */
  #queueTail: Promise<void> | undefined
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
  /** One shared subscriber owns all host, constructor and registration listener boundaries. */
  readonly #events: ReturnType<typeof createStorageHooks>
  /**
   * Unsubscribe functions for the handlers of an installed `storageProbe(handlers)`. The host owns
   * them because it subscribes before the probe's batch emits its first event.
   */
  #probeHandlerSubscriptions: (() => void)[] = []
  /**
   * Aborted once when the host starts closing. A running plugin install stops being awaited at that
   * point; PluginHost itself would wait for it to finish.
   */
  readonly #closing = createAbortController()
  /** Live borrow count per published store; `unUse` refuses a store whose count is above zero. */
  readonly #borrowCounts = new Map<IStorageBase, number>()
  /** Extension keys each installed plugin published, by plugin id, so `unUse` can withdraw them. */
  readonly #extensionKeys = new Map<string, readonly PropertyKey[]>()
  /** A non-owning reverse index resolves only committed exact stores to their existing context. */
  readonly #storeContexts = new WeakMap<
    object,
    {
      readonly context: IStorageNativeRegistrationContext
      readonly native: IStorageBase
      readonly orgId?: string
    }
  >()
  /** Installation order is retained by original contexts, without another lifecycle registry. */
  readonly #detectContexts = new Set<IStorageNativeRegistrationContext>()
  /** A successful result and every concurrent caller share the same exact detection Promise. */
  #detectPromise: Promise<void> | undefined
  /** New publications invalidate a settled cache while the running pass consumes appended entries. */
  #detectRunning = false
  /** Default organization is captured once and never stored in a shared current-call slot. */
  readonly #orgId: string
  /** Journal configuration, per-organization journal preparation and the journal port for this host. */
  readonly #journalOwner: StorageHostJournal
  /** Per-plugin install entries and the registration context each backend plugin installs through. */
  readonly #installer: StorageHostInstaller
  /**
   * Runs one install batch through PluginHost and publishes its stores, extensions and journal
   * bootstrap.
   */
  readonly #batch: StorageHostBatch
  /** Projects committed stores into borrowed backend views per organization. */
  readonly #projection: StorageHostProjection

  /** Creates the shell and snapshots lifecycle/deadline inputs before any plugin runs. */
  constructor(options: IStorageHostOptions = {}) {
    const {
      installTimeoutMs: installTimeoutOption,
      scheduler: schedulerOption,
      report,
      org,
      autoDetect
    } = options ?? {}
    this.#orgId = org === undefined ? STORAGE_DEFAULT_ORG : org
    assertOperationContext({ orgId: this.#orgId })
    if (autoDetect !== undefined && typeof autoDetect !== 'boolean')
      throw createStorageTypeError(
        StorageHostErrorCode.invalidConfig,
        StorageErrorText.invalidAutoDetect
      )
    this.#scheduler =
      schedulerOption === undefined
        ? systemScheduler
        : (snapshotScheduler(schedulerOption) ?? systemScheduler)
    /**
     * Per-plugin install deadline, enforced by PluginHost's `mutationTimeoutMs`; 0 disables it.
     * Each plugin of a batch has its own deadline (the batch no longer shares one budget).
     */
    const installTimeoutMs = installTimeoutOption ?? 30_000
    if (!Number.isFinite(installTimeoutMs) || installTimeoutMs < 0) {
      throw createStorageTypeError(
        StorageHostErrorCode.backendPluginInvalid,
        StorageErrorText.backendPluginInvalid
      )
    }
    this.#installTimeoutMs = installTimeoutMs
    this.#report = (error) => {
      if (report === undefined) {
        reportStorageUnhandledFailure(error)
        return
      }
      try {
        const result = report(error)
        if (result !== undefined) void Promise.resolve(result).catch(reportStorageUnhandledFailure)
      } catch (reporterError) {
        reportStorageUnhandledFailure(reporterError)
      }
    }

    this.#events = createStorageHooks(this.#report)
    this.#inner = createStoragePluginHost({
      pipeline: { mode: 'async' },
      execution: {
        mutationTimeoutMs: this.#installTimeoutMs === 0 ? false : this.#installTimeoutMs,
        pipelineDrainTimeoutMs: false
      },
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
    this.#journalOwner = new StorageHostJournal(this)
    this.#installer = new StorageHostInstaller(this)
    this.#batch = new StorageHostBatch(this)
    this.#projection = new StorageHostProjection(this)
  }

  /**
   * Install one atomic native plugin batch; publication happens only after complete success. An
   * overlapping call waits for the running `use`/`unUse` call; setup and timeout failures reject
   * and roll back newly owned Stores.
   */
  use<const TPlugins extends readonly IStorageBackendPluginHandle[]>(
    ...plugins: IRejectInstalledOrDuplicateIds<{ [N in P[number]['id']]: true }, TPlugins>
  ): Promise<IStorageHost<readonly [...P, ...TPlugins]>> {
    this.#assertOpen()
    return this.#enqueue(() =>
      this.#install<TPlugins>(plugins as unknown as readonly IStorageBackendPluginHandle[])
    )
  }

  /**
   * Run `use` and `unUse` calls one at a time in call order. An idle host runs the call at once, so
   * its synchronous start is unchanged; a busy host starts it after the running call settles,
   * whether that call succeeded or failed.
   */
  #enqueue<T>(work: () => Promise<T>): Promise<T> {
    const tail = this.#queueTail
    const result = tail === undefined ? work() : tail.then(work, work)
    /** The queue only orders calls; each caller still sees its own outcome. */
    const settled: Promise<void> = result.then(
      () => undefined,
      () => undefined
    )
    this.#queueTail = settled
    void settled.then(() => {
      if (this.#queueTail === settled) this.#queueTail = undefined
    })
    return result
  }

  /** Install one batch; runs only when no other `use` or `unUse` call is running. */
  #install<TPlugins extends readonly IStorageBackendPluginHandle[]>(
    plugins: readonly IStorageBackendPluginHandle[]
  ): Promise<IStorageHost<readonly [...P, ...TPlugins]>> {
    this.#assertOpen()
    this.#state = 'installing'
    /** Probe handlers of this batch, subscribed before its first lifecycle event. */
    const probeSubscriptions = this.#subscribeProbeHandlers(plugins)
    if (this.#events.hasListeners(Hook.beforeHostInstall))
      this.#events.emit(Hook.beforeHostInstall, () => ({ pluginCount: plugins.length }))
    /** Only this live batch token can publish its native install results. */
    const batchToken: IStorageBatchToken = { active: true }
    this.#activeBatchToken = batchToken
    /** Reject a cancelled or losing batch before the next publication step. */

    /** This Promise owns native installation and the one atomic store publication. */
    const batch = Promise.resolve().then(() => this.#batch.runInstallBatch(plugins, batchToken))
    this.#installing = batch
    /** Only the current batch may reopen admission and return the narrowed host. */
    const settled = batch.then(
      () => {
        this.#batch.assertBatchOwner(batchToken)
        batchToken.active = false
        this.#activeBatchToken = undefined
        if (this.#state === 'installing') this.#state = 'open'
        this.#installing = undefined
        this.#probeHandlerSubscriptions.push(...probeSubscriptions)
        if (this.#events.hasListeners(Hook.afterHostInstall))
          this.#events.emit(Hook.afterHostInstall, () => ({ pluginCount: plugins.length }))
        return this as unknown as IStorageHost<readonly [...P, ...TPlugins]>
      },
      (error: unknown) => {
        // Provisional trusted values are owned by PluginHost rollback, not by this local map.
        /** Preserve the original failure under the correct host boundary identity. */
        const primary = batchToken.active
          ? new StorageError(
              StorageHostErrorCode.backendInstallFailed,
              { cause: error },
              StorageErrorText.backendInstallFailed
            )
          : new StorageError(
              StorageHostErrorCode.storageHostDisposed,
              { cause: error },
              StorageErrorText.storageHostDisposed
            )
        batchToken.active = false
        this.#activeBatchToken = undefined
        if (this.#state === 'installing') this.#state = 'open'
        this.#installing = undefined
        if (this.#registry.size === 0) {
          /** A failed first batch leaves no backend, so its journal configuration is discarded. */
          this.#journalOwner.journal = undefined
          this.#journalOwner.journalOrgs = undefined
          this.#batchStarted = false
        }
        if (this.#events.hasListeners(Hook.onHostInstallError))
          this.#events.emit(Hook.onHostInstallError, () => ({
            pluginCount: plugins.length,
            code: primary.code
          }))
        /** The probe of a failed batch was never installed, so its handlers stop here. */
        for (const unsubscribe of probeSubscriptions) unsubscribe()
        throw primary
      }
    )
    return settled
  }

  /**
   * Remove one installed plugin by id. Its store, extension methods and probe listeners are
   * withdrawn first, then PluginHost releases its resources in reverse order. Rejects with
   * BACKEND_NOT_INSTALLED for an unknown id, BACKEND_IN_USE while another plugin borrows the
   * backend, and INVALID_CONFIG for a configured journal plugin, whose recording is bound to the
   * backends installed with it.
   */
  unUse(id: string): Promise<void> {
    try {
      this.#assertOpen()
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#enqueue(() => this.#remove(id))
  }

  /** Remove one plugin; runs only when no other `use` or `unUse` call is running. */
  async #remove(id: string): Promise<void> {
    this.#assertOpen()
    const context = [...this.#detectContexts].find((candidate) => candidate.id === id)
    if (context === undefined)
      throw new StorageError(
        StorageHostErrorCode.backendNotInstalled,
        {},
        StorageErrorText.backendNotInstalled
      )
    const store = this.#registry.get(id)
    if (store !== undefined && (this.#borrowCounts.get(store) ?? 0) > 0)
      throw new StorageError(StorageHostErrorCode.backendInUse, {}, StorageErrorText.backendInUse)
    if (id === STORAGE_JOURNAL_PLUGIN_ID && this.#journalOwner.journal !== undefined)
      throw new StorageError(
        StorageHostErrorCode.invalidConfig,
        {},
        StorageErrorText.journalPluginInUse
      )
    this.#withdrawPlugin(id, context)
    this.#state = 'installing'
    try {
      await this.#inner.unUse(pluginNameFromBackendId(id))
    } finally {
      if (this.#state === 'installing') this.#state = 'open'
    }
  }

  /** Withdraw one plugin's public publication before PluginHost releases its resources. */
  #withdrawPlugin(id: string, context: IStorageNativeRegistrationContext): void {
    const nextRegistry = new Map(this.#registry)
    nextRegistry.delete(id)
    this.#registry = nextRegistry
    this.#detectContexts.delete(context)
    const nextExtensions = Object.create(null) as Record<PropertyKey, unknown>
    const withdrawn = new Set(this.#extensionKeys.get(id) ?? [])
    for (const key of Reflect.ownKeys(this.#extensions))
      if (!withdrawn.has(key))
        Object.defineProperty(
          nextExtensions,
          key,
          Object.getOwnPropertyDescriptor(this.#extensions, key)!
        )
    this.#extensions = nextExtensions
    this.#extensionKeys.delete(id)
    if (id === STORAGE_PROBE_PLUGIN_ID) {
      for (const unsubscribe of this.#probeHandlerSubscriptions) unsubscribe()
      this.#probeHandlerSubscriptions = []
    }
    if (!this.#detectRunning) this.#detectPromise = undefined
  }

  /**
   * Subscribe the handlers of every `storageProbe(handlers)` in this batch to the host registry.
   * Runs before the batch emits `beforeHostInstall`, so the probe observes the whole batch.
   */
  #subscribeProbeHandlers(plugins: readonly IStorageBackendPluginHandle[]): (() => void)[] {
    const subscriptions: (() => void)[] = []
    for (const plugin of plugins) {
      const handlers = readStorageProbeHandlers(plugin)
      if (handlers === undefined) continue
      for (const [name, handler] of Object.entries(handlers))
        if (handler !== undefined)
          subscriptions.push(this.#events.hooks.on(name as keyof IStorageHookMap, handler as never))
    }
    return subscriptions
  }

  /** Execute original checks in installation order; failure retains no result from this pass. */
  detect(): Promise<void> {
    try {
      this.#assertOpen()
    } catch (error) {
      return Promise.reject(error)
    }
    if (this.#detectPromise !== undefined) return this.#detectPromise
    this.#detectRunning = true
    /** Only a complete pass admits its previously unchecked registrations. */
    const completed: IStorageNativeRegistrationContext[] = []
    this.#detectPromise = Promise.resolve().then(async () => {
      try {
        for (const context of this.#detectContexts) {
          if (context.isDetected()) continue
          await context.runDetect()
          completed.push(context)
        }
        this.#assertOpen()
        for (const context of completed) context.completeDetect()
        this.#detectRunning = false
      } catch (error) {
        this.#detectRunning = false
        this.#detectPromise = undefined
        throw error
      }
    })
    return this.#detectPromise
  }

  /** Resolve only an exact published store from this host, never an id-shaped foreign object. */
  #observers(store: IStorageBase | IStorageBorrowedBackend<IStorageBase>): IStorageObserverSet {
    this.#assertOpen()
    /** This index points to the original context and grants no independent lifecycle authority. */
    const row = this.#storeContexts.get(store)
    const context = row?.context
    if (context === undefined || this.#registry.get(context.id) !== context.storeCell.get())
      throw createStorageTypeError(
        StorageHostErrorCode.backendPluginInvalid,
        StorageErrorText.backendPluginInvalid
      )
    return context.getObservers(row!.native, row!.orgId)
  }
  /** Bind codec observations without changing codec execution. */
  codecStages(store: IStorageBase | IStorageBorrowedBackend<IStorageBase>) {
    return this.#observers(store).codec
  }
  /** Bind query observations without creating a query owner. */
  queryStages(store: IStorageBase | IStorageBorrowedBackend<IStorageBase>) {
    return this.#observers(store).query
  }
  /** Bind transaction observations to the canonical transaction owner. */
  transactionStages(store: IStorageBase | IStorageBorrowedBackend<IStorageBase>) {
    return this.#observers(store).transaction
  }
  /** Bind lock observations without retaining locks or policy state. */
  concurrencyStages(store: IStorageBase | IStorageBorrowedBackend<IStorageBase>) {
    return this.#observers(store).concurrency
  }
  /** Bind backend observations to this exact published registration. */
  backendStages(store: IStorageBase | IStorageBorrowedBackend<IStorageBase>) {
    return this.#observers(store).backend
  }
  /** Bind SQL observations without changing the native statement path. */
  sqlStages(store: IStorageBase | IStorageBorrowedBackend<IStorageBase>) {
    return this.#observers(store).sql
  }
  /** Bind ordinary operation observations without adding an execution runner. */
  operationStages(store: IStorageBase | IStorageBorrowedBackend<IStorageBase>) {
    return this.#observers(store).operation
  }

  /** Observe the original envelope plan with one immutable operation and target version. */
  envelopeStages(
    store: IStorageBase | IStorageBorrowedBackend<IStorageBase>,
    operation: Readonly<{ operation: string; targetVersion: number }>
  ): IStorageEnvelopeStages {
    this.#assertOpen()
    /** Lookup points to the original published registration and grants no additional authority. */
    const row = this.#storeContexts.get(store)
    const context = row?.context
    if (context === undefined || this.#registry.get(context.id) !== context.storeCell.get())
      throw createStorageTypeError(
        StorageHostErrorCode.backendPluginInvalid,
        StorageErrorText.backendPluginInvalid
      )
    return context.getEnvelopeStages(operation, row!.orgId)
  }

  /** Returns the current immutable extension plane after its corresponding batch has committed. */
  get extensions(): Readonly<Record<PropertyKey, unknown>> {
    this.#assertOpen()
    return this.#extensions
  }

  /** Project original Feature API objects from only the atomically published backend snapshot. */
  get api(): IStorageHost<P>['api'] {
    this.#assertOpen()
    /** This detached namespace grants no installation authority or new method lifetime. */
    const api = Object.create(null) as Record<string, unknown>
    for (const [id, store] of this.#registry) api[id] = 'api' in store ? store.api : undefined
    return api as IStorageHost<P>['api']
  }

  /** Internal journal consumers resolve one admitted registration without exposing the native store. */
  [storageJournalAccess](id: string): IStorageJournalBackendAccess {
    return this.#journalOwner.journalAccess(id, this.#orgId)
  }

  /**
   * Create immutable business closures; no current-organization slot or installation authority
   * exists.
   */
  org(orgId: string): IStorageOrgView<P> {
    this.#assertOpen()
    assertOperationContext({ orgId })
    /** Every lookup observes the current original committed registry and closes over this org. */
    const backend = (id: string) => {
      const store = this.backend(id as keyof IPluginStoreMap<P> & string)
      return this.#projection.projectBackend(store, orgId)
    }
    /** Original cells retain selected outputs while this getter retains only immutable org identity. */
    const projectExtensions = () => {
      this.#assertOpen()
      const result = Object.create(null)
      for (const context of this.#detectContexts)
        Object.assign(
          result,
          context.storeCell.projectExtensions(
            context.getOrgContext(orgId).callContext,
            context.assertCurrent
          )
        )
      return result
    }
    /** The view shell has no dispose, drop, installation or mutable registration methods. */
    const view = {
      [storageJournalAccess]: (id: string) => this.#journalOwner.journalAccess(id, orgId),
      orgId,
      org: (next: string) => this.org(next),
      backend,
      hasBackend: (id: string) => this.hasBackend(id),
      backends: () => {
        this.#assertOpen()
        return new Map([...this.#registry.keys()].map((id) => [id, backend(id)]))
      },
      detect: () => this.detect(),
      get api() {
        const result = Object.create(null)
        for (const [id, store] of view.backends())
          result[id] = 'api' in store ? store.api : undefined
        return result
      },
      get extensions() {
        return projectExtensions()
      },
      codecStages: (store: IStorageBase | IStorageBorrowedBackend<IStorageBase>) =>
        this.codecStages(store),
      queryStages: (store: IStorageBase | IStorageBorrowedBackend<IStorageBase>) =>
        this.queryStages(store),
      transactionStages: (store: IStorageBase | IStorageBorrowedBackend<IStorageBase>) =>
        this.transactionStages(store),
      concurrencyStages: (store: IStorageBase | IStorageBorrowedBackend<IStorageBase>) =>
        this.concurrencyStages(store),
      backendStages: (store: IStorageBase | IStorageBorrowedBackend<IStorageBase>) =>
        this.backendStages(store),
      sqlStages: (store: IStorageBase | IStorageBorrowedBackend<IStorageBase>) =>
        this.sqlStages(store),
      operationStages: (store: IStorageBase | IStorageBorrowedBackend<IStorageBase>) =>
        this.operationStages(store),
      envelopeStages: (
        store: IStorageBase | IStorageBorrowedBackend<IStorageBase>,
        operation: Readonly<{ operation: string; targetVersion: number }>
      ) => this.envelopeStages(store, operation)
    }
    return view as unknown as IStorageOrgView<P>
  }

  /** Attempt every native target independently and retain every original deletion failure. */
  async dropOrg(orgId: string): Promise<void> {
    this.#assertOpen()
    assertOperationContext({ orgId })
    const failures: unknown[] = []
    for (const store of this.#registry.values()) {
      const context = this.#storeContexts.get(store)!.context
      try {
        context.assertExecution()
        await context.storeCell.dropOrg(orgId)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length !== 0)
      throw createStorageAggregateError(
        StorageHostErrorCode.orgDeleteFailed,
        StorageErrorText.orgDeleteFailed,
        failures
      )
  }

  /** Looks up an exact store from the last atomically published registry snapshot. */
  backend<TId extends keyof IPluginStoreMap<P> & string>(id: TId): IPluginStoreMap<P>[TId] {
    this.#assertOpen()
    /** Use the original admitted backend object instead of creating a replacement. */
    const store = this.#registry.get(id)
    if (store === undefined)
      throw new StorageError(
        StorageHostErrorCode.backendNotInstalled,
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
    /** Publish the stable cleanup result before any observer can reenter this method. */
    const completion = Promise.withResolvers<void>()
    this.#disposePromise = completion.promise
    /** Close observations retain the count captured before public membership is cleared. */
    const backendCount = this.#registry.size
    this.#state = 'closing'
    if (this.#events.hasListeners(Hook.beforeHostClose))
      this.#events.emit(Hook.beforeHostClose, () => ({ backendCount }))
    if (this.#activeBatchToken !== undefined) {
      /** Only this live batch token can publish its native install results. */
      // Closing stops the running install from being awaited and from publishing.
      this.#activeBatchToken.active = false
      this.#activeBatchToken = undefined
      try {
        this.#closing.abort(
          new StorageError(
            StorageHostErrorCode.storageHostDisposed,
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
    this.#detectContexts.clear()
    this.#extensions = {}
    void mergeCleanupResults([this.#inner.dispose()])
      .then(({ cleanupErrors }) => {
        if (cleanupErrors.length !== 0) {
          if (this.#events.hasListeners(Hook.onHostCloseError))
            this.#events.emit(Hook.onHostCloseError, () => ({
              backendCount,
              code: StorageHostErrorCode.storageHostDisposeFailed
            }))
          throw createStorageAggregateError(
            StorageHostErrorCode.storageHostDisposeFailed,
            StorageErrorText.storageHostDisposeFailed,
            cleanupErrors
          )
        }
        if (this.#events.hasListeners(Hook.afterHostClose))
          this.#events.emit(Hook.afterHostClose, () => ({ backendCount }))
      })
      .finally(() => {
        this.#state = 'closed'
        this.#journalOwner.journalOrgs?.clear()
        this.#journalOwner.journalOrgs = undefined
        this.#events.clear()
      })
      .then(completion.resolve, completion.reject)
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
        StorageHostErrorCode.storageHostDisposed,
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
      await snapshot.store.dispose()
    } catch (error) {
      this.#report(error)
    }
  }

  /** Install owner port: project one committed backend for an organization. */
  get projectBackend(): (
    store: IStorageBase,
    orgId: string
  ) => ReturnType<typeof borrowStorageBackend> {
    return (store, orgId) => this.#projection.projectBackend(store, orgId)
  }
  /** Install owner port: dispose a store whose install lost its batch. */
  get disposeLateStore(): (
    snapshot: Extract<IStorageBaseAdmission, { readonly valid: true }>
  ) => Promise<void> {
    return (snapshot) => this.#disposeLateStore(snapshot)
  }
  /** Install owner port: the current lifecycle state. */
  get state(): IStorageHostState {
    return this.#state
  }
  /** Install owner port: the canonical PluginHost. */
  get inner(): IStoragePluginHost {
    return this.#inner
  }
  /** Install owner port: aborted once when the host starts closing. */
  get closing() {
    return this.#closing
  }
  /** Install owner port: the token of the batch currently allowed to publish. */
  get activeBatchToken(): IStorageBatchToken | undefined {
    return this.#activeBatchToken
  }
  /** Install owner port: live borrow counts per published store. */
  get borrowCounts(): Map<IStorageBase, number> {
    return this.#borrowCounts
  }
  /** Install owner port: the journal owner. */
  get journalOwner(): StorageHostJournal {
    return this.#journalOwner
  }
  /** Batch owner port: the committed registry, replaced only after a whole batch commits. */
  set registry(value: IStorageRegistry) {
    this.#registry = value
  }
  /** Batch owner port: extensions published with the matching registry, without the open check. */
  get publishedExtensions(): Readonly<Record<PropertyKey, unknown>> {
    return this.#extensions
  }
  /** Batch owner port: replace the published extensions together with the registry. */
  set publishedExtensions(value: Readonly<Record<PropertyKey, unknown>>) {
    this.#extensions = value
  }
  /** Batch owner port: extension keys each installed plugin published, by plugin id. */
  get extensionKeys(): Map<string, readonly PropertyKey[]> {
    return this.#extensionKeys
  }
  /** Batch owner port: registration contexts in installation order, for detection. */
  get detectContexts(): Set<IStorageNativeRegistrationContext> {
    return this.#detectContexts
  }
  /** Batch owner port: whether a detection pass is running. */
  get detectRunning(): boolean {
    return this.#detectRunning
  }
  /** Batch owner port: the shared detection Promise. */
  get detectPromise(): Promise<void> | undefined {
    return this.#detectPromise
  }
  /** Batch owner port: a new publication invalidates a settled detection result. */
  set detectPromise(value: Promise<void> | undefined) {
    this.#detectPromise = value
  }
  /** Batch owner port: the installer that builds per-plugin install entries. */
  get installer(): StorageHostInstaller {
    return this.#installer
  }
  /** Journal owner port: reject work after the host started closing. */
  get assertOpen(): () => void {
    return () => this.#assertOpen()
  }
  /** Journal owner port: whether any install batch has started. */
  get batchStarted(): boolean {
    return this.#batchStarted
  }
  /** Journal owner port: the journal marks the first batch as started when it admits configuration. */
  set batchStarted(value: boolean) {
    this.#batchStarted = value
  }
  /** Journal owner port: the host's one event subscriber. */
  get events(): ReturnType<typeof createStorageHooks> {
    return this.#events
  }
  /** Journal owner port: the default organization captured at construction. */
  get orgId(): string {
    return this.#orgId
  }
  /** Journal owner port: the committed backend registry. */
  get registry(): IStorageRegistry {
    return this.#registry
  }
  /** Journal owner port: the caller's diagnostic reporter. */
  get report(): (error: unknown) => void {
    return this.#report
  }
  /** Journal owner port: the scheduler shared with PluginHost. */
  get scheduler(): IScheduler {
    return this.#scheduler
  }
  /** Journal owner port: committed store contexts by store object. */
  get storeContexts() {
    return this.#storeContexts
  }
}

/**
 * Create a Host and atomically install the optional initial plugin tuple. Defaults to no backends
 * and a 30000 ms install budget. Browser storage is acquired only by selected backend plugins;
 * failed initial installation disposes its newly created facade before rejecting. A
 * `storageJournalPlugin(options)` in the tuple adds journal recording, and `undo` when its logger
 * selects the undo extension.
 */
export async function createStorageHost<
  const TPlugins extends readonly IStorageBackendPluginHandle[] = readonly []
>(options?: IStorageHostCreateOptions<TPlugins>): Promise<IStorageHost<TPlugins>> {
  /** Constructor options are consumed synchronously before plugin installation can yield. */
  const facade = new StorageHost(options)
  /** Rest arguments detach the initial plugin list before installation begins. */
  const plugins = options?.plugins
  /** Detection selection must remain stable while native installation awaits. */
  const autoDetect = options?.autoDetect
  try {
    if (plugins !== undefined && plugins.length > 0) await facade.use(...(plugins as TPlugins))
    if (autoDetect !== false) await facade.detect()
    return facade as unknown as IStorageHost<TPlugins>
  } catch (error) {
    try {
      await facade.dispose()
    } catch (cleanupError) {
      throw createStorageAggregateError(
        StorageHostErrorCode.backendInstallFailed,
        StorageErrorText.backendInstallFailed,
        [error, cleanupError]
      )
    }
    throw error
  }
}
