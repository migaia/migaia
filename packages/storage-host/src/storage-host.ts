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
  createBackendChangeController,
  registerBackendChangeController,
  registerBackendEnvelopeStages,
  registerBackendValueCommit,
  getBackendChangeController,
  registerBackendEntityAccess,
  type IBackendChangeController
} from './core/change-controller.js'
import { StorageHookName as Hook } from './hook-names.js'
import { borrowStorageBackend } from './borrow.js'
import { createBackendKeyLockPort } from './backends/key-locks.js'
import { STORAGE_DEFAULT_ORG } from './state-constants.js'
import type { IBackendStageBindings } from '@migaia/storage-contract'
import {
  defineHost,
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
import {
  snapshotStorageBaseDetailed,
  assertOperationContext,
  StorageContractError,
  StorageContractErrorCode
} from '@migaia/storage-contract'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { withTimeout, type INativeAbortSignal } from '@migaia/utils/promise'
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
  IStorageBorrowedBackend,
  IStorageOrgBinding
} from './types.js'

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
          context.setRegistrationCore(core)
        },
        getStore: context.storeCell.get,
        setStorageFeatureProjection: context.storeCell.setFeatureProjection,
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
        createKeyLockPort: (() => {
          /** Only original window admission is acquired; the physical backend owns final release. */
          registrationCore!.onDispose(() => undefined)
          return createBackendKeyLockPort()
        }) satisfies IStoragePluginCore['createKeyLockPort'],
        createRevisionPort: (() => {
          /** Window admission belongs to the original owner; physical backends retain the facts. */
          registrationCore!.onDispose(() => undefined)
          return createBackendRevisionPort()
        }) satisfies IStoragePluginCore['createRevisionPort'],
        createChangeController: ((options) => {
          /** Original resource admission owns partial-construction cleanup and the install window. */
          let controller: IBackendChangeController | undefined
          registrationCore!.onDispose(() => controller?.dispose())
          controller = createBackendChangeController(options)
          return controller
        }) satisfies IStoragePluginCore['createChangeController'],
        registerChangeController: ((store, controller) => {
          /** Exact registry release is attached to the same original registration scope. */
          let release: (() => void) | undefined
          registrationCore!.onDispose(() => release?.())
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
          registrationCore!.onDispose(() => release?.())
          if (context.storeCell.get() !== store)
            throw createStorageTypeError(
              StorageErrorCode.backendPluginInvalid,
              StorageErrorText.backendPluginInvalid
            )
          release = registerBackendValueCommit(store, commit)
        }) satisfies IStoragePluginCore['registerValueCommit'],
        registerOrgBinding: ((store, binding) => {
          /** The original window and exact store cell remain the only registration authority. */
          registrationCore!.onDispose(context.storeCell.releaseOrgBindings)
          /** Capture the original callbacks once so later descriptor mutation cannot reroute an org. */
          let backend: IStorageOrgBinding['backend']
          let drop: IStorageOrgBinding['drop']
          try {
            backend = binding?.backend
            drop = binding?.drop
          } catch (cause) {
            throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
          }
          if (
            context.storeCell.get() !== store ||
            typeof backend !== 'function' ||
            typeof drop !== 'function'
          )
            throw new StorageContractError(StorageContractErrorCode.invalidArgument)
          context.storeCell.setOrgBinding(
            Object.freeze({
              backend: (orgId) => Reflect.apply(backend, binding, [orgId]),
              drop: (orgId) => Reflect.apply(drop, binding, [orgId])
            })
          )
        }) satisfies IStoragePluginCore['registerOrgBinding'],
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
                registrationCore!.onDispose(release)
              } catch (error) {
                release()
                throw error
              }
              return release
            }
          }) satisfies IStorageHooks,
        emit: ((name, payload) => {
          context.assertCurrent()
          context.emit(name, payload)
        }) satisfies IStorageHookEmitter,
        setStorageKind: context.setKind,
        execution: forwardStorageExecution(host, context.assertExecution, () => ({
          backendId: context.id,
          backend: context.getKind()?.name ?? context.id
        })),
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
  readonly org: IStorageHostOptions['org']
  readonly autoDetect: IStorageHostOptions['autoDetect']
  readonly installTimeoutMs: number | undefined
  readonly scheduler: IStorageHostOptions['scheduler']
  readonly report: IStorageHostOptions['report']
  readonly hooks: IStorageHostOptions['hooks']
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
        org: options?.org,
        autoDetect: options?.autoDetect,
        installTimeoutMs: options?.installTimeoutMs,
        scheduler: options?.scheduler,
        report: options?.report,
        hooks: options?.hooks
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
    /** Read constructor options once before any plugin can execute. */
    const optionsSnapshot = snapshotStorageHostCreateOptions(options)
    const {
      installTimeoutMs: installTimeoutOption,
      scheduler: schedulerOption,
      report,
      hooks,
      org,
      autoDetect
    } = optionsSnapshot.hostOptions
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

    this.#events = createStorageHooks(this.#report)
    this.#publicHooks = Object.freeze({
      on: (name, handler) => {
        this.#assertOpen()
        return this.#events.hooks.on(name, handler)
      }
    })
    if (hooks !== undefined) {
      if (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks))
        throw createStorageTypeError(StorageErrorCode.invalidConfig, StorageErrorText.invalidHooks)
      /** Snapshot own enumerable handlers once before acquiring any listener registration. */
      let hookEntries: Array<[string, unknown]>
      try {
        hookEntries = Object.entries(hooks)
      } catch (cause) {
        throw createStorageTypeError(
          StorageErrorCode.invalidConfig,
          StorageErrorText.invalidHooks,
          cause
        )
      }
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
        /** The original core supplies registration and installation admission for all bound ports. */
        let registrationCore: IStorageInstallCore | undefined
        /** Construction bindings are allocated only when a backend actually requests them. */
        let stageBindings: IBackendStageBindings | undefined
        /**
         * The original installation owns only its captured dependency handles, never their
         * resources.
         */
        let borrowed: Map<object, IStorageBase> | undefined
        /** Checks belong to this original registration and retain registration order. */
        const checks = new Set<IStorageDetectCheck>()
        /** A successful complete host pass admits this registration's real execution endpoints. */
        let detected = false
        /** The original owners validate both unpublished candidates and committed registrations. */
        const assertRegistration = (): void => {
          /**
           * Original config admission accepts the actual candidate in its current install
           * operation.
           */
          void registrationCore!.config.get()
          if (!batchToken.active) getPluginRuntimeIntegration(registrationCore).assertCurrent()
        }
        /** Immutable identity does not retain a shared current-store or current-organization slot. */
        const observerBinding = {
          identity: () => ({
            backendId: native.id,
            backend: kind?.name ?? native.id,
            orgId: this.#orgId
          }),
          assertCurrent: assertRegistration,
          emit: this.#events.emit,
          hasListeners: this.#events.hasListeners,
          report: this.#report
        }
        /** Observations retain original registration validity and agree with the one store handoff. */
        const bindObservers = (store: IStorageBase): IStorageObserverSet => {
          observerBinding.assertCurrent()
          storeCell.bind(store)
          return createStorageObservers(observerBinding, () => store)
        }
        /**
         * Each call context closes over its organization and only installation-captured
         * dependencies.
         */
        const callContext = (orgId: string): IStoragePluginCallContext =>
          Object.freeze({
            orgId,
            backend: (view) => {
              assertRegistration()
              const source = borrowed?.get(view)
              if (source === undefined)
                throw new StorageContractError(StorageContractErrorCode.invalidArgument)
              return this.#projectBackend(source, orgId) as typeof view
            }
          })
        /** Bind the next domain core to its matching entry in this install batch. */
        const context: IStorageNativeRegistrationContext = {
          id: native.id,
          defaultOrgId: this.#orgId,
          getOrgContext: (orgId) => {
            assertRegistration()
            assertOperationContext({ orgId })
            /** Read-only ports point to the same original execution and observer implementations. */
            const binding = {
              ...observerBinding,
              identity: () => ({ ...observerBinding.identity(), orgId })
            }
            const execution = forwardStorageExecution(this.#inner, context.assertExecution, () => ({
              backendId: native.id,
              backend: kind?.name ?? native.id
            }))
            const contextForOrg = callContext(orgId)
            const observe = (store: IStorageBase) => createStorageObservers(binding, () => store)
            return Object.freeze({
              orgId,
              execution,
              callContext: contextForOrg,
              stageBindings: {
                backendStages: createStorageObservers(binding, storeCell.get).backend,
                operationStages: (store) => observe(store).operation,
                codecStages: (store) => observe(store).codec,
                transactionStages: (store) => observe(store).transaction,
                concurrencyStages: (store) => observe(store).concurrency,
                sqlStages: (store) => observe(store).sql,
                queryStages: (store) => observe(store).query
              },
              createTransactionApi: (scope) =>
                storeCell.createOrgTransactionApi(
                  scope,
                  storeCell.forOrg(orgId, this.#orgId),
                  contextForOrg,
                  execution
                )
            })
          },
          assertCurrent: assertRegistration,
          assertExecution: () => {
            assertRegistration()
            if (!batchToken.active && !detected)
              throw new StorageContractError(StorageContractErrorCode.unsupported)
          },
          isDetected: () => detected,
          completeDetect: () => {
            detected = true
          },
          getPublishedBackend: (id) => {
            /** Original scope admission enforces the install window before any lookup. */
            let view: ReturnType<typeof borrowStorageBackend> | undefined
            /**
             * Aliases borrow the source registration's existing facts and release with this
             * borrower.
             */
            const releases: Array<() => void> = []
            registrationCore!.onDispose(() => {
              if (view !== undefined) borrowed?.delete(view)
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
              assertRegistration()
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
            if (controller !== undefined)
              releases.push(registerBackendChangeController(view, controller))
            ;(borrowed ??= new Map()).set(view, store)
            return view as ReturnType<IStoragePluginCore['getPublishedBackend']>
          },
          registerDetect: (check) => {
            if (typeof check !== 'function')
              throw createStorageTypeError(
                StorageErrorCode.invalidConfig,
                StorageErrorText.invalidDetectCheck
              )
            /** Original onDispose admission enforces exactly the existing installation window. */
            const entry: IStorageDetectCheck = { check }
            registrationCore!.onDispose(() => {
              checks.delete(entry)
            })
            checks.add(entry)
          },
          runDetect: async () => {
            assertRegistration()
            /** Timings describe one backend's real checks without adding a check deadline. */
            const startedAt = this.#scheduler.now()
            /** Read the original registration signal, which seals with the resource owner. */
            const signal = registrationCore!.lifecycle.signal
            /** Only checks actually invoked contribute to the fixed observation payload. */
            let checkCount = 0
            this.#events.emit(Hook.beforeDetect, observerBinding.identity)
            try {
              for (const entry of checks) {
                this.#assertOpen()
                assertRegistration()
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
                  ...observerBinding.identity(),
                  checkCount,
                  elapsedMs: Math.max(0, this.#scheduler.now() - startedAt)
                }))
            } catch (error) {
              if (this.#events.hasListeners(Hook.onDetectError))
                this.#events.emit(Hook.onDetectError, () => ({
                  ...observerBinding.identity(),
                  code: readStorageHookFailureCode(error, this.#report)
                }))
              throw error
            }
          },
          setRegistrationCore: (core) => {
            registrationCore = core
          },
          hooks: this.#events.hooks,
          emit: this.#events.emit,
          getObservers: (store, orgId) =>
            createStorageObservers(
              orgId === undefined
                ? observerBinding
                : {
                    ...observerBinding,
                    identity: () => ({ ...observerBinding.identity(), orgId })
                  },
              () => store
            ),
          getEnvelopeStages: (operation, orgId) =>
            createStorageEnvelopeStages(
              orgId === undefined
                ? observerBinding
                : {
                    ...observerBinding,
                    identity: () => ({ ...observerBinding.identity(), orgId })
                  },
              operation
            ),
          getStageBindings: () =>
            (stageBindings ??= {
              backendStages: createStorageObservers(observerBinding, storeCell.get).backend,
              operationStages: (store) => bindObservers(store).operation,
              codecStages: (store) => bindObservers(store).codec,
              transactionStages: (store) => bindObservers(store).transaction,
              concurrencyStages: (store) => bindObservers(store).concurrency,
              sqlStages: (store) => bindObservers(store).sql,
              queryStages: (store) => bindObservers(store).query
            }),
          scheduler: this.#scheduler,
          getKind: () => kind,
          setKind: (value) => {
            kind = value
          },
          storeCell,
          runInstall: async <T>(operation: () => Promise<T>): Promise<T> => {
            if (kind !== undefined) {
              this.#events.emit(Hook.beforeBackendPluginInstall, observerBinding.identity)
              this.#events.emit(Hook.beforeBackendCreate, observerBinding.identity)
            }
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
              /** The complete original install hook includes selected Feature publication. */
              const installed = await withTimeout(() => pending, {
                timeoutMs: Math.max(0, this.#installTimeoutMs - elapsed),
                signals: [batchToken.controller.signal],
                scheduler: this.#scheduler,
                report: (error) => this.#report(error),
                zeroTimeoutBehavior: 'skip'
              })
              /**
               * Register last in the original install window so accepted checks drain before any
               * resource they may inspect, even when a Feature registered them before the store.
               */
              registrationCore!.onDispose(async () => {
                for (const entry of checks) await entry.pending?.catch(this.#report)
              })
              if (kind !== undefined) {
                this.#events.emit(Hook.afterBackendPluginInstall, observerBinding.identity)
                this.#events.emit(Hook.afterBackendInstall, observerBinding.identity)
              }
              return installed
            } catch (error) {
              installExpired = !operationSettled
              if (kind !== undefined) {
                if (this.#events.hasListeners(Hook.onBackendRejected))
                  this.#events.emit(Hook.onBackendRejected, () => ({
                    ...observerBinding.identity(),
                    code: readStorageHookFailureCode(error, this.#report)
                  }))
                if (this.#events.hasListeners(Hook.onBackendPluginInstallError))
                  this.#events.emit(Hook.onBackendPluginInstallError, () => ({
                    ...observerBinding.identity(),
                    code: readStorageHookFailureCode(error, this.#report)
                  }))
              }
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
              core.onDispose(() => {
                this.#events.emit(Hook.onBackendDisposeStart, observerBinding.identity)
                /** The original captured disposer retains its receiver and one cleanup execution. */
                const disposed = Reflect.apply(
                  snapshot.dispose,
                  snapshot.receiver,
                  []
                ) as Promise<void>
                if (!this.#events.hasListeners(Hook.afterBackendDispose)) return disposed
                return Promise.resolve(disposed).then(() =>
                  this.#events.emit(Hook.afterBackendDispose, observerBinding.identity)
                )
              })
            } catch (error) {
              void this.#disposeLateStore(snapshot)
              throw error
            }
            if (kind === undefined || snapshot.backend !== kind.name)
              throw createStorageTypeError(
                StorageErrorCode.backendKindMismatch,
                StorageErrorText.backendKindMismatch
              )
            /** Every admitted base, including frozen raw stores, shares this host's observer owner. */
            let releaseEnvelope: (() => void) | undefined
            core.onDispose(() => releaseEnvelope?.())
            releaseEnvelope = registerBackendEnvelopeStages(
              snapshot.store,
              context.getEnvelopeStages,
              () => context.storeCell.getChainMethods('query')
            )
            storeCell.set(snapshot.store)
            this.#events.emit(Hook.afterBackendCreate, observerBinding.identity)
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
        this.#detectContexts.add(native!)
        if (native!.getKind() !== undefined) {
          nextRegistry.set(native!.id, entries[index]!.storeCell.get())
          this.#storeContexts.set(entries[index]!.storeCell.get(), {
            context: native!,
            native: entries[index]!.storeCell.get()
          })
        }
      }
      this.#registry = new Map(nextRegistry)
      this.#extensions = Object.freeze(nextExtensions)
      if (!this.#detectRunning) this.#detectPromise = undefined
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
    return Object.freeze(api) as IStorageHost<P>['api']
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
      const controller = getBackendChangeController(store)
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
    const hooks: IStorageHooks = Object.freeze({
      on: (name, handler) => {
        this.#assertOpen()
        return this.#events.hooks.on(name, (payload) => {
          if ('orgId' in payload && payload.orgId === orgId) handler(payload)
        })
      }
    })
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
      return Object.freeze(result)
    }
    /** The view shell has no dispose, drop, installation or mutable registration methods. */
    const view = {
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
        return Object.freeze(result)
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
    return Object.freeze(view) as unknown as IStorageOrgView<P>
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
    this.#extensions = Object.freeze({})
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
  try {
    if (plugins !== undefined && plugins.length > 0) await facade.use(...(plugins as TPlugins))
    if (optionsSnapshot.hostOptions.autoDetect !== false) await facade.detect()
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
