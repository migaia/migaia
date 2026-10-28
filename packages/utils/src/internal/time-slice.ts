/**
 * Cooperative time slicing: process a large (or unbounded) sequence in bounded slices and yield to
 * the host between them, so rendering, input, timers and I/O keep running. The slice budget is
 * measured on a monotonic clock; yields go through `asyncTask` strategies.
 */
import { ERROR_SOURCE, UtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'
import {
  attachErrorIdentity,
  attachSecondaryErrors,
  tryReadProperty,
  UtilsAbortError
} from '../error.ts'
import type { IAbortSignal } from './promise-contract.ts'
import { resolveAsyncTaskStrategy, yieldToHost, type AsyncTaskStrategy } from './async-task.ts'
import { systemScheduler } from './scheduler.ts'

/** Progress of one time-sliced run. */
export type ITimeSliceReport = {
  /** Items handled so far. */
  readonly processed: number
  /** Slices started so far (at least 1). */
  readonly slices: number
  /** Monotonic milliseconds since the run started. */
  readonly elapsedMs: number
}

/** Options shared by `timeSlice`, `timeSliceMap` and `timeSliceReduce`. */
export type ITimeSliceOptions = {
  /** Milliseconds of work per slice before yielding. Defaults to `8` (half a 60Hz frame). */
  readonly budget?: number
  /** How to yield between slices. Defaults to `auto`; a list is an ordered fallback. */
  readonly strategy?: AsyncTaskStrategy | readonly AsyncTaskStrategy[]
  /** Stops at the next item boundary; rejects with `UtilsAbortError`. */
  readonly signal?: IAbortSignal
  /** Called after every slice and once at the end. A throw stops the run like a handler throw. */
  readonly onProgress?: (report: ITimeSliceReport) => void
  /** Monotonic clock; defaults to the system scheduler clock. Inject one in tests. */
  readonly clock?: { now(): number }
}

/** Default slice budget in milliseconds. */
const DEFAULT_BUDGET = 8

/** Creates a coded `INVALID_ARGUMENT` error of the given native type. */
function argumentError(
  Constructor: TypeErrorConstructor | RangeErrorConstructor,
  field: string,
  expectation: string
): Error {
  return attachErrorIdentity(new Constructor(UtilsErrorText.invalidArgument(field, expectation)), {
    source: ERROR_SOURCE,
    code: UtilsErrorCode.invalidArgument
  })
}

/** Unified iterator view over sync and async sources. */
type ISliceIterator<T> = {
  next(): IteratorResult<T> | PromiseLike<IteratorResult<T>>
  return?(): unknown
}

/** Opens the source once; sync iterators stay sync so slices do not pay a microtask per item. */
function openSource<T>(source: Iterable<T> | AsyncIterable<T>): {
  readonly iterator: ISliceIterator<T>
  readonly async: boolean
} {
  if (source !== null && (typeof source === 'object' || typeof source === 'function')) {
    /** Async iteration takes precedence, matching `for await`. */
    const asyncFactory = (source as Partial<AsyncIterable<T>>)[Symbol.asyncIterator]
    if (typeof asyncFactory === 'function')
      return { iterator: Reflect.apply(asyncFactory, source, []) as ISliceIterator<T>, async: true }
    /** Sync iteration fallback. */
    const syncFactory = (source as Partial<Iterable<T>>)[Symbol.iterator]
    if (typeof syncFactory === 'function')
      return { iterator: Reflect.apply(syncFactory, source, []) as ISliceIterator<T>, async: false }
  }
  throw argumentError(TypeError, 'source', UtilsErrorText.iterableExpectation)
}

/** Detects a thenable through one guarded `then` read. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  /** Guarded read; a throwing getter means "not a thenable". */
  const then = tryReadProperty(value as { then?: unknown }, 'then')
  return !then.threw && typeof then.value === 'function'
}

/**
 * Processes every item of `source` with `handler`, yielding to the host whenever a slice exceeds
 * `budget` milliseconds. At least one item runs per slice, so progress is guaranteed even when a
 * single item is slower than the budget. Async handlers are awaited.
 *
 * A handler or `onProgress` throw stops the run: the iterator's `return()` runs, and the original
 * error rejects the Promise (a `return()` failure is attached through `errors`). Abort stops at the
 * next item boundary the same way and rejects with `UtilsAbortError`. Invalid arguments throw
 * `INVALID_ARGUMENT` synchronously.
 *
 * @example
 *   ;```ts
 *   await timeSlice(rows, (row) => index.add(row), {
 *     budget: 5,
 *     onProgress: ({ processed }) => bar(processed)
 *   })
 *   ```
 */
