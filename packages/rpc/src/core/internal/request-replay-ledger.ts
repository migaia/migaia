import { RpcCoreErrorText } from '../error-text.js'
import { createStringLeaseRegistry, type ILeaseRegistry } from '@migaia/lifecycle'
import { tagRpcError, RpcCoreErrorCode } from '../errors.js'

/** Each entry owns its exact lease and admission mode until final settlement or disposal. */
type IReplayEntry = {
  readonly peerKey: string
  readonly at: number
  readonly active: boolean
  readonly releaseCount: () => void
}

/** Exact group entries either roll back before execution or settle under the original replay mode. */
export type IReplayReservation = Readonly<{
  rollback(): void
  release(now: number): void
}>

/** Non-evicting replay ledger for business requests. */
export class RequestReplayLedger {
  /** Accepted requests retain monotonic admission times in insertion order until TTL expiry. */
  readonly #completed = new Map<string, IReplayEntry>()
  /** In-flight L and protected legacy streams never enter the ordered expiry prefix. */
  readonly #active = new Map<string, IReplayEntry>()
  /** Reentrant identity retention cannot insert after the physical owner clears this generation. */
  #generation = 0
  /** Pure owner mode: true is L, false is live legacy, undefined is terminal. */
  readonly #activeOnly: () => boolean | undefined
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
    },
    activeOnly: () => boolean | undefined = () => false
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
    this.#activeOnly = activeOnly
  }

  /** Returns true for a fresh tombstone, otherwise admits and records the key. */
  admit(
    key: string,
    peerKey: string,
    now: number,
    activeOverride?: boolean,
    holdUntilSettlement = false
  ): boolean {
    /** Snapshot mode before any identity callback can retire or downgrade the resource. */
    const mode = this.#activeOnly()
    if (mode === undefined) return false
    /** Clear is the reentrancy barrier; qualification getters never perform cleanup themselves. */
    const generation = this.#generation
    /** Auth-bound members may use L only when their physical owner is also qualified. */
    const active = activeOverride ?? mode
    this.#purge(now)
    if (this.#rejected.has(key)) return false
    if (this.#completed.has(key) || this.#active.has(key)) return false
    const peerCount = this.#peerCounts.count(peerKey)
    if (peerCount >= this.#maxEntriesPerPeer || this.size >= this.#maxEntries) {
      if (!active && this.#rejected.size < this.#maxEntries)
        this.#rejected.set(key, now + Math.min(this.#ttlMs, 1_000))
      return false
    }
    if (this.#retain && !this.#retain(peerKey)) return false
    if (generation !== this.#generation || this.#activeOnly() === undefined) {
      this.#release?.(peerKey)
      return false
    }
    let releaseCount: (() => void) | undefined
    try {
      releaseCount = this.#peerCounts.retain(peerKey)
      ;(active || holdUntilSettlement ? this.#active : this.#completed).set(key, {
        peerKey,
        at: now,
        releaseCount,
        active
      })
      return true
    } catch (error) {
      releaseCount?.()
      this.#release?.(peerKey)
      throw error
    }
  }

  /** Captures exact entry identity so a late finally cannot release a later same-ID operation. */
  captureRelease(key: string): (now: number) => void {
    /** Holding the entry, rather than its key alone, preserves cleanup ownership across reuse. */
    const entry = this.#active.get(key)
    return (now) => {
      if (entry && this.#active.get(key) === entry) this.releaseActive(key, now)
    }
  }

  /** Reserve the complete member set synchronously; refusal cannot create rejected tombstones. */
  reserveMany(
    keys: readonly string[],
    peerKey: string,
    now: number,
    activeOverride?: boolean
  ): IReplayReservation | undefined {
    /** The same lifecycle/mode barrier applies to every member, including reentrant retain hooks. */
    const mode = this.#activeOnly()
    if (mode === undefined) return undefined
    const generation = this.#generation
    const active = activeOverride ?? mode
    this.#purge(now)
    if (
      keys.length === 0 ||
      new Set(keys).size !== keys.length ||
      this.size + keys.length > this.#maxEntries ||
      this.#peerCounts.count(peerKey) + keys.length > this.#maxEntriesPerPeer ||
      keys.some(
        (key) => this.#completed.has(key) || this.#active.has(key) || this.#rejected.has(key)
      )
    )
      return undefined
    /** Identity retention is rolled back before any group entry becomes visible on refusal. */
    const entries: IReplayEntry[] = []
    const releasePrepared = (): void => {
      for (const entry of entries) {
        entry.releaseCount()
        this.#release?.(entry.peerKey)
      }
      entries.length = 0
    }
    try {
      for (const _key of keys) {
        if (this.#retain && !this.#retain(peerKey)) {
          releasePrepared()
          return undefined
        }
        if (generation !== this.#generation || this.#activeOnly() === undefined) {
          this.#release?.(peerKey)
          releasePrepared()
          return undefined
        }
        entries.push({ peerKey, at: now, active, releaseCount: this.#peerCounts.retain(peerKey) })
      }
    } catch (error) {
      releasePrepared()
      throw error
    }
    for (let index = 0; index < keys.length; index++)
      this.#active.set(keys[index]!, entries[index]!)
    /** One terminal decision prevents a late rollback from erasing executed replay history. */
    let settled = false
    return Object.freeze({
      rollback: () => {
        if (settled) return
        settled = true
        for (let index = 0; index < keys.length; index++) {
          const entry = entries[index]!
          if (this.#active.get(keys[index]!) !== entry) continue
          this.#active.delete(keys[index]!)
          entry.releaseCount()
          this.#release?.(peerKey)
        }
      },
      release: (at: number) => {
        if (settled) return
        settled = true
        for (let index = 0; index < keys.length; index++)
          if (this.#active.get(keys[index]!) === entries[index])
            this.releaseActive(keys[index]!, at)
      }
    })
  }

  /** Settles the current active entry; callers observe physical ownership before invoking this. */
  releaseActive(key: string, now = 0): void {
    /** An already settled or cleared entry has no remaining lease to release. */
    const entry = this.#active.get(key)
    if (!entry) return
    this.#active.delete(key)
    if (!entry.active || this.#activeOnly() === false) {
      this.#completed.set(key, { ...entry, at: now, active: false })
    } else {
      entry.releaseCount()
      this.#release?.(entry.peerKey)
    }
  }

  /** Tests whether a fresh tombstone exists without changing it. */
  has(key: string, now: number): boolean {
    this.#purge(now)
    return this.#completed.has(key) || this.#active.has(key)
  }

  /** Checks replay capacity before a caller consumes a separate admission quota. */
  canAdmit(key: string, peerKey: string, now: number): boolean {
    this.#purge(now)
    if (
      this.#activeOnly() === undefined ||
      this.#rejected.has(key) ||
      this.#completed.has(key) ||
      this.#active.has(key)
    )
      return false
    const peerCount = this.#peerCounts.count(peerKey)
    return peerCount < this.#maxEntriesPerPeer && this.size < this.#maxEntries
  }

  /** Reports completed replay entries without exposing mutable ledger state. */
  get size(): number {
    return this.#completed.size + this.#active.size
  }

  /** Package diagnostics distinguish in-flight occupancy from retained completion tombstones. */
  get activeSize(): number {
    return this.#active.size
  }

  /** Reads numeric admission capacity after its decision without purging or exposing identities. */
  readCapacity(peerKey: string): Readonly<{
    occupancy: number
    limit: number
    peerOccupancy: number
    peerLimit: number
  }> {
    return {
      occupancy: this.size,
      limit: this.#maxEntries,
      peerOccupancy: this.#peerCounts.count(peerKey),
      peerLimit: this.#maxEntriesPerPeer
    }
  }

  /** Drops only expired tombstones. */
  clear(): void {
    this.#generation += 1
    for (const entry of [...this.#completed.values(), ...this.#active.values()]) {
      entry.releaseCount()
      this.#release?.(entry.peerKey)
    }
    this.#completed.clear()
    this.#active.clear()
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
