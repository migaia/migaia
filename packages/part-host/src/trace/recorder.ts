import type { ITraceEvent, ITraceStep } from '@migaia/part-contract'
import type { ITraceListener, ITraceSink } from './sink.ts'

/**
 * Records kept per key; older records are dropped. Fixed capacity so memory does not grow with
 * history.
 */
export const TRACE_CAPACITY = 50

/** Marker string that identifies this module in bundles (production bundles must not contain it). */
export const TRACE_RECORDER_MARKER = 'trace-recorder'

/** Fixed-capacity ring of records; `push` and `list` cost O(capacity). */
class Ring<T> {
  /** Stored records in insertion order, at most TRACE_CAPACITY. */
  readonly #items: T[] = []
  /** Next slot to overwrite once full. */
  #next = 0

  /** Adds a record, overwriting the oldest when full. */
  push(item: T): void {
    if (this.#items.length < TRACE_CAPACITY) this.#items.push(item)
    else {
      this.#items[this.#next] = item
      this.#next = (this.#next + 1) % TRACE_CAPACITY
    }
  }

  /** Records from oldest to newest. */
  list(): readonly T[] {
    return [...this.#items.slice(this.#next), ...this.#items.slice(0, this.#next)]
  }
}

/** Development trace recorder (`trace-recorder`): steps and events per key in fixed-size rings. */
class TraceRecorder implements ITraceSink {
  /** Always true: this module is only chosen under the `development` condition. */
  readonly enabled = true
  /** Module marker; kept as a field so bundles that include the recorder contain it. */
  readonly kind = TRACE_RECORDER_MARKER
  /** Steps by address. */
  readonly #steps = new Map<string, Ring<ITraceStep>>()
  /** Events by key. */
  readonly #events = new Map<string, Ring<ITraceEvent>>()
  /** Listeners told about new records. */
  readonly #listeners = new Set<ITraceListener>()

  /** Ring of a key in a map, created on first use. */
  static #ring<T>(map: Map<string, Ring<T>>, key: string): Ring<T> {
    /** Existing ring. */
    let ring = map.get(key)
    if (ring === undefined) {
      ring = new Ring<T>()
      map.set(key, ring)
    }
    return ring
  }

  /** Tells every listener about a key. */
  #notify(key: string): void {
    for (const listener of this.#listeners) listener(key)
  }

  /** Records a step under its address. */
  step(step: ITraceStep): void {
    TraceRecorder.#ring(this.#steps, step.address).push(step)
    this.#notify(step.address)
  }

  /** Records an event under its key. */
  event(event: ITraceEvent): void {
    TraceRecorder.#ring(this.#events, event.address).push(event)
    this.#notify(event.address)
  }

  /** Steps of an address, oldest first. */
  steps(address: string): readonly ITraceStep[] {
    return this.#steps.get(address)?.list() ?? []
  }

  /** Events of a key, oldest first. */
  events(key: string): readonly ITraceEvent[] {
    return this.#events.get(key)?.list() ?? []
  }

  /** Adds a listener; the returned removal may be called more than once. */
  subscribe(listener: ITraceListener): () => void {
    this.#listeners.add(listener)
    return () => void this.#listeners.delete(listener)
  }

  /** Drops every record and listener (host dispose). */
  clear(): void {
    this.#steps.clear()
    this.#events.clear()
    this.#listeners.clear()
  }
}

/** Creates the trace sink of a host; this module is chosen under the `development` condition. */
export function createTraceSink(): ITraceSink {
  return new TraceRecorder()
}
