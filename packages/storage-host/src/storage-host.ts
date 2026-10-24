import { isStorageErrorFamily } from './core/error-family.js'
import {
  createStorageHooks,
  readStorageHookFailureCode,
  type IStorageHookEmitter
} from './hooks.js'
import type { IStorageHooks } from './hook-types.js'
import { createStorageObservers, type IStorageObserverSet } from './stages.js'
import { createBackendRevisionPort } from './backends/revisions.js'
import { createStorageEnvelopeStages } from './envelope-stages.js'
import {
  registerBackendChangeController,
  registerBackendEnvelopeStages,
  registerBackendValueCommit,
  getBackendChangeController,
  registerBackendEntityAccess,
  type IBackendChangeController
} from './core/backend-registry.js'
import { StorageHookName as Hook } from './hook-names.js'
import { borrowStorageBackend } from './borrow.js'
import { createBackendKeyLockPort } from './backends/key-locks.js'
import { STORAGE_DEFAULT_ORG, STORAGE_JOURNAL_BOOTSTRAP_PREFIX } from './state-constants.js'
import type { IBackendStageBindings } from '@migaia/storage-contract'
import {
  defineHost,
  definePlugin as defineNativePlugin,
  asyncDisposeKey,
  PluginHostErrorCode,
  getPluginRuntimeIntegration,
  type IHostHandle,
  type IPluginHostOptions,
  type IPlugin,
  type IPluginConstraint,
  type IPluginHostCore
} from '@migaia/plugin-host'
import { createAbortController, snapshotScheduler, mergeCleanupResults } from '@migaia/lifecycle'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { snapshotStorageBaseDetailed } from './authoring/store.js'
import {
  assertOperationContext,
  StorageContractError,
  StorageContractErrorCode
} from '@migaia/storage-contract'
import { withTimeout, type INativeAbortSignal } from '@migaia/utils/promise'
import { observeThenableRejection } from '@migaia/utils/function'
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
  IStorageBackendKind,
  IStoragePluginCore,
  IStorageEnvelopeStages,
  IStorageOrgView,
  IStorageBackendOrgContext,
  IStoragePluginCallContext,
  IStorageBorrowedBackend
} from './types.js'
import { storageJournalAccess, type IStorageJournalBackendAccess } from './journal/binding.js'
import {
  snapshotStorageJournalConfiguration,
  type IStorageJournalConfigurationSnapshot
} from './journal/configuration-options.js'
import type { IStorageJournalConfiguration, IStorageJournalExecutionPort } from './journal/types.js'
import type { IStorageJournalRuntime } from './journal/loader.js'
import type { prepareStorageJournalConfiguration } from './journal/configuration.js'

/** Deliver final reporter failures through the existing utility host exception boundary. */
function reportStorageUnhandledFailure(error: unknown): void {
  observeThenableRejection(undefined, { error }, (failure) => {
    throw failure
  })
}

/** Minimal PluginHost domain core; storage materializers do not expose host mutation to plugins. */
type IStorageHostCore = object

/** Narrow lifecycle core required by a backend materializer. */
type IStorageInstallCore = Pick<
  IPluginHostCore<IStoragePipelineInput>,
  'onDispose' | 'operation' | 'config' | 'lifecycle'
>

/** A check retains only its original callback and currently running work for lifecycle draining. */
type IStorageDetectCheck = {
  readonly check: (signal: INativeAbortSignal) => Promise<void>
  pending?: Promise<void>
}

