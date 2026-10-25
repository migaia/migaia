/**
 * Projects a provider return through one supplied completion callback while preserving synchronous
 * results and captured thenable semantics. Utility promise inspection owns assimilation; this
 * module does not allocate provider registrations or execution lifetimes.
 */
import { probeThenable, ThenableProbeKind, assimilateCapturedThen } from '@migaia/utils/function'

/**
 * Project one actual business return through the existing provider completion boundary. Synchronous
 * values add no Promise; genuine asynchronous returns retain native assimilation and late failure.
 */
export function completeProviderReturn<C, R>(
  value: unknown,
  context: C,
  complete: (value: unknown, context: C) => R
): R | Promise<R> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function'))
    return complete(value, context)
  /** A proxy can hide native identity; ordinary thenable admission still owns its business return. */
  let nativePromise: boolean
  try {
    nativePromise = value instanceof Promise
  } catch {
    nativePromise = false
  }
  /** Native Promise resolution preserves its constructor/realm semantics before result projection. */
  if (nativePromise)
    return completeAsyncProviderReturn(value as Promise<unknown>, context, complete)
  /** Foreign thenables and plain result objects perform the same single then-property admission. */
  const probe = probeThenable(value)
  if (probe.kind === ThenableProbeKind.failed) throw probe.error
  if (probe.kind === ThenableProbeKind.notThenable) return complete(value, context)
  /** Native assimilation schedules the captured then callback; its getter is never read twice. */
  const assimilated = Promise.resolve().then(() =>
    assimilateCapturedThen<unknown>(probe.thenFn, value)
  )
  return assimilated.then((result) => complete(result, context))
}

/** Await the actual native Promise only when business is asynchronous, preserving then overrides. */
async function completeAsyncProviderReturn<C, R>(
  value: Promise<unknown>,
  context: C,
  complete: (value: unknown, context: C) => R
): Promise<R> {
  return complete(await value, context)
}
