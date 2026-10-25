/**
 * Owns the limits plugin's task membership and per-peer counts for atomic concurrency admission.
 * Whole-group acquisition and exact release share the same registry; it stores no provider bodies,
 * ordering policy, replay outcomes or transport lifecycle.
 */
import { tagRpcError, RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'

/** Original endpoint execution capacity; opt-in shared scopes preserve this default. */
const DEFAULT_MAX_GLOBAL = 256
/** Original verified-peer execution capacity, including waiting and running work. */
const DEFAULT_MAX_PER_PEER = 64

/** Validate the same owner limits at construction and when another physical session joins it. */
function validateLimits(maxGlobal: number, maxPerPeer: number): void {
  if (![maxGlobal, maxPerPeer].every(Number.isSafeInteger) || maxGlobal < 1 || maxPerPeer < 1)
    throw tagRpcError(
      new TypeError(RpcCoreErrorText.providerAdmissionLimitsMustBePositiveSafeIntegers),
      RpcCoreErrorCode.invalidConfig
    )
}

/** Optional limits own only actual business leases; framing, ordering and replay stay outside. */
export class ProviderAdmissionRegistry {
  /** Every admitted member retains exactly one release identity through actual completion. */
  readonly #leases = new Map<string, string>()
  /** Per-admitted-peer occupancy is updated with global occupancy in the same transaction. */
  readonly #peerCounts = new Map<string, number>()
  /** Immutable installation policy never revokes already admitted work. */
  readonly #maxGlobal: number
  /** Peers cannot consume another peer's original capacity. */
  readonly #maxPerPeer: number

  /** Validate the original positive safe-integer bounds before any provider can enter. */
  constructor(maxGlobal = DEFAULT_MAX_GLOBAL, maxPerPeer = DEFAULT_MAX_PER_PEER) {
    validateLimits(maxGlobal, maxPerPeer)
    this.#maxGlobal = maxGlobal
    this.#maxPerPeer = maxPerPeer
  }

  /** Atomically reserves one task lease; duplicate keys are rejected. */
  acquire(taskKey: string, peerKey: string): boolean {
    if (this.#leases.has(taskKey)) return false
    const peerCount = this.#peerCounts.get(peerKey) ?? 0
    if (this.#leases.size >= this.#maxGlobal || peerCount >= this.#maxPerPeer) return false
    this.#leases.set(taskKey, peerKey)
    this.#peerCounts.set(peerKey, peerCount + 1)
    return true
  }

  /** Reserve every member against logical and physical bounds in the same synchronous transaction. */
  acquireMany(taskKeys: readonly string[], peerKey: string): boolean {
    /** Group keys are trusted canonical identities allocated after complete profile/ACL checks. */
    const count = taskKeys.length
    if (
      count === 0 ||
      this.#leases.size + count > this.#maxGlobal ||
      (this.#peerCounts.get(peerKey) ?? 0) + count > this.#maxPerPeer
    )
      return false
    /** Duplicate members cannot turn one lease into several units of purported capacity. */
    const unique = new Set(taskKeys)
    if (unique.size !== count || taskKeys.some((key) => this.#leases.has(key))) return false
    /** All original members share one immutable identity pair; each retains its own release key. */
    const lease = peerKey
    for (const key of taskKeys) this.#leases.set(key, lease)
    this.#peerCounts.set(peerKey, (this.#peerCounts.get(peerKey) ?? 0) + count)
    return true
  }

  /** Releases a task lease exactly once. */
  release(taskKey: string): void {
    /**
     * The original task key alone can retire both global and per-peer dimensions, including after
     * queued cancellation.
     */
    const lease = this.#leases.get(taskKey)
    if (lease === undefined) return
    this.#leases.delete(taskKey)
    this.#releaseCount(lease)
  }

  /** Both global and verified-peer counts retire under the same original lease exactly once. */
  #releaseCount(key: string): void {
    const count = this.#peerCounts.get(key) ?? 0
    if (count <= 1) this.#peerCounts.delete(key)
    else this.#peerCounts.set(key, count - 1)
  }

  /** Report active leases without exposing the original task-key table. */
  get size(): number {
    return this.#leases.size
  }

  /** Installation cleanup releases this unique quota owner without touching provider execution. */
  clear(): void {
    this.#leases.clear()
    this.#peerCounts.clear()
  }
}
