/**
 * Own active deduplication and completed retention for one flow, using source cleanup keys and
 * numeric leases without retaining provider bodies.
 */
import { createStringLeaseRegistry } from '@migaia/lifecycle'
import type { IRpcAuthenticationRetain } from '@migaia/rpc-contract/interfaces'
import { RpcAuthenticationReplayPolicy as Policy } from './constants.ts'

/** Use the source's signed counter window to decide completed retention. */
export type IRequestReplaySource = Readonly<{
  replayKeys: Set<string>
  window?: Readonly<{ high: bigint }>
}>

/** Keep retention choice and verified request counter with the admitted entry. */
export type IRequestReplayEntry = Readonly<{
  source: IRequestReplaySource
  at: number
  retain: IRpcAuthenticationRetain
  /** Use the request's verified counter, never the high counter at dispatch time. */
  counter?: bigint
  /** Reserve bounded global and per-peer capacity only for numeric retention. */
  releaseCount?: () => void
}>

/** Keep numeric refusals tied to their source and fixed short expiry. */
type IRequestReplayRejection = Readonly<{ source: IRequestReplaySource; expiresAt: number }>

/** Expiry metadata can be checked without reading an unexpired request body. */
type IRequestReplayCompletion = Readonly<{ entry: IRequestReplayEntry; at: number }>

/** The signed admission window has exactly 64 positions, independent of request concurrency. */
const requestReplayWindowSlots = 64n

/** Completed IDs share their verified counter's ring slot; active and refused IDs never enter it. */
type IRequestReplayWindow = {
  high: bigint
  readonly slots: (Map<string, IRequestReplayEntry> | undefined)[]
}

/** Active entries never expire; completed entries follow false, signed-window or individual TTL. */
export class RequestReplayLedger {
  /** Deduplicate active business independently from its completed-retention policy. */
  readonly #active = new Map<string, IRequestReplayEntry>()
  /** Numeric lookup retains expiry metadata separately from the request body. */
  readonly #completed = new Map<string, IRequestReplayCompletion>()
  /** Equal durations preserve completion/expiry order, so cleanup stops at each first live header. */
  readonly #durations = new Map<number, Map<string, IRequestReplayCompletion>>()
  /** Window lookup is independent from numeric TTL cleanup; only the counter ring expires it. */
  readonly #windowCompleted = new Map<string, IRequestReplayEntry>()
  /** Keep short numeric refusal history outside accepted-entry capacity. */
  readonly #rejected = new Map<string, IRequestReplayRejection>()
  /** Index completed window IDs in their source's fixed-size counter ring. */
  readonly #windowRings = new WeakMap<IRequestReplaySource, IRequestReplayWindow>()
  /** Use per-peer lifecycle leases only for numeric entries. */
  readonly #peerCounts = createStringLeaseRegistry()
  /** This derived scalar counts numeric active and completed entries without another index. */
  #numericCount = 0
  /** Fix the numeric per-peer bound before dispatch begins. */
  readonly #maxPerPeer: number

  /** False and window modes do not consume the numeric retention budget. */
  constructor(maxPerPeer: number = Policy.maxEntriesPerPeer) {
    this.#maxPerPeer = maxPerPeer
  }

  /** Do not extend completion expiry when checking duplicates. */
  has(key: string, now: number): boolean {
    this.#purge(now)
    return this.#active.has(key) || this.#completed.has(key) || this.#windowCompleted.has(key)
  }

  /** Reserve a correlation; only numeric retention can exhaust capacity. */
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
    /** Release the peer lease and derived count once for this numeric entry. */
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
    if (entry.retain === 'window') {
      this.#windowCompleted.set(key, entry)
      this.#queueWindow(key, entry)
      return
    }
    /** A connection's selected duration is stable; expiry begins at business completion. */
    const duration = entry.retain
    /** The header and its ordered bucket point to the same immutable entry. */
    const completed = { entry, at: now }
    this.#completed.set(key, completed)
    /** Empty buckets are removed during release, so each bucket consumes a numeric lease. */
    let bucket = this.#durations.get(duration)
    if (!bucket) {
      bucket = new Map()
      this.#durations.set(duration, bucket)
    }
    bucket.set(key, completed)
  }

  /** Expire only completed window entries; active business and streams remain deduplicated. */
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
      /** Remove the completed slot before releasing its source membership. */
      const entries = ring.slots[index]
      ring.slots[index] = undefined
      if (entries)
        for (const [key, entry] of entries) {
          this.#windowCompleted.delete(key)
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
    /** Share a completion bucket among logical group members with the same counter. */
    const entries = (ring.slots[index] ??= new Map())
    entries.set(key, entry)
  }

  /** Retire only the source's owned keys and prevent late completion from reviving them. */
  retire(source: IRequestReplaySource): void {
    this.#windowRings.delete(source)
    for (const key of source.replayKeys) {
      /** Check source identity before cleanup can touch a reused correlation. */
      const entry =
        this.#active.get(key) ?? this.#windowCompleted.get(key) ?? this.#completed.get(key)?.entry
      if (entry?.source === source) {
        this.#active.delete(key)
        this.#windowCompleted.delete(key)
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

  /** Remove the owning map entry before releasing capacity and source membership once. */
  #release(key: string, entry: IRequestReplayEntry): void {
    entry.source.replayKeys.delete(key)
    if (entry.releaseCount) {
      /** Active numeric IDs may have no completed bucket; completed IDs release its last slot once. */
      const bucket = this.#durations.get(entry.retain as number)
      bucket?.delete(key)
      if (bucket?.size === 0) this.#durations.delete(entry.retain as number)
      entry.releaseCount()
      this.#numericCount -= 1
    }
  }

  /** Read only expiry headers; request bodies are touched only when their numeric retention ends. */
  #purge(now: number): void {
    // Each nonempty duration bucket consumes at least one of Policy.maxEntries (4096) numeric
    // leases. Durations come from config/connection retain; no new user capacity limit is added.
    for (const [duration, bucket] of this.#durations)
      for (const [key, completed] of bucket) {
        if (now - completed.at < duration) break
        this.#completed.delete(key)
        this.#release(key, completed.entry)
      }
    for (const [key, entry] of this.#rejected) {
      if (entry.expiresAt > now) break
      this.#rejected.delete(key)
      entry.source.replayKeys.delete(key)
    }
  }
}
