import { createTopologyIndex, type ITopologyIndex } from '@migaia/capability/graph/topology'
import { DependencyNodeStatus } from '@migaia/capability/graph/dependency'
import { StageLanes } from './stage-lanes.js'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { PluginHostRegistrationLifecycle } from './state-constants.js'
import type { IDataOrderSlotState } from './composition.js'
import type { IInstallBatchContext } from './install-runtime.js'
import type { IRegistration } from './registry.js'

/** Creates the host-owned dependency index and translates structural failures at its boundary. */
const createDependencyIndex = (): ITopologyIndex =>
  createTopologyIndex({
    onCycle: () => {
      throw new PluginHostError(PluginHostErrorCode.dependencyCycle, ERROR_TEXT.DEPENDENCY_CYCLE)
    },
    onInvalid: () => {
      throw new PluginHostError(
        PluginHostErrorCode.pluginDefinitionInvalid,
        ERROR_TEXT.PLUGIN_DEFINITION_INVALID
      )
    }
  })

/**
 * Every piece of mutable state a host shares with its runtimes, in one owner.
 *
 * These fields used to be private fields of `PluginHost`, handed to eight runtimes through port
 * literals that closed over `this`. That forced a construction order — a runtime could not be built
 * before the field it reads existed — and the order was maintained by assigning some fields after
 * the runtimes were already constructed. One holder removes both: the state is complete before any
 * runtime sees it, so the ports carry a reference instead of a closure and the deferred assignments
 * have nothing left to defer.
 *
 * Initial values are stated here and nowhere else: four empty maps, an empty lane set, slot ordinal
 * `0n` and revision `0`.
 */
export class PluginHostState<TDomainCore extends object, TValue> {
  /** Persistent dependency facts shared by every planner invocation for this host. */
  readonly #index = createDependencyIndex()
  /** Installed registrations by plugin name. */
  readonly registrations = new Map<string, IRegistration<TDomainCore, TValue>>()
  /** Registration owner for each immutable extension view slot. */
  readonly extensionOwners = new Map<PropertyKey, IRegistration<TDomainCore, TValue>>()
  /** Live definition lanes, written only through the composition entry. */
  readonly stageSlots = new Map<string, IDataOrderSlotState>()
  /** The four pipeline lanes and the snapshot rule that governs reading them. */
  readonly lanes = new StageLanes<TValue>()
  /**
   * Names whose registration left through removal (not replacement) and has not been reinstalled.
   * It lets dependency validation tell `PREREQUISITE_REMOVED` apart from `PREREQUISITE_MISSING`.
   */
  readonly removedNames = new Set<string>()
  /** Next host-owned slot ordinal for a never-before-seen plugin name. */
  #nextStageSlot = 0n
  /** Monotonic view generation; every committed mutation advances it by one. */
  #revision = 0

  get revision(): number {
    return this.#revision
  }

  /** Returns the host's single mutable dependency index to planning and commit paths. */
  dependencyIndex(): ITopologyIndex {
    return this.#index
  }

  /** Projects one committed registration into the status vocabulary owned by capability. */
  readDependencyStatus(name: string): DependencyNodeStatus {
    /** Registration named by an index node; index and registry commits stay atomic. */
    const registration = this.registrations.get(name)!
    if (!registration.enabled) return DependencyNodeStatus.disabled
    if (registration.suspended) return DependencyNodeStatus.suspended
    if (!registration.activated) return DependencyNodeStatus.inactive
    return DependencyNodeStatus.active
  }

  /** Reserves the next ordering ordinal. Ordinals are never reused, so order stays total. */
  allocateStageSlot(): bigint {
    return this.#nextStageSlot++
  }

  /** Advances the view generation. Called once per committed mutation, never speculatively. */
  commit(): void {
    this.#revision += 1
  }

  /** Publishes one prepared install batch atomically into the tables owned by this state. */
  publishInstallBatch(
    installed: readonly IRegistration<TDomainCore, TValue>[],
    batch: IInstallBatchContext<TDomainCore, TValue>
  ): void {
    for (const registration of installed) {
      this.registrations.set(registration.name, registration)
      this.removedNames.delete(registration.name)
    }
    for (const [key, registration] of batch.extensionOwners)
      this.extensionOwners.set(key, registration)
    this.lanes.replace(batch)
    batch.committed = true
    this.commit()
  }

  /**
   * Detaches one registration from every host-visible table, synchronously and without user code.
   *
   * It lives with the state rather than on the host because it is the state's own bookkeeping —
   * `SM08` requires registration teardown to have one owner instead of the host and the removal
   * runtime each deleting half. Idempotent: a second call finds nothing of its own left and removes
   * nothing belonging to whoever claimed the key next.
   */
  closeRegistration(registration: IRegistration<TDomainCore, TValue>): void {
    for (const { key } of [...registration.extensions].reverse())
      if (this.extensionOwners.get(key) === registration) this.extensionOwners.delete(key)
    if (this.registrations.get(registration.name) === registration)
      this.registrations.delete(registration.name)
  }

  /**
   * Rejects a registration that is neither the current install nor a committed one.
   *
   * The two admissible cases are different in kind: during install the operation runtime owns the
   * answer, and afterwards the registration table does. Both live here, so a caller cannot satisfy
   * one and forget the other.
   */
  assertRegistrationValid(
    registration: IRegistration<TDomainCore, TValue>,
    assertCurrent: (registration: IRegistration<TDomainCore, TValue>) => void
  ): void {
    if (registration.lifecycle === PluginHostRegistrationLifecycle.install) {
      assertCurrent(registration)
      return
    }
    if (this.registrations.get(registration.name) === registration) return
    throw new PluginHostError(
      PluginHostErrorCode.pluginNotInstalled,
      ERROR_TEXT.PLUGIN_NOT_INSTALLED(registration.name)
    )
  }

  /** Whether this exact registration is still the committed owner of its name. */
  isLive(registration: IRegistration<TDomainCore, TValue>): boolean {
    return (
      registration.installed &&
      registration.enabled &&
      this.registrations.get(registration.name) === registration
    )
  }

  /** Current enabled registrations in stable installation order. */
  enabledRegistrations(): readonly IRegistration<TDomainCore, TValue>[] {
    return [...this.registrations.values()].filter((registration) => registration.enabled)
  }
}