export function timeSlice<T>(
  source: Iterable<T> | AsyncIterable<T>,
  handler: (item: T, index: number) => unknown,
  options: ITimeSliceOptions = {}
): Promise<ITimeSliceReport> {
  if (typeof handler !== 'function')
    throw argumentError(TypeError, 'handler', UtilsErrorText.functionExpectation)
  /** Options read once. */
  const {
    budget = DEFAULT_BUDGET,
    strategy = 'auto',
    signal,
    onProgress,
    clock = systemScheduler
  } = options
  if (typeof budget !== 'number')
    throw argumentError(TypeError, 'budget', UtilsErrorText.budgetExpectation)
  if (!Number.isFinite(budget) || budget <= 0)
    throw argumentError(RangeError, 'budget', UtilsErrorText.budgetExpectation)
  if (onProgress !== undefined && typeof onProgress !== 'function')
    throw argumentError(TypeError, 'onProgress', UtilsErrorText.functionExpectation)
  if (clock === null || typeof clock !== 'object' || typeof clock.now !== 'function')
    throw argumentError(TypeError, 'clock', 'an object with a now() method')
  // Resolve once up front so an unsupported yield strategy fails before any item runs.
  /** Concrete yield strategy used between slices. */
  const yieldStrategy = resolveAsyncTaskStrategy(strategy)
  /** Opened source; opening errors are argument errors. */
  const { iterator, async } = openSource(source)
  return run({
    iterator,
    async,
    handler,
    budget,
    strategy: yieldStrategy,
    signal,
    onProgress,
    clock
  })
}

/** Snapshot values are passed explicitly; progress creation never captures one run's changing state. */
function sliceReport(
  processed: number,
  slices: number,
  startedAt: number,
  clock: { now(): number }
): ITimeSliceReport {
  return Object.freeze({ processed, slices, elapsedMs: clock.now() - startedAt })
}

/** Observe cancellation at the same item boundary and keep hostile reason failures as reasons. */
function checkSliceAbort(signal: IAbortSignal | undefined): void {
  if (!signal?.aborted) return
  /** Cancellation reasons use the package's canonical protected property read. */
  const reason = tryReadProperty(signal as { reason?: unknown }, 'reason')
  throw new UtilsAbortError(reason.threw ? reason.error : reason.value)
}

/** One admitted slicing run owns exactly these source, callback and scheduling capabilities. */
type ISliceRunContext<T> = {
  readonly iterator: ISliceIterator<T>
  readonly async: boolean
  readonly handler: (item: T, index: number) => unknown
  readonly budget: number
  readonly strategy: AsyncTaskStrategy
  readonly signal: IAbortSignal | undefined
  readonly onProgress: ((report: ITimeSliceReport) => void) | undefined
  readonly clock: { now(): number }
}

/** The asynchronous slicing loop owns all run counters; borrowed capabilities arrive explicitly. */
async function run<T>(context: ISliceRunContext<T>): Promise<ITimeSliceReport> {
  /** These admitted references stay stable until this run returns or rejects. */
  const { iterator, async, handler, budget, strategy, signal, onProgress, clock } = context
  /** Run start on the monotonic clock. */
  const startedAt = clock.now()
  /** Start of the current slice. */
  let sliceStart = startedAt
  /** Items handled so far; also the next item's index. */
  let processed = 0
  /** Slices started so far. */
  let slices = 1
  /** Whether the iterator reported completion, so `return()` must not be called. */
  let done = false
  try {
    for (;;) {
      checkSliceAbort(signal)
      /** Next iterator step; awaited only for async sources. */
      const step = async ? await iterator.next() : (iterator.next() as IteratorResult<T>)
      if (step.done) {
        done = true
        break
      }
      /** Handler result; awaited only when it is a thenable. */
      const result = handler(step.value, processed)
      if (isThenable(result)) await result
      processed += 1
      if (clock.now() - sliceStart >= budget) {
        onProgress?.(sliceReport(processed, slices, startedAt, clock))
        await yieldToHost(strategy, signal ? { signal } : undefined)
        slices += 1
        sliceStart = clock.now()
      }
    }
  } catch (error) {
    if (!done && typeof iterator.return === 'function') {
      try {
        /** Cleanup result; awaited for async iterators. */
        const closed = iterator.return()
        if (isThenable(closed)) await closed
      } catch (cleanupError) {
        throw attachSecondaryErrors(error, [cleanupError])
      }
    }
    throw error
  }
  /** Final report, also delivered to `onProgress`. */
  const final = sliceReport(processed, slices, startedAt, clock)
  onProgress?.(final)
  return final
}

