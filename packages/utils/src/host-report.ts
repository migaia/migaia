/**
 * Delivers an unhandled diagnostic through the host's existing exception queue. Shared by promise
 * controls and thenable observation so reporter failures stay observable without creating an
 * unhandled rejected Promise or a function-to-promise dependency.
 */
export function reportUnhandledError(error: unknown): void {
  /** Read at reporting time so the host owns scheduling and can supply its diagnostic seam. */
  const enqueue = globalThis.queueMicrotask
  if (typeof enqueue === 'function')
    enqueue(() => {
      throw error
    })
  else throw error
}
