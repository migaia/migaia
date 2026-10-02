import { RpcCoreErrorText } from '../error-text.js'
import { createStringLeaseRegistry, type ILeaseRegistry } from '@migaia/lifecycle'
import { tagRpcError, RpcCoreErrorCode } from '../errors.js'

/** Non-evicting replay ledger for business requests. */
export class RequestReplayLedger {
  /** Accepted requests retain monotonic admission times in insertion order until TTL expiry. */
  readonly #completed = new Map<
    string,
    {
      readonly peerKey: string
      readonly at: number
      /** Releases this tombstone's per-peer lease (idempotent, O(1) admission). */
      readonly releaseCount: () => void
    }
  >()
  /**
   * Rejected keys use the same fixed short TTL, so monotonic admission preserves expiry order. An
   * existing rejected key is never refreshed or moved by duplicate admission.
   */
  readonly #rejected = new Map<string, number>()
  /** Global tombstone budget remains non-evicting before retention expiry. */
  readonly #maxEntries: number
  /** Independently bounded per-peer lease count prevents one peer consuming global capacity. */
  readonly #maxEntriesPerPeer: number
  /** Accepted request retention also bounds the fixed rejected-key TTL. */
  readonly #ttlMs: number
  /** Optional binding retain hook keeps accepted request identity alive until expiry. */
  readonly #retain?: (peerKey: string) => boolean
  /** Paired binding release hook runs only on expiration or owner disposal. */
  readonly #release?: (peerKey: string) => void
  /**
   * Per-peer completed-tombstone counts, owned by `@migaia/lifecycle`'s `LeaseRegistry` so
   * `admit()`/`canAdmit()` read the count in O(1) instead of scanning `#completed` (M-T27). Each
   * admitted tombstone holds one lease; purging/clearing releases it.
   */
  readonly #peerCounts: ILeaseRegistry<string> = createStringLeaseRegistry()

  constructor(
    maxEntries = 4096,
    maxEntriesPerPeer = 1024,
    ttlMs = 310_000,
    lease?: {
      readonly retain: (peerKey: string) => boolean
      readonly release: (peerKey: string) => void
    }
  ) {
    if (
      ![maxEntries, maxEntriesPerPeer, ttlMs].every(Number.isSafeInteger) ||
      maxEntries < 1 ||
      maxEntriesPerPeer < 1 ||
      ttlMs < 1
    )
      throw tagRpcError(
        new TypeError(RpcCoreErrorText.requestReplayLimitsMustBePositiveSafeIntegers),
        RpcCoreErrorCode.invalidConfig
      )
    this.#maxEntries = maxEntries
    this.#maxEntriesPerPeer = maxEntriesPerPeer
    this.#ttlMs = ttlMs
    this.#retain = lease?.retain
    this.#release = lease?.release
  }

  /** Returns true for a fresh tombstone, otherwise admits and records the key. */
  admit(key: string, peerKey: string, now: number): boolean {
    this.#purge(now)
    if (this.#rejected.has(key)) return false
    if (this.#completed.has(key)) return false
    const peerCount = this.#peerCounts.count(peerKey)
    if (peerCount >= this.#maxEntriesPerPeer || this.#completed.size >= this.#maxEntries) {
      if (this.#rejected.size < this.#maxEntries)
        this.#rejected.set(key, now + Math.min(this.#ttlMs, 1_000))
      return false
    }
    if (this.#retain && !this.#retain(peerKey)) return false
    let releaseCount: (() => void) | undefined
    try {
      releaseCount = this.#peerCounts.retain(peerKey)
      this.#completed.set(key, { peerKey, at: now, releaseCount })
      return true
    } catch (error) {
      releaseCount?.()
      this.#release?.(peerKey)
      throw error
    }
  }

  /** Tests whether a fresh tombstone exists without changing it. */
  has(key: string, now: number): boolean {
    this.#purge(now)
    return this.#completed.has(key)
  }

  /** Checks replay capacity before a caller consumes a separate admission quota. */
  canAdmit(key: string, peerKey: string, now: number): boolean {
    this.#purge(now)
    if (this.#rejected.has(key) || this.#completed.has(key)) return false
    const peerCount = this.#peerCounts.count(peerKey)
    return peerCount < this.#maxEntriesPerPeer && this.#completed.size < this.#maxEntries
  }

  /** Reports completed replay entries without exposing mutable ledger state. */
  get size(): number {
    return this.#completed.size
  }

  /** Drops only expired tombstones. */
  clear(): void {
    for (const entry of this.#completed.values()) {
      entry.releaseCount()
      this.#release?.(entry.peerKey)
    }
    this.#completed.clear()
    this.#rejected.clear()
  }

  /** Purges expired tombstones under the endpoint resource owner. */
  purge(now: number): void {
    this.#purge(now)
  }

  /**
   * Purges expired prefixes using the canonical endpoint's monotonic admission clock. Accepted and
   * rejected maps have independently fixed retention, so their insertion order is expiry order;
   * live suffixes are never scanned, evicted, or refreshed.
   */
  #purge(now: number): void {
    for (const [key, entry] of this.#completed) {
      if (now - entry.at < this.#ttlMs) break
      this.#completed.delete(key)
      entry.releaseCount()
      this.#release?.(entry.peerKey)
    }
    for (const [key, expiresAt] of this.#rejected) {
      if (expiresAt > now) break
      this.#rejected.delete(key)
    }
  }
}
