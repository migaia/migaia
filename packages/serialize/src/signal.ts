import {
  createSerializeError,
  createSerializeTypeError,
  SerializeErrorCode,
  SerializeErrorText
} from './errors.js'
import { createAbortController } from '@migaia/lifecycle/abort'
import type { ISerializeAbortSignal } from './types.js'
import {
  isSerializeTaggedError,
  readAborted,
  readReason,
  snapshotSerializeSignal
} from './signal-snapshot.js'

/** Internal registration record used to make signal-listener rollback idempotent. */
type IListenerRegistration = {
  readonly signal: ISerializeAbortSignal
  readonly listener: () => void
  attempted: boolean
  removed: boolean
}

/**
 * Compose caller and registry-closing signals with first-observed-wins arbitration.
 *
 * Every registration is followed by an `aborted` recheck because structural signals may abort
 * during `addEventListener` without replaying the already-fired event. Registration rollback and
 * settle cleanup remove each attempted listener at most once; cleanup failures are reported as
 * secondary errors so they cannot replace an abort or registration failure.
 */
export function composeSerializeSignal(
  caller: ISerializeAbortSignal | undefined,
  closing: ISerializeAbortSignal,
  report: (error: unknown) => void
): { readonly signal: ISerializeAbortSignal; readonly dispose: () => void } {
  const closingSnapshot = snapshotSerializeSignal(closing)
  if (readAborted(closingSnapshot)) return { signal: closingSnapshot, dispose: () => {} }
  const callerSnapshot = caller === undefined ? undefined : snapshotSerializeSignal(caller)
  if (callerSnapshot !== undefined && readAborted(callerSnapshot)) {
    readReason(callerSnapshot)
    return { signal: callerSnapshot, dispose: () => {} }
  }

  /** Internal controller that preserves the first observed abort reason. */
  const composed = createAbortController()
  /** Caller listener registration state. */
  const callerRegistration: IListenerRegistration = {
    signal: callerSnapshot!,
    listener: () => observeAbort(callerSnapshot!),
    attempted: false,
    removed: false
  }
  /** Closing listener registration state. */
  const closingRegistration: IListenerRegistration = {
    signal: closingSnapshot,
    listener: () => observeAbort(closingSnapshot),
    attempted: false,
    removed: false
  }
  /** All registrations, kept in install order so cleanup can run strict LIFO. */
  const registrations = [callerRegistration, closingRegistration]
  /** Number of active addEventListener calls; cleanup defers while reentrant registration runs. */
  let registrationDepth = 0
  /** Whether cleanup was requested while a registration was in progress. */
  let cleanupRequested = false
  /** Whether this composed signal has entered terminal cleanup. */
  let disposed = false

  /** Report a listener-removal failure without allowing it to replace the primary error. */
  const reportCleanupFailure = (error: unknown): void => {
    try {
      report(error)
    } catch {
      // Secondary reporter failure must not escape signal cleanup.
    }
  }

  /** Captured parser listeners whose failures must remain observable as secondary errors. */
  const exposedListeners = new Map<() => void, () => void>()

  /** Expose the composed signal while retaining primary abort state and reporting listener errors. */
  const exposedSignal: ISerializeAbortSignal = {
    get aborted() {
      return composed.signal.aborted
    },
    get reason() {
      return composed.signal.reason
    },
    addEventListener(type, listener, options) {
      if (exposedListeners.has(listener)) return
      const wrapped = (): void => {
        try {
          listener()
        } catch (error) {
          reportCleanupFailure(error)
        }
      }
      exposedListeners.set(listener, wrapped)
      try {
        composed.signal.addEventListener(type, wrapped, options)
      } catch (error) {
        exposedListeners.delete(listener)
        throw error
      }
    },
    removeEventListener(type, listener) {
      const wrapped = exposedListeners.get(listener)
      if (wrapped === undefined) return
      exposedListeners.delete(listener)
      composed.signal.removeEventListener(type, wrapped)
    }
  }

  /** Remove each attempted listener once, continuing after individual removal failures. */
  const cleanupListeners = (): void => {
    if (registrationDepth > 0) return
    for (const registration of [...registrations].reverse()) {
      if (!registration.attempted || registration.removed) continue
      registration.removed = true
      try {
        registration.signal.removeEventListener('abort', registration.listener)
      } catch (error) {
        reportCleanupFailure(error)
      }
    }
  }

  /** Request idempotent cleanup, deferring actual removal across reentrant registration. */
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    cleanupRequested = true
    exposedListeners.clear()
    cleanupListeners()
  }

  /** Abort composed signal once, then release source listeners. */
  function abortComposed(reason: unknown): void {
    if (disposed) return
    if (!composed.signal.aborted) {
      try {
        composed.abort(reason)
      } finally {
        dispose()
      }
      return
    }
    dispose()
  }

  /** Convert asynchronous source abort failures into a composed package-owned failure. */
  const observeAbort = (source: ISerializeAbortSignal): void => {
    try {
      abortComposed(readReason(source))
    } catch (error) {
      try {
        abortComposed(
          isSerializeTaggedError(error)
            ? error
            : createSerializeTypeError(
                SerializeErrorCode.invalidOption,
                SerializeErrorText.signalAccessorFailed,
                { cause: error }
              )
        )
      } catch (abortError) {
        reportCleanupFailure(abortError)
      }
    }
  }

  /** Install one source listener and tag any registration failure with its original cause. */
  const register = (registration: IListenerRegistration): void => {
    registration.attempted = true
    registrationDepth++
    try {
      registration.signal.addEventListener('abort', registration.listener, { once: true })
    } catch (error) {
      dispose()
      throw createSerializeError(
        SerializeErrorCode.invalidOption,
        SerializeErrorText.signalRegistrationFailed,
        { cause: error }
      )
    } finally {
      registrationDepth--
      if (registrationDepth === 0 && cleanupRequested) cleanupListeners()
    }
  }

  /** Recheck one source after listener registration and feed its current reason if aborted. */
  const recheck = (source: ISerializeAbortSignal): boolean => {
    if (!readAborted(source)) return false
    abortComposed(readReason(source))
    return true
  }

  try {
    if (callerSnapshot !== undefined) register(callerRegistration)
    if ((callerSnapshot !== undefined && recheck(callerSnapshot)) || recheck(closingSnapshot)) {
      return { signal: exposedSignal, dispose }
    }

    register(closingRegistration)
    if (callerSnapshot !== undefined) recheck(callerSnapshot)
    recheck(closingSnapshot)
    return { signal: exposedSignal, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}

/** Create one operation owner through the existing lifecycle controller and signal composition path. */
export function createSerializeOperationSignal(
  caller: ISerializeAbortSignal | undefined,
  report: (error: unknown) => void
): {
  readonly signal: ISerializeAbortSignal
  readonly abort: (reason?: unknown) => void
  readonly dispose: () => void
} {
  const owner = createAbortController()
  const composed = composeSerializeSignal(caller, owner.signal, report)
  return {
    signal: composed.signal,
    abort(reason?: unknown) {
      try {
        owner.abort(reason)
      } catch (error) {
        try {
          report(error)
        } catch {
          // Secondary reporting failure cannot replace the operation's primary cancellation.
        }
      }
    },
    dispose: composed.dispose
  }
}
