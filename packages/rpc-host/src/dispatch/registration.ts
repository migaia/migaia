/** One cold provider reservation joins the actual native install commit or rollback. */
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { createRpcError } from '../host/error-owner.js'
import type { IProviderMethodEntry } from './types.js'

/** Reservations contain only exact tokens; the sole live catalog retains all executable entries. */
export class ProviderRegistration {
  /** The dispatcher lends its one canonical execution Map, never a second dispatch table. */
  readonly #catalog: Map<string, IProviderMethodEntry>
  /** The original compiled Map doubles as this registration's exact ownership receipt. */
  #entries: ReadonlyMap<string, IProviderMethodEntry> | undefined
  /** Pending keys refer only to their exact transaction token and disappear on commit/rollback. */
  readonly #reservations: Map<string, ProviderRegistration>
  /** One previous exact registration may be replaced by this native installation. */
  #previous: ProviderRegistration | undefined
  /** The canonical cached directory is refreshed once after an actual atomic publication. */
  readonly #refresh: () => void
  /** Rollback and successful retirement are idempotent and cannot revive this registration. */
  #disposed = false
  /** Uncommitted disposal must never remove any live provider entry. */
  #committed = false

  /** Complete all duplicate checks before atomically reserving the compiled cold key set. */
  constructor(
    catalog: Map<string, IProviderMethodEntry>,
    entries: ReadonlyMap<string, IProviderMethodEntry>,
    reservations: Map<string, ProviderRegistration>,
    previous: ProviderRegistration | undefined,
    refresh: () => void
  ) {
    this.#catalog = catalog
    this.#entries = entries
    this.#reservations = reservations
    this.#previous = previous
    this.#refresh = refresh
    for (const [name] of entries) {
      /** Only this exact previous owner's still-live entry may be overwritten at native commit. */
      const current = catalog.get(name)
      if (
        reservations.has(name) ||
        (current !== undefined && !(previous && previous.#owns(catalog, name, current)))
      )
        throw createRpcError(
          RpcCoreErrorCode.providerDuplicated,
          RpcCoreErrorText.providerDuplicated(name)
        )
    }
    for (const name of entries.keys()) reservations.set(name, this)
  }

  /** A held native invocation borrows its exact candidate entry without committing publication. */
  get(name: string): IProviderMethodEntry | undefined {
    return this.#entries?.get(name)
  }

  /** Native commit moves original entries into the sole live catalog and refreshes exactly once. */
  readonly commit = (): void => {
    if (this.#disposed || this.#committed) return
    this.#releaseReservations()
    /** Capture the exact prior receipt before releasing the candidate's retained reference. */
    const previous = this.#previous
    if (previous && previous.#catalog === this.#catalog) {
      previous.#withdraw()
      previous.#disposed = true
    }
    this.#previous = undefined
    for (const [name, entry] of this.#entries!) this.#catalog.set(name, entry)
    this.#committed = true
    this.#refresh()
  }

  /** Candidate rollback releases only its reservations; late old disposal cannot erase a successor. */
  readonly dispose = (): void => {
    if (this.#disposed) return
    this.#disposed = true
    this.#releaseReservations()
    if (this.#committed) {
      this.#withdraw()
    } else this.#entries = undefined
    this.#previous = undefined
    this.#refresh()
  }

  /** Ownership is exact to both the canonical dispatcher and original compiled entry identity. */
  #owns(catalog: Map<string, IProviderMethodEntry>, name: string, entry: IProviderMethodEntry) {
    return (
      this.#catalog === catalog &&
      this.#committed &&
      !this.#disposed &&
      this.#entries?.get(name) === entry
    )
  }

  /** A competing pending token can never release or inherit this transaction's reservation. */
  #releaseReservations(): void {
    if (!this.#entries) return
    for (const name of this.#entries.keys())
      if (this.#reservations.get(name) === this) this.#reservations.delete(name)
  }

  /** Only original entries still owned by this receipt are removed; retained invocations stay valid. */
  #withdraw(): void {
    if (!this.#entries) return
    for (const [name, entry] of this.#entries)
      if (this.#catalog.get(name) === entry) this.#catalog.delete(name)
    this.#entries = undefined
  }
}
