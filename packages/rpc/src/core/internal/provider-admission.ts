import { tagWebRpcError, WebRpcErrorCode } from '../errors.js'

/** Owns global and per-peer admission leases for provider execution. */
export class ProviderAdmissionRegistry {
  readonly #leases = new Map<string, string>()
  readonly #peerCounts = new Map<string, number>()
  readonly #maxGlobal: number
  readonly #maxPerPeer: number

  constructor(maxGlobal = 256, maxPerPeer = 64) {
    if (![maxGlobal, maxPerPeer].every(Number.isSafeInteger) || maxGlobal < 1 || maxPerPeer < 1)
      throw tagWebRpcError(
        new TypeError('provider admission limits must be positive safe integers'),
        WebRpcErrorCode.invalidConfig
      )
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

  /** Releases a task lease exactly once. */
  release(taskKey: string): void {
    const peerKey = this.#leases.get(taskKey)
    if (peerKey === undefined) return
    this.#leases.delete(taskKey)
    const count = this.#peerCounts.get(peerKey) ?? 0
    if (count <= 1) this.#peerCounts.delete(peerKey)
    else this.#peerCounts.set(peerKey, count - 1)
  }

  /** Reports the number of active admission leases without exposing the lease map. */
  get size(): number {
    return this.#leases.size
  }

  /** Clears all leases during endpoint disposal. */
  clear(): void {
    this.#leases.clear()
    this.#peerCounts.clear()
  }
}
