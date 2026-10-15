import { assimilateCapturedThen } from '@migaia/utils/function'

/**
 * Ported from `@migaia/capability`'s `containAsyncRejection`.
 *
 * `() => void` in TypeScript still accepts an `async` function. This guards a diagnostic/release
 * callback's return value for a thenable and observes its rejection, so a callback that turns out
 * to be `async` behind our backs doesn't surface as an unhandled rejection one microtask later
 * (L-T17, L-T26, L-T35).
 */
export function containAsyncRejection(value: unknown, onRejected: (error: unknown) => void): void {
  if ((value === null || typeof value !== 'object') && typeof value !== 'function') return
  let then: unknown
  try {
    then = (value as { then?: unknown }).then
  } catch (error) {
    onRejected(error)
    return
  }
  if (typeof then !== 'function') return
  // Reuse the `then` we already read — `assimilateCapturedThen` invokes it exactly once with the
  // thenable as receiver, so we never hand the value back to `Promise.resolve()` to read `.then` a
  // second time (a stateful getter could return a different function or throw on the second read).
  const settled = assimilateCapturedThen<unknown>(
    then as (resolve: unknown, reject: unknown) => void,
    value
  )
  void settled.catch((error: unknown) => {
    try {
      onRejected(error)
    } catch {
      // The rejection handler is itself the last error boundary; it must not manufacture a new
      // unhandled rejection by throwing back out of this `.catch`.
    }
  })
}

/**
 * Hands `error` to a caller-supplied reporter, the last error boundary of a lifecycle operation.
 * The reporter's own synchronous throw and async rejection are contained here because no lower
 * layer exists to receive them (L-T26, L-T35). An absent reporter makes this a no-op.
 */
export function safeReport(report: ((error: unknown) => void) | undefined, error: unknown): void {
  if (!report) return
  try {
    const result: unknown = report(error)
    containAsyncRejection(result, () => {
      // The reporter's own async failure has no lower layer to report to; it terminates here.
    })
  } catch {
    // The reporter is the last error boundary for its own failures too (L-T35).
  }
}
