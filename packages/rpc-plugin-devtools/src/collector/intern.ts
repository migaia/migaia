/** Owns bounded name identities and per-source carrier sequence joins used by collector readers. */
import { CollectorText } from './text.ts'

/** Shared loss state belongs to the collector, including rejected names at the intern boundary. */
export type IInternCounters = { internOverflow: number }

/** Long-lived names have one bounded identity domain, separate from recyclable message ids. */
export class NameTable {
  /** String lookup allocates only when a new supported name first appears. */
  #ids = new Map<string, number>()
  /** Reverse lookup restores names only at a query, service or recording boundary. */
  #names: string[] = [CollectorText.overflow]
  /** Upper bound prevents unbounded name growth after the collector has warmed up. */
  #limit: number
  /** Overflow is reported through the collector's public retention counters. */
  #counters: IInternCounters

  /** Reserve id zero for overflow; absent optional values use the separate sentinel -1. */
  constructor(limit: number, counters: IInternCounters) {
    this.#limit = limit
    this.#counters = counters
  }

  /** Lookup or intern one name; a rejected new name does not disturb existing ids. */
  id(value: string | undefined): number {
    if (value === undefined) return -1
    /** Existing names remain stable even when the table reaches its bound. */
    const known = this.#ids.get(value)
    if (known !== undefined) return known
    if (this.#ids.size >= this.#limit) {
      this.#counters.internOverflow++
      return 0
    }
    /** New ids are dense, so query method filters can use a Uint8Array. */
    const id = this.#names.length
    this.#names.push(value)
    this.#ids.set(value, id)
    return id
  }

  /** Read-only filter compilation never interns a query's unknown name. */
  find(value: string): number | undefined {
    return this.#ids.get(value)
  }

  /** Restore one optional name at a cold public boundary. */
  name(id: number): string | undefined {
    return id < 0 ? undefined : this.#names[id]
  }

  /** Filter dimension includes the dedicated overflow slot. */
  get size(): number {
    return this.#names.length
  }

  /** Clearing occurs only after all retained rings have released their ids. */
  clear(): void {
    this.#ids.clear()
    this.#names.length = 1
  }
}

/** A read builds this index from retained origins; ingestion never translates source ordinals. */
export class CarrierTable {
  /** Actual endpoint strings keep independent emitters separate without consuming intern capacity. */
  #carriers = new Map<string, Map<number, number>>()
  /** Non-increasing source ordinals identify the same replacement-generation boundary as before. */
  #lastSources = new Map<string, number>()

  /** Visit an ordered origin and return prior origins retired by an observed source reset. */
  acquireCarrier(
    endpoint: string,
    sourceSeq: number,
    sequence: number
  ): Iterable<number> | undefined {
    /** A restarted emitter cannot resolve an old generation's retained source ordinal. */
    let entries = this.#carriers.get(endpoint)
    /**
     * A retired map iterator belongs only to this cold scan, never to persistent generation
     * history.
     */
    const retired =
      entries !== undefined && sourceSeq <= (this.#lastSources.get(endpoint) ?? -1)
        ? entries.values()
        : undefined
    if (entries === undefined || retired !== undefined) {
      entries = new Map()
      this.#carriers.set(endpoint, entries)
    }
    entries.set(sourceSeq, sequence)
    this.#lastSources.set(endpoint, sourceSeq)
    return retired
  }

  /** Missing retained origins have no join; never invent a collector ordinal. */
  carrierSequence(endpoint: string, sourceSeq: number): number {
    return this.#carriers.get(endpoint)?.get(sourceSeq) ?? -1
  }
}
