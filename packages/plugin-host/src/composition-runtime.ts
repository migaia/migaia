/**
 * Owns staged composition admission and removal transactions; opaque provenance and native cleanup
 * stay with their existing owners.
 */
import { reverseItems, appendCleanupErrors } from './cleanup-runtime.ts'
import { preflightPluginDefinitions } from './admission-runtime.ts'
import type { PluginHostRemovalRuntime } from './removal-runtime.ts'
import { boundedWait, mergeCleanupResults, type ICleanupResult } from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
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
  resolveAdmissionDefinitions
} from './composition.ts'
import ERROR_TEXT, {
  PluginHostError,
  createPluginHostTypeError,
  PluginHostInternalText
} from './error-text.ts'
import { PluginHostErrorCode } from './error-code.ts'
import { reportDiagnostic } from './diagnostic-report.ts'
import { PluginHostCleanupMode } from './state-constants.ts'
import type { PluginHostState } from './host-state.ts'
import type { IInstallBatchContext, PluginHostInstallRuntime } from './install-runtime.ts'
import type { IPluginDefinition, IRegistration } from './registry.ts'
import type {
  IPluginAdmission,
  IPluginAdmissionRequest,
  IPluginBatchRemovalOptions,
  IPluginBatchRemovalResult,
  IPluginDataOrderSlot,
  IPluginPreparedAdmissions,
  IPluginPreparedRemovalBatch,
  IRegistrationToken
} from './composition-types.ts'
import type { IPluginConstraint } from './plugin-definition-types.ts'
import type { IPluginHostCore } from './plugin-core-types.ts'
import type { IPluginHostPhysicalCleanupResult } from './plugin-lifecycle-types.ts'
import type { IPluginHostDiagnostic } from './host-options-types.ts'

type ICompositionStrictCleanupResult<TRegistration> = ICleanupResult &
  Readonly<{
    readonly leafErrorsByRegistration: ReadonlyMap<TRegistration, ICleanupResult>
  }>

/** Original Host authority captured at construction and acquired by the composition entry on demand. */
export type IPluginHostCompositionRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  readonly host: object
  readonly scheduler: IScheduler
  readonly pipelineDrainTimeoutMs: number | false
  /** Host-owned dependency facts used for one whole-batch removal plan. */
  readonly state: PluginHostState<TDomainCore, TValue>
  readonly assertActive: () => void
  readonly assertMutationAllowed: () => void
  readonly snapshotPlugins: (
    plugins: readonly IPluginConstraint<any>[]
  ) => IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>[]
  readonly enqueue: <T>(task: () => Promise<T>) => Promise<T>
  readonly publish: (
    installed: readonly IRegistration<TDomainCore, TValue>[],
    batch: IInstallBatchContext<TDomainCore, TValue>
  ) => void
  readonly createView: () => unknown
  readonly diagnostic: IPluginHostDiagnostic
  /** Existing installation owner keeps activation and candidate construction together. */
  readonly installation: PluginHostInstallRuntime<TDomainCore, TValue>
  /** Existing removal owner performs cleanup; the Host adds no forwarding layer. */
  readonly removal: PluginHostRemovalRuntime<TDomainCore, TValue>
}>

/** Owns opaque composition capabilities and staged install/removal transactions. */
export class PluginHostCompositionRuntime<TDomainCore extends object, TValue> {
  /** Narrow Host authority required by composition publication and cleanup. */
  readonly #port: IPluginHostCompositionRuntimePort<TDomainCore, TValue>

  /** Retains canonical Host transaction authority; no candidate or cleanup work starts eagerly. */
  constructor(port: IPluginHostCompositionRuntimePort<TDomainCore, TValue>) {
    this.#port = port
  }

  /** Captures one immutable plugin definition behind an opaque admission capability. */
  createPluginAdmission<TPlugin extends IPluginConstraint<any>>(
    plugin: TPlugin
  ): IPluginAdmission<TPlugin> {
    this.#port.assertActive()
    this.#port.assertMutationAllowed()
    /** Canonical snapshot admission runs before any opaque token is created. */
    const definition = this.#port.snapshotPlugins([plugin])[0]
    /** The frozen empty token exposes identity without forgeable captured-definition data. */
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
    /** A live same-name slot cannot be replaced; retirement permits a newly issued lane. */
    const current = this.#port.state.stageSlots.get(name)
    if (current && !current.retired)
      throw createPluginHostTypeError(ERROR_TEXT.DATA_ORDER_SLOT_LIVE(name))
    const { slot, state } = createDataOrderSlotState(
      this.#port.host,
      name,
      this.#port.state.allocateStageSlot()
    )
    this.#port.state.stageSlots.set(name, state)
    this.#port.state.lanes.ensureSlot(state)
    return slot
  }

