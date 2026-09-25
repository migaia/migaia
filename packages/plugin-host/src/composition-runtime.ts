import { boundedWait, type ILifecycleScheduler } from '@migaia/lifecycle'
import {
  DependencyMutationKind,
  DependencyPolicy,
  planDependencyMutation
} from '@migaia/capability/graph/dependency'
import {
  captureCleanupFence,
  createDataOrderSlotState,
  createRegistrationReceipt,
  emptyPhysicalCleanupResult,
  readDataOrderSlotState,
  readPreparedAdmissions,
  readPreparedRemoval,
  readRegistrationForReceipt,
  readRegistrationReceipt,
  registerAdmissionDefinition,
  registerPreparedAdmissions,
  registerPreparedRemoval,
  resolveAdmissionDefinitions,
  type IDataOrderSlotState
} from './composition.js'
import ERROR_TEXT, { PluginHostError, createPluginHostTypeError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { reportDiagnostic } from './diagnostic-report.js'
import type { PluginHostState } from './host-state.js'
import type { IInstallBatchContext } from './install-runtime.js'
import type { IInstallEntry, IPluginDefinition, IRegistration } from './registry.js'
import type {
  IPluginAdmission,
  IPluginAdmissionRequest,
  IPluginBatchRemovalOptions,
  IPluginBatchRemovalResult,
  IPluginConstraint,
  IPluginDataOrderSlot,
  IPluginHostCore,
  IPluginHostPhysicalCleanupResult,
  IPluginPreparedAdmissions,
  IPluginPreparedRemovalBatch,
  IPluginRegistrationReceipt,
  IPluginHostDiagnostic
} from './typing.js'

type ICompositionStrictCleanupResult<TRegistration> = Readonly<{
  readonly cleanupErrors: readonly unknown[]
  readonly leafErrorsByRegistration: ReadonlyMap<TRegistration, readonly unknown[]>
}>

type IPluginHostCompositionRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  readonly host: object
  readonly scheduler: ILifecycleScheduler
  readonly pipelineDrainTimeoutMs: number | false
  readonly registrations: Map<string, IRegistration<TDomainCore, TValue>>
  /** Host-owned dependency facts used for one whole-batch removal plan. */
  readonly state: PluginHostState<TDomainCore, TValue>
  readonly stageSlots: Map<string, IDataOrderSlotState>
  readonly allocateStageSlot: () => bigint
  readonly assertActive: () => void
  readonly assertMutationAllowed: () => void
  readonly snapshotPlugins: (
    plugins: readonly IPluginConstraint<any>[]
  ) => IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>[]
  readonly preflight: (
    definitions: readonly IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>[]
  ) => IInstallEntry<TDomainCore, TValue>[]
  readonly enqueue: <T>(task: () => Promise<T>) => Promise<T>
  readonly installBatch: (
    entries: readonly IInstallEntry<TDomainCore, TValue>[],
    publish: boolean
  ) => Promise<{
    readonly installed: readonly IRegistration<TDomainCore, TValue>[]
    readonly batch: IInstallBatchContext<TDomainCore, TValue>
  }>
  readonly publish: (
    installed: readonly IRegistration<TDomainCore, TValue>[],
    batch: IInstallBatchContext<TDomainCore, TValue>
  ) => void
  readonly revision: () => number
  readonly commitRevision: () => void
  readonly disposeRegistration: (
    registration: IRegistration<TDomainCore, TValue>,
    preserveErrorIdentity: boolean
  ) => Promise<unknown[]>
  readonly revokeRegistration: (registration: IRegistration<TDomainCore, TValue>) => unknown[]
  readonly disposeRegistrationStrict: (
    registration: IRegistration<TDomainCore, TValue>
  ) => Promise<unknown[]>
  readonly createView: () => unknown
  /** Records a name removed through the managed protocol; see `PREREQUISITE_REMOVED`. */
  readonly markRemoved: (name: string) => void
  readonly diagnostic: IPluginHostDiagnostic
}>

