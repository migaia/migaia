import { UtilsErrorCode } from './error-code.js'
import { UtilsErrorText } from './error-text.js'

/** Returns a function that always returns the same stable value. */
export const noop = (): undefined => undefined

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
        if (!(result instanceof Promise)) {
          const error = new TypeError(
            UtilsErrorText.invalidArgument('onceAsync result', 'a native Promise')
          )
          Object.defineProperty(error, 'source', { value: '@migaia/utils', enumerable: true })
          Object.defineProperty(error, 'code', {
            value: UtilsErrorCode.invalidArgument,
            enumerable: true
          })
          throw error
        }
        return result
      })
    return promise
  }
}
