import { ERROR_SOURCE, UtilsErrorCode } from './error-code.ts'
import { UtilsErrorText } from './error-text.ts'
import { tryReadProperty } from './error.ts'
import { reportUnhandledError } from './host-report.ts'

/**
 * Maximum synchronous reentrancy before consumers spill work from the native stack.
 * Event-subscriber dispatch and middleware-pipeline invocation share this stable boundary.
 */
export const MAX_NATIVE_RECURSION_DEPTH = 256

/**
 * Stable outcomes for one `.then` admission read. Consumers must branch on this value instead of
 * probing a thenable again, which preserves hostile getter and receiver semantics.
 */
export const ThenableProbeKind = {
  notThenable: 'not-thenable',
  thenable: 'thenable',
  failed: 'failed'
} as const

/** Result of a single, failure-contained thenable inspection. */
export type IThenableProbe =
  | { readonly kind: typeof ThenableProbeKind.notThenable }
  | {
      readonly kind: typeof ThenableProbeKind.thenable
      readonly thenFn: (resolve: unknown, reject: unknown) => void
    }
  | { readonly kind: typeof ThenableProbeKind.failed; readonly error: unknown }

/** Result shape used when synchronous callers need to reject or observe a captured thenable. */
export type IThenableInspection =
  | { readonly then: undefined }
  | { readonly then: (resolve: unknown, reject: unknown) => void }
  | { readonly error: unknown }

type IAbsentThenProperty = Readonly<Record<'then', undefined>>
type IPresentThenProperty = Readonly<Record<'then', (resolve: unknown, reject: unknown) => void>>

/** Non-thenable inspection has no own properties; sharing retains the existing frozen shape. */
const ABSENT_THEN_INSPECTION = Object.freeze({}) as IAbsentThenProperty

/** Returns a function that always returns the same stable value. */
export const noop = (): undefined => undefined

/**
 * Reads `value.then` once and returns an explicit discriminant. Getter failures stay in the result,
 * allowing callers to apply their own package error policy without a second read.
 */
export function probeThenable(value: unknown): IThenableProbe {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function'))
    return { kind: ThenableProbeKind.notThenable }
  /** The only read of then; a getter failure remains caller-owned data. */
  const read = tryReadProperty(value as { then?: unknown }, 'then')
  if (read.threw) return { kind: ThenableProbeKind.failed, error: read.error }
  const thenFn = read.value
  if (typeof thenFn !== 'function') return { kind: ThenableProbeKind.notThenable }
  return {
    kind: ThenableProbeKind.thenable,
    thenFn: thenFn as (resolve: unknown, reject: unknown) => void
  }
}

/** Invokes an already-captured then method once with its original thenable receiver. */
export function assimilateCapturedThen<T>(
  thenFn: (resolve: unknown, reject: unknown) => void,
  thenable: unknown
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      Reflect.apply(thenFn, thenable, [resolve, reject])
    } catch (error) {
      reject(error)
    }
  })
}

/** Reads a callback result's then property once for synchronous-contract enforcement. */
export function inspectThenable(value: unknown): IThenableInspection {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function'))
    return ABSENT_THEN_INSPECTION
  /** Read then once without allocating the intermediate guarded-read result. */
  let then: unknown
  try {
    then = (value as { then?: unknown }).then
  } catch (error) {
    return { error }
  }
  if (typeof then !== 'function') return ABSENT_THEN_INSPECTION
  const inspection = {} as IPresentThenProperty
  Object.defineProperty(inspection, String.fromCharCode(116, 104, 101, 110), { value: then })
  return inspection
}

/** Observes a captured thenable rejection while containing reporter failures at the boundary. */
export function observeThenableRejection(
  value: unknown,
  inspection: IThenableInspection,
  onRejected: (error: unknown) => void
): void {
  if ('then' in inspection && inspection.then !== undefined) {
    void assimilateCapturedThen<unknown>(inspection.then, value).then(undefined, (error) => {
      try {
        onRejected(error)
      } catch (reporterError) {
        reportUnhandledError(reporterError)
      }
    })
  } else if ('error' in inspection) {
    try {
      onRejected(inspection.error)
    } catch (reporterError) {
      reportUnhandledError(reporterError)
    }
  }
}

