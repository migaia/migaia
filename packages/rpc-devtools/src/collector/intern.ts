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

  /** Acquire before eviction, keeping repeated ids stable even in a one-slot ring. */
  acquire(value: string | undefined): number {
    if (value === undefined) return -1
    /** Existing identity reuses its retained slot with no object allocation. */
    let id = this.#ids.get(value)
    if (id === undefined) {
      id = this.#free.length === 0 ? this.#names.length : this.#free.pop()!
      this.#names[id] = value
      this.#refs[id] = 0
      this.#ids.set(value, id)
    }
    this.#refs[id]!++
    return id
  }

  /** The final ring owner releases both the string and its Map entry in O(1). */
  release(id: number): void {
    if (id < 0 || --this.#refs[id]! !== 0) return
    this.#ids.delete(this.#names[id]!)
    this.#names[id] = undefined
    this.#free.push(id)
  }

  /** Restore the retained message identity at a representation boundary. */
  name(id: number): string | undefined {
    return id < 0 ? undefined : this.#names[id]
  }
}
