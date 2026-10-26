/**
 * Owns bounded request-ID replay retention for one installed authentication flow. Accepted source
 * records lend their cleanup keys; actual dispatch completion settles entries without retaining
 * provider bodies, outcome keys, timers or a second source registry.
 */
import { createStringLeaseRegistry } from '@migaia/lifecycle'
import { RpcAuthenticationReplayPolicy as Policy } from './constants.js'

/** The existing authentication source retains only its own replay cleanup membership. */
export type IRequestReplaySource = Readonly<{ replayKeys: Set<string> }>

/** One exact accepted entry holds capacity until its real completion and retention expiry. */
export type IRequestReplayEntry = Readonly<{
  source: IRequestReplaySource
  at: number
  /** This admission sampled the actual acquired native owner's current exclusive reader custody. */
  activeOnly: boolean
  releaseCount(): void
}>

/** Refused correlations retain only the original source and their fixed short expiry. */
type IRequestReplayRejection = Readonly<{ source: IRequestReplaySource; expiresAt: number }>

/** Active work never expires early; completed and rejected prefixes purge without eviction. */
export class RequestReplayLedger {
  /** Actual business completion alone moves these accepted identities into retained history. */
  readonly #active = new Map<string, IRequestReplayEntry>()
  /** Equal TTLs preserve settlement order, so expiry scans only an expired prefix. */
  readonly #completed = new Map<string, IRequestReplayEntry>()
  /** A bounded short refusal history prevents immediate capacity retries from changing admission. */
  readonly #rejected = new Map<string, IRequestReplayRejection>()
  /** The original lifecycle counter supplies O(1) capacity without another identity registry. */
  readonly #peerCounts = createStringLeaseRegistry()
  /** Cold authentication configuration fixes this bound before any source can dispatch. */
  readonly #maxPerPeer: number

  /** Global retention and expiry remain the original internal policy, with no new public knobs. */
  constructor(maxPerPeer: number = Policy.maxEntriesPerPeer) {
    this.#maxPerPeer = maxPerPeer
  }

  /** Check completed and active identity without refreshing its retention timestamp. */
  has(key: string, now: number): boolean {
    this.#purge(now)
    return this.#active.has(key) || this.#completed.has(key)
  }

  /** Reserve one canonical correlation; refusal neither evicts history nor acquires capacity. */
  admit(
    source: IRequestReplaySource,
    peerKey: string,
    key: string,
    now: number,
    activeOnly = false
  ): IRequestReplayEntry | undefined {
    this.#purge(now)
    if (this.#rejected.has(key)) return undefined
    if (
      this.#active.size + this.#completed.size >= Policy.maxEntries ||
      this.#peerCounts.count(peerKey) >= this.#maxPerPeer
    ) {
      if (this.#rejected.size < Policy.maxEntries) {
        this.#rejected.set(key, { source, expiresAt: now + Policy.rejectedTtlMs })
        source.replayKeys.add(key)
      }
      return undefined
    }
    /** The retained lease is released by this exact entry on expiry or source retirement. */
    const entry = { source, at: now, activeOnly, releaseCount: this.#peerCounts.retain(peerKey) }
    this.#active.set(key, entry)
    source.replayKeys.add(key)
    return entry
  }

  /** A late completion cannot settle a reused key or revive a physically retired source. */
  settle(key: string, entry: IRequestReplayEntry, now: number): void {
    if (this.#active.get(key) !== entry) return
    this.#active.delete(key)
    if (entry.activeOnly) {
      entry.source.replayKeys.delete(key)
      entry.releaseCount()
      return
    }
    this.#completed.set(key, { ...entry, at: now })
  }

  /** Retire only the existing source's owned entries; no unrelated source scan is required. */
  retire(source: IRequestReplaySource): void {
    for (const key of source.replayKeys) {
      /** Exact original source identity fences late cleanup against another accepted source. */
      const entry = this.#active.get(key) ?? this.#completed.get(key)
      if (entry?.source === source) {
        this.#active.delete(key)
        this.#completed.delete(key)
        entry.releaseCount()
      }
      if (this.#rejected.get(key)?.source === source) this.#rejected.delete(key)
    }
    source.replayKeys.clear()
  }

  /** Fixed TTL insertion order makes total expiry work linear in entries actually removed. */
  #purge(now: number): void {
    for (const [key, entry] of this.#completed) {
      if (now - entry.at < Policy.ttlMs) break
      this.#completed.delete(key)
      entry.source.replayKeys.delete(key)
      entry.releaseCount()
    }
    for (const [key, entry] of this.#rejected) {
      if (entry.expiresAt > now) break
      this.#rejected.delete(key)
      entry.source.replayKeys.delete(key)
    }
  }
}
