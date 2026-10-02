import { RpcCoreErrorText } from '../error-text.js'
import { tagRpcError, RpcCoreErrorCode } from '../errors.js'

/** Owns bounded active outbound identifiers and released replay tombstones. */
export class ReplayWindow {
  /** Active identifiers have no expiry and remain reserved until explicit release. */
  readonly #activeIds = new Set<string>()
  /**
   * Released identifiers remain as TTL-bounded tombstones to reject late reuse. Monotonic release
   * times preserve insertion order, so expiration removes only the oldest prefix.
   */
  readonly #releasedIds = new Map<string, number>()
  /** Combined active/tombstone budget; expired entries alone may return capacity. */
  readonly #maxEntries: number
  /** Retention after settlement; successful completion never bypasses the replay boundary. */
  readonly #ttlMs: number
  /** Endpoint clock for replay tombstone expiration. */
  readonly #now: () => number

  /** Owns one bounded namespace using the endpoint's supported monotonic clock. */
  constructor(now: () => number, maxEntries = 4096, ttlMs = 310_000) {
    if (
      !Number.isSafeInteger(maxEntries) ||
      maxEntries < 1 ||
      !Number.isSafeInteger(ttlMs) ||
      ttlMs < 1
    )
      throw tagRpcError(
        new TypeError(RpcCoreErrorText.replayLimitsMustBePositiveSafeIntegers),
        RpcCoreErrorCode.invalidConfig
      )
    this.#maxEntries = maxEntries
    this.#ttlMs = ttlMs
    this.#now = now
  }

  /** Tests whether an outbound identifier remains reserved. */
  hasReservedId(id: string): boolean {
    this.#purgeReleasedIds()
    return this.#activeIds.has(id) || this.#releasedIds.has(id)
  }

  /** Reserves an outbound identifier for the replay window. */
  reserveId(id: string): boolean {
    this.#purgeReleasedIds()
    if (this.#activeIds.has(id) || this.#releasedIds.has(id)) return false
    if (this.#activeIds.size + this.#releasedIds.size >= this.#maxEntries) return false
    this.#activeIds.add(id)
    return true
  }

  /** Moves an active identifier to a TTL-bounded tombstone after settlement. */
  releaseId(id: string): void {
    if (!this.#activeIds.delete(id)) return
    this.#releasedIds.set(id, this.#now())
  }

  /**
   * Removes an identifier after its owner has already completed the full replay retention window.
   * This is distinct from `releaseId()`: no second tombstone is needed once the caller has proved
   * that the original retention window has elapsed, so the capacity slot becomes reusable
   * immediately.
   */
  expireId(id: string): void {
    this.#activeIds.delete(id)
    this.#releasedIds.delete(id)
  }

  /** The replay retention window; used by owners that mirror this ledger's TTL. */
  get ttlMs(): number {
    return this.#ttlMs
  }

  /** Maximum entries in each independently bounded replay namespace. */
  get maxEntries(): number {
    return this.#maxEntries
  }

  /** Releases all replay state during endpoint disposal. */
  clear(): void {
    this.#activeIds.clear()
    this.#releasedIds.clear()
  }

  /**
   * Removes only the expired prefix. Each removed entry is visited once over its lifetime; an
   * access with no expiration inspects only the first live entry, regardless of retained count.
   */
  #purgeReleasedIds(): void {
    /** One monotonic read keeps the entire purge on the same retention boundary. */
    const now = this.#now()
    for (const [key, releasedAt] of this.#releasedIds) {
      if (now - releasedAt < this.#ttlMs) break
      this.#releasedIds.delete(key)
    }
  }
}
