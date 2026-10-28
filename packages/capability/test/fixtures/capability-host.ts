/** Shared host fixtures own controlled handles and deferred activation/cleanup, without resources. */
import { vi, type Mock } from 'vitest'
import { createCapabilityHost, type ICapabilityHandle } from '../../src/index.js'

/** Build the exact handle fixture while retaining the caller's disposer mock identity. */
export const handleOf = (
  dispose: Mock<() => void | PromiseLike<void>> = vi.fn()
): ICapabilityHandle & { dispose: typeof dispose } => ({
  dispose
})

/** Let each case choose when activation or cleanup settles without a timer or external resource. */
export const deferred = <T>() => {
  /** Test owner resolves the original Promise with the requested resource. */
  let resolve!: (value: T) => void
  /** Test owner rejects the original Promise with the requested failure identity. */
  let reject!: (error: unknown) => void
  /** Shared original Promise lets cases assert pending identity and explicit settlement order. */
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

/** Explicitly list allowed names so fixtures cannot restore a permissive default. */
export const enabledHost = <Context>(context: Context, ...names: string[]) =>
  createCapabilityHost(context, {
    flags: Object.fromEntries(names.map((name) => [name, true]))
  })
