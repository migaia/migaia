// Journal configuration and per-organization journal preparation for one storage host (see ./storage-host.ts).
import { isStorageErrorFamily } from './core/error-family.ts'
import { readStorageHookFailureCode } from './hooks.ts'
import { StorageHookName as Hook } from './hook-names.ts'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { StorageError } from './errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from './error-text.ts'
import { type IStorageStoreCell } from './store-cell.ts'
import type { IStorageBackendPluginHandle, IStoragePipelineInput } from './types.ts'
import { readStorageJournalConfiguration } from './journal/plugin-configuration.ts'
import { type IStorageJournalBackendAccess } from './journal/binding.ts'
import {
  snapshotStorageJournalConfiguration,
  type IStorageJournalConfigurationSnapshot
} from './journal/configuration-options.ts'
import type { IStorageJournalConfiguration, IStorageJournalExecutionPort } from './journal/types.ts'
import type { IStorageJournalRuntime } from './journal/loader.ts'
import type { prepareStorageJournalConfiguration } from './journal/configuration.ts'
import type { IStorageNativeRegistrationContext, StorageHost } from './storage-host.ts'

/** Own the host's journal configuration, runtime and per-organization journal preparation. */
export class StorageHostJournal {
  /** The host whose registry, store contexts, events and lifecycle the journal reads. */
  readonly #owner: StorageHost<any>

  /** Capture the owning host; journal state starts empty. */
  constructor(owner: StorageHost<any>) {
    this.#owner = owner
  }

  /**
   * Journal configuration taken from a `storageJournalPlugin(options)` in the first install batch.
   * It is set once, before that batch plans its journal bootstrap, and cleared if that batch
   * fails.
   */
  journal:
    | IStorageJournalConfigurationSnapshot
    | Extract<IStorageJournalConfiguration, Function>
    | undefined

  /** Resolved optional code is reused directly inside native transaction activity windows. */
  journalRuntime: IStorageJournalRuntime | undefined

  /**
   * Concurrent first endpoints share one exact initializer and per-registration preparation
   * Promise.
   */
  journalOrgs:
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
  journalPipelineInstalled = false

  /**
   * Fixed-org access borrows only original private I/O and the registration's resource release
   * hook.
   */
  journalAccess(id: string, orgId: string): IStorageJournalBackendAccess {
    this.#owner.assertOpen()
    this.requireJournalRuntime()
    const store = this.#owner.registry.get(id)
    if (store === undefined)
      throw new StorageError(
        StorageHostErrorCode.backendNotInstalled,
        {},
        StorageErrorText.backendNotInstalled
      )
    const context = this.#owner.storeContexts.get(store)!.context
    return this.journalContextAccess(context, orgId)
  }

  /** Candidate bootstrap and published lookups consume the same exact original registration facts. */
  journalContextAccess(
    context: IStorageNativeRegistrationContext,
    orgId: string
  ): IStorageJournalBackendAccess {
    this.#owner.assertOpen()
    context.assertExecution()
    const binding = context.storeCell.journalForOrg(orgId)
    return {
      registration: context.storeCell.journalIdentity,
      orgId,
      backendInstanceId: context.id,
      binding,
      retain: (resource: import('@migaia/storage-contract').IStorageResource) => {
        this.#owner.assertOpen()
        context.assertExecution()
        return context.storeCell.retainJournalResource(resource)
      }
    }
  }

  /**
   * Take journal configuration from a `storageJournalPlugin(options)` in this batch. Only the first
   * batch may carry it, because backends installed earlier were set up without journal ports; a
   * later batch, or two configured journal plugins, is rejected with INVALID_CONFIG.
   */
  admitJournalConfiguration(plugins: readonly IStorageBackendPluginHandle[]): void {
    const first = !this.#owner.batchStarted
    this.#owner.batchStarted = true
    for (const plugin of plugins) {
      const configuration = readStorageJournalConfiguration(plugin)?.configuration
      if (configuration === undefined) continue
      if (!first || this.journal !== undefined)
        throw new StorageError(
          StorageHostErrorCode.invalidConfig,
          {},
          StorageErrorText.journalConfigurationLate
        )
      this.journal =
        typeof configuration === 'function'
          ? configuration
          : snapshotStorageJournalConfiguration(configuration)
    }
  }

  /** Require the explicitly installed journal plugin before invoking optional journal code. */
  requireJournalRuntime(): IStorageJournalRuntime {
    if (this.journalRuntime === undefined)
      throw new StorageError(
        StorageHostErrorCode.journalNotAssembled,
        {},
        StorageErrorText.journalNotAssembled
      )
    return this.journalRuntime
  }