/** One native registration's single-assignment store bridge into its PluginHost core. */
type IStorageNativeRegistrationContext = {
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
type IStoragePluginHost = IHostHandle<IStorageHostCore, IStoragePipelineInput, readonly []> &
  Readonly<{
    setNativeContexts(
      contexts: Array<IStorageNativeRegistrationContext | undefined>,
      expectedEntries: number
    ): void
  }>

/** One native registration retains only its install core and original construction context. */
type IStorageRegistrationAssembly = {
  /** The native batch entry owns store, org and stage authority. */
  readonly context: IStorageNativeRegistrationContext
  /** The canonical PluginHost owns the existing pipeline and resource scope. */
  readonly host: IHostHandle<IStorageHostCore, IStoragePipelineInput, readonly []>
  /** Installation supplies this core before invoking registration callbacks. */
  registrationCore: IStorageInstallCore | undefined
}
/** Assemble native ports without creating another install or resource owner. */
function createStorageRegistrationCore(registration: IStorageRegistrationAssembly): object {
  /** Ports borrow the same original context and PluginHost. */
  const { context } = registration
  return {
    setStorageRegistrationCore: (core: IStorageInstallCore) => {
      registration.registrationCore = core
      context.setRegistrationCore(core)
    },
    getStore: context.storeCell.get,
    registerJournalRuntime: context.registerJournalRuntime,
    journal: context.getJournal(context.defaultOrgId),
    setStorageFeatureProjection: context.storeCell.setFeatureProjection,
    getStorageFeatureClientResolver: context.storeCell.getFeatureClientResolver,
    setStorageJournalBinding: (
      binding: import('./journal/types.js').IStorageJournalBackendBinding
    ) => {
      /** Admission remains inside the original registration's installation window. */
      registration.registrationCore!.onDispose(context.storeCell.releaseJournalResources)
      context.storeCell.setJournalBinding(binding)
    },
    createTransactionApi: context.storeCell.createTransactionApi,
    getChainMethods: context.storeCell.getChainMethods,
    getOrgContext: context.getOrgContext,
    captureStorageExtension: (key: PropertyKey, value: unknown, receiver: object) => {
      /** The native descriptor reader captures each original source value exactly once. */
      context.storeCell.captureExtension(key, value, receiver)
      return context.storeCell.projectExtension(
        key,
        context.getOrgContext(context.defaultOrgId).callContext,
        context.assertCurrent
      )
    },
    getBackendId: () => context.id,
    defaultOrgId: context.defaultOrgId,
    getScheduler: () => context.scheduler,
    getStageBindings: context.getStageBindings,
    ...createStorageNativeAuthoringPorts(registration),
    ...createStorageExecutionPorts(registration)
  }
}
/** Own the native batch bridge while delegating lifecycle and pipelines to PluginHost. */
class StoragePluginHostAssembly {
  /** One bridge slot belongs to each entry in the active native install batch. */
  #nativeContexts: Array<IStorageNativeRegistrationContext | undefined> = []
  /** Each domain core consumes its matching slot exactly once. */
  #contextIndex = 0
  /** The canonical managed host owns installation, resources and pipeline execution. */
  #host: IHostHandle<IStorageHostCore, IStoragePipelineInput, readonly []>
  /** Allocate only the batch bridge; PluginHost retains the full managed lifecycle. */
  constructor(options: IPluginHostOptions) {
    this.#host = defineHost<IStorageHostCore, IStoragePipelineInput>({
      host: options,
      domainCore: () => this.#createDomainCore()
    })
  }
  /** Materialize native ports only for the matching batch entry. */
  #createDomainCore(): object {
    /** The next entry may deliberately have no storage bridge. */
    const context = this.#nativeContexts[this.#contextIndex++]
    if (context === undefined) return {}
    return createStorageRegistrationCore({ context, host: this.#host, registrationCore: undefined })
  }
  /** Require a complete registration-order bridge before PluginHost starts the batch. */
  #setNativeContexts(
    contexts: Array<IStorageNativeRegistrationContext | undefined>,
    expectedEntries: number
  ): void {
    if (contexts.length !== expectedEntries)
      throw new StorageError(
        StorageErrorCode.backendPluginInvalid,
        {},
        StorageErrorText.backendPluginInvalid
      )
    this.#nativeContexts = contexts
    this.#contextIndex = 0
  }
  /** Publish original managed host ports together with native batch configuration. */
  construct(): IStoragePluginHost {
    return {
      ...this.#host,
      setNativeContexts: (contexts, expectedEntries) =>
        this.#setNativeContexts(contexts, expectedEntries)
    } as IStoragePluginHost
  }
}
/** Create the storage bridge around one canonical managed PluginHost. */
export function createStoragePluginHost(options: IPluginHostOptions): IStoragePluginHost {
  return new StoragePluginHostAssembly(options).construct()
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

/** One install batch shares only journal-preparation authority and its ordered registration bridge. */
type IStorageInstallBatchContext = {
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
type IStorageInstallEntryResult = {
  readonly plugin: IPlugin<IStorageInstallCore, Record<string, unknown>>
  readonly storeCell: IStorageStoreCell
}
/** One original registration owns its store handoff, dependency borrows and native context ports. */
type IStorageInstallEntryContext = {
  /** Original installState is captured before native construction begins. */
  readonly installState: IStorageInstallBatchContext
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

  /** A late installation cannot regain authority after its deadline. */
  installExpired: boolean

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
export class StorageHostFacade<P extends readonly IStorageBackendPluginHandle[] = readonly []> {
  /** One original facade owns immutable org preparation data, never another backend registry. */
  readonly #journal:
    | IStorageJournalConfigurationSnapshot
    | Extract<IStorageJournalConfiguration, Function>
    | undefined
  /** Resolved optional code is reused directly inside native transaction activity windows. */
  #journalRuntime: IStorageJournalRuntime | undefined
  /**
   * Concurrent first endpoints share one exact initializer and per-registration preparation
   * Promise.
   */
  #journalOrgs:
    | Map<
        string,
        {
          readonly options: Promise<IStorageJournalConfigurationSnapshot>
          configuration?: IStorageJournalConfigurationSnapshot
          readonly backends: Map<
            IStorageStoreCell,
            {
              readonly promise: Promise<void>
              value?: Awaited<ReturnType<typeof prepareStorageJournalConfiguration>>
              complete: boolean
            }
          >
        }
      >
    | undefined
  /** The original successful bootstrap owns one async stage and its canonical sync-entry guard. */
  #journalPipelineInstalled = false
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
  /** Saved public listener ports continue to enforce the existing host admission boundary. */
  readonly #publicHooks: IStorageHooks
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

  /** Creates the shell and snapshots lifecycle/deadline inputs before any plugin runs. */
  constructor(options: IStorageHostOptions = {}) {
    const {
      installTimeoutMs: installTimeoutOption,
      scheduler: schedulerOption,
      report,
      hooks,
      org,
      autoDetect,
      journal
    } = options ?? {}
    this.#journal =
      typeof journal === 'function' || journal === undefined
        ? journal
        : snapshotStorageJournalConfiguration(journal)
    this.#orgId = org === undefined ? STORAGE_DEFAULT_ORG : org
    assertOperationContext({ orgId: this.#orgId })
    if (autoDetect !== undefined && typeof autoDetect !== 'boolean')
      throw createStorageTypeError(
        StorageErrorCode.invalidConfig,
        StorageErrorText.invalidAutoDetect
      )
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
    this.#publicHooks = {
      on: (name, handler) => {
        this.#assertOpen()
        return this.#events.hooks.on(name, handler)
      }
    }
    if (hooks !== undefined) {
      if (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks))
        throw createStorageTypeError(StorageErrorCode.invalidConfig, StorageErrorText.invalidHooks)
      /** Capture declared ordinary handlers before acquiring any listener registration. */
      const hookEntries = Object.entries(hooks)
      for (const [name, handler] of hookEntries) {
        if (handler !== undefined)
          this.#events.hooks.on(name as keyof typeof hooks, handler as never)
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
    if (this.#events.hasListeners(Hook.beforeHostInstall))
      this.#events.emit(Hook.beforeHostInstall, () => ({ pluginCount: plugins.length }))
    /** Only this live batch token can publish its native install results. */
    const batchToken: IStorageBatchToken = {
      controller: createAbortController(),
      startedAt: this.#scheduler.now(),
      active: true
    }
    this.#activeBatchToken = batchToken
    /** Reject a cancelled or losing batch before the next publication step. */

    /** This Promise owns native installation and the one atomic store publication. */
    const batch = Promise.resolve().then(() => this.#runInstallBatch(plugins, batchToken))
    this.#installing = batch
    /** Only the current batch may reopen admission and return the narrowed host. */
    const settled = batch.then(
      () => {
        this.#assertBatchOwner(batchToken)
        batchToken.active = false
        this.#activeBatchToken = undefined
        if (this.#state === 'installing') this.#state = 'open'
        this.#installing = undefined
        if (this.#events.hasListeners(Hook.afterHostInstall))
          this.#events.emit(Hook.afterHostInstall, () => ({ pluginCount: plugins.length }))
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
        if (this.#events.hasListeners(Hook.onHostInstallError))
          this.#events.emit(Hook.onHostInstallError, () => ({
            pluginCount: plugins.length,
            code: primary.code
          }))
        throw primary
      }
    )
    return settled
  }

  /** Public listener registration shares the same subscriber used by every backend stage. */
  get hooks(): IStorageHooks {
    this.#assertOpen()
    return this.#publicHooks
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
        StorageErrorCode.backendPluginInvalid,
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
        StorageErrorCode.backendPluginInvalid,
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
    return this.#journalAccess(id, this.#orgId)
  }

  /**
   * Fixed-org access borrows only original private I/O and the registration's resource release
   * hook.
   */
  #journalAccess(id: string, orgId: string): IStorageJournalBackendAccess {
    this.#assertOpen()
    this.#requireJournalRuntime()
    const store = this.#registry.get(id)
    if (store === undefined)
      throw new StorageError(
        StorageErrorCode.backendNotInstalled,
        {},
        StorageErrorText.backendNotInstalled
      )
    const context = this.#storeContexts.get(store)!.context
    return this.#journalContextAccess(context, orgId)
  }

  /** Candidate bootstrap and published lookups consume the same exact original registration facts. */
  #journalContextAccess(
    context: IStorageNativeRegistrationContext,
    orgId: string
  ): IStorageJournalBackendAccess {
    this.#assertOpen()
    context.assertExecution()
    const binding = context.storeCell.journalForOrg(orgId)
    return {
      registration: context.storeCell.journalIdentity,
      orgId,
      backendInstanceId: context.id,
      binding,
      retain: (resource: import('@migaia/storage-contract').IStorageResource) => {
        this.#assertOpen()
        context.assertExecution()
        return context.storeCell.retainJournalResource(resource)
      }
    }
  }

  /** Require the explicitly installed journal plugin before invoking optional journal code. */
  #requireJournalRuntime(): IStorageJournalRuntime {
    if (this.#journalRuntime === undefined)
      throw new StorageError(
        StorageErrorCode.journalNotAssembled,
        {},
        StorageErrorText.journalNotAssembled
      )
    return this.#journalRuntime
  }

  /** Both native installs and the final bootstrap consume the same original batch deadline. */
  #awaitInstall<T>(pending: Promise<T>, token: IStorageBatchToken, elapsed: number): Promise<T> {
    return withTimeout(() => pending, {
      timeoutMs: Math.max(0, this.#installTimeoutMs - elapsed),
      signals: [token.controller.signal],
      scheduler: this.#scheduler,
      report: (error) => this.#report(error),
      zeroTimeoutBehavior: 'skip'
    })
  }

  /** One original org cell shares the initializer Promise without opening stores in org(). */
  #journalOptions(orgId: string, candidates?: readonly IStorageNativeRegistrationContext[]) {
    this.#assertOpen()
    const existing = this.#journalOrgs?.get(orgId)
    if (existing !== undefined) return existing.options
    const source = this.#journal!
    const options = Promise.resolve().then(async () => {
      this.#assertOpen()
      if (typeof source !== 'function') {
        this.#journalOrgs!.get(orgId)!.configuration = source
        return source
      }
      /** Load optional logging only when this organization initializes its journal. */
      const runtime = this.#requireJournalRuntime()
      this.#journalRuntime = runtime
      const configured = await source({
        orgId,
        storageLogStore: (id: string, options: { readonly prefix: string }) => {
          this.#assertOpen()
          const candidate = candidates?.find(
            (context) => context.id === id && context.getKind() !== undefined
          )
          const published = this.#registry.get(id)
          const context =
            candidate ??
            (published === undefined ? undefined : this.#storeContexts.get(published)?.context)
          if (context === undefined)
            throw new StorageError(
              StorageErrorCode.backendNotInstalled,
              {},
              StorageErrorText.backendNotInstalled
            )
          return runtime.openStorageLogStore(
            this.#journalContextAccess(context, orgId),
            runtime.snapshotStorageLogPrefix(options)
          )
        }
      })
      this.#assertOpen()
      const snapshot = snapshotStorageJournalConfiguration(configured)
      this.#journalOrgs!.get(orgId)!.configuration = snapshot
      return snapshot
    })
    ;(this.#journalOrgs ??= new Map()).set(orgId, { options, backends: new Map() })
    return options
  }

  /** Each original backend cell prepares once under its org's already fixed configuration. */
  #prepareJournalBackend(
    context: IStorageNativeRegistrationContext,
    orgId: string,
    candidates?: readonly IStorageNativeRegistrationContext[]
  ) {
    context.assertExecution()
    const options = this.#journalOptions(orgId, candidates)
    const backends = this.#journalOrgs!.get(orgId)!.backends
    const existing = backends.get(context.storeCell)
    if (existing !== undefined) return existing
    let entry!: {
      readonly promise: Promise<void>
      value?: Awaited<ReturnType<typeof prepareStorageJournalConfiguration>>
      complete: boolean
    }
    const promise = options.then(async (configured) => {
      context.assertExecution()
      if (configured.logger.undo !== undefined) {
        /** Only the original physical backend may publish its undo endpoint; frozen bases stay raw. */
        let undo: unknown
        try {
          undo = Reflect.get(context.storeCell.forOrg(orgId, this.#orgId), 'undo')
        } catch (cause) {
          if (isStorageErrorFamily(cause)) throw cause
          throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
        }
        if (typeof undo !== 'function')
          throw new StorageContractError(StorageContractErrorCode.unsupported)
      }
      /** Load optional code before preparing the native journal transaction resources. */
      const runtime = this.#requireJournalRuntime()
      this.#journalRuntime = runtime
      entry.value = await runtime.prepareStorageJournalConfiguration(
        configured,
        this.#journalContextAccess(context, orgId),
        context.storeCell.get().backend,
        {
          report: this.#report,
          onBinlogAppendError: (txId, error) => {
            this.#report(error)
            this.#events.emit(Hook.onBinlogAppendError, () => ({
              backendId: context.id,
              backend: context.storeCell.get().backend,
              orgId,
              namespace: configured.namespace,
              backendInstanceId: context.id,
              txId,
              code: readStorageHookFailureCode(error, this.#report)
            }))
          },
          beforeRecover: () =>
            this.#events.emit(Hook.beforeJournalRecover, () => ({
              backendId: context.id,
              backend: context.storeCell.get().backend,
              orgId,
              namespace: configured.namespace,
              backendInstanceId: context.id
            })),
          afterRecover: (count, elapsedMs) =>
            this.#events.emit(Hook.afterJournalRecover, () => ({
              backendId: context.id,
              backend: context.storeCell.get().backend,
              orgId,
              namespace: configured.namespace,
              backendInstanceId: context.id,
              count,
              elapsedMs
            })),
          onRecoverError: (error) =>
            this.#events.emit(Hook.onJournalRecoverError, () => ({
              backendId: context.id,
              backend: context.storeCell.get().backend,
              orgId,
              namespace: configured.namespace,
              backendInstanceId: context.id,
              code: readStorageHookFailureCode(error, this.#report)
            }))
        }
      )
      entry.complete = true
    })
    entry = { promise, complete: false }
    backends.set(context.storeCell, entry)
    return entry
  }

  /** Backend authors receive only fixed-org preparation, initial locks and original-scope recording. */
  #journalPort(
    context: IStorageNativeRegistrationContext,
    orgId: string
  ): IStorageJournalExecutionPort | undefined {
    if (this.#journal === undefined) return undefined
    const prepared = () => {
      context.assertExecution()
      const entry = this.#journalOrgs?.get(orgId)?.backends.get(context.storeCell)
      if (!entry?.complete) throw new StorageContractError(StorageContractErrorCode.unsupported)
      return entry.value
    }
    return {
      prepare: () => this.#prepareJournalBackend(context, orgId).promise,
      runRedo: (run, signal) => {
        const value = prepared()
        if (value === undefined || !('runRedo' in value))
          return Promise.reject(new StorageContractError(StorageContractErrorCode.unsupported))
        return value.runRedo(run, signal)
      },
      beginRedo: (scope) => {
        const value = prepared()
        if (value === undefined || !('runRedo' in value)) return undefined
        return value.begin(scope)
      },
      active: () => prepared() !== undefined,
      headLocks: () => prepared()?.headLocks ?? [],
      begin: (scope: Omit<import('@migaia/storage-contract').ITransactionScope, 'use'>) =>
        prepared()?.begin(scope),
      undo: (txId, run) => {
        const undo = prepared()?.undo
        if (undo === undefined)
          return Promise.reject(new StorageContractError(StorageContractErrorCode.unsupported))
        return undo(txId, run)
      }
    }
  }

  /** Observe prepared operations synchronously so native I/O starts in its original active task. */
  #observeJournalExecution<R>(
    orgId: string,
    describe: () => IStoragePipelineInput,
    invoke: (observing: boolean) => Promise<R>
  ): Promise<R> {
    /** The initial install path may observe before preparation loads the optional module. */
    const observe = (runtime: IStorageJournalRuntime) =>
      runtime.observeStorageTelemetry(
        () => this.#journalOrgs?.get(orgId)?.configuration,
        describe,
        invoke,
        () => this.#scheduler.now(),
        this.#report
      )
    return observe(this.#requireJournalRuntime())
  }

  /** Resolve native organization data through its original registration, then remove ownership. */
  #projectBackend(store: IStorageBase, orgId: string): ReturnType<typeof borrowStorageBackend> {
    this.#assertOpen()
    const context = this.#storeContexts.get(store)?.context
    if (context === undefined)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    context.assertExecution()
    return context.storeCell.projectOrgBackend(orgId, () => {
      const native = context.storeCell.forOrg(orgId, this.#orgId)
      /** The original base admission also governs a custom backend's newly exposed physical view. */
      const snapshot = snapshotStorageBaseDetailed(native, { asyncDisposeKey })
      if (!snapshot.valid)
        throw createStorageTypeError(
          StorageErrorCode.backendPluginInvalid,
          StorageErrorText.backendPluginInvalid,
          snapshot.cause
        )
      if (snapshot.backend !== context.getKind()?.name)
        throw createStorageTypeError(
          StorageErrorCode.backendKindMismatch,
          StorageErrorText.backendKindMismatch
        )
      const ports = context.getOrgContext(orgId)
      const api = context.storeCell.createOrgApi(native, ports.callContext, ports.execution)
      const view = borrowStorageBackend(
        native,
        () => {
          this.#assertOpen()
          context.assertExecution()
        },
        { orgId, ...(api === undefined ? {} : { api }) }
      )
      this.#storeContexts.set(view, { context, native, orgId })
      /** Entity borrows the same controller, filtered through this immutable organization boundary. */
      const controller = getBackendChangeController(native) ?? getBackendChangeController(store)
      if (controller !== undefined) {
        const projectedController: IBackendChangeController = {
          ...controller,
          publish: (change) => controller.publish({ ...change, orgId }),
          subscribe: (listener) =>
            controller.subscribe((change) => {
              if (change.orgId === orgId) return listener(change)
            })
        }
        context.storeCell.retainOrgBinding(
          registerBackendChangeController(view, projectedController)
        )
      }
      context.storeCell.retainOrgBinding(
        registerBackendEnvelopeStages(
          view,
          (operation) => context.getEnvelopeStages(operation, orgId),
          () => context.storeCell.getChainMethods('query')
        )
      )
      context.storeCell.retainOrgBinding(
        registerBackendEntityAccess(view, native, () => {
          this.#assertOpen()
          context.assertExecution()
        })
      )
      return view
    }) as ReturnType<typeof borrowStorageBackend>
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
      return this.#projectBackend(store, orgId)
    }
    /** Root hooks retain one subscriber; each view filters invocation identities at delivery. */
    const hooks: IStorageHooks = {
      on: (name, handler) => {
        this.#assertOpen()
        return this.#events.hooks.on(name, (payload) => {
          if ('orgId' in payload && payload.orgId === orgId) handler(payload)
        })
      }
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
      [storageJournalAccess]: (id: string) => this.#journalAccess(id, orgId),
      orgId,
      org: (next: string) => this.org(next),
      backend,
      hasBackend: (id: string) => this.hasBackend(id),
      backends: () => {
        this.#assertOpen()
        return new Map([...this.#registry.keys()].map((id) => [id, backend(id)]))
      },
      detect: () => this.detect(),
      hooks,
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
        StorageErrorCode.orgDeleteFailed,
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
    this.#detectContexts.clear()
    this.#extensions = {}
    void mergeCleanupResults([this.#inner.dispose()])
      .then(({ cleanupErrors }) => {
        if (cleanupErrors.length !== 0) {
          if (this.#events.hasListeners(Hook.onHostCloseError))
            this.#events.emit(Hook.onHostCloseError, () => ({
              backendCount,
              code: StorageErrorCode.storageHostDisposeFailed
            }))
          throw createStorageAggregateError(
            StorageErrorCode.storageHostDisposeFailed,
            StorageErrorText.storageHostDisposeFailed,
            cleanupErrors
          )
        }
        if (this.#events.hasListeners(Hook.afterHostClose))
          this.#events.emit(Hook.afterHostClose, () => ({ backendCount }))
      })
      .finally(() => {
        this.#state = 'closed'
        this.#journalOrgs?.clear()
        this.#journalOrgs = undefined
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
      await snapshot.store.dispose()
    } catch (error) {
      this.#report(error)
    }
  }

  /** Reject a cancelled or losing batch before the next publication step. */
  #assertBatchOwner(batchToken: IStorageBatchToken): void {
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
  /** Install one native batch using the canonical PluginHost transaction and existing deadline. */
  async #runInstallBatch(
    plugins: readonly IStorageBackendPluginHandle[],
    batchToken: IStorageBatchToken
  ): Promise<void> {
    this.#assertBatchOwner(batchToken)
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
    this.#assertBatchOwner(batchToken)
    /** Only the final original batch preparation admits already completed candidate reads. */
    const installState = { batchToken, preparingJournal: false } as IStorageInstallBatchContext
    /** Each batch entry retains exactly one original store handoff. */
    installState.nativeContexts = new Map<number, IStorageNativeRegistrationContext>()
    /** Materialize original definitions in the same order as native registration. */
    const entries = plugins.map((plugin, index) =>
      this.#createInstallEntry(installState, plugin, nativeMetadata[index]!, index)
    )
    /** Pass only the original definitions to the canonical install batch. */
    const materialized = entries.map((entry) => entry.plugin)
    /** A final original registration prepares candidates before the atomic public registry swap. */
    installState.installedJournalPipeline = false
    const candidates = [...installState.nativeContexts.values()]
    if (
      this.#journal !== undefined &&
      (candidates.length !== 0 || !this.#journalOrgs?.has(this.#orgId))
    ) {
      materialized.push(
        defineNativePlugin(
          STORAGE_JOURNAL_BOOTSTRAP_PREFIX + (nativeMetadata[0]?.id ?? this.#orgId),
          (core) => ({
            install: () => this.#installJournalBootstrap(installState, candidates, core)
          })
        ) as (typeof materialized)[number]
      )
    }
    this.#inner.setNativeContexts(
      materialized.map((_, index) => installState.nativeContexts.get(index)),
      materialized.length
    )
    /** Committed native handles retain their original guarded extension methods. */
    const innerHandles = await this.#inner.use(
      ...(materialized as IPluginConstraint<IStorageHostCore>[])
    )
    this.#assertBatchOwner(batchToken)
    if (installState.installedJournalPipeline) this.#journalPipelineInstalled = true
    this.#publishInstallBatch(plugins, installState, entries, innerHandles)
  }

  /** Atomically publish the native handles only after the original PluginHost batch commits. */
  #publishInstallBatch(
    plugins: readonly IStorageBackendPluginHandle[],
    installState: IStorageInstallBatchContext,
    entries: readonly IStorageInstallEntryResult[],
    innerHandles: readonly { readonly extensions: object }[]
  ): void {
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
      const native = installState.nativeContexts.get(index)
      this.#detectContexts.add(native!)
      if (native!.getKind() !== undefined) {
        nextRegistry.set(native!.id, entries[index]!.storeCell.get())
        this.#storeContexts.set(entries[index]!.storeCell.get(), {
          context: native!,
          native: entries[index]!.storeCell.get()
        })
      }
    }
    this.#registry = nextRegistry
    this.#extensions = nextExtensions
    if (!this.#detectRunning) this.#detectPromise = undefined
  }
  /** Prepare journal candidates within the original batch deadline before native publication. */
  async #installJournalBootstrap(
    installState: IStorageInstallBatchContext,
    candidates: readonly IStorageNativeRegistrationContext[],
    core: Pick<IPluginHostCore<never>, 'useAsyncPipeline'>
  ): Promise<Record<string, never>> {
    const elapsed = Math.max(0, this.#scheduler.now() - installState.batchToken.startedAt)
    await this.#awaitInstall(
      this.#prepareInstallJournal(installState, candidates),
      installState.batchToken,
      elapsed
    )
    if (!this.#journalPipelineInstalled) {
      core.useAsyncPipeline(async (input, next) => next(input))
      installState.installedJournalPipeline = true
    }
    return {}
  }
  /** Grant only the original bootstrap's temporary prepared-candidate authority. */
  async #prepareInstallJournal(
    installState: IStorageInstallBatchContext,
    candidates: readonly IStorageNativeRegistrationContext[]
  ): Promise<void> {
    installState.preparingJournal = true
    try {
      await this.#journalOptions(this.#orgId, candidates)
      for (const context of candidates)
        if (context.getKind() !== undefined)
          await this.#prepareJournalBackend(context, this.#orgId, candidates).promise
    } finally {
      installState.preparingJournal = false
    }
  }
  /** Materialize one registration with a single store handoff and original native plugin definition. */
  #createInstallEntry(
    installState: IStorageInstallBatchContext,
    plugin: IStorageBackendPluginHandle,
    metadata: NonNullable<ReturnType<typeof readStorageNativePluginMetadata>>,
    index: number
  ): IStorageInstallEntryResult {
    /** Initialize registration facts in original construction order before any callback can publish. */
    const entryState = { installState, plugin, metadata, index } as IStorageInstallEntryContext

    /** Retain only this entry original trusted definition metadata. */
    entryState.native = entryState.metadata

    /** Preserve the exact admitted store with one single-assignment handoff. */
    entryState.storeCell = createStorageStoreCell()

    /** A late installation cannot regain authority after its deadline. */
    entryState.installExpired = false

    /** Checks belong to this original registration and retain registration order. */
    entryState.checks = new Set<IStorageDetectCheck>()

    /** A successful complete host pass admits this registration's real execution endpoints. */
    entryState.detected = false

    /** Immutable identity does not retain a shared current-store or current-organization slot. */
    entryState.observerBinding = {
      identity: () => ({
        backendId: entryState.native.id,
        backend: entryState.kind?.name ?? entryState.native.id,
        orgId: this.#orgId
      }),
      assertCurrent: () => this.#assertRegistration(entryState),
      emit: this.#events.emit,
      hasListeners: this.#events.hasListeners,
      report: this.#report
    }
    entryState.context = this.#createInstallRegistrationContext(entryState)

    entryState.installState.nativeContexts.set(entryState.index, entryState.context)

    /** The original PluginHost definition remains the registration and lifecycle owner. */
    entryState.definition = readStorageNativePluginDefinition(entryState.plugin)

    if (entryState.definition === undefined)
      throw new StorageError(
        StorageErrorCode.backendPluginInvalid,
        {},
        StorageErrorText.backendPluginInvalid
      )
    return {
      plugin: entryState.definition as IPlugin<IStorageInstallCore, Record<string, unknown>>,
      storeCell: entryState.storeCell
    }
  }

  /** The original owners validate both unpublished candidates and committed registrations. */
  #assertRegistration(entryState: IStorageInstallEntryContext): void {
    /** Original config admission accepts the actual candidate in its current install operation. */
    if (entryState.installState.preparingJournal)
      getPluginRuntimeIntegration(entryState.registrationCore).assertPreparedRegistration()
    else void entryState.registrationCore!.config.get()
    if (!entryState.installState.batchToken.active)
      getPluginRuntimeIntegration(entryState.registrationCore).assertCurrent()
  }

  /** Observations retain original registration validity and agree with the one store handoff. */
  #bindObservers(
    entryState: IStorageInstallEntryContext,
    store: IStorageBase
  ): IStorageObserverSet {
    entryState.observerBinding.assertCurrent()
    entryState.storeCell.bind(store)
    return createStorageObservers(entryState.observerBinding, () => store)
  }

  /** Each call context closes over its organization and only installation-captured dependencies. */
  #callContext(entryState: IStorageInstallEntryContext, orgId: string): IStoragePluginCallContext {
    return {
      orgId,
      backend: (view) => {
        this.#assertRegistration(entryState)
        const source = entryState.borrowed?.get(view)
        if (source === undefined)
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        return this.#projectBackend(source, orgId) as typeof view
      }
    }
  }

  /** Bind the next domain core to its matching entry in this install batch. */
  #createInstallRegistrationContext(
    entryState: IStorageInstallEntryContext
  ): IStorageInstallEntryContext['context'] {
    return {
      ...(this.#journal === undefined
        ? {}
        : {
            observeExecution: <R>(
              orgId: string,
              describe: () => IStoragePipelineInput,
              invoke: (observing: boolean) => Promise<R>
            ) => this.#observeJournalExecution(orgId, describe, invoke)
          }),
      registerJournalRuntime: (runtime) => {
        entryState.registrationCore!.onDispose(() => {
          if (this.#journalRuntime === runtime) this.#journalRuntime = undefined
        })
        if (this.#journalRuntime !== undefined)
          throw new StorageError(
            StorageErrorCode.invalidConfig,
            {},
            StorageErrorText.defaultError(StorageErrorCode.invalidConfig)
          )
        this.#journalRuntime = runtime
      },
      getJournal: (orgId) => this.#journalPort(entryState.context, orgId),
      id: entryState.native.id,
      defaultOrgId: this.#orgId,
      getOrgContext: (orgId: Parameters<IStorageNativeRegistrationContext['getOrgContext']>[0]) =>
        this.#installGetOrgContext(entryState, orgId),
      assertCurrent: () => this.#assertRegistration(entryState),
      assertExecution: () => {
        this.#assertRegistration(entryState)
        if (!entryState.installState.batchToken.active && !entryState.detected)
          throw new StorageContractError(StorageContractErrorCode.unsupported)
      },
      isDetected: () => entryState.detected,
      completeDetect: () => {
        entryState.detected = true
      },
      getPublishedBackend: (
        id: Parameters<IStorageNativeRegistrationContext['getPublishedBackend']>[0]
      ) => this.#installGetPublishedBackend(entryState, id),
      registerDetect: (check) => {
        if (typeof check !== 'function')
          throw createStorageTypeError(
            StorageErrorCode.invalidConfig,
            StorageErrorText.invalidDetectCheck
          )
        /** Original onDispose admission enforces exactly the existing installation window. */
        const entry: IStorageDetectCheck = { check }
        entryState.registrationCore!.onDispose(() => {
          entryState.checks.delete(entry)
        })
        entryState.checks.add(entry)
      },
      runDetect: () => this.#installRunDetect(entryState),
      setRegistrationCore: (core) => {
        entryState.registrationCore = core
      },
      hooks: this.#events.hooks,
      emit: (name, payload) => {
        /** Accepted native work may settle during close; optional diagnostics cannot mask it. */
        if (this.#state === 'closing') return
        this.#assertRegistration(entryState)
        this.#events.emit(name, payload)
      },
      getObservers: (store, orgId) =>
        createStorageObservers(
          orgId === undefined
            ? entryState.observerBinding
            : {
                ...entryState.observerBinding,
                identity: () => ({ ...entryState.observerBinding.identity(), orgId })
              },
          () => store
        ),
      getEnvelopeStages: (operation, orgId) =>
        createStorageEnvelopeStages(
          orgId === undefined
            ? entryState.observerBinding
            : {
                ...entryState.observerBinding,
                identity: () => ({ ...entryState.observerBinding.identity(), orgId })
              },
          operation
        ),
      getStageBindings: () =>
        (entryState.stageBindings ??= {
          backendStages: createStorageObservers(
            entryState.observerBinding,
            entryState.storeCell.get
          ).backend,
          operationStages: (store) => this.#bindObservers(entryState, store).operation,
          codecStages: (store) => this.#bindObservers(entryState, store).codec,
          transactionStages: (store) => this.#bindObservers(entryState, store).transaction,
          concurrencyStages: (store) => this.#bindObservers(entryState, store).concurrency,
          sqlStages: (store) => this.#bindObservers(entryState, store).sql,
          queryStages: (store) => this.#bindObservers(entryState, store).query
        }),
      scheduler: this.#scheduler,
      getKind: () => entryState.kind,
      setKind: (value) => {
        entryState.kind = value
      },
      storeCell: entryState.storeCell,
      runInstall: <T>(operation: () => Promise<T>) =>
        this.#installRunInstall(entryState, operation),
      isInstallExpired: () => entryState.installExpired,
      registerStore: (
        store: Parameters<IStorageNativeRegistrationContext['registerStore']>[0],
        core: Parameters<IStorageNativeRegistrationContext['registerStore']>[1]
      ) => this.#installRegisterStore(entryState, store, core)
    }
  }
  /** Project the original native execution, journal and observers for one organization. */
  #installGetOrgContext(
    entryState: IStorageInstallEntryContext,
    orgId: Parameters<IStorageNativeRegistrationContext['getOrgContext']>[0]
  ): ReturnType<IStorageNativeRegistrationContext['getOrgContext']> {
    this.#assertRegistration(entryState)
    assertOperationContext({ orgId })
    /** Read-only ports point to the same original execution and observer implementations. */
    const binding = {
      ...entryState.observerBinding,
      identity: () => ({ ...entryState.observerBinding.identity(), orgId })
    }
    const execution = forwardStorageExecution(
      this.#inner,
      entryState.context.assertExecution,
      () => ({
        backendId: entryState.native.id,
        backend: entryState.kind?.name ?? entryState.native.id,
        orgId
      }),
      entryState.context.observeExecution === undefined
        ? undefined
        : (describe, invoke) => entryState.context.observeExecution!(orgId, describe, invoke)
    )
    const contextForOrg = this.#callContext(entryState, orgId)
    const observe = (store: IStorageBase) => createStorageObservers(binding, () => store)
    return {
      journal: entryState.context.getJournal(orgId),
      orgId,
      execution,
      callContext: contextForOrg,
      stageBindings: {
        backendStages: createStorageObservers(binding, entryState.storeCell.get).backend,
        operationStages: (store) => observe(store).operation,
        codecStages: (store) => observe(store).codec,
        transactionStages: (store) => observe(store).transaction,
        concurrencyStages: (store) => observe(store).concurrency,
        sqlStages: (store) => observe(store).sql,
        queryStages: (store) => observe(store).query
      },
      createTransactionApi: (scope) =>
        entryState.storeCell.createOrgTransactionApi(
          scope,
          entryState.storeCell.forOrg(orgId, this.#orgId),
          contextForOrg,
          execution
        )
    }
  }
  /** Borrow a committed registration and release its borrowed facts with this installation. */
  #installGetPublishedBackend(
    entryState: IStorageInstallEntryContext,
    id: Parameters<IStorageNativeRegistrationContext['getPublishedBackend']>[0]
  ): ReturnType<IStorageNativeRegistrationContext['getPublishedBackend']> {
    /** Original scope admission enforces the install window before any lookup. */
    let view: ReturnType<typeof borrowStorageBackend> | undefined
    /** Aliases borrow the source registration's existing facts and release with this borrower. */
    const releases: Array<() => void> = []
    entryState.registrationCore!.onDispose(() => {
      if (view !== undefined) entryState.borrowed?.delete(view)
      for (const release of releases) release()
    })
    /** Current-batch and future stores never enter this committed registry. */
    const store = this.#registry.get(id)
    if (store === undefined)
      throw new StorageError(
        StorageErrorCode.backendNotInstalled,
        {},
        StorageErrorText.backendNotInstalled
      )
    /** Its existing context retains the exact original lifecycle and enablement guards. */
    const source = this.#storeContexts.get(store)!
    const assertBorrowed = () => {
      this.#assertRegistration(entryState)
      source.context.assertCurrent()
    }
    view = borrowStorageBackend(store, assertBorrowed)
    releases.push(registerBackendEntityAccess(view, store, assertBorrowed))
    releases.push(
      registerBackendEnvelopeStages(
        view,
        (operation) => source.context.getEnvelopeStages(operation),
        () => source.context.storeCell.getChainMethods('query')
      )
    )
    const controller = getBackendChangeController(store)
    if (controller !== undefined) releases.push(registerBackendChangeController(view, controller))
    ;(entryState.borrowed ??= new Map()).set(view, store)
    return view as ReturnType<IStoragePluginCore['getPublishedBackend']>
  }
  /** Run original checks in registration order and retain their pending work for disposal. */
  async #installRunDetect(
    entryState: IStorageInstallEntryContext
  ): ReturnType<IStorageNativeRegistrationContext['runDetect']> {
    this.#assertRegistration(entryState)
    /** Timings describe one backend's real checks without adding a check deadline. */
    const startedAt = this.#scheduler.now()
    /** Read the original registration signal, which seals with the resource owner. */
    const signal = entryState.registrationCore!.lifecycle.signal
    /** Only checks actually invoked contribute to the fixed observation payload. */
    let checkCount = 0
    this.#events.emit(Hook.beforeDetect, entryState.observerBinding.identity)
    try {
      for (const entry of entryState.checks) {
        this.#assertOpen()
        this.#assertRegistration(entryState)
        checkCount += 1
        entry.pending = Promise.resolve().then(() => entry.check(signal))
        try {
          await entry.pending
        } finally {
          entry.pending = undefined
        }
      }
      this.#assertOpen()
      if (this.#events.hasListeners(Hook.afterDetect))
        this.#events.emit(Hook.afterDetect, () => ({
          ...entryState.observerBinding.identity(),
          checkCount,
          elapsedMs: Math.max(0, this.#scheduler.now() - startedAt)
        }))
    } catch (error) {
      if (this.#events.hasListeners(Hook.onDetectError))
        this.#events.emit(Hook.onDetectError, () => ({
          ...entryState.observerBinding.identity(),
          code: readStorageHookFailureCode(error, this.#report)
        }))
      throw error
    }
  }
  /** Apply the original batch deadline to one native installation and drain accepted checks. */
  async #installRunInstall<T>(
    entryState: IStorageInstallEntryContext,
    operation: () => Promise<T>
  ): Promise<T> {
    if (entryState.kind !== undefined) {
      this.#events.emit(Hook.beforeBackendPluginInstall, entryState.observerBinding.identity)
      this.#events.emit(Hook.beforeBackendCreate, entryState.observerBinding.identity)
    }
    /** Consume the original batch deadline instead of resetting it per backend. */
    const elapsed = Math.max(
      0,
      this.#scheduler.now() - entryState.installState.batchToken.startedAt
    )
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
      /** The complete original install hook includes selected Feature publication. */
      const installed = await this.#awaitInstall(
        pending,
        entryState.installState.batchToken,
        elapsed
      )
      /**
       * Register last in the original install window so accepted checks drain before any resource
       * they may inspect, even when a Feature registered them before the store.
       */
      entryState.registrationCore!.onDispose(async () => {
        for (const entry of entryState.checks) await entry.pending?.catch(this.#report)
      })
      if (entryState.kind !== undefined) {
        this.#events.emit(Hook.afterBackendPluginInstall, entryState.observerBinding.identity)
        this.#events.emit(Hook.afterBackendInstall, entryState.observerBinding.identity)
      }
      return installed
    } catch (error) {
      entryState.installExpired = !operationSettled
      if (entryState.kind !== undefined) {
        if (this.#events.hasListeners(Hook.onBackendRejected))
          this.#events.emit(Hook.onBackendRejected, () => ({
            ...entryState.observerBinding.identity(),
            code: readStorageHookFailureCode(error, this.#report)
          }))
        if (this.#events.hasListeners(Hook.onBackendPluginInstallError))
          this.#events.emit(Hook.onBackendPluginInstallError, () => ({
            ...entryState.observerBinding.identity(),
            code: readStorageHookFailureCode(error, this.#report)
          }))
      }
      throw error
    }
  }
  /** Admit one native store and hand its original disposer and identity to PluginHost. */
  #installRegisterStore(
    entryState: IStorageInstallEntryContext,
    store: Parameters<IStorageNativeRegistrationContext['registerStore']>[0],
    core: Parameters<IStorageNativeRegistrationContext['registerStore']>[1]
  ): ReturnType<IStorageNativeRegistrationContext['registerStore']> {
    /** Use contract-owned admission and its captured original disposal receiver. */
    const snapshot = snapshotStorageBaseDetailed(store, { asyncDisposeKey })
    if (!snapshot.valid)
      throw createStorageTypeError(
        StorageErrorCode.backendPluginInvalid,
        StorageErrorText.backendPluginInvalid,
        snapshot.cause
      )
    if (
      !entryState.installState.batchToken.active ||
      this.#activeBatchToken !== entryState.installState.batchToken
    ) {
      void this.#disposeLateStore(snapshot)
      throw new StorageError(
        StorageErrorCode.storageHostDisposed,
        {},
        StorageErrorText.storageHostDisposed
      )
    }
    try {
      core.onDispose(() => {
        this.#events.emit(Hook.onBackendDisposeStart, entryState.observerBinding.identity)
        /** The original captured disposer retains its receiver and one cleanup execution. */
        const disposed = snapshot.store.dispose()
        if (!this.#events.hasListeners(Hook.afterBackendDispose)) return disposed
        return Promise.resolve(disposed).then(() =>
          this.#events.emit(Hook.afterBackendDispose, entryState.observerBinding.identity)
        )
      })
    } catch (error) {
      void this.#disposeLateStore(snapshot)
      throw error
    }
    if (entryState.kind === undefined || snapshot.backend !== entryState.kind.name)
      throw createStorageTypeError(
        StorageErrorCode.backendKindMismatch,
        StorageErrorText.backendKindMismatch
      )
    /** Every admitted base, including frozen raw stores, shares this host's observer owner. */
    let releaseEnvelope: (() => void) | undefined
    core.onDispose(() => releaseEnvelope?.())
    releaseEnvelope = registerBackendEnvelopeStages(
      snapshot.store,
      entryState.context.getEnvelopeStages,
      () => entryState.context.storeCell.getChainMethods('query')
    )
    entryState.storeCell.set(snapshot.store)
    this.#events.emit(Hook.afterBackendCreate, entryState.observerBinding.identity)
  }
}

