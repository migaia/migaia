import { RpcCoreErrorText } from '../error-text.js'
import { tagRpcError, RpcCoreErrorCode } from '../errors.js'

export class PeerRegistry<T extends string = string> {
  readonly #configured = new Set<T>()
  readonly #learned = new Map<T, number>()
  readonly #maxLearned: number
  readonly #learnedTtlMs: number
  /** Caller-provided clock for peer discovery expiration. */
  readonly #now: () => number

  constructor(now: () => number, maxLearned = 1024, learnedTtlMs = 300_000) {
    if (!Number.isSafeInteger(maxLearned) || maxLearned < 1)
      throw tagRpcError(
        new TypeError(RpcCoreErrorText.maxLearnedMustBeAPositiveSafeInteger),
        RpcCoreErrorCode.invalidConfig
      )
    if (!Number.isSafeInteger(learnedTtlMs) || learnedTtlMs < 1)
      throw tagRpcError(
        new TypeError(RpcCoreErrorText.learnedTtlMsMustBeAPositiveSafeInteger),
        RpcCoreErrorCode.invalidConfig
      )
    this.#maxLearned = maxLearned
    this.#learnedTtlMs = learnedTtlMs
    this.#now = now
  }

  add(id: T, configured = false): void {
    this.#purgeLearned()
    if (configured) {
      this.#configured.add(id)
      this.#learned.delete(id)
      return
    }
    if (this.#configured.has(id)) return
    if (!this.#learned.has(id) && this.#learned.size >= this.#maxLearned) {
      const oldest = this.#learned.keys().next().value
      if (oldest !== undefined) this.#learned.delete(oldest)
    }
    this.#learned.delete(id)
    this.#learned.set(id, this.#now())
  }
  snapshot(): readonly T[] {
    this.#purgeLearned()
    return [...this.#configured, ...this.#learned.keys()]
  }
  remove(id: T): void {
    this.#configured.delete(id)
    this.#learned.delete(id)
  }

  /** Removes discovery state while preserving an explicitly configured peer. */
  removeLearned(id: T): void {
    this.#learned.delete(id)
  }
  has(id: T): boolean {
    this.#purgeLearned()
    return this.#configured.has(id) || this.#learned.has(id)
  }

  /** Clears configured and learned peer state during endpoint disposal. */
  clear(): void {
    this.#configured.clear()
    this.#learned.clear()
  }
  [Symbol.iterator](): Iterator<T> {
    return this.snapshot()[Symbol.iterator]()
  }

  /** Removes learned peers whose authentication knowledge has expired. */
  #purgeLearned(): void {
    const cutoff = this.#now() - this.#learnedTtlMs
    for (const [id, learnedAt] of this.#learned) {
      if (learnedAt <= cutoff) this.#learned.delete(id)
    }
  }
}
