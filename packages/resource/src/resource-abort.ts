/** Request-scoped abort/source race; lifecycle owns signal subscription and listener cleanup. */
import type { IRuntime } from '@migaia/reactive'
import { ReactiveErrorPhase } from '@migaia/reactive/extension'
import { observeAbortSubscription } from '@migaia/lifecycle/abort'
import type { IAbortSignal } from '@migaia/utils/promise'
import {
  abortError,
  createCancellationFailure,
  createSignalRegistrationFailure
} from './resource-failure.ts'

/** Explicit abort-boundary state shared only by its source and signal callbacks. */
type IResourceAbortContext<T> = {
  /** Runtime contains registration and cleanup diagnostics. */
  readonly runtime: IRuntime
  /** Native Promise completion callbacks ignore their receiver. */
  readonly resolve: (value: T | PromiseLike<T>) => void
  /** Native Promise rejection callback is installed before host-controlled signal access. */
  readonly reject: (error: unknown) => void
  /** The first source or abort event has exclusive settlement authority. */
  settled: boolean
  /** Lifecycle owns listener removal, including synchronous-abort admission cleanup. */
  subscription: ReturnType<typeof observeAbortSubscription> | undefined
}

/**
 * Creates the original native Promise boundary and synchronously admits source and abort
 * observation.
 */
export function withResourceAbort<T>(
  source: Promise<T>,
  signal: IAbortSignal,
  runtime: IRuntime
): Promise<T> {
  // The executor forwards immutable inputs; mutable settlement belongs to its explicit context.
  return new Promise<T>((resolve, reject) =>
    registerResourceAbort(source, signal, runtime, resolve, reject)
  )
}

/** Observes source before signal access and preserves the original hostile-registration precedence. */
function registerResourceAbort<T>(
  source: Promise<T>,
  signal: IAbortSignal,
  runtime: IRuntime,
  resolve: (value: T | PromiseLike<T>) => void,
  reject: (error: unknown) => void
): void {
  /** Only completion state persists; source and signal are not retained as owner fields. */
  const context: IResourceAbortContext<T> = {
    runtime,
    resolve,
    reject,
    settled: false,
    subscription: undefined
  }
  source.then(
    (value) => settleResourceAbortValue(context, value),
    (error) => settleResourceAbortError(context, error)
  )
  try {
    if (signal.aborted) {
      context.settled = true
      reject(abortError(signal.reason))
      return
    }
  } catch (error) {
    context.settled = true
    reject(createSignalRegistrationFailure(error))
    return
  }
  try {
    context.subscription = observeAbortSubscription(
      signal,
      (reason) => cancelResourceAbort(context, reason),
      (error) => reportResourceAbortCleanup(context, error)
    )
    context.subscription.retryRegistrationCleanup()
  } catch (error) {
    if (context.settled) {
      // Synchronous abort already won; diagnostics cannot replace its canonical reason.
      try {
        runtime.reportError(createSignalRegistrationFailure(error), {
          phase: ReactiveErrorPhase.asyncFlush
        })
      } catch {
        // Last-boundary diagnostics remain best effort, as before.
      }
      return
    }
    context.settled = true
    reject(createSignalRegistrationFailure(error))
    return
  }
  /** One final signal read catches abort during host registration. */
  let abortedAfterRegistration = false
  try {
    abortedAfterRegistration = signal.aborted
  } catch (error) {
    context.settled = true
    context.subscription?.unsubscribe()
    reject(createSignalRegistrationFailure(error))
    return
  }
  if (abortedAfterRegistration) cancelResourceAbort(context, undefined)
  if (context.settled) context.subscription?.unsubscribe()
}

/** Preserves canonical cancellation while registration finishes listener ownership. */
function cancelResourceAbort<T>(context: IResourceAbortContext<T>, reason: unknown): void {
  if (context.settled) return
  context.settled = true
  context.reject(abortError(reason))
}

/** Removes the listener before delivering the unchanged source value. */
function settleResourceAbortValue<T>(context: IResourceAbortContext<T>, value: T): void {
  if (context.settled) return
  context.settled = true
  context.subscription?.unsubscribe()
  context.resolve(value)
}

/** Removes the listener before delivering the original source rejection object. */
function settleResourceAbortError<T>(context: IResourceAbortContext<T>, error: unknown): void {
  if (context.settled) return
  context.settled = true
  context.subscription?.unsubscribe()
  context.reject(error)
}

/** Contains cleanup diagnostics without replacing primary settlement or adding a rejected Promise. */
function reportResourceAbortCleanup<T>(context: IResourceAbortContext<T>, error: unknown): void {
  try {
    context.runtime.reportError(createCancellationFailure(error), {
      phase: ReactiveErrorPhase.asyncFlush
    })
  } catch {
    // Last-boundary diagnostics remain best effort, as before.
  }
}
