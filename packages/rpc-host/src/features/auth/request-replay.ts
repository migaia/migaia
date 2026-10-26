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

/** Equal verified counters share one completed bucket; the source window bounds live buckets to64. */
type IRequestReplayWindowBucket = {
  readonly counter: bigint
  readonly entries: Map<string, IRequestReplayEntry>
  next?: IRequestReplayWindowBucket
}

/** Active entries never expire; completed entries follow false, signed-window or individual TTL. */
export class RequestReplayLedger {
  /** Actual business completion alone may remove an in-flight correlation. */
  readonly #active = new Map<string, IRequestReplayEntry>()
  /** Numeric expiry and signed-window advancement release only this existing completed history. */
  readonly #completed = new Map<string, IRequestReplayEntry>()
  /** The original short numeric refusal history does not reserve accepted-entry capacity. */
  readonly #rejected = new Map<string, IRequestReplayRejection>()
  /** Only completed window entries appear in counter order under their original source identity. */
  readonly #windowHeads = new WeakMap<IRequestReplaySource, IRequestReplayWindowBucket>()
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
    /** An ordered head lets advancement inspect only expired counters and the first live boundary. */
    let head = this.#windowHeads.get(source)
    while (head && this.#outsideWindow(source, head.counter)) {
      for (const [key, entry] of head.entries) {
        this.#completed.delete(key)
        this.#release(key, entry)
      }
      head = head.next
    }
    if (head) this.#windowHeads.set(source, head)
    else this.#windowHeads.delete(source)
  }

  /** Insert out-of-order completions among at most64 live counters from the fixed64-slot window. */
  #queueWindow(key: string, entry: IRequestReplayEntry): void {
    this.advanceWindow(entry.source)
    /** Old active requests settle directly when expired and never reach this completed queue. */
    const counter = entry.counter!
    /** Expired buckets were consumed above, so distinct counters here are bounded by64. */
    const head = this.#windowHeads.get(entry.source)
    if (!head || counter < head.counter) {
      this.#windowHeads.set(entry.source, {
        counter,
        entries: new Map([[key, entry]]),
        next: head
      })
      return
    }
    /** This walk is bounded by the protocol's fixed64 counters, independent of active key count. */
    let bucket = head
    while (bucket.next && bucket.next.counter <= counter) bucket = bucket.next
    if (bucket.counter === counter) bucket.entries.set(key, entry)
    else
      bucket.next = {
        counter,
        entries: new Map([[key, entry]]),
        next: bucket.next
      }
  }

  /** Source retirement uses only its original owned keys and fences every late completion. */
  retire(source: IRequestReplaySource): void {
    this.#windowHeads.delete(source)
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
    return source.window!.high - counter >= 64n
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
