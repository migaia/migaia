// Shared test utilities for the Resource test suite.

/** A manually resolvable/rejectable Promise, for controlling fetcher settlement timing in tests. */
export function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * Drain the microtask queue (queueMicrotask-based idle scheduling, promise `.then` chains). A
 * macrotask boundary (`setTimeout`) only runs once every pending microtask has settled, so this
 * reliably observes effects scheduled via `internalsOf(runtime).deferIdle`.
 */
export function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