/** Owns opaque composition capabilities and staged install/removal transactions. */
export class PluginHostCompositionRuntime<TDomainCore extends object, TValue> {
  /** Narrow Host authority required by composition publication and cleanup. */
  readonly #port: IPluginHostCompositionRuntimePort<TDomainCore, TValue>

  constructor(port: IPluginHostCompositionRuntimePort<TDomainCore, TValue>) {
    this.#port = port
  }

  /** Captures one immutable plugin definition behind an opaque admission capability. */
  createPluginAdmission<TPlugin extends IPluginConstraint<any>>(
    plugin: TPlugin
  ): IPluginAdmission<TPlugin> {
    this.#port.assertActive()
    this.#port.assertMutationAllowed()
    const definition = this.#port.snapshotPlugins([plugin])[0]
    const admission = Object.freeze({})
    registerAdmissionDefinition(admission, definition)
    return admission as IPluginAdmission<TPlugin>
  }

  /** Allocates one Host-owned stable ordering lane. */
  createDataOrderSlot(name: string): IPluginDataOrderSlot {
    this.#port.assertActive()
    this.#port.assertMutationAllowed()
    if (typeof name !== 'string' || name.length === 0 || name.includes('.'))
      throw createPluginHostTypeError(ERROR_TEXT.DATA_ORDER_SLOT_NAME_INVALID)
    const current = this.#port.stageSlots.get(name)
    if (current && !current.retired)
      throw createPluginHostTypeError(ERROR_TEXT.DATA_ORDER_SLOT_LIVE(name))
    const { slot, state } = createDataOrderSlotState(
      this.#port.host,
      name,
      this.#port.allocateStageSlot()
    )
    this.#port.stageSlots.set(name, state)
    this.#port.state.lanes.ensureSlot(state)
    return slot
  }

