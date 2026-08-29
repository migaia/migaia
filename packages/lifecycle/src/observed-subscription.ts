import type { IAbortSignal } from './abort.js'
import { LifecycleErrorCode } from './error-code.js'
import { LifecycleErrorText } from './error-text.js'
import { createLifecycleTypeError } from './errors.js'

/** Idempotent handle for one lifecycle-owned abort registration. */
export type IObservedAbortSubscription = {
  unsubscribe(): void
  /** Re-attempts cleanup after a host stores a listener after invoking it during registration. */
  retryRegistrationCleanup(): void
  readonly failures: readonly unknown[]
}

/** Operation-owned sink for callback, reason-read, and cleanup failures. */
export type IObservedAbortFailureSink = (error: unknown) => void

/**
 * Registers one lifecycle-owned abort callback with a hostile-signal-safe receiver snapshot.
 * Registration races are closed by a post-add state recheck; callback and cleanup failures are
 * delivered to the owning operation and never rethrown through native EventTarget dispatch.
 */
export function observeAbortSubscription(
  signal: IAbortSignal,
  callback: (reason: unknown) => void,
  onFailure: IObservedAbortFailureSink
): IObservedAbortSubscription {
  let addEventListener: unknown
  let removeEventListener: unknown
  try {
    addEventListener = signal.addEventListener
    removeEventListener = signal.removeEventListener
  } catch (error) {
    throw createLifecycleTypeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.abortSignalInvalid,
      {
        cause: error
      }
    )
  }
  if (typeof addEventListener !== 'function' || typeof removeEventListener !== 'function') {
    throw createLifecycleTypeError(
      LifecycleErrorCode.invalidOption,
      LifecycleErrorText.abortSignalInvalid
    )
  }
  let removed = false
  let attempted = false
  let delivered = false
  let registrationInProgress = false
  let callbackDuringRegistration = false
  const failures: unknown[] = []
  const removeCaptured = (force = false): void => {
    if (!attempted || (removed && !force)) return
    removed = true
    try {
      Reflect['apply'](
        removeEventListener as (type: string, listener: () => void) => void,
        signal,
        ['abort', listener]
      )
    } catch (error) {
      failures.push(error)
      try {
        onFailure(error)
      } catch {
        // The operation's final diagnostic boundary owns sink failure.
      }
    }
  }
  const unsubscribe = (): void => {
    if (removed || !attempted) return
    removeCaptured(true)
  }
  const listener = (): void => {
    if (delivered) return
    delivered = true
    if (registrationInProgress) callbackDuringRegistration = true
    try {
      let reason: unknown
      try {
        reason = signal.reason
      } catch (error) {
        try {
          onFailure(error)
        } catch {
          // Native dispatch must not receive an operation callback failure.
        }
        reason = error
      }
      callback(reason)
    } catch (error) {
      try {
        onFailure(error)
      } catch {
        // Native dispatch must not receive an operation callback failure.
      }
    } finally {
      unsubscribe()
    }
  }
  attempted = true
  registrationInProgress = true
  try {
    Reflect['apply'](
      addEventListener as (type: string, listener: () => void, options?: unknown) => void,
      signal,
      ['abort', listener, { once: true }]
    )
  } catch (error) {
    unsubscribe()
    if (
      failures.length > 0 &&
      error !== null &&
      (typeof error === 'object' || typeof error === 'function')
    ) {
      try {
        Object.defineProperty(error, 'errors', {
          value: Object.freeze([...failures]),
          enumerable: true,
          configurable: true
        })
      } catch {
        // Preserve the registration primary when its error object is not extensible.
      }
    }
    throw error
  } finally {
    registrationInProgress = false
  }
  const retryRegistrationCleanup = (): void => {
    if (callbackDuringRegistration || failures.length > 0) removeCaptured(true)
  }
  let aborted = false
  try {
    aborted = signal.aborted
  } catch (error) {
    unsubscribe()
    throw error
  }
  if (aborted) listener()
  return { unsubscribe, retryRegistrationCleanup, failures }
}