  /** One original org cell shares the initializer Promise without opening stores in org(). */
  journalOptions(orgId: string, candidates?: readonly IStorageNativeRegistrationContext[]) {
    this.#owner.assertOpen()
    const existing = this.journalOrgs?.get(orgId)
    if (existing !== undefined) return existing.options
    const source = this.journal!
    const options = Promise.resolve().then(async () => {
      this.#owner.assertOpen()
      if (typeof source !== 'function') {
        this.journalOrgs!.get(orgId)!.configuration = source
        return source
      }
      /** Load optional logging only when this organization initializes its journal. */
      const runtime = this.requireJournalRuntime()
      this.journalRuntime = runtime
      const configured = await source({
        orgId,
        storageLogStore: (id: string, options: { readonly prefix: string }) => {
          this.#owner.assertOpen()
          const candidate = candidates?.find(
            (context) => context.id === id && context.getKind() !== undefined
          )
          const published = this.#owner.registry.get(id)
          const context =
            candidate ??
            (published === undefined
              ? undefined
              : this.#owner.storeContexts.get(published)?.context)
          if (context === undefined)
            throw new StorageError(
              StorageHostErrorCode.backendNotInstalled,
              {},
              StorageErrorText.backendNotInstalled
            )
          return runtime.openStorageLogStore(
            this.journalContextAccess(context, orgId),
            runtime.snapshotStorageLogPrefix(options)
          )
        }
      })
      this.#owner.assertOpen()
      const snapshot = snapshotStorageJournalConfiguration(configured)
      this.journalOrgs!.get(orgId)!.configuration = snapshot
      return snapshot
    })
    ;(this.journalOrgs ??= new Map()).set(orgId, { options, backends: new Map() })
    return options
  }

  /** Each original backend cell prepares once under its org's already fixed configuration. */
  prepareJournalBackend(
    context: IStorageNativeRegistrationContext,
    orgId: string,
    candidates?: readonly IStorageNativeRegistrationContext[]
  ) {
    context.assertExecution()
    const options = this.journalOptions(orgId, candidates)
    const backends = this.journalOrgs!.get(orgId)!.backends
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
          undo = Reflect.get(context.storeCell.forOrg(orgId, this.#owner.orgId), 'undo')
        } catch (cause) {
          if (isStorageErrorFamily(cause)) throw cause
          throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
        }
        if (typeof undo !== 'function')
          throw new StorageContractError(StorageContractErrorCode.unsupported)
      }
      /** Load optional code before preparing the native journal transaction resources. */
      const runtime = this.requireJournalRuntime()
      this.journalRuntime = runtime
      entry.value = await runtime.prepareStorageJournalConfiguration(
        configured,
        this.journalContextAccess(context, orgId),
        context.storeCell.get().backend,
        {
          report: this.#owner.report,
          onBinlogAppendError: (txId, error) => {
            this.#owner.report(error)
            this.#owner.events.emit(Hook.onBinlogAppendError, () => ({
              backendId: context.id,
              backend: context.storeCell.get().backend,
              orgId,
              namespace: configured.namespace,
              backendInstanceId: context.id,
              txId,
              code: readStorageHookFailureCode(error, this.#owner.report)
            }))
          },
          beforeRecover: () =>
            this.#owner.events.emit(Hook.beforeJournalRecover, () => ({
              backendId: context.id,
              backend: context.storeCell.get().backend,
              orgId,
              namespace: configured.namespace,
              backendInstanceId: context.id
            })),
          afterRecover: (count, elapsedMs) =>
            this.#owner.events.emit(Hook.afterJournalRecover, () => ({
              backendId: context.id,
              backend: context.storeCell.get().backend,
              orgId,
              namespace: configured.namespace,
              backendInstanceId: context.id,
              count,
              elapsedMs
            })),
          onRecoverError: (error) =>
            this.#owner.events.emit(Hook.onJournalRecoverError, () => ({
              backendId: context.id,
              backend: context.storeCell.get().backend,
              orgId,
              namespace: configured.namespace,
              backendInstanceId: context.id,
              code: readStorageHookFailureCode(error, this.#owner.report)
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
  journalPort(
    context: IStorageNativeRegistrationContext,
    orgId: string
  ): IStorageJournalExecutionPort | undefined {
    if (this.journal === undefined) return undefined
    const prepared = () => {
      context.assertExecution()
      const entry = this.journalOrgs?.get(orgId)?.backends.get(context.storeCell)
      if (!entry?.complete) throw new StorageContractError(StorageContractErrorCode.unsupported)
      return entry.value
    }
    return {
      prepare: () => this.prepareJournalBackend(context, orgId).promise,
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
  observeJournalExecution<R>(
    orgId: string,
    describe: () => IStoragePipelineInput,
    invoke: (observing: boolean) => Promise<R>
  ): Promise<R> {
    /** The initial install path may observe before preparation loads the optional module. */
    const observe = (runtime: IStorageJournalRuntime) =>
      runtime.observeStorageTelemetry(
        () => this.journalOrgs?.get(orgId)?.configuration,
        describe,
        invoke,
        () => this.#owner.scheduler.now(),
        this.#owner.report
      )
    return observe(this.requireJournalRuntime())
  }
}
