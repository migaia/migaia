// Install entries and backend registration contexts for one storage host (see ./storage-host.ts).
import { readStorageHookFailureCode } from './hooks.js'
import { createStorageObservers, type IStorageObserverSet } from './stages.js'
import { createStorageEnvelopeStages } from './envelope-stages.js'
import {
  registerBackendChangeController,
  registerBackendEnvelopeStages,
  getBackendChangeController,
  registerBackendEntityAccess
} from './core/backend-registry.js'
import { StorageHookName as Hook } from './hook-names.js'
import { borrowStorageBackend } from './borrow.js'
import { asyncDisposeKey, getPluginRuntimeIntegration, type IPlugin } from '@migaia/plugin-host'
import { snapshotStorageBaseDetailed } from './authoring/store.js'
import {
  assertOperationContext,
  StorageContractError,
  StorageContractErrorCode
} from '@migaia/storage-contract'
import { raceWithAbort } from '@migaia/utils/promise'
import { createStorageTypeError, StorageError } from './errors.js'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from './error-text.js'
import { readStorageNativePluginDefinition, readStorageNativePluginMetadata } from './contracts.js'
import { forwardStorageExecution } from './execution.js'
import { createStorageStoreCell } from './store-cell.js'
import type { IStorageBase } from '@migaia/storage-contract'
import type {
  IStorageBackendPluginHandle,
  IStoragePipelineInput,
  IStoragePluginCore,
  IStoragePluginCallContext
} from './types.js'
import type {
  IStorageNativeRegistrationContext,
  IStorageDetectCheck,
  IStorageInstallBatchContext,
  IStorageInstallCore,
  IStorageInstallEntryContext,
  IStorageInstallEntryResult,
  StorageHost
} from './storage-host.js'

/** Own install entries and the registration context through which each backend plugin installs. */
export class StorageHostInstaller {
  /** The host whose registry, events, borrow counts and lifecycle the install reads. */
  readonly #owner: StorageHost<any>

  /** Capture the owning host. */
  constructor(owner: StorageHost<any>) {
    this.#owner = owner
  }

  /** Materialize one registration with a single store handoff and original native plugin definition. */
  createInstallEntry(
    installState: IStorageInstallBatchContext,
    plugin: IStorageBackendPluginHandle,
    metadata: NonNullable<ReturnType<typeof readStorageNativePluginMetadata>>,
    index: number
  ): IStorageInstallEntryResult {
    /** Initialize registration facts in original construction order before any callback can publish. */
    const entryState = {
      installState,
      plugin,
      metadata,
      index,
      installSettled: false
    } as IStorageInstallEntryContext

    /** Retain only this entry original trusted definition metadata. */
    entryState.native = entryState.metadata

    /** Preserve the exact admitted store with one single-assignment handoff. */
    entryState.storeCell = createStorageStoreCell()

    /** A late installation cannot regain authority after its deadline. */

    /** Checks belong to this original registration and retain registration order. */
    entryState.checks = new Set<IStorageDetectCheck>()

    /** A successful complete host pass admits this registration's real execution endpoints. */
    entryState.detected = false

    /** Immutable identity does not retain a shared current-store or current-organization slot. */
    entryState.observerBinding = {
      identity: () => ({
        backendId: entryState.native.id,
        backend: entryState.kind?.name ?? entryState.native.id,
        orgId: this.#owner.orgId
      }),
      assertCurrent: () => this.assertRegistration(entryState),
      emit: this.#owner.events.emit,
      hasListeners: this.#owner.events.hasListeners,
      report: this.#owner.report
    }
    entryState.context = this.createInstallRegistrationContext(entryState)

    entryState.installState.nativeContexts.set(entryState.index, entryState.context)

    /** The original PluginHost definition remains the registration and lifecycle owner. */
    entryState.definition = readStorageNativePluginDefinition(entryState.plugin)

    if (entryState.definition === undefined)
      throw new StorageError(
        StorageHostErrorCode.backendPluginInvalid,
        {},
        StorageErrorText.backendPluginInvalid
      )
    return {
      plugin: entryState.definition as IPlugin<IStorageInstallCore, Record<string, unknown>>,
      storeCell: entryState.storeCell
    }
  }

  /** The original owners validate both unpublished candidates and committed registrations. */
  assertRegistration(entryState: IStorageInstallEntryContext): void {
    /** Original config admission accepts the actual candidate in its current install operation. */
    if (entryState.installState.preparingJournal)
      getPluginRuntimeIntegration(entryState.registrationCore).assertPreparedRegistration()
    else void entryState.registrationCore!.config.get()
    if (!entryState.installState.batchToken.active)
      getPluginRuntimeIntegration(entryState.registrationCore).assertCurrent()
  }

