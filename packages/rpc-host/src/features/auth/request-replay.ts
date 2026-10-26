/**
 * Owns active request-ID deduplication and selected completed retention for one authentication
 * flow. Original source cleanup keys and the numeric lease counter retain exact ownership; no
 * provider body, timer, outcome store or second source registry belongs to this ledger.
 */
import { createStringLeaseRegistry } from '@migaia/lifecycle'
import type { IRpcAuthenticationRetain } from '@migaia/rpc-contract/interfaces'
import { RpcAuthenticationReplayPolicy as Policy } from './constants.js'

/** Existing source membership also lends its actual signed counter window for completion checks. */
export type IRequestReplaySource = Readonly<{
  replayKeys: Set<string>
  window?: Readonly<{ high: bigint }>
}>

/** One exact entry keeps its original retention choice and verified request counter. */
export type IRequestReplayEntry = Readonly<{
  source: IRequestReplaySource
  at: number
  retain: IRpcAuthenticationRetain
  /** Window entries borrow this request's verified counter, never a later dispatch high value. */
  counter?: bigint
  /** Only numeric retention reserves original global/per-peer bounded capacity. */
  releaseCount?: () => void
}>

/** Refused numeric correlations retain their original source and fixed short expiry. */
type IRequestReplayRejection = Readonly<{ source: IRequestReplaySource; expiresAt: number }>

/** The signed admission window has exactly 64 positions, independent of request concurrency. */
const requestReplayWindowSlots = 64n

/** Completed IDs share their verified counter's ring slot; active and refused IDs never enter it. */
type IRequestReplayWindow = {
  high: bigint
  readonly slots: (Map<string, IRequestReplayEntry> | undefined)[]
}

/** Active entries never expire; completed entries follow false, signed-window or individual TTL. */
export class RequestReplayLedger {
  /** Actual business completion alone may remove an in-flight correlation. */
  readonly #active = new Map<string, IRequestReplayEntry>()
  /** Numeric expiry and signed-window advancement release only this existing completed history. */
  readonly #completed = new Map<string, IRequestReplayEntry>()
  /** The original short numeric refusal history does not reserve accepted-entry capacity. */
  readonly #rejected = new Map<string, IRequestReplayRejection>()
  /** Each original source retains only completed IDs in its fixed-size signed-counter ring. */
  readonly #windowRings = new WeakMap<IRequestReplaySource, IRequestReplayWindow>()
  /** Original lifecycle leases count numeric entries only for each admitted direct peer. */
  readonly #peerCounts = createStringLeaseRegistry()
  /** This derived scalar counts numeric active and completed entries without another index. */
  #numericCount = 0
  /** Cold auth configuration fixes the original numeric per-peer bound before dispatch. */
  readonly #maxPerPeer: number

  /** False and window modes do not consume the numeric retention budget. */
  constructor(maxPerPeer: number = Policy.maxEntriesPerPeer) {
    this.#maxPerPeer = maxPerPeer
  }

  /** Duplicate checks never refresh an accepted correlation's original completion timestamp. */
  has(key: string, now: number): boolean {
    this.#purge(now)
    return this.#active.has(key) || this.#completed.has(key)
  }