/**
 * Create a Host and atomically install the optional initial plugin tuple. Defaults to no backends
 * and a 30000 ms install budget. Browser storage is acquired only by selected backend plugins;
 * failed initial installation disposes its newly created facade before rejecting.
 */
export function createStorageHost<
  const TPlugins extends readonly IStorageBackendPluginHandle[] = readonly [],
  const TOptions extends Exclude<
    import('./journal/types.js').IStorageJournalConfiguration,
    Function
  > = Exclude<import('./journal/types.js').IStorageJournalConfiguration, Function>
>(
  options: Omit<IStorageHostCreateOptions<TPlugins>, 'journal'> & {
    readonly journal: (
      context: import('./journal/types.js').IStorageJournalInitializerContext
    ) => TOptions | PromiseLike<TOptions>
  }
): Promise<
  IStorageHost<
    TPlugins,
    (
      context: import('./journal/types.js').IStorageJournalInitializerContext
    ) => TOptions | PromiseLike<TOptions>
  >
>
/** Direct options retain the actual selected logger extension instead of widening it. */
export function createStorageHost<
  const TPlugins extends readonly IStorageBackendPluginHandle[] = readonly [],
  const TOptions extends Exclude<
    import('./journal/types.js').IStorageJournalConfiguration,
    Function
  > = Exclude<import('./journal/types.js').IStorageJournalConfiguration, Function>
