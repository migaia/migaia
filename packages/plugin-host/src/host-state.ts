import { StageLanes } from './stage-lanes.js'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { PluginHostRegistrationLifecycle } from './state-constants.js'
import type { IDataOrderSlotState } from './composition.js'
import type { IInstallBatchContext } from './install-runtime.js'
import type { IRegistration, ISharedEntry } from './registry.js'

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
  /** Installed registrations by plugin name. */
  readonly registrations = new Map<string, IRegistration<TDomainCore, TValue>>()
  /** Published shared entries by key, with their owning registration. */
  readonly shared = new Map<PropertyKey, ISharedEntry<TDomainCore, TValue>>()
  /** Last owner name for shared keys removed from the active table. */
  readonly retiredShared = new Map<PropertyKey, string>()
  /** Registration owner for each immutable extension view slot. */
  readonly extensionOwners = new Map<PropertyKey, IRegistration<TDomainCore, TValue>>()
  /** Live definition lanes, written only through the composition entry. */
  readonly stageSlots = new Map<string, IDataOrderSlotState>()
  /** The four pipeline lanes and the snapshot rule that governs reading them. */
  readonly lanes = new StageLanes<TValue>()
  /** Next host-owned slot ordinal for a never-before-seen plugin name. */
  #nextStageSlot = 0n
  /** Monotonic view generation; every committed mutation advances it by one. */
  #revision = 0

  get revision(): number {
    return this.#revision
  }

  /** Reserves the next ordering ordinal. Ordinals are never reused, so order stays total. */
  allocateStageSlot(): bigint {
    return this.#nextStageSlot++
  }

  /** Advances the view generation. Called once per committed mutation, never speculatively. */
  commit(): void {
    this.#revision += 1
  }

  /** Reads a committed shared key, distinguishing disabled, removed and never-registered owners. */
  getShared<T = unknown>(key: PropertyKey): T | undefined {
    const entry = this.shared.get(key)
    if (entry) {
      if (!entry.owner.enabled)
        throw new PluginHostError(
          PluginHostErrorCode.prerequisiteDisabled,
          ERROR_TEXT.PREREQUISITE_DISABLED(key, entry.owner.name),
          { detail: { key, owner: entry.owner.name, recoverable: true } }
        )
      return entry.value as T
    }
    const retiredOwner = this.retiredShared.get(key)
    if (retiredOwner !== undefined)
      throw new PluginHostError(
        PluginHostErrorCode.prerequisiteRemoved,
        ERROR_TEXT.PREREQUISITE_REMOVED(key, retiredOwner),
        { detail: { key, owner: retiredOwner, recoverable: false } }
      )
    return undefined
  }

  /** Publishes one prepared install batch atomically into the tables owned by this state. */
  publishInstallBatch(
    installed: readonly IRegistration<TDomainCore, TValue>[],
    batch: IInstallBatchContext<TDomainCore, TValue>
  ): void {
    for (const registration of installed) this.registrations.set(registration.name, registration)
    for (const [key, entry] of batch.shared) {
      this.shared.set(key, entry)
      this.retiredShared.delete(key)
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
    for (const key of registration.shared)
      if (this.shared.get(key)?.owner === registration) {
        this.shared.delete(key)
        this.retiredShared.set(key, registration.name)
      }
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