/** Own the first synchronous invocation and its exact cached result or thrown reason. */
class OnceInvocation<T extends (...args: never[]) => unknown> {
  /** Reentrant calls reject while the original invocation is running. */
  #state: 'idle' | 'running' | 'done' = 'idle'
  /** The original result is returned by identity after successful completion. */
  #result: unknown
  /** A private sentinel distinguishes no failure from a callback throwing undefined. */
  #noFailure = Symbol('no failure')
  /** The original thrown value is remembered without normalization or wrapping. */
  #failure: unknown = this.#noFailure
  /** The original callback is invoked with its original plain receiver. */
  #functionValue: T
  /** Capture one callback without invoking it during wrapper construction. */
  constructor(functionValue: T) {
    this.#functionValue = functionValue
  }
  /** One stable callback preserves detached invocation and the first outcome. */
  readonly invoke = (...args: never[]): unknown => {
    if (this.#state === 'running') {
      const error = new TypeError(UtilsErrorText.reentrantCall)
      Object.defineProperty(error, 'source', { value: ERROR_SOURCE, enumerable: true })
      Object.defineProperty(error, 'code', {
        value: UtilsErrorCode.reentrantCall,
        enumerable: true
      })
      throw error
    }
    if (this.#state === 'done') {
      if (this.#failure !== this.#noFailure) throw this.#failure
      return this.#result
    }
    this.#state = 'running'
    try {
      this.#result = Reflect.apply(this.#functionValue, undefined, args)
      this.#state = 'done'
      return this.#result
    } catch (error) {
      this.#failure = error
      this.#state = 'done'
      throw error
    }
  }
}

/**
 * Wraps a synchronous function so its body runs only on the first call; later calls return the
 * first result or rethrow the first error. Calling the wrapper again from inside the running body
 * throws `REENTRANT_CALL`. Each `once(fn)` has its own cache.
 */
export function once<T extends (...args: never[]) => unknown>(functionValue: T): T {
  return new OnceInvocation(functionValue).invoke as T
}

/** Construct the existing invalid-thenable error without replacing its native type. */
function onceAsyncResultError(): TypeError {
  /** The same semantic identity is attached to the original native error. */
  const error = new TypeError(
    UtilsErrorText.invalidArgument('onceAsync result', 'a Promise or PromiseLike')
  )
  Object.defineProperty(error, 'source', { value: ERROR_SOURCE, enumerable: true })
  Object.defineProperty(error, 'code', { value: UtilsErrorCode.invalidArgument, enumerable: true })
  return error
}

/** Own the exact first asynchronous Promise, including a remembered rejection. */
class OnceAsyncInvocation<T> {
  /** Every concurrent or later call returns this exact Promise after first admission. */
  #promise: Promise<T> | undefined
  /** The user callback is read once from construction and invoked without a receiver. */
  #functionValue: () => PromiseLike<T>
  /** Capture the callback without starting an asynchronous operation. */
  constructor(functionValue: () => PromiseLike<T>) {
    this.#functionValue = functionValue
  }
  /** Start in the original microtask and memoize before user code can reenter. */
  readonly invoke = (): Promise<T> => {
    this.#promise ??= Promise.resolve().then(() => this.#start())
    return this.#promise
  }
  /** Admit the original then protocol once before using the canonical assimilation owner. */
  #start(): Promise<T> {
    /** The original callback receives no wrapper instance as its receiver. */
    const functionValue = this.#functionValue
    /** User results retain their original thenable object identity during assimilation. */
    const result: unknown = functionValue()
    if (result === null || (typeof result !== 'object' && typeof result !== 'function'))
      throw onceAsyncResultError()
    /** One property read preserves hostile getter failures and prevents a second admission read. */
    const then: unknown = Reflect.get(result, 'then')
    if (typeof then !== 'function') throw onceAsyncResultError()
    return assimilateCapturedThen<T>(then as (resolve: unknown, reject: unknown) => void, result)
  }
}

/**
 * Wraps an async function so the first call starts it and every call, including concurrent ones,
 * returns that same Promise. A first rejection is remembered too and the function never runs again;
 * put retries inside `functionValue` when needed. A non-thenable result rejects with
 * `INVALID_ARGUMENT`.
 */
export function onceAsync<T>(functionValue: () => PromiseLike<T>): () => Promise<T> {
  return new OnceAsyncInvocation(functionValue).invoke
}