>(
  options: Omit<IStorageHostCreateOptions<TPlugins>, 'journal'> & { readonly journal: TOptions }
): Promise<IStorageHost<TPlugins, TOptions>>
/** Broad named options and existing one-parameter callers retain their prior inference. */
export function createStorageHost<
  const TPlugins extends readonly IStorageBackendPluginHandle[] = readonly []
>(options?: IStorageHostCreateOptions<TPlugins>): Promise<IStorageHost<TPlugins>>
/** Original runtime factory remains the only implementation of every type overload. */
export async function createStorageHost<
  const TPlugins extends readonly IStorageBackendPluginHandle[] = readonly []
>(options?: IStorageHostCreateOptions<TPlugins>): Promise<IStorageHost<TPlugins>> {
  /** Constructor options are consumed synchronously before plugin installation can yield. */
  const facade = new StorageHostFacade(options)
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
        StorageErrorCode.backendInstallFailed,
        StorageErrorText.backendInstallFailed,
        [error, cleanupError]
      )
    }
    throw error
  }
}

/** Borrow native authoring ports from the original install and resource scope. */
function createStorageNativeAuthoringPorts(registration: IStorageRegistrationAssembly) {
  /** Native authoring retains the batch entry's original store cell. */
  const { context } = registration
  return {
    createKeyLockPort: (() => {
      /** Only original window admission is acquired; the physical backend owns final release. */
      registration.registrationCore!.onDispose(() => undefined)
      return createBackendKeyLockPort()
    }) satisfies IStoragePluginCore['createKeyLockPort'],
    createOrgAuthoringPort: (() => {
      /** Only this original installation can capture late child construction authority. */
      registration.registrationCore!.onDispose(context.storeCell.releaseOrgBindings)
      return {
        createChangeController: (options, factory) => {
          context.assertExecution()
          const controller = requireChangeControllerFactory(factory)(options)
          context.storeCell.retainOrgBinding(() => controller.dispose())
          return controller
        },
        createKeyLockPort: () => {
          context.assertExecution()
          return createBackendKeyLockPort()
        },
        createRevisionPort: () => {
          context.assertExecution()
          return createBackendRevisionPort()
        },
        registerChangeController: (store, controller) => {
          context.assertExecution()
          context.storeCell.retainOrgBinding(registerBackendChangeController(store, controller))
          /** Root observers retain all organizations through their original controller channel. */
          const root = getBackendChangeController(context.storeCell.get())
          if (root !== undefined && root !== controller && 'subscribe' in controller)
            context.storeCell.retainOrgBinding(
              (controller as IBackendChangeController).subscribe((change) =>
                root.publishExternal(change)
              )
            )
        },
        registerValueCommit: (store, commit) => {
          context.assertExecution()
          context.storeCell.retainOrgBinding(registerBackendValueCommit(store, commit))
        }
      } satisfies ReturnType<IStoragePluginCore['createOrgAuthoringPort']>
    }) satisfies IStoragePluginCore['createOrgAuthoringPort'],
    createRevisionPort: (() => {
      /** Window admission belongs to the original owner; physical backends retain the facts. */
      registration.registrationCore!.onDispose(() => undefined)
      return createBackendRevisionPort()
    }) satisfies IStoragePluginCore['createRevisionPort'],
    createChangeController: ((options, factory) => {
      /** Original resource admission owns partial-construction cleanup and the install window. */
      let controller: IBackendChangeController | undefined
      registration.registrationCore!.onDispose(() => controller?.dispose())
      controller = requireChangeControllerFactory(factory)(options)
      return controller
    }) satisfies IStoragePluginCore['createChangeController'],
    registerChangeController: ((store, controller) => {
      /** Exact registry release is attached to the same original registration scope. */
      let release: (() => void) | undefined
      registration.registrationCore!.onDispose(() => release?.())
      if (context.storeCell.get() !== store)
        throw createStorageTypeError(
          StorageErrorCode.backendPluginInvalid,
          StorageErrorText.backendPluginInvalid
        )
      release = registerBackendChangeController(store, controller)
    }) satisfies IStoragePluginCore['registerChangeController'],
    registerValueCommit: ((store, commit) => {
      /** The original installation window owns both admission and exact registration cleanup. */
      let release: (() => void) | undefined
      registration.registrationCore!.onDispose(() => release?.())
      if (context.storeCell.get() !== store)
        throw createStorageTypeError(
          StorageErrorCode.backendPluginInvalid,
          StorageErrorText.backendPluginInvalid
        )
      release = registerBackendValueCommit(store, commit)
    }) satisfies IStoragePluginCore['registerValueCommit'],
    registerOrgBinding: ((store, binding) => {
      /** The original window and exact store cell remain the only registration authority. */
      registration.registrationCore!.onDispose(context.storeCell.releaseOrgBindings)
      if (context.storeCell.get() !== store)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      context.storeCell.setOrgBinding(binding)
    }) satisfies IStoragePluginCore['registerOrgBinding'],
    registerFeatureClientResolver: ((store, resolver) => {
      /** Window admission precedes callbacks, reflection, or any native client acquisition. */
      registration.registrationCore!.onDispose(() => undefined)
      if (context.storeCell.get() !== store)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      context.storeCell.setFeatureClientResolver(resolver)
    }) satisfies IStoragePluginCore['registerFeatureClientResolver']
  }
}
/** Publish operation and installation ports through the canonical managed host. */
function createStorageExecutionPorts(registration: IStorageRegistrationAssembly) {
  /** Execution uses the original registration context and sole PluginHost pipeline. */
  const { context, host } = registration
  return {
    getChangeController: () => {
      context.assertCurrent()
      return getBackendChangeController(context.storeCell.get())
    },
    getPublishedBackend: context.getPublishedBackend,
    registerDetect: context.registerDetect,
    getStorageHooks: () =>
      ({
        on(name, handler) {
          /** Original resource admission owns the lifetime of this exact subscription handle. */
          const release = context.hooks.on(name, handler)
          try {
            registration.registrationCore!.onDispose(release)
          } catch (error) {
            release()
            throw error
          }
          return release
        }
      }) satisfies IStorageHooks,
    emit: ((name, payload) => context.emit(name, payload)) satisfies IStorageHookEmitter,
    setStorageKind: context.setKind,
    execution: forwardStorageExecution(
      host,
      context.assertExecution,
      () => ({
        backendId: context.id,
        backend: context.getKind()?.name ?? context.id,
        orgId: context.defaultOrgId
      }),
      context.observeExecution === undefined
        ? undefined
        : (describe, invoke) => context.observeExecution!(context.defaultOrgId, describe, invoke)
    ),
    runStorageInstall: context.runInstall,
    isStorageInstallExpired: context.isInstallExpired,
    registerStore: (store: IStorageBase) => {
      if (registration.registrationCore === undefined)
        throw new StorageError(
          StorageErrorCode.backendPluginInvalid,
          {},
          StorageErrorText.backendPluginInvalid
        )
      context.registerStore(store, registration.registrationCore)
    }
  }
}

/** Missing notification assembly is rejected before acquiring a channel or lifecycle resource. */
function requireChangeControllerFactory(
  factory: import('./core/change-types.js').IBackendChangeControllerFactory | undefined
): import('./core/change-types.js').IBackendChangeControllerFactory {
  if (factory === undefined)
    throw new StorageError(
      StorageErrorCode.changeControllerNotAssembled,
      {},
      StorageErrorText.changeControllerNotAssembled
    )
  return factory
}
