/**
 * Owns one registration's view of a shared extension slot: address lookup, ready and registered
 * enumeration, reservation metadata and contribution receipts. Slot state, ownership and
 * publication stay with Host state; this view only reads them and stages this registration's
 * writes.
 */
import ERROR_TEXT, { PluginHostError, createPluginHostTypeError } from './error-text.ts'
import { PluginHostErrorCode } from './error-code.ts'
import type { IInstallBatchContext } from './install-runtime.ts'
import type {
  IExtensionOwner,
  IRegistration,
  ISharedExtensionContribution,
  ISharedExtensionReservation,
  ISharedExtensionSlot
} from './registry.ts'
import type { IPluginRuntimeSharedSlot } from './core.ts'

/** Host state reads and writes a slot view needs; it grants no ownership change. */
export type ISharedSlotViewPort<TDomainCore extends object, TValue> = Readonly<{
  /** Rejects once the Host is closing or disposed. */
  assertActive(): void
  /** Current committed owner of an extension key. */
  ownerOf(key: PropertyKey): IExtensionOwner<TDomainCore, TValue> | undefined
  /** Committed registration under a plugin name. */
  registrationNamed(name: string): IRegistration<TDomainCore, TValue> | undefined
  /** Whether a registration is still the live committed generation. */
  isLive(registration: IRegistration<TDomainCore, TValue>): boolean
  /** Publishes or withdraws one committed contribution. */
  updateContribution(receipt: ISharedExtensionContribution<TDomainCore, TValue>, add: boolean): void
}>

/** One registration's frozen view of a shared slot, handed to the slot's facade factory. */
export class SharedSlotView<
  TDomainCore extends object,
  TValue,
  TFacade extends object
> implements IPluginRuntimeSharedSlot<TFacade> {
  declare readonly facade: TFacade
  /** Host state access for reads and committed contribution updates. */
  readonly #port: ISharedSlotViewPort<TDomainCore, TValue>
  /** Canonical slot the view reads. */
  readonly #slot: ISharedExtensionSlot<TDomainCore, TValue>
  /** Extension key the slot is published under. */
  readonly #key: PropertyKey
  /** Registration that owns this view's writes. */
  readonly #registration: IRegistration<TDomainCore, TValue>
  /** Install batch whose commit publishes staged receipts. */
  readonly #batch: IInstallBatchContext<TDomainCore, TValue>
  /** This registration's reservation, carrying metadata until install commit. */
  readonly #reservation: ISharedExtensionReservation<TDomainCore, TValue>
  /** Re-validates the owning registration before any write. */
  readonly #assertContribution: () => void

  /** Captures the slot and the owning registration; `facade` reads the slot's current facade. */
  constructor(
    port: ISharedSlotViewPort<TDomainCore, TValue>,
    slot: ISharedExtensionSlot<TDomainCore, TValue>,
    key: PropertyKey,
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue>,
    reservation: ISharedExtensionReservation<TDomainCore, TValue>,
    assertContribution: () => void
  ) {
    this.#port = port
    this.#slot = slot
    this.#key = key
    this.#registration = registration
    this.#batch = batch
    this.#reservation = reservation
    this.#assertContribution = assertContribution
    Object.defineProperty(this, 'facade', {
      enumerable: true,
      get: () => slot.facade as TFacade
    })
  }

  /** Whether this view's slot is still the committed, unretired owner of its key. */
  #isCurrent(): boolean {
    return !this.#slot.retired && this.#port.ownerOf(this.#key) === this.#slot
  }

  /** Resolves one ready contribution by instance id, then by name; ambiguous names return null. */
  readonly find = (target: string): object | null | undefined => {
    this.#port.assertActive()
    if (!this.#isCurrent()) return undefined
    /** Instance identity takes precedence over an equal human name. */
    const instances = this.#slot.instanceIds.get(target) ?? this.#slot.names.get(target)
    if (instances && instances.members.size !== 1) return null
    /** Both indexes select one receipt before the original registration's availability check. */
    const receipt = instances?.single
    return receipt &&
      this.#port.isLive(receipt.registration) &&
      receipt.registration.activated &&
      !receipt.registration.suspended
      ? receipt.value
      : undefined
  }

  /** Ready contribution values in publication order. */
  readonly values = (): readonly object[] => this.#readValues()

  /** Projects the exact committed slot's ready receipts without rebuilding any ownership index. */
  #readValues(): readonly object[] {
    return this.#port.ownerOf(this.#key) === this.#slot
      ? Array.from(this.#slot.contributions, (receipt) => receipt.value)
      : []
  }

  /** Cold enumeration includes suspended or non-ready units, but never candidates or old owners. */
  readonly registered = (): readonly object[] => {
    if (!this.#isCurrent()) return []
    /** Values of registrations that are still the committed generation. */
    const values: object[] = []
    for (const [owner, entry] of this.#slot.registrations)
      if (this.#port.registrationNamed(owner.name) === owner && entry.value !== undefined)
        values.push(entry.value)
    return values
  }

  /** Annotates this registration's reservation; metadata is published with its install commit. */
  readonly register = (value: object, onCommit?: () => void): void => {
    this.#assertContribution()
    if (typeof value !== 'object' || value === null)
      throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION)
    this.#reservation.value = value
    this.#reservation.onCommit = onCommit
  }

  /** Stages or publishes one ready contribution and returns its exact withdrawal. */
  readonly contribute = (value: object, instanceId: string): (() => void) =>
    this.#contribute(value, instanceId)

  /** Stages the exact receipt and returns its withdrawal under this original registration owner. */
  #contribute(value: object, instanceId: string): () => void {
    this.#assertContribution()
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof instanceId !== 'string' ||
      !instanceId
    )
      throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION)
    if (this.#slot.retired)
      throw new PluginHostError(
        PluginHostErrorCode.registrationRevoked,
        ERROR_TEXT.REGISTRATION_REVOKED
      )
    /** Exact registration retains ownership even if a successor later takes the same name. */
    const registration = this.#registration
    /** This original batch owns staged receipts until its native publication commits. */
    const batch = this.#batch
    /** Candidate rollback cannot erase any committed or successor receipt. */
    const receipt = Object.freeze({ slot: this.#slot, registration, instanceId, value })
    if (!batch.committed) batch.sharedContributions.add(receipt)
    ;(registration.sharedContributions ??= new Set()).add(receipt)
    if (batch.committed) this.#port.updateContribution(receipt, true)
    /** Withdrawal carries only its exact receipt and original batch, never another generation. */
    const withdrawal = { batch, receipt }
    return () => this.#withdraw(withdrawal)
  }

  /** Removes the exact staged or committed receipt; late cleanup cannot affect a successor. */
  #withdraw(
    withdrawal: Readonly<{
      readonly batch: IInstallBatchContext<TDomainCore, TValue>
      readonly receipt: ISharedExtensionContribution<TDomainCore, TValue>
    }>
  ): void {
    const { batch, receipt } = withdrawal
    batch.sharedContributions.delete(receipt)
    this.#port.updateContribution(receipt, false)
    receipt.registration.sharedContributions?.delete(receipt)
  }
}
