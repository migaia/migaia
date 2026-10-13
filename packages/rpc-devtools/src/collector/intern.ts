import { CollectorText } from './text.js'

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

/** Message ids recycle at eviction rather than consuming the long-lived name budget. */
export class MessageTable {
  /** Only currently retained message identities remain indexed. */
  #ids = new Map<string, number>()
  /** Reverse slots are shared by main, recording and watcher rings through reference counts. */
  #names: (string | undefined)[] = []
  /** Each retained ring slot owns exactly one reference to its message id. */
  #refs: number[] = []
  /** Released numeric ids are reused without allocating a freelist node. */
  #free: number[] = []
  /** Endpoint-scoped numeric source sequences share this existing retained-identity pool. */
  #carriers = new Map<number, Map<number, number>>()
  /** Nonnegative endpoint ids distinguish carrier aliases from ordinary message-name slots. */
  #carrierEndpoints: number[] = []
  /** Original emitter ordinals stay numeric until their last retained carrier row retires. */
  #carrierSources: number[] = []
  /** Collector ordinals bridge independently sequenced emitters without modifying their views. */
  #carrierSequences: number[] = []
  /** A replacement generation may restart its emitter ordinal while old recorded rows remain. */
  #carrierLastSources = new Map<number, number>()

  /** Acquire before eviction, keeping repeated ids stable even in a one-slot ring. */
  acquire(value: string | undefined): number {
    if (value === undefined) return -1
    /** Existing identity reuses its retained slot with no object allocation. */
    let id = this.#ids.get(value)
    if (id === undefined) {
      id = this.#free.length === 0 ? this.#names.length : this.#free.pop()!
      this.#names[id] = value
      this.#refs[id] = 0
      this.#carrierEndpoints[id] = -1
      this.#ids.set(value, id)
    }
    this.#refs[id]!++
    return id
  }

  /** The final ring owner releases both the string and its Map entry in O(1). */
  release(id: number): void {
    if (id < 0 || --this.#refs[id]! !== 0) return
    /** Each carrier row in main/record/watch owns the same alias, so independent retention survives. */
    const endpoint = this.#carrierEndpoints[id] ?? -1
    if (endpoint >= 0) {
      /** Old-generation retirement cannot delete a same-ordinal alias in a replacement generation. */
      const entries = this.#carriers.get(endpoint)!
      if (entries.get(this.#carrierSources[id]!) === id) entries.delete(this.#carrierSources[id]!)
      this.#carrierEndpoints[id] = -1
    } else this.#ids.delete(this.#names[id]!)
    this.#names[id] = undefined
    this.#free.push(id)
  }

  /** Acquire one numeric carrier alias before eviction; all rings retain the same global sequence. */
  acquireCarrier(endpoint: number, sourceSeq: number, sequence: number): number {
    // Overflow has no unique endpoint identity and must never correlate unrelated sources.
    if (endpoint <= 0) return -1
    /** Only the first real endpoint allocates its numeric lookup; later rows use its existing map. */
    let entries = this.#carriers.get(endpoint)
    if (entries === undefined) {
      entries = new Map()
      this.#carriers.set(endpoint, entries)
    }
    /** Repeated ring writers retain the same alias rather than assigning another sequence. */
    let id = entries.get(sourceSeq)
    if (id !== undefined && this.#carrierSequences[id] !== sequence) {
      // Existing retained aliases belong to an earlier emitter generation, not this new event.
      entries = new Map()
      this.#carriers.set(endpoint, entries)
      id = undefined
    } else if (id === undefined && sourceSeq <= (this.#carrierLastSources.get(endpoint) ?? -1)) {
      entries = new Map()
      this.#carriers.set(endpoint, entries)
    }
    if (id === undefined) {
      id = this.#free.length === 0 ? this.#names.length : this.#free.pop()!
      if (id === this.#names.length) this.#names.push(undefined)
      this.#refs[id] = 0
      this.#carrierEndpoints[id] = endpoint
      this.#carrierSources[id] = sourceSeq
      this.#carrierSequences[id] = sequence
      entries.set(sourceSeq, id)
      this.#carrierLastSources.set(endpoint, sourceSeq)
    }
    this.#refs[id]!++
    return id
  }

  /** Restore the collector-domain link only while an originating carrier row remains retained. */
  carrierSequence(endpoint: number, sourceSeq: number): number {
    /** Source -1 denotes no physical observation; overflow identities cannot disambiguate aliases. */
    if (sourceSeq < 0 || endpoint <= 0) return -1
    /** Numeric lookup creates neither an event object nor a concatenated key. */
    const id = this.#carriers.get(endpoint)?.get(sourceSeq)
    return id === undefined ? -1 : this.#carrierSequences[id]!
  }

  /** Restore the retained message identity at a representation boundary. */
  name(id: number): string | undefined {
    return id < 0 ? undefined : this.#names[id]
  }
}