/**
 * Time-sliced `map`: resolves with every mapper result in source order.
 *
 * @example
 *   ;```ts
 *   const rows = await timeSliceMap(csvLines, parseLine)
 *   ```
 */
export function timeSliceMap<T, R>(
  source: Iterable<T> | AsyncIterable<T>,
  mapper: (item: T, index: number) => R | PromiseLike<R>,
  options?: ITimeSliceOptions
): Promise<Awaited<R>[]> {
  if (typeof mapper !== 'function')
    throw argumentError(TypeError, 'mapper', UtilsErrorText.functionExpectation)
  return new SliceMapOperation(mapper).run(source, options)
}

/**
 * Time-sliced `reduce` with an explicit initial accumulator.
 *
 * @example
 *   ;```ts
 *   const total = await timeSliceReduce(orders, (sum, order) => sum + order.amount, 0)
 *   ```
 */
export function timeSliceReduce<T, A>(
  source: Iterable<T> | AsyncIterable<T>,
  reducer: (accumulator: A, item: T, index: number) => A,
  initial: A,
  options?: ITimeSliceOptions
): Promise<A> {
  if (typeof reducer !== 'function')
    throw argumentError(TypeError, 'reducer', UtilsErrorText.functionExpectation)
  return new SliceReduceOperation(reducer, initial).run(source, options)
}

/** A mapped run owns its output array and one mapper, including asynchronous append ordering. */
class SliceMapOperation<T, R> {
  /** Callback remains a plain invocation and is never replaced after admission. */
  readonly #mapper: (item: T, index: number) => R | PromiseLike<R>
  /** Only completed mapper values enter the result, in source order. */
  readonly #results: Awaited<R>[] = []

  /** Capture the caller callback without running source iteration early. */
  constructor(mapper: (item: T, index: number) => R | PromiseLike<R>) {
    this.#mapper = mapper
  }

  /** Reuse the canonical slicing loop; the result becomes visible after final progress delivery. */
  run(source: Iterable<T> | AsyncIterable<T>, options?: ITimeSliceOptions): Promise<Awaited<R>[]> {
    return timeSlice(source, this.#handle, options).then(() => this.#results)
  }

  /** Preserve synchronous fast-path appends and the one Promise job for asynchronous values. */
  readonly #handle = (item: T, index: number): unknown => {
    /** Reading the mapper out retains the original receiver-free callback invocation. */
    const mapper = this.#mapper
    /** A mapper thenable is assimilated exactly as before. */
    const value = mapper(item, index)
    if (isThenable(value)) return Promise.resolve(value).then(this.#append)
    this.#results.push(value as Awaited<R>)
    return undefined
  }

  /** One asynchronous mapper continuation commits its value without adding a second job. */
  readonly #append = (value: Awaited<R>): void => {
    this.#results.push(value)
  }
}

/** A reduction owns one accumulator and callback while the canonical loop owns iteration timing. */
class SliceReduceOperation<T, A> {
  /** The reducer uses the original plain-call receiver. */
  readonly #reducer: (accumulator: A, item: T, index: number) => A
  /** The latest returned accumulator remains private until slicing completes. */
  #accumulator: A

  /** Store the initial accumulator without reading the source or invoking the reducer. */
  constructor(reducer: (accumulator: A, item: T, index: number) => A, initial: A) {
    this.#reducer = reducer
    this.#accumulator = initial
  }

  /** Return the final accumulator after the same final progress callback. */
  run(source: Iterable<T> | AsyncIterable<T>, options?: ITimeSliceOptions): Promise<A> {
    return timeSlice(source, this.#handle, options).then(() => this.#accumulator)
  }

  /** One source item advances the accumulator synchronously, preserving reducer failure identity. */
  readonly #handle = (item: T, index: number): void => {
    /** A local callback keeps the original unbound invocation semantics. */
    const reducer = this.#reducer
    this.#accumulator = reducer(this.#accumulator, item, index)
  }
}