  /** Observations retain original registration validity and agree with the one store handoff. */
  bindObservers(entryState: IStorageInstallEntryContext, store: IStorageBase): IStorageObserverSet {
    entryState.observerBinding.assertCurrent()
    entryState.storeCell.bind(store)
    return createStorageObservers(entryState.observerBinding, () => store)
  }

  /** Each call context closes over its organization and only installation-captured dependencies. */
  callContext(entryState: IStorageInstallEntryContext, orgId: string): IStoragePluginCallContext {
    return {
      orgId,
      backend: (view) => {
        this.assertRegistration(entryState)
        const source = entryState.borrowed?.get(view)
        if (source === undefined)
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        return this.#owner.projectBackend(source, orgId) as typeof view
      }
    }
  }

  /** Bind the next domain core to its matching entry in this install batch. */
  createInstallRegistrationContext(
    entryState: IStorageInstallEntryContext
  ): IStorageInstallEntryContext['context'] {
    return {
      ...(this.#owner.journalOwner.journal === undefined
        ? {}
        : {
            observeExecution: <R>(
              orgId: string,
              describe: () => IStoragePipelineInput,
              invoke: (observing: boolean) => Promise<R>
            ) => this.#owner.journalOwner.observeJournalExecution(orgId, describe, invoke)
          }),
      registerJournalRuntime: (runtime) => {
        entryState.registrationCore!.onDispose(() => {
          if (this.#owner.journalOwner.journalRuntime === runtime)
            this.#owner.journalOwner.journalRuntime = undefined
        })
        if (this.#owner.journalOwner.journalRuntime !== undefined)
          throw new StorageError(
            StorageHostErrorCode.invalidConfig,
            {},
            StorageErrorText.defaultError(StorageHostErrorCode.invalidConfig)
          )
        this.#owner.journalOwner.journalRuntime = runtime
      },
      getJournal: (orgId) => this.#owner.journalOwner.journalPort(entryState.context, orgId),
      id: entryState.native.id,
      defaultOrgId: this.#owner.orgId,
      getOrgContext: (orgId: Parameters<IStorageNativeRegistrationContext['getOrgContext']>[0]) =>
        this.installGetOrgContext(entryState, orgId),
      assertCurrent: () => this.assertRegistration(entryState),
      assertExecution: () => {
        this.assertRegistration(entryState)
        if (!entryState.installState.batchToken.active && !entryState.detected)
          throw new StorageContractError(StorageContractErrorCode.unsupported)
      },
      isDetected: () => entryState.detected,
      completeDetect: () => {
        entryState.detected = true
      },
      getPublishedBackend: (
        id: Parameters<IStorageNativeRegistrationContext['getPublishedBackend']>[0]
      ) => this.installGetPublishedBackend(entryState, id),
      registerDetect: (check) => {
        if (typeof check !== 'function')
          throw createStorageTypeError(
            StorageHostErrorCode.invalidConfig,
            StorageErrorText.invalidDetectCheck
          )
        /** Original onDispose admission enforces exactly the existing installation window. */
        const entry: IStorageDetectCheck = { check }
        entryState.registrationCore!.onDispose(() => {
          entryState.checks.delete(entry)
        })
        entryState.checks.add(entry)
      },
      runDetect: () => this.installRunDetect(entryState),
      setRegistrationCore: (core) => {
        entryState.registrationCore = core
      },
      hooks: this.#owner.events.hooks,
      emit: (name, payload) => {
        /** Accepted native work may settle during close; optional diagnostics cannot mask it. */
        if (this.#owner.state === 'closing') return
        this.assertRegistration(entryState)
        this.#owner.events.emit(name, payload)
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
          operationStages: (store) => this.bindObservers(entryState, store).operation,
          codecStages: (store) => this.bindObservers(entryState, store).codec,
          transactionStages: (store) => this.bindObservers(entryState, store).transaction,
          concurrencyStages: (store) => this.bindObservers(entryState, store).concurrency,
          sqlStages: (store) => this.bindObservers(entryState, store).sql,
          queryStages: (store) => this.bindObservers(entryState, store).query
        }),
      scheduler: this.#owner.scheduler,
      getKind: () => entryState.kind,
      setKind: (value) => {
        entryState.kind = value
      },
      storeCell: entryState.storeCell,
      runInstall: <T>(operation: () => Promise<T>) => this.installRunInstall(entryState, operation),
      isInstallExpired: () => !entryState.installSettled && !this.isRegistrationCurrent(entryState),
      registerStore: (
        store: Parameters<IStorageNativeRegistrationContext['registerStore']>[0],
        core: Parameters<IStorageNativeRegistrationContext['registerStore']>[1]
      ) => this.installRegisterStore(entryState, store, core)
    }
  }

  /** Project the original native execution, journal and observers for one organization. */
  installGetOrgContext(
    entryState: IStorageInstallEntryContext,
    orgId: Parameters<IStorageNativeRegistrationContext['getOrgContext']>[0]
  ): ReturnType<IStorageNativeRegistrationContext['getOrgContext']> {
    this.assertRegistration(entryState)
    assertOperationContext({ orgId })
    /** Read-only ports point to the same original execution and observer implementations. */
    const binding = {
      ...entryState.observerBinding,
      identity: () => ({ ...entryState.observerBinding.identity(), orgId })
    }
    const execution = forwardStorageExecution(
      this.#owner.inner,
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
    const contextForOrg = this.callContext(entryState, orgId)
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
          entryState.storeCell.forOrg(orgId, this.#owner.orgId),
          contextForOrg,
          execution
        )
    }
  }

  /** Borrow a committed registration and release its borrowed facts with this installation. */
  installGetPublishedBackend(
    entryState: IStorageInstallEntryContext,
    id: Parameters<IStorageNativeRegistrationContext['getPublishedBackend']>[0]
  ): ReturnType<IStorageNativeRegistrationContext['getPublishedBackend']> {
    /** Original scope admission enforces the install window before any lookup. */
    let view: ReturnType<typeof borrowStorageBackend> | undefined
    /** Aliases borrow the source registration's existing facts and release with this borrower. */
    const releases: Array<() => void> = []
    /** The borrowed store, read after the release is registered so a failed lookup releases nothing. */
    let store: IStorageBase | undefined
    entryState.registrationCore!.onDispose(() => {
      if (view !== undefined) {
        entryState.borrowed?.delete(view)
        const remaining = (this.#owner.borrowCounts.get(store!) ?? 1) - 1
        if (remaining === 0) this.#owner.borrowCounts.delete(store!)
        else this.#owner.borrowCounts.set(store!, remaining)
      }
      for (const release of releases) release()
    })
    /** Current-batch and future stores never enter this committed registry. */
    store = this.#owner.registry.get(id)
    if (store === undefined)
      throw new StorageError(
        StorageHostErrorCode.backendNotInstalled,
        {},
        StorageErrorText.backendNotInstalled
      )
    /** Its existing context retains the exact original lifecycle and enablement guards. */
    const source = this.#owner.storeContexts.get(store)!
    const assertBorrowed = () => {
      this.assertRegistration(entryState)
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
    this.#owner.borrowCounts.set(store, (this.#owner.borrowCounts.get(store) ?? 0) + 1)
    return view as ReturnType<IStoragePluginCore['getPublishedBackend']>
  }

  /** Run original checks in registration order and retain their pending work for disposal. */
  async installRunDetect(
    entryState: IStorageInstallEntryContext
  ): ReturnType<IStorageNativeRegistrationContext['runDetect']> {
    this.assertRegistration(entryState)
    /** Timings describe one backend's real checks without adding a check deadline. */
    const startedAt = this.#owner.scheduler.now()
    /** Read the original registration signal, which seals with the resource owner. */
    const signal = entryState.registrationCore!.lifecycle.signal
    /** Only checks actually invoked contribute to the fixed observation payload. */
    let checkCount = 0
    this.#owner.events.emit(Hook.beforeDetect, entryState.observerBinding.identity)
    try {
      for (const entry of entryState.checks) {
        this.#owner.assertOpen()
        this.assertRegistration(entryState)
        checkCount += 1
        entry.pending = Promise.resolve().then(() => entry.check(signal))
        try {
          await entry.pending
        } finally {
          entry.pending = undefined
        }
      }
      this.#owner.assertOpen()
      if (this.#owner.events.hasListeners(Hook.afterDetect))
        this.#owner.events.emit(Hook.afterDetect, () => ({
          ...entryState.observerBinding.identity(),
          checkCount,
          elapsedMs: Math.max(0, this.#owner.scheduler.now() - startedAt)
        }))
    } catch (error) {
      if (this.#owner.events.hasListeners(Hook.onDetectError))
        this.#owner.events.emit(Hook.onDetectError, () => ({
          ...entryState.observerBinding.identity(),
          code: readStorageHookFailureCode(error, this.#owner.report)
        }))
      throw error
    }
  }

  /** Apply the original batch deadline to one native installation and drain accepted checks. */
  async installRunInstall<T>(
    entryState: IStorageInstallEntryContext,
    operation: () => Promise<T>
  ): Promise<T> {
    if (entryState.kind !== undefined) {
      this.#owner.events.emit(Hook.beforeBackendPluginInstall, entryState.observerBinding.identity)
      this.#owner.events.emit(Hook.beforeBackendCreate, entryState.observerBinding.identity)
    }
    try {
      /**
       * The complete original install hook includes selected Feature publication. PluginHost owns
       * its deadline; a rejection after the registration stopped being current goes to `report`.
       */
      const installed = await this.settleInstall(entryState, operation())
      /**
       * Register last in the original install window so accepted checks drain before any resource
       * they may inspect, even when a Feature registered them before the store.
       */
      entryState.registrationCore!.onDispose(async () => {
        for (const entry of entryState.checks) await entry.pending?.catch(this.#owner.report)
      })
      if (entryState.kind !== undefined) {
        this.#owner.events.emit(Hook.afterBackendPluginInstall, entryState.observerBinding.identity)
        this.#owner.events.emit(Hook.afterBackendInstall, entryState.observerBinding.identity)
      }
      return installed
    } catch (error) {
      if (entryState.kind !== undefined) {
        if (this.#owner.events.hasListeners(Hook.onBackendRejected))
          this.#owner.events.emit(Hook.onBackendRejected, () => ({
            ...entryState.observerBinding.identity(),
            code: readStorageHookFailureCode(error, this.#owner.report)
          }))
        if (this.#owner.events.hasListeners(Hook.onBackendPluginInstallError))
          this.#owner.events.emit(Hook.onBackendPluginInstallError, () => ({
            ...entryState.observerBinding.identity(),
            code: readStorageHookFailureCode(error, this.#owner.report)
          }))
      }
      throw error
    }
  }

  /**
   * True while PluginHost still accepts work from this registration. A plugin whose install
   * outlived `mutationTimeoutMs`, or whose host closed, is no longer current.
   */
  isRegistrationCurrent(entryState: IStorageInstallEntryContext): boolean {
    if (entryState.registrationCore === undefined) return true
    try {
      // During install this checks the install operation is still current; afterwards, the commit.
      getPluginRuntimeIntegration(entryState.registrationCore).assertPreparedRegistration()
      return true
    } catch {
      // assertCurrent signals expiry by throwing; expiry is the answer, not a failure to report.
      return false
    }
  }

  /**
   * Await one plugin's install work. A rejection that arrives after PluginHost gave up on the
   * registration (timeout or close) has no caller left, so it is reported instead of lost.
   */
  async settleInstall<T>(entryState: IStorageInstallEntryContext, pending: Promise<T>): Promise<T> {
    void pending.then(
      () => {
        entryState.installSettled = true
      },
      () => {
        entryState.installSettled = true
      }
    )
    try {
      return await raceWithAbort(() => pending, {
        signal: this.#owner.closing.signal,
        report: (error) => this.#owner.report(error)
      })
    } catch (error) {
      if (!this.#owner.closing.signal.aborted && !this.isRegistrationCurrent(entryState))
        this.#owner.report(error)
      throw error
    }
  }

  /** Admit one native store and hand its original disposer and identity to PluginHost. */
  installRegisterStore(
    entryState: IStorageInstallEntryContext,
    store: Parameters<IStorageNativeRegistrationContext['registerStore']>[0],
    core: Parameters<IStorageNativeRegistrationContext['registerStore']>[1]
  ): ReturnType<IStorageNativeRegistrationContext['registerStore']> {
    /** Use contract-owned admission and its captured original disposal receiver. */
    const snapshot = snapshotStorageBaseDetailed(store, { asyncDisposeKey })
    if (!snapshot.valid)
      throw createStorageTypeError(
        StorageHostErrorCode.backendPluginInvalid,
        StorageErrorText.backendPluginInvalid,
        snapshot.cause
      )
    if (
      !entryState.installState.batchToken.active ||
      this.#owner.activeBatchToken !== entryState.installState.batchToken ||
      !this.isRegistrationCurrent(entryState)
    ) {
      void this.#owner.disposeLateStore(snapshot)
      throw new StorageError(
        StorageHostErrorCode.storageHostDisposed,
        {},
        StorageErrorText.storageHostDisposed
      )
    }
    try {
      core.onDispose(() => {
        this.#owner.events.emit(Hook.onBackendDisposeStart, entryState.observerBinding.identity)
        /** The original captured disposer retains its receiver and one cleanup execution. */
        const disposed = snapshot.store.dispose()
        if (!this.#owner.events.hasListeners(Hook.afterBackendDispose)) return disposed
        return Promise.resolve(disposed).then(() =>
          this.#owner.events.emit(Hook.afterBackendDispose, entryState.observerBinding.identity)
        )
      })
    } catch (error) {
      void this.#owner.disposeLateStore(snapshot)
      throw error
    }
    if (entryState.kind === undefined || snapshot.backend !== entryState.kind.name)
      throw createStorageTypeError(
        StorageHostErrorCode.backendKindMismatch,
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
    this.#owner.events.emit(Hook.afterBackendCreate, entryState.observerBinding.identity)
  }
}
