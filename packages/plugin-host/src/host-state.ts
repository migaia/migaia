import { createTopologyIndex, type ITopologyIndex } from '@migaia/capability/graph/topology'
import type { IDependencyNodeState } from '@migaia/capability/graph/dependency'
import { StageLanes } from './stage-lanes.js'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { PluginHostRegistrationLifecycle } from './state-constants.js'
import type { IDataOrderSlotState } from './composition.js'
import type { IInstallBatchContext } from './install-runtime.js'
import type {
  IExtensionOwner,
  IRegistration,
  ISharedExtensionSlot,
  ISharedExtensionContribution,
  ISharedExtensionBucket
} from './registry.js'
import type { IPluginRuntimeSharedSlot } from './core.js'
import { assertPluginExtensionKey, isSharedExtensionSlot } from './extension.js'
import { createPluginHostTypeError } from './error-text.js'
import { toIndexNode } from './dependency-runtime.js'

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
  readonly extensionOwners = new Map<PropertyKey, IExtensionOwner<TDomainCore, TValue>>()
  /** Concrete class/frozen-handle publication reads the same canonical extension owner. */
  #sharedPublication:
    | Readonly<{
        assertActive(): void
        publish(key: PropertyKey): void
      }>
    | undefined
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

  /** The original Host installs these callbacks once before admitting any plugin installation. */
  configureSharedPublication(
    publication: Readonly<{
      assertActive(): void
      publish(key: PropertyKey): void
    }>
  ): void {
    this.#sharedPublication = publication
  }

  /** Read only the committed shared facade; exclusive extensions retain original snapshot semantics. */
  readSharedExtension(key: PropertyKey): object | undefined {
    /** Exact owner equality prevents an old facade from reading a later same-key registration. */
    const owner = this.extensionOwners.get(key)
    return owner && isSharedExtensionSlot(owner) && !owner.retired ? owner.facade : undefined
  }

  /** Immutable class publication reserves the same key and family for this Host's lifetime. */
  ownsSharedExtension(key: PropertyKey): boolean {
    /** Retired ownership remains in the original map, without a second publication registry. */
    const owner = this.extensionOwners.get(key)
    return owner !== undefined && isSharedExtensionSlot(owner)
  }

  /** Stage one family-authorized contribution inside the existing atomic installation batch. */
  acquireSharedSlot<TFacade extends object>(
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue>,
    key: PropertyKey,
    family: object,
    create: (view: IPluginRuntimeSharedSlot<TFacade>) => TFacade,
    assertInstall: () => void,
    assertContribution: () => void
  ): IPluginRuntimeSharedSlot<TFacade> {
    assertInstall()
    assertPluginExtensionKey(registration.name, key)
    if (typeof family !== 'object' || family === null || typeof create !== 'function')
      throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION)
    /** Candidate overlay remains invisible to committed publication. */
    const candidate = batch.extensionOwners.get(key)
    /** A committed shared family survives retirement of its first member. */
    const committed = this.extensionOwners.get(key)
    /** Ordinary exclusive ownership is released only by the existing replacement batch. */
    const owner =
      candidate ??
      (committed && !isSharedExtensionSlot(committed) && batch.releasedOwners.has(committed)
        ? undefined
        : committed)
    if (owner && (!isSharedExtensionSlot(owner) || owner.family !== family))
      throw new PluginHostError(
        PluginHostErrorCode.extensionDuplicate,
        ERROR_TEXT.EXTENSION_DUPLICATE(registration.name, key)
      )
    /** All address indexes are part of this one canonical slot, never an adapter-side host registry. */
    const slot: ISharedExtensionSlot<TDomainCore, TValue> =
      owner && isSharedExtensionSlot(owner) && !owner.retired
        ? owner
        : {
            key,
            family,
            facade: {},
            retired: false,
            contributions: new Set(),
            registrations: new Set(),
            names: new Map(),
            instanceIds: new Map()
          }
    /** Writes are exact-registration scoped; facade reads require committed slot identity. */
    const view: IPluginRuntimeSharedSlot<TFacade> = Object.freeze({
      get facade() {
        return slot.facade as TFacade
      },
      find: (target: string): object | null | undefined => {
        this.#sharedPublication?.assertActive()
        if (slot.retired || this.extensionOwners.get(key) !== slot) return undefined
        /** Instance identity takes precedence over an equal human name. */
        const instances = slot.instanceIds.get(target) ?? slot.names.get(target)
        if (instances && instances.members.size !== 1) return null
        /** Both indexes select one receipt before the original registration's availability check. */
        const receipt = instances?.single
        return receipt &&
          this.isLive(receipt.registration) &&
          receipt.registration.activated &&
          !receipt.registration.suspended
          ? receipt.value
          : undefined
      },
      values: (): readonly object[] =>
        this.extensionOwners.get(key) === slot
          ? [...slot.contributions.values()].map((receipt) => receipt.value)
          : [],
      contribute: (value: object, instanceId: string): (() => void) => {
        assertContribution()
        if (
          typeof value !== 'object' ||
          value === null ||
          typeof instanceId !== 'string' ||
          !instanceId
        )
          throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION)
        if (slot.retired)
          throw new PluginHostError(
            PluginHostErrorCode.registrationRevoked,
            ERROR_TEXT.REGISTRATION_REVOKED
          )
        /** Candidate rollback cannot erase any committed or successor receipt. */
        const receipt = Object.freeze({ slot, registration, instanceId, value })
        if (!batch.committed) batch.sharedContributions.push(receipt)
        ;(registration.sharedContributions ??= []).push(receipt)
        if (batch.committed) this.#updateSharedContribution(receipt, true)
        return () => {
          /** Candidate withdrawal never publishes and late cleanup cannot affect a successor. */
          const candidate = batch.sharedContributions.indexOf(receipt)
          if (candidate !== -1) batch.sharedContributions.splice(candidate, 1)
          this.#updateSharedContribution(receipt, false)
          const owned = registration.sharedContributions?.indexOf(receipt) ?? -1
          if (owned !== -1) registration.sharedContributions!.splice(owned, 1)
        }
      }
    })
    if (!owner || (isSharedExtensionSlot(owner) && owner.retired)) {
      slot.facade = create(view)
      if (typeof slot.facade !== 'object' || slot.facade === null)
        throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION)
    }
    batch.extensionOwners.set(key, slot)
    if (!registration.sharedSlots?.includes(slot)) (registration.sharedSlots ??= []).push(slot)
    return view
  }

  /** Returns the host's single mutable dependency index to planning and commit paths. */
  dependencyIndex(): ITopologyIndex {
    return this.#index
  }

  /** Projects one committed registration into capability's orthogonal dependency state. */
  readDependencyState(name: string): IDependencyNodeState {
    /** Registration named by an index node; index and registry commits stay atomic. */
    const registration = this.registrations.get(name)!
    return {
      activated: registration.activated,
      enabled: registration.enabled,
      suspended: registration.suspended,
      stale: registration.stale
    }
  }

  /** Writes one registration's enablement through the host's visibility owner. */
  setEnabled(registration: IRegistration<TDomainCore, TValue>, enabled: boolean): void {
    registration.enabled = enabled
    this.lanes.invalidate()
  }

  /** Writes one registration's suspension through the host's visibility owner. */
  setSuspended(registration: IRegistration<TDomainCore, TValue>, suspended: boolean): void {
    registration.suspended = suspended
    this.lanes.invalidate()
  }

  /** Records whether a retained instance must reinstall when its providers recover. */
  setStale(registration: IRegistration<TDomainCore, TValue>, stale: boolean): void {
    registration.stale = stale
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
    for (const receipt of batch.sharedContributions)
      if (receipt.slot.retired)
        throw new PluginHostError(
          PluginHostErrorCode.registrationRevoked,
          ERROR_TEXT.REGISTRATION_REVOKED
        )
    /** Replacement's old and new exact receipts may retain one slot in this same commit. */
    const retainedSlots = new Set([...batch.extensionOwners.values()].filter(isSharedExtensionSlot))
    for (const registration of installed) {
      /** Registration currently owning this name before candidate publication, if any. */
      const previous = this.registrations.get(registration.name)
      if (previous && previous !== registration && !registration.segment)
        registration.segment = previous.segment
      /** Canonical dependency node derived from the admitted plugin snapshot. */
      const node = toIndexNode(registration.name, registration.plugin)
      if (!previous) this.#index.add(node)
      else if (previous !== registration)
        this.#index.setDependencies(registration.name, node.dependencies)
      this.registrations.set(registration.name, registration)
      this.removedNames.delete(registration.name)
    }
    for (const released of batch.releasedOwners)
      this.#revokeSharedContributions(released, retainedSlots)
    for (const released of batch.releasedOwners)
      for (const { key } of released.extensions)
        if (this.extensionOwners.get(key) === released) this.extensionOwners.delete(key)
    for (const [key, owner] of batch.extensionOwners)
      if (
        !isSharedExtensionSlot(owner) ||
        installed.some((registration) => registration.sharedSlots?.includes(owner))
      )
        this.extensionOwners.set(key, owner)
    for (const registration of installed)
      for (const slot of registration.sharedSlots ?? []) {
        slot.registrations.add(registration)
        this.#sharedPublication?.publish(slot.key)
      }
    for (const receipt of batch.sharedContributions) {
      this.#updateSharedContribution(receipt, true)
    }
    for (const registration of installed) this.lanes.bindOwner(registration)
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
    this.#revokeSharedContributions(registration)
    for (const { key } of [...registration.extensions].reverse())
      if (this.extensionOwners.get(key) === registration) this.extensionOwners.delete(key)
    if (this.registrations.get(registration.name) === registration) {
      this.registrations.delete(registration.name)
      this.#index.remove(registration.name)
    }
  }

  /** Retire only this exact receipt; candidate rollback and late cleanup cannot touch a successor. */
  #revokeSharedContributions(
    registration: IRegistration<TDomainCore, TValue>,
    retainedSlots?: ReadonlySet<ISharedExtensionSlot<TDomainCore, TValue>>
  ): void {
    for (const receipt of registration.sharedContributions ?? [])
      this.#updateSharedContribution(receipt, false)
    for (const slot of registration.sharedSlots ?? []) {
      slot.registrations.delete(registration)
      if (
        slot.registrations.size === 0 &&
        !retainedSlots?.has(slot) &&
        this.extensionOwners.get(slot.key) === slot
      ) {
        slot.retired = true
      }
    }
    registration.sharedContributions = []
    registration.sharedSlots = []
  }

  /** Update exact ready membership and both canonical indexes through one publication owner. */
  #updateSharedContribution(
    receipt: ISharedExtensionContribution<TDomainCore, TValue>,
    publish: boolean
  ): void {
    /** The original registration retains its slot while physical generations rebind. */
    const slot = receipt.slot
    if (publish) {
      this.extensionOwners.set(slot.key, slot)
      slot.contributions.add(receipt)
    } else if (!slot.contributions.delete(receipt)) return
    for (const [index, key] of [
      [slot.names, receipt.registration.name],
      [slot.instanceIds, receipt.instanceId]
    ] as const) {
      /** One exact bucket is updated; stale cleanup never removes a successor receipt. */
      const bucket: ISharedExtensionBucket<TDomainCore, TValue> = index.get(key) ?? {
        members: new Set<ISharedExtensionContribution<TDomainCore, TValue>>(),
        single: undefined
      }
      if (publish) {
        bucket.members.add(receipt)
        index.set(key, bucket)
      } else {
        bucket.members.delete(receipt)
        if (bucket.members.size === 0) index.delete(key)
      }
      bucket.single = undefined
      // Membership changes are cold; hot selection reads the cached receipt without an iterator.
      if (bucket.members.size === 1)
        bucket.members.forEach((remaining) => {
          bucket.single = remaining
        })
    }
    if (publish) this.#sharedPublication?.publish(slot.key)
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
}
