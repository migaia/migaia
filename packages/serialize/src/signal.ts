import {
  createSerializeError,
  createSerializeTypeError,
  SerializeErrorCode,
  SerializeErrorText,
  SERIALIZE_SOURCE
} from './errors.js'
import type { ISerializeAbortSignal } from './types.js'

/** Captured signal method used without rereading a hostile accessor. */
type IInvokable<TResult> = (...args: never[]) => TResult

/** Minimal serialize-owned controller used only for composed operation signals. */
type ISerializeAbortController = {
  readonly signal: ISerializeAbortSignal
  abort(reason?: unknown): void
}

/**
 * Create a runtime-neutral abort controller for core signal composition.
 *
 * This owns only one-shot signal notification; registry lifecycle, scope, scheduler, and cleanup
 * remain in their existing owners. Listener failures remain reachable as a serialize error.
 */
const createSerializeAbortController = (): ISerializeAbortController => {
  let aborted = false
  /** First abort reason, retained for stable first-observed-wins semantics. */
  let reason: unknown
  /** Active listeners waiting for the one abort notification. */
  const listeners = new Set<() => void>()
  /** Structural signal facade exposed to composed operations. */
  const signal: ISerializeAbortSignal = {
    get aborted() {
      return aborted
    },
    get reason() {
      return reason
    },
    addEventListener(_type, listener) {
      if (!aborted) listeners.add(listener)
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener)
    }
  }

  return {
    signal,
    abort(value) {
      if (aborted) return
      aborted = true
      reason = value
      const pending = [...listeners]
      listeners.clear()
      const failures: unknown[] = []
      for (const listener of pending) {
        try {
          listener()
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length === 0) return
      const primary =
        failures.length === 1
          ? failures[0]
          : new AggregateError(failures, SerializeErrorText.signalDispatchFailed)
      throw createSerializeError(
        SerializeErrorCode.invalidOption,
        SerializeErrorText.signalDispatchFailed,
        { cause: primary }
      )
    }
  }
}

/** Invoke captured signal method with original signal as receiver. */
const invokeWithReceiver = <TResult>(
  method: IInvokable<TResult>,
  receiver: object,
  args: readonly unknown[]
): TResult => Reflect.apply(method, receiver, args)

/** Keep tagged serialize failures intact while wrapping hostile signal accessors. */
const isSerializeTaggedError = (error: unknown): error is Error & { readonly source: string } => {
  try {
    return (
      error instanceof Error && (error as { readonly source?: unknown }).source === SERIALIZE_SOURCE
    )
  } catch {
    return false
  }
}

/** Read dynamic `aborted` state and convert accessor/shape failures to package-owned errors. */
const readAborted = (signal: ISerializeAbortSignal): boolean => {
  try {
    const value = signal.aborted
    if (typeof value !== 'boolean') throw new TypeError(SerializeErrorText.signalInvalid)
    return value
  } catch (error) {
    if (isSerializeTaggedError(error)) throw error
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.signalAccessorFailed,
      { cause: error }
    )
  }
}

/** Read abort reason once at the point it wins arbitration. */
const readReason = (signal: ISerializeAbortSignal): unknown => {
  try {
    return signal.reason
  } catch (error) {
    if (isSerializeTaggedError(error)) throw error
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.signalReasonReadFailed,
      { cause: error }
    )
  }
}

/** Capture signal shape and establish a serialize-owned state snapshot before admission. */
export const snapshotSerializeSignal = (value: unknown): ISerializeAbortSignal => {
  try {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      throw new TypeError(SerializeErrorText.signalInvalid)
    }
    const source = value as ISerializeAbortSignal
    const initialAborted = readAborted(source)
    const addEventListener = source.addEventListener
    const removeEventListener = source.removeEventListener
    if (typeof addEventListener !== 'function' || typeof removeEventListener !== 'function') {
      throw new TypeError(SerializeErrorText.signalInvalid)
    }
    const initialReason = initialAborted ? readReason(source) : undefined
    /** Snapshot state that prevents pre-aborted operations from rereading hostile raw getters. */
    let observedAborted = initialAborted
    /** First reason observed by this snapshot, retained by identity. */
    let observedReason = initialReason
    const captureCurrentState = (): boolean => {
      if (observedAborted) return true
      const currentAborted = readAborted(source)
      if (!currentAborted) return false
      observedAborted = true
      observedReason = readReason(source)
      return true
    }
    return {
      get aborted() {
        return captureCurrentState()
      },
      get reason() {
        return observedAborted ? observedReason : readReason(source)
      },
      addEventListener(type, listener, options) {
        invokeWithReceiver(addEventListener as IInvokable<void>, source as object, [
          type,
          listener,
          options
        ])
      },
      removeEventListener(type, listener) {
        invokeWithReceiver(removeEventListener as IInvokable<void>, source as object, [
          type,
          listener
        ])
      }
    }
  } catch (error) {
    if (isSerializeTaggedError(error)) throw error
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.signalAccessorFailed,
      { cause: error }
    )
  }
}

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
  if (caller === undefined) return { signal: closingSnapshot, dispose: () => {} }
  const callerSnapshot = snapshotSerializeSignal(caller)
  if (readAborted(callerSnapshot)) {
    readReason(callerSnapshot)
    return { signal: callerSnapshot, dispose: () => {} }
  }

  /** Internal controller that preserves the first observed abort reason. */
  const composed = createSerializeAbortController()
  /** Caller listener registration state. */
  const callerRegistration: IListenerRegistration = {
    signal: callerSnapshot,
    listener: () => observeAbort(callerSnapshot),
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
    register(callerRegistration)
    if (recheck(callerSnapshot) || recheck(closingSnapshot)) {
      return { signal: composed.signal, dispose }
    }

    register(closingRegistration)
    recheck(callerSnapshot)
    recheck(closingSnapshot)
    return { signal: composed.signal, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}