  /** Reserve one original identity; only numeric policy can refuse bounded capacity admission. */
  admit(
    source: IRequestReplaySource,
    peerKey: string,
    key: string,
    now: number,
    retain: IRpcAuthenticationRetain = false,
    counter?: bigint
  ): IRequestReplayEntry | undefined {
    this.#purge(now)
    if (typeof retain === 'number') {
      if (this.#rejected.has(key)) return undefined
      if (
        this.#numericCount >= Policy.maxEntries ||
        this.#peerCounts.count(peerKey) >= this.#maxPerPeer
      ) {
        if (this.#rejected.size < Policy.maxEntries) {
          this.#rejected.set(key, { source, expiresAt: now + Policy.rejectedTtlMs })
          source.replayKeys.add(key)
        }
        return undefined
      }
    }
    /** Only this exact numeric entry can release the original peer lease and derived count. */
    const releaseCount = typeof retain === 'number' ? this.#peerCounts.retain(peerKey) : undefined
    if (releaseCount) this.#numericCount += 1
    /** Admission has already verified the counter for window-mode entries. */
    const entry = { source, at: now, retain, counter, releaseCount }
    this.#active.set(key, entry)
    source.replayKeys.add(key)
    return entry
  }

  /** A late completion cannot settle a reused key or revive a physically retired source. */
  settle(key: string, entry: IRequestReplayEntry, now: number): void {
    if (this.#active.get(key) !== entry) return
    this.#active.delete(key)
    if (
      entry.retain === false ||
      (entry.retain === 'window' && this.#outsideWindow(entry.source, entry.counter!))
    ) {
      this.#release(key, entry)
      return
    }
    /** Completion time still belongs to numeric TTL; window ordering uses the verified counter. */
    const completed = { ...entry, at: now }
    this.#completed.set(key, completed)
    if (entry.retain === 'window') this.#queueWindow(key, completed)
  }

  /** The original signed window may release completed entries, never active business or streams. */
  advanceWindow(source: IRequestReplaySource): void {
    /** No completed window identity means there is no expiry work or counter snapshot to advance. */
    const ring = this.#windowRings.get(source)
    if (!ring) return
    /** Admission owns this monotonic high counter; out-of-order messages leave it unchanged. */
    const high = source.window!.high
    /** Newly expired counters are precisely (oldHigh - 64, high - 64]. */
    const distance = high - ring.high
    /** A jump of at least 64 expires every old slot, so no advance visits more than 64 slots. */
    const steps = Number(distance < requestReplayWindowSlots ? distance : requestReplayWindowSlots)
    /** (oldHigh + 1) % 64 equals (oldHigh - 63) % 64 without negative early-counter indices. */
    let index = Number((ring.high + 1n) % requestReplayWindowSlots)
    // The ring is allocated with exactly 64 slots below; this loop has a compile-time fixed bound.
    for (let step = 0; step < steps; step++) {
      /** Remove the original completed slot before releasing its owned membership. */
      const entries = ring.slots[index]
      ring.slots[index] = undefined
      if (entries)
        for (const [key, entry] of entries) {
          this.#completed.delete(key)
          this.#release(key, entry)
        }
      index = (index + 1) % ring.slots.length
    }
    ring.high = high
  }

  /** Out-of-order completions insert directly into their counter slot, without ordering active IDs. */
  #queueWindow(key: string, entry: IRequestReplayEntry): void {
    this.advanceWindow(entry.source)
    /** Old active requests settle directly when expired and never reach this completed ring. */
    let ring = this.#windowRings.get(entry.source)
    if (!ring) {
      ring = {
        high: entry.source.window!.high,
        slots: Array<Map<string, IRequestReplayEntry> | undefined>(Number(requestReplayWindowSlots))
      }
      this.#windowRings.set(entry.source, ring)
    }
    /** Two live counters cannot collide modulo 64 within the admitted 64-slot window. */
    const index = Number(entry.counter! % requestReplayWindowSlots)
    /** Equal-counter logical group members share one original completion bucket. */
    const entries = (ring.slots[index] ??= new Map())
    entries.set(key, entry)
  }

  /** Source retirement uses only its original owned keys and fences every late completion. */
  retire(source: IRequestReplaySource): void {
    this.#windowRings.delete(source)
    for (const key of source.replayKeys) {
      /** Exact original source identity prevents cleanup from touching a reused correlation. */
      const entry = this.#active.get(key) ?? this.#completed.get(key)
      if (entry?.source === source) {
        this.#active.delete(key)
        this.#completed.delete(key)
        this.#release(key, entry)
      }
      if (this.#rejected.get(key)?.source === source) this.#rejected.delete(key)
    }
    source.replayKeys.clear()
  }

  /** These existing source/counter fields are present only after verified window-mode admission. */
  #outsideWindow(source: IRequestReplaySource, counter: bigint): boolean {
    return source.window!.high - counter >= requestReplayWindowSlots
  }

  /** Every caller removes its exact map entry first, so capacity and membership release once. */
  #release(key: string, entry: IRequestReplayEntry): void {
    entry.source.replayKeys.delete(key)
    if (entry.releaseCount) {
      entry.releaseCount()
      this.#numericCount -= 1
    }
  }

  /** Different numeric durations require a complete linear pass rather than an expiry-prefix break. */
  #purge(now: number): void {
    for (const [key, entry] of this.#completed) {
      if (typeof entry.retain !== 'number' || now - entry.at < entry.retain) continue
      this.#completed.delete(key)
      this.#release(key, entry)
    }
    for (const [key, entry] of this.#rejected) {
      if (entry.expiresAt > now) break
      this.#rejected.delete(key)
      entry.source.replayKeys.delete(key)
    }
  }
}