  /** Permanently retires one exact Host-owned ordering lane. */
  retireDataOrderSlot(slot: IPluginDataOrderSlot): void {
    this.#port.assertActive()
    this.#port.assertMutationAllowed()
    const state = readDataOrderSlotState(slot)
    if (!state || state.host !== this.#port.host)
      throw createPluginHostTypeError(ERROR_TEXT.ADMISSION_SLOT_FOREIGN)
    if (state.retired) return
    state.retired = true
    this.#port.state.lanes.retireSlot(state)
    if (this.#port.stageSlots.get(state.name) === state) this.#port.stageSlots.delete(state.name)
  }

  /** Prepares an install candidate without publishing it. */
  async prepareAdmissions(
    requests: readonly IPluginAdmissionRequest[]
  ): Promise<IPluginPreparedAdmissions> {
    this.#port.assertActive()
    this.#port.assertMutationAllowed()
    const definitions = resolveAdmissionDefinitions<
      IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>
    >(requests, this.#port.host)
    return this.#port.enqueue(async () => {
      const prepared = await this.#port.installBatch(this.#port.preflight(definitions), false)
      return registerPreparedAdmissions({
        host: this.#port.host,
        installed: prepared.installed,
        batch: prepared.batch,
        baseRevision: this.#port.revision(),
        committed: false,
        discarded: false
      })
    })
  }

  /** Publishes one prepared candidate at a single synchronous commit point. */
  commitPreparedAdmissions(
    prepared: IPluginPreparedAdmissions
  ): readonly IPluginRegistrationReceipt[] {
    const state = readPreparedAdmissions<
      IRegistration<TDomainCore, TValue>,
      IInstallBatchContext<TDomainCore, TValue>
    >(prepared)
    if (!state || state.host !== this.#port.host || state.committed || state.discarded)
      throw new PluginHostError(
        PluginHostErrorCode.pluginInstallFailed,
        ERROR_TEXT.PLUGIN_INSTALL_FAILED('prepared')
      )
    this.#port.assertActive()
    this.#port.assertMutationAllowed()
    // Retiring a data-order slot does not advance the revision, but a candidate staged on it would
    // bind to a tombstoned segment that compaction may already have dropped, silently losing its
    // stages; a retired slot is therefore drift for the prepared batch that captured it.
    if (
      this.#port.revision() !== state.baseRevision ||
      state.installed.some((registration) => registration.segment?.retired === true)
    )
      throw new PluginHostError(
        PluginHostErrorCode.pluginInstallFailed,
        ERROR_TEXT.PREPARED_ADMISSION_DRIFT
      )
    this.#port.publish(state.installed, state.batch)
    state.committed = true
    return Object.freeze(
      state.installed.map((registration) =>
        createRegistrationReceipt(registration, this.#port.host)
      )
    )
  }

  /** Rolls back an unpublished candidate and returns exact cleanup observations. */
  discardPreparedAdmissions(
    prepared: IPluginPreparedAdmissions
  ): Promise<IPluginHostPhysicalCleanupResult> {
    return this.#port.enqueue(async () => {
      const state = readPreparedAdmissions<
        IRegistration<TDomainCore, TValue>,
        IInstallBatchContext<TDomainCore, TValue>
      >(prepared)
      if (!state || state.host !== this.#port.host || state.committed || state.discarded)
        return emptyPhysicalCleanupResult()
      state.discarded = true
      const errors: unknown[] = []
      for (const registration of [...state.installed].reverse())
        errors.push(...(await this.#port.disposeRegistration(registration, true)))
      return Object.freeze({ cleanupErrors: Object.freeze(errors) })
    })
  }

  /** Binds exact live receipts into one prepared removal capability. */
  prepareUnUseBatch(receipts: readonly IPluginRegistrationReceipt[]): IPluginPreparedRemovalBatch {
    this.#port.assertActive()
    if (!Array.isArray(receipts))
      throw createPluginHostTypeError('registration receipts must be an array')
    const seen = new Set<IRegistration<TDomainCore, TValue>>()
    const registrations = receipts.map((receipt) => {
      /** Exact registration and issuing host bound to this opaque receipt. */
      const resolved = readRegistrationForReceipt(receipt)
      const match = resolved?.registration as IRegistration<TDomainCore, TValue> | undefined
      if (
        !match ||
        resolved?.host !== this.#port.host ||
        this.#port.registrations.get(match.name) !== match ||
        readRegistrationReceipt(match) !== receipt ||
        seen.has(match)
      )
        throw new PluginHostError(
          PluginHostErrorCode.pluginNotInstalled,
          ERROR_TEXT.PLUGIN_NOT_INSTALLED('receipt')
        )
      seen.add(match)
      return match
    })
    return registerPreparedRemoval({
      host: this.#port.host,
      registrations: this.#orderRemoval(registrations),
      committed: false
    })
  }

  /** Commits logical revocation, then drains the caller fence and strict cleanup chain. */
  async commitPreparedUnUseBatch<TView>(
    prepared: IPluginPreparedRemovalBatch,
    options: IPluginBatchRemovalOptions
  ): Promise<IPluginBatchRemovalResult<TView>> {
    const state = readPreparedRemoval<IRegistration<TDomainCore, TValue>>(prepared)
    if (!state || state.host !== this.#port.host || state.committed || !options)
      throw new PluginHostError(
        PluginHostErrorCode.pluginNotInstalled,
        ERROR_TEXT.PLUGIN_NOT_INSTALLED('prepared')
      )
    const beforeCleanup = captureCleanupFence(options.beforeCleanup)
    this.#port.assertActive()
    this.#port.assertMutationAllowed()
    // Registrations may have changed since preparation; the dependency check is re-run at the
    // commit point, which is the only point that actually revokes anything.
    this.#orderRemoval(state.registrations)
    state.committed = true
    for (const registration of state.registrations) {
      this.#port.revokeRegistration(registration)
      this.#port.markRemoved(registration.name)
    }
    this.#port.commitRevision()
    const snapshot = this.#port.createView() as TView
    const physicalTask = this.#runStrictCleanup(state.registrations, beforeCleanup)
    let detail: ICompositionStrictCleanupResult<IRegistration<TDomainCore, TValue>> | undefined
    const completed =
      this.#port.pipelineDrainTimeoutMs === false
        ? await physicalTask.then((value) => {
            detail = value
            return true
          })
        : await boundedWait(
            physicalTask.then((value) => {
              detail = value
            }),
            this.#port.scheduler.now() + this.#port.pipelineDrainTimeoutMs,
            { scheduler: this.#port.scheduler }
          )
    if (completed && detail) {
      const leaves = state.registrations.map((registration) => {
        const leafErrors = detail!.leafErrorsByRegistration.get(registration) ?? Object.freeze([])
        return Object.freeze({
          receipt: readRegistrationReceipt(registration)!,
          name: registration.name,
          cleanupComplete: leafErrors.length === 0,
          cleanupErrors: leafErrors
        })
      })
      return Object.freeze({
        ok: detail.cleanupErrors.length === 0,
        committed: true,
        snapshot,
        leaves: Object.freeze(leaves),
        cleanupComplete: detail.cleanupErrors.length === 0,
        cleanupErrors: detail.cleanupErrors
      })
    }
    const physicalCompletion = physicalTask.then((value) =>
      Object.freeze({ cleanupErrors: value.cleanupErrors })
    )
    return Object.freeze({
      ok: false,
      committed: true,
      snapshot,
      leaves: Object.freeze(
        state.registrations.map((registration) =>
          Object.freeze({
            receipt: readRegistrationReceipt(registration)!,
            name: registration.name,
            cleanupComplete: false,
            cleanupErrors: Object.freeze([]),
            physicalCompletion
          })
        )
      ),
      cleanupComplete: false,
      cleanupErrors: Object.freeze([]),
      physicalCompletion
    })
  }

  /**
   * Rejects a managed removal that would leave a required dependent of a removed registration
   * behind (`DEPENDENCY_BLOCKED`), and orders the set dependents-first for cleanup.
   */
  #orderRemoval(
    registrations: readonly IRegistration<TDomainCore, TValue>[]
  ): readonly IRegistration<TDomainCore, TValue>[] {
    /** Exact roots held by the prepared receipt set. */
    const names = registrations.map((registration) => registration.name)
    /** One canonical plan replaces per-registration blocker scans and a second ordering scan. */
    const plan = planDependencyMutation(
      this.#port.state.dependencyIndex(),
      (name) => this.#port.state.readDependencyState(name),
      { roots: names, kind: DependencyMutationKind.remove, policy: DependencyPolicy.reject }
    )
    if (plan.blockedBy.length > 0)
      throw new PluginHostError(
        PluginHostErrorCode.dependencyBlocked,
        ERROR_TEXT.DEPENDENCY_BLOCKED(names[0] ?? ''),
        { detail: { blockedBy: plan.blockedBy } }
      )
    return Object.freeze(
      plan.order.map((name) => this.#port.registrations.get(name)!).filter(Boolean)
    )
  }

  /** Executes the fence and leaf cleanup chain without a deadline; callers bound observation. */
  async #runStrictCleanup(
    registrations: readonly IRegistration<TDomainCore, TValue>[],
    fence: Promise<void>
  ): Promise<ICompositionStrictCleanupResult<IRegistration<TDomainCore, TValue>>> {
    const errors: unknown[] = []
    const leafErrorsByRegistration = new Map<
      IRegistration<TDomainCore, TValue>,
      readonly unknown[]
    >()
    try {
      await fence
    } catch (error) {
      errors.push(error)
      reportDiagnostic(
        this.#port.diagnostic,
        ERROR_TEXT.CLEANUP_FENCE_REJECTED,
        PluginHostErrorCode.cleanupIncomplete,
        error
      )
    }
    for (const registration of registrations) {
      const leafErrors = await this.#port.disposeRegistrationStrict(registration)
      leafErrorsByRegistration.set(registration, Object.freeze([...leafErrors]))
      errors.push(...leafErrors)
    }
    return Object.freeze({
      cleanupErrors: Object.freeze([...errors]),
      leafErrorsByRegistration
    })
  }
}
