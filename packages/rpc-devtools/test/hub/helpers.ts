import type {
  IRpcDevtoolsCounters,
  IRpcDevtoolsDescribe,
  IRpcDevtoolsQuery,
  IRpcDevtoolsStats,
  IRpcDevtoolsWatchBatch,
  IRpcDevtoolsWireEvent
} from '../../src/contract/index.js'
import type { IRpcDevtoolsTargetClient } from '../../src/hub/types.js'

/** Mutable simulated monotonic clock lets each describe request consume its known RTT. */
export type ITestClock = { now: number }

/** Deferred calls expose lifecycle races without timers or transport implementations. */
export type IDeferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

/** Construct one externally controlled promise; ownership stays with the test. */
export function deferred<T>(): IDeferred<T> {
  /** The executor initializes both completion functions synchronously. */
  let resolve!: (value: T) => void
  /** Failure injection retains the original error instance. */
  let reject!: (error: unknown) => void
  /** The promise remains pending until the oracle advances this operation. */
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

/** Contract loss counters are fixture metadata, independent of the hub's own bounded storage. */
export const counters: IRpcDevtoolsCounters = {
  evicted: 0,
  contentDropped: 0,
  droppedReentrant: 0,
  sampledOut: 0,
  ignoredWhilePaused: 0,
  ignoredAfterClose: 0,
  internOverflow: 0
}

/** A fake target exposes only the frozen request/stream boundary and observable release counts. */
export type IFakeTarget = {
  client: IRpcDevtoolsTargetClient
  requests: { method: string; payload: unknown }[]
  watchInputs: unknown[]
  readonly releases: number
  push(events: readonly IRpcDevtoolsWireEvent[]): void
  fail(error: unknown): void
}

/** Optional controls model supported alignment, catch-up, stats and asynchronous watch cleanup. */
export type IFakeTargetOptions = {
  clock?: ITestClock
  offset?: number
  rtts?: readonly number[]
  describeGate?: Promise<void>
  describeError?: Error
  releaseGate?: Promise<void>
  releaseError?: Error
  onRelease?(): void
  stats?: IRpcDevtoolsStats
}

/**
 * Create explicit outbound-request wire metadata; overrides model other participant roles. Neither
 * collector nor probe-core participates in hub acceptance.
 */
export function event(
  seq: number,
  at: number,
  fields: Partial<IRpcDevtoolsWireEvent> = {}
): IRpcDevtoolsWireEvent {
  return {
    seq,
    at,
    endpointId: 'endpoint',
    stage: 'message',
    direction: 'outbound',
    kind: 'request',
    ...fields
  }
}

/**
 * Preserve query and watch event references while paging through the public service contract. A
 * pending next can resolve after return, allowing the hub to prove stale-watch isolation.
 */
export function fakeTarget(
  events: readonly IRpcDevtoolsWireEvent[] = [],
  options: IFakeTargetOptions = {}
): IFakeTarget {
  /** Request history proves catch-up cursor progress and the five alignment samples. */
  const requests: { method: string; payload: unknown }[] = []
  /** Every stream creation records its contract filter input. */
  const watchInputs: unknown[] = []
  /** Stream batches queue until the hub asks for the next batch. */
  const batches: IRpcDevtoolsWatchBatch[] = []
  /** One async-iterator next is outstanding at a time. */
  let pending: IDeferred<IteratorResult<IRpcDevtoolsWatchBatch>> | undefined
  /** A failed stream rejects the next call if no request was outstanding. */
  let failure: unknown
  /** Distinguish absent failure from an intentionally undefined rejection value. */
  let failed = false
  /** Returning the iterator ends future reads but cannot cancel an already received batch. */
  let returned = false
  /** Cleanup count makes watch ownership and idempotent release observable. */
  let releases = 0
  /** Each sample uses its own latency; minimum RTT must determine the final estimate. */
  let describes = 0
  /** Injectable monotonic time is shared by client and hub in clock acceptance cases. */
  const clock = options.clock ?? { now: 0 }
  /** Public client never owns a transport; it returns frozen-contract payloads only. */
  const client: IRpcDevtoolsTargetClient = {
    /** Describe consumes RTT; query returns at most 1,000 retained events after the supplied cursor. */
    async request(method, payload) {
      requests.push({ method, payload })
      if (method === 'describe') {
        if (options.describeGate) await options.describeGate
        if (options.describeError) throw options.describeError
        /** Remote clock is sampled at the midpoint of a symmetric simulated round trip. */
        const rtt = options.rtts?.[describes % options.rtts.length] ?? 0
        /** Header fields match the frozen service contract and keep remote clock identity explicit. */
        const description: IRpcDevtoolsDescribe = {
          version: '1',
          now: clock.now + rtt / 2 + (options.offset ?? 0),
          paused: false,
          descriptors: [],
          limits: { maxEvents: 100_000, maxContentBytes: 0 },
          counters
        }
        describes++
        clock.now += rtt
        return description
      }
      if (method === 'query') {
        /** Cursor and limit stay at the service boundary; pages retain original wire-event identity. */
        const query = (payload ?? {}) as IRpcDevtoolsQuery
        /** Empty pages keep the last cursor instead of inventing an unseen event sequence. */
        const page: IRpcDevtoolsWireEvent[] = []
        for (const item of events) {
          if (item.seq > (query.afterSeq ?? 0)) page.push(item)
          if (page.length === Math.min(query.limit ?? 1000, 1000)) break
        }
        return { events: page, nextSeq: page.at(-1)?.seq ?? query.afterSeq ?? 0, counters }
      }
      if (method === 'stats') return options.stats ?? { since: 0, methods: [] }
      throw new Error(`unexpected fixture request: ${method}`)
    },
    /** The custom iterator exposes cleanup timing and preserves emitted batches by reference. */
    stream(method, payload) {
      if (method !== 'watch') throw new Error(`unexpected fixture stream: ${method}`)
      watchInputs.push(payload)
      return {
        /** Each target owns exactly this iterator, with no generator return scheduling ambiguity. */
        [Symbol.asyncIterator]() {
          return {
            /** Read queued data first, then hold one future read until the test emits or fails. */
            next(): Promise<IteratorResult<IRpcDevtoolsWatchBatch>> {
              if (returned) return Promise.resolve({ done: true, value: undefined })
              if (failed) return Promise.reject(failure)
              /** A queued page retains the exact events supplied to push. */
              const batch = batches.shift()
              if (batch) return Promise.resolve({ done: false, value: batch })
              pending = deferred<IteratorResult<IRpcDevtoolsWatchBatch>>()
              return pending.promise
            },
            /** Cleanup can remain pending or reject while keeping the original error. */
            async return() {
              releases++
              returned = true
              options.onRelease?.()
              if (options.releaseGate) await options.releaseGate
              if (options.releaseError) throw options.releaseError
              return { done: true as const, value: undefined }
            }
          }
        }
      }
    }
  }
  return {
    client,
    requests,
    watchInputs,
    get releases() {
      return releases
    },
    /** Deliver one page even after return if a read was already outstanding. */
    push(items) {
      /** Batch metadata records no fabricated collector loss. */
      const batch: IRpcDevtoolsWatchBatch = { events: items, dropped: 0 }
      if (pending) {
        pending.resolve({ done: false, value: batch })
        pending = undefined
      } else batches.push(batch)
    },
    /** Fail the outstanding stream with exactly the caller's original error. */
    fail(error) {
      failed = true
      failure = error
      if (pending) {
        pending.reject(error)
        pending = undefined
      }
    }
  }
}

/** Drain bounded microtasks until the asynchronous contract condition becomes observable. */
export async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 30; i++) {
    if (condition()) return
    await Promise.resolve()
  }
  throw new Error('fixture condition did not settle')
}

/** Allow a completed stale read to traverse the watch loop without advancing wall-clock time. */
export async function drain(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