  /** Permanently retires one exact Host-owned ordering lane. */
  retireDataOrderSlot(slot: IPluginDataOrderSlot): void {
    this.#port.assertActive()
    this.#port.assertMutationAllowed()
    /** Opaque provenance binds this operation to the issuing Host and exact transaction state. */
    const state = readDataOrderSlotState(slot)
    if (!state || state.host !== this.#port.host)
      throw createPluginHostTypeError(ERROR_TEXT.ADMISSION_SLOT_FOREIGN)
    if (state.retired) return
    state.retired = true
    this.#port.state.lanes.retireSlot(state)
    if (this.#port.state.stageSlots.get(state.name) === state)
      this.#port.state.stageSlots.delete(state.name)
  }

  /** Prepares an install candidate without publishing it. */
  async prepareAdmissions(
    requests: readonly IPluginAdmissionRequest[]
  ): Promise<IPluginPreparedAdmissions> {
    this.#port.assertActive()
    this.#port.assertMutationAllowed()
    /** Definition resolution captures publication order before work enters the mutation queue. */
    const definitions = resolveAdmissionDefinitions<
      IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>
    >(requests, this.#port.host)
    return this.#port.enqueue(() => this.#prepareCandidate(definitions))
  }

  /**
   * Runs candidate construction inside the native mutation queue and captures its exact base
   * revision.
   */
  async #prepareCandidate(
    definitions: readonly IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>[]
  ): Promise<IPluginPreparedAdmissions> {
    /** Native install retains no-publication mode and the original setup/install await sequence. */
    const prepared = await this.#port.installation.installBatch(
      preflightPluginDefinitions(definitions, (name) => this.#port.state.registrations.has(name)),
      false
    )
    return registerPreparedAdmissions({
      host: this.#port.host,
      installed: prepared.installed,
      batch: prepared.batch,
      baseRevision: this.#port.state.revision,
      committed: false,
      discarded: false
    })
  }

  /** Publishes one prepared candidate at a single synchronous commit point. */
  commitPreparedAdmissions(prepared: IPluginPreparedAdmissions): readonly IRegistrationToken[] {
    /** Opaque provenance binds this operation to the issuing Host and exact transaction state. */
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
    if (this.#port.state.revision !== state.baseRevision || hasRetiredSegments(state.installed))
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
      /** Opaque provenance binds this operation to the issuing Host and exact transaction state. */
      const state = readPreparedAdmissions<
        IRegistration<TDomainCore, TValue>,
        IInstallBatchContext<TDomainCore, TValue>
      >(prepared)
      if (!state || state.host !== this.#port.host || state.committed || state.discarded)
        return emptyPhysicalCleanupResult()
      state.discarded = true
      /** Cleanup failures retain their original identities and observed release order. */
      const errors: unknown[] = []
      /** Native physical continuations are merged only when bounded work remains unfinished. */
      const physical: Promise<ICleanupResult>[] = []
      for (const registration of reverseItems(state.installed)) {
        /** Native removal owns logical cleanup and reports any surviving physical continuation. */
        const result = await this.#port.removal.disposeRegistration(registration, true)
        appendCleanupErrors(errors, result.cleanupErrors)
        if (result.physicalCompletion) physical.push(result.physicalCompletion)
      }
      return Object.freeze({
        cleanupErrors: Object.freeze(errors),
        ...(physical.length ? { physicalCompletion: mergeCleanupResults(physical) } : {})
      })
    })
  }

  /** Binds exact live receipts into one prepared removal capability. */
  prepareUnUseBatch(receipts: readonly IRegistrationToken[]): IPluginPreparedRemovalBatch {
    this.#port.assertActive()
    if (!Array.isArray(receipts))
      throw createPluginHostTypeError(PluginHostInternalText.REGISTRATION_RECEIPTS_ARRAY)
    /** Exact-generation membership rejects duplicate receipts without scanning previous entries. */
    const seen = new Set<IRegistration<TDomainCore, TValue>>()
    /** Validated original receipt order is projected into one dependency-safe removal plan. */
    const registrations = receipts.map((receipt) => {
      /** Exact registration and issuing host bound to this opaque receipt. */
      const resolved = readRegistrationForReceipt(receipt)
      /** Receipt identity must still resolve to the exact currently committed registration. */
      const match = resolved?.registration as IRegistration<TDomainCore, TValue> | undefined
      if (
        !match ||
        resolved?.host !== this.#port.host ||
        this.#port.state.registrations.get(match.name) !== match ||
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
    /** Opaque provenance binds this operation to the issuing Host and exact transaction state. */
    const state = readPreparedRemoval<IRegistration<TDomainCore, TValue>>(prepared)
    if (!state || state.host !== this.#port.host || state.committed || !options)
      throw new PluginHostError(
        PluginHostErrorCode.pluginNotInstalled,
        ERROR_TEXT.PLUGIN_NOT_INSTALLED('prepared')
      )
    /** The original thenable is captured once before logical revocation can commit. */
    const beforeCleanup = captureCleanupFence(options.beforeCleanup)
    this.#port.assertActive()
    this.#port.assertMutationAllowed()
    // A prepared receipt belongs to one generation, never a replacement sharing its name.
    for (const registration of state.registrations) {
      if (this.#port.state.registrations.get(registration.name) !== registration)
        throw new PluginHostError(
          PluginHostErrorCode.pluginNotInstalled,
          ERROR_TEXT.PLUGIN_NOT_INSTALLED(registration.name)
        )
    }
    // Registrations may have changed since preparation; the dependency check is re-run at the
    // commit point, which is the only point that actually revokes anything.
    this.#orderRemoval(state.registrations)
    /** Every original receipt must admit removal before committed state or publication changes. */
    for (const registration of state.registrations)
      this.#port.removal.assertRemovalAllowed(registration)
    state.committed = true
    for (const registration of state.registrations) {
      this.#port.removal.revokeRegistration(registration)
      this.#port.state.removedNames.add(registration.name)
    }
    this.#port.state.commit()
    /** Publication is read immediately after logical revocation and before awaiting cleanup. */
    const snapshot = this.#port.createView() as TView
    /** One deadline covers all registrations and their release steps. False is explicitly unbounded. */
    const deadlineAt =
      this.#port.pipelineDrainTimeoutMs === false
        ? undefined
        : this.#port.scheduler.now() + this.#port.pipelineDrainTimeoutMs
    /** One strict-cleanup chain retains the original fence, leaf order and shared deadline. */
    const physicalTask = this.#runStrictCleanup(state.registrations, beforeCleanup, deadlineAt)
    /** The bounded observer stores completed detail without translating its cleanup failures. */
    let detail: ICompositionStrictCleanupResult<IRegistration<TDomainCore, TValue>> | undefined
    /** Only the shared cleanup budget determines whether logical removal returns full detail. */
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
            deadlineAt!,
            { scheduler: this.#port.scheduler }
          )
    if (completed && detail) {
      /** Per-leaf reports preserve the dependency-safe physical release order. */
      const leaves = state.registrations.map((registration) => {
        /** Each exact registration receives the original native cleanup result for that leaf. */
        const leaf = detail!.leafErrorsByRegistration.get(registration)!
        /** Leaf completeness uses native collected failures and surviving physical work. */
        const leafErrors = leaf.cleanupErrors
        return Object.freeze({
          receipt: readRegistrationReceipt(registration)!,
          name: registration.name,
          cleanupComplete: leafErrors.length === 0 && !leaf.physicalCompletion,
          ...leaf
        })
      })
      return Object.freeze({
        ok: detail.cleanupErrors.length === 0 && !detail.physicalCompletion,
        committed: true as const,
        snapshot,
        leaves: Object.freeze(leaves),
        cleanupComplete: detail.cleanupErrors.length === 0 && !detail.physicalCompletion,
        cleanupErrors: detail.cleanupErrors,
        ...(detail.physicalCompletion ? { physicalCompletion: detail.physicalCompletion } : {})
      })
    }
    /** Native lifecycle merging exposes work still running beyond the logical removal budget. */
    const physicalCompletion = mergeCleanupResults([physicalTask])
    return Object.freeze({
      ok: false,
      committed: true as const,
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
      plan.order.map((name) => this.#port.state.registrations.get(name)!).filter(Boolean)
    )
  }

  /** Preserves the caller fence, then releases each leaf under the selected shared budget. */
  async #runStrictCleanup(
    registrations: readonly IRegistration<TDomainCore, TValue>[],
    fence: Promise<void>,
    deadlineAt?: number
  ): Promise<ICompositionStrictCleanupResult<IRegistration<TDomainCore, TValue>>> {
    /** Cleanup failures retain their original identities and observed release order. */
    const errors: unknown[] = []
    /** Each original generation retains its own cleanup result for the aggregate leaf projection. */
    const leafErrorsByRegistration = new Map<IRegistration<TDomainCore, TValue>, ICleanupResult>()
    /** Native physical continuations are merged only when bounded work remains unfinished. */
    const physical: Promise<ICleanupResult>[] = []
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
      /** Each exact registration receives the original native cleanup result for that leaf. */
      const leaf = await this.#port.removal.disposeRegistration(
        registration,
        true,
        deadlineAt === undefined ? PluginHostCleanupMode.unbounded : PluginHostCleanupMode.bounded,
        deadlineAt
      )
      leafErrorsByRegistration.set(registration, leaf)
      appendCleanupErrors(errors, leaf.cleanupErrors)
      if (leaf.physicalCompletion) physical.push(leaf.physicalCompletion)
    }
    return Object.freeze({
      cleanupErrors: Object.freeze([...errors]),
      leafErrorsByRegistration,
      ...(physical.length ? { physicalCompletion: mergeCleanupResults(physical) } : {})
    })
  }
}

/**
 * One pass over candidate-owned segments rejects retired-slot drift without copying nested
 * collections.
 */
function hasRetiredSegments<TDomainCore extends object, TValue>(
  registrations: readonly IRegistration<TDomainCore, TValue>[]
): boolean {
  for (const registration of registrations)
    for (const segment of registration.segments.values()) if (segment.retired) return true
  return false
}
