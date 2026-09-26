import { RequestReplayLedger } from './request-replay-ledger.js'
import { VariationAdmissionRegistry } from './variation-admission.js'

/** Owns control-frame replay, admission and unordered abort state. */
export class ControlTaskRegistry {
  readonly #replay: RequestReplayLedger
  readonly #variationAdmission: VariationAdmissionRegistry
  readonly #pendingAborts = new Map<string, number>()
  readonly #maxPendingAborts = 4096

  constructor(lease?: {
    readonly retain: (peerKey: string) => boolean
    readonly release: (peerKey: string) => void
  }) {
    this.#replay = new RequestReplayLedger(1024, 256, 310_000, lease)
    this.#variationAdmission = new VariationAdmissionRegistry(lease)
  }

  /** Rejects duplicate or over-budget control frames. */
  admit(key: string, now = Date.now()): boolean {
    this.#purge(now)
    return this.#replay.admit(key, 'control', now)
  }

  /** Atomically rejects duplicates before consuming variation admission budget. */
  admitControl(peerKey: string, key: string, now = Date.now()): boolean {
    return this.#variationAdmission.admit(peerKey, key, now)
  }

  /** Stores an abort that arrived before its request, within a hard cap. */
  rememberAbort(key: string, expiresAt: number, now = Date.now()): boolean {
    this.#purge(now)
    if (this.#pendingAborts.has(key)) return true
    if (this.#pendingAborts.size >= this.#maxPendingAborts) return false
    this.#pendingAborts.set(key, expiresAt)
    return true
  }

  /** Consumes a pending abort only while it remains live. */
  consumeAbort(key: string, now = Date.now()): boolean {
    this.#purge(now)
    const expiresAt = this.#pendingAborts.get(key)
    if (expiresAt === undefined) return false
    this.#pendingAborts.delete(key)
    return true
  }

  /** Admits unique variations with independent global and per-peer budgets. */
  admitVariation(peerKey: string, now = Date.now()): boolean {
    return this.#variationAdmission.admitBudget(peerKey, now)
  }

  /** Releases all control state during endpoint disposal. */
  clear(): void {
    this.#replay.clear()
    this.#variationAdmission.clear()
    this.#pendingAborts.clear()
  }

  /** Purges replay and pending-abort TTL state under the endpoint resource owner. */
  purge(now = Date.now()): void {
    this.#purge(now)
    this.#replay.purge(now)
  }

  #purge(now: number): void {
    for (const [key, expiresAt] of this.#pendingAborts)
      if (expiresAt <= now) this.#pendingAborts.delete(key)
  }
}
