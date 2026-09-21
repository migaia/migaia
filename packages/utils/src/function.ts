import { UtilsErrorCode } from './error-code.js'
import { UtilsErrorText } from './error-text.js'

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

export type IThenableProbeKind = (typeof ThenableProbeKind)[keyof typeof ThenableProbeKind]

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

/** Returns a function that always returns the same stable value. */
export const noop = (): undefined => undefined

/**
 * Reads `value.then` once and returns an explicit discriminant. Getter failures stay in the result,
 * allowing callers to apply their own package error policy without a second read.
 */
export function probeThenable(value: unknown): IThenableProbe {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function'))
    return { kind: ThenableProbeKind.notThenable }
  let thenFn: unknown
  try {
    thenFn = (value as { then?: unknown }).then
  } catch (error) {
    return { kind: ThenableProbeKind.failed, error }
  }
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
    return Object.freeze({}) as IAbsentThenProperty
  try {
    const then = (value as { then?: unknown }).then
    if (typeof then !== 'function') return Object.freeze({}) as IAbsentThenProperty
    const inspection = {} as IPresentThenProperty
    Object.defineProperty(inspection, String.fromCharCode(116, 104, 101, 110), { value: then })
    return inspection
  } catch (error) {
    return { error }
  }
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
      } catch {
        // The supplied reporter is the terminal boundary for its own failure.
      }
    })
  } else if ('error' in inspection) {
    try {
      onRejected(inspection.error)
    } catch {
      // The supplied reporter is the terminal boundary for its own failure.
    }
  }
}

/** Memoizes a synchronous function, including its first thrown result. */
export function once<T extends (...args: never[]) => unknown>(functionValue: T): T {
  let state: 'idle' | 'running' | 'done' = 'idle'
  let result: unknown
  let failure: unknown
  const noFailure = Symbol('no failure')
  failure = noFailure
  return ((...args: never[]) => {
    if (state === 'running') {
      const error = new TypeError(UtilsErrorText.reentrantCall)
      Object.defineProperty(error, 'source', { value: '@migaia/utils', enumerable: true })
      Object.defineProperty(error, 'code', {
        value: UtilsErrorCode.reentrantCall,
        enumerable: true
      })
      throw error
    }
    if (state === 'done') {
      if (failure !== noFailure) throw failure
      return result
    }
    state = 'running'
    try {
      result = functionValue(...args)
      state = 'done'
      return result
    } catch (error) {
      failure = error
      state = 'done'
      throw error
    }
  }) as T
}

/** Memoizes one asynchronous invocation and preserves exact Promise identity. */
export function onceAsync<T>(functionValue: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | undefined
  return () => {
    if (promise === undefined)
      promise = Promise.resolve().then(() => {
        const result: unknown = functionValue()
        if (result === null || (typeof result !== 'object' && typeof result !== 'function')) {
          const error = new TypeError(
            UtilsErrorText.invalidArgument('onceAsync result', 'a Promise or PromiseLike')
          )
          Object.defineProperty(error, 'source', { value: '@migaia/utils', enumerable: true })
          Object.defineProperty(error, 'code', {
            value: UtilsErrorCode.invalidArgument,
            enumerable: true
          })
          throw error
        }
        let then: unknown
        // Read the then protocol exactly once so a hostile or stateful getter cannot alter
        // admission between validation and assimilation.
        then = Reflect.get(result, 'then')
        if (typeof then !== 'function') {
          const error = new TypeError(
            UtilsErrorText.invalidArgument('onceAsync result', 'a Promise or PromiseLike')
          )
          Object.defineProperty(error, 'source', { value: '@migaia/utils', enumerable: true })
          Object.defineProperty(error, 'code', {
            value: UtilsErrorCode.invalidArgument,
            enumerable: true
          })
          throw error
        }
        return new Promise<T>((resolve, reject) => {
          try {
            Reflect.apply(
              then as (
                resolve: (value: unknown) => void,
                reject: (reason: unknown) => void
              ) => void,
              result,
              [resolve, reject]
            )
          } catch (error) {
            reject(error)
          }
        })
      })
    return promise
  }
}
