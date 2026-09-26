import { RequestReplayLedger } from './request-replay-ledger.js'

/** Owns variation replay and bounded per-peer admission without control-feature state. */
export class VariationAdmissionRegistry {
  /** Replay ledger shared by all variation subkinds on one endpoint. */
  readonly #replay: RequestReplayLedger
  /** Per-peer admission counters for variation flood protection. */
  readonly #admissions = new Map<string, { count: number; at: number }>()
  /** Maximum number of variation admissions retained per peer window. */
  readonly #maxPerPeer = 128
  /** Maximum number of variation admissions retained globally per window. */
  readonly #maxTotal = 4096
  /** Duration of one variation admission window. */
  readonly #windowMs = 60_000
  /** Number of admissions in current global window. */
  #total = 0
  /** Start time of current global admission window. */
  #windowStartedAt = 0

  /** Creates one variation admission owner with optional verified-peer lease handling. */
  constructor(lease?: {
    readonly retain: (peerKey: string) => boolean
    readonly release: (peerKey: string) => void
  }) {
    this.#replay = new RequestReplayLedger(1024, 256, 310_000, lease)
  }

  /** Atomically admits one unique variation before invoking its handler. */
  admit(peerKey: string, key: string, now = Date.now()): boolean {
    this.purge(now)
    if (!this.#replay.canAdmit(key, peerKey, now)) return false
    if (this.#total >= this.#maxTotal) return false
    const current = this.#admissions.get(peerKey)
    if (!current || now - current.at >= this.#windowMs) {
      this.#admissions.set(peerKey, { count: 1, at: now })
      this.#total += 1
      return this.#replay.admit(key, peerKey, now)
    }
    if (current.count >= this.#maxPerPeer) return false
    current.count += 1
    this.#total += 1
    return this.#replay.admit(key, peerKey, now)
  }

  /** Consumes only bounded admission budget, preserving legacy control-owner semantics. */
  admitBudget(peerKey: string, now = Date.now()): boolean {
    this.purge(now)
    if (this.#total >= this.#maxTotal) return false
    const current = this.#admissions.get(peerKey)
    if (!current || now - current.at >= this.#windowMs) {
      this.#admissions.set(peerKey, { count: 1, at: now })
      this.#total += 1
      return true
    }
    if (current.count >= this.#maxPerPeer) return false
    current.count += 1
    this.#total += 1
    return true
  }

  /** Clears replay and admission state at endpoint disposal. */
  clear(): void {
    this.#replay.clear()
    this.#admissions.clear()
    this.#total = 0
    this.#windowStartedAt = 0
  }

  /** Purges replay entries and resets expired admission windows. */
  purge(now = Date.now()): void {
    this.#replay.purge(now)
    if (now - this.#windowStartedAt >= this.#windowMs) {
      this.#admissions.clear()
      this.#total = 0
      this.#windowStartedAt = now
    }
  }
}
