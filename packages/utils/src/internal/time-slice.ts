/**
 * Cooperative time slicing: process a large (or unbounded) sequence in bounded slices and yield to
 * the host between them, so rendering, input, timers and I/O keep running. The slice budget is
 * measured on a monotonic clock; yields go through `asyncTask` strategies.
 */
import { ERROR_SOURCE, UtilsErrorCode } from '../error-code.js'
import { UtilsErrorText } from '../error-text.js'
import {
  attachErrorIdentity,
  attachSecondaryErrors,
  tryReadProperty,
  UtilsAbortError
} from '../error.js'
import type { IAbortSignal } from '../promise.js'
import { resolveAsyncTaskStrategy, yieldToHost, type AsyncTaskStrategy } from './async-task.js'
import { systemScheduler } from './scheduler.js'

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
  return run(iterator, async, handler, budget, yieldStrategy, signal, onProgress, clock)
}

/** The asynchronous slicing loop behind `timeSlice()`. */
async function run<T>(
  iterator: ISliceIterator<T>,
  async: boolean,
  handler: (item: T, index: number) => unknown,
  budget: number,
  strategy: AsyncTaskStrategy,
  signal: IAbortSignal | undefined,
  onProgress: ((report: ITimeSliceReport) => void) | undefined,
  clock: { now(): number }
): Promise<ITimeSliceReport> {
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
  /** Builds a frozen progress snapshot. */
  const report = (): ITimeSliceReport =>
    Object.freeze({ processed, slices, elapsedMs: clock.now() - startedAt })
  /** Throws the abort error when the signal fired. */
  const checkAbort = (): void => {
    if (!signal?.aborted) return
    /** Abort reason read once through a guarded getter. */
    const reason = tryReadProperty(signal as { reason?: unknown }, 'reason')
    throw new UtilsAbortError(reason.threw ? reason.error : reason.value)
  }
  try {
    for (;;) {
      checkAbort()
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
        onProgress?.(report())
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
  const final = report()
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
  /** Results in source order. */
  const results: Awaited<R>[] = []
  return timeSlice(
    source,
    (item, index) => {
      /** Mapper result, awaited when asynchronous. */
      const value = mapper(item, index)
      if (isThenable(value))
        return Promise.resolve(value).then((resolved) => {
          results.push(resolved as Awaited<R>)
        })
      results.push(value as Awaited<R>)
      return undefined
    },
    options
  ).then(() => results)
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
  /** Running accumulator. */
  let accumulator = initial
  return timeSlice(
    source,
    (item, index) => {
      accumulator = reducer(accumulator, item, index)
    },
    options
  ).then(() => accumulator)
}
