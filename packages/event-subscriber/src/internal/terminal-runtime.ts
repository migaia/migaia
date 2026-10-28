/**
 * Owns host diagnostic adaptation and the terminal failure ladder; it does not schedule event
 * dispatch.
 */
import { EventSubscriberErrorCode } from '../error-code.ts'
import { createEventAggregateError, eventErrorText } from '../errors.ts'

/** Internal host terminal sinks; this type never crosses the package public boundary. */
export type IEventTerminalRuntime = {
  /** Sends the error to the host's `reportError`; returns false when the host has none. */
  reportError(error: unknown): boolean
  /** Logs the error with `console.error`; returns false when the host has no console error. */
  consoleError(error: unknown): boolean
  /** Rethrows the error from a microtask, so the host's uncaught-error handling sees it. */
  enqueueThrow(error: unknown): void
}

/** Host diagnostics read by the terminal fallback; injectable for isolated failure tests. */
export type IEventTerminalHost = {
  /** Host `reportError`, as in browsers and recent Node versions. */
  readonly reportError?: (value: unknown) => void
  /** Host console; only `error` is used. */
  readonly console?: { readonly error?: (value: unknown) => void }
  /** Host `queueMicrotask`, used to rethrow as a last resort. */
  readonly queueMicrotask?: (callback: () => void) => void
}

/** Feature-detects host diagnostics lazily without importing DOM, Node, or lifecycle types. */
export const createSystemTerminalRuntime = (
  host: IEventTerminalHost = globalThis as IEventTerminalHost
): IEventTerminalRuntime => new SystemTerminalRuntime(host)

/** Owns one host adapter while preserving native host method receivers and lazy getter reads. */
class SystemTerminalRuntime implements IEventTerminalRuntime {
  /** Original host object is retained for native receiver-sensitive diagnostics. */
  readonly #host: IEventTerminalHost

  /** Retains the host without reading any of its diagnostic members eagerly. */
  constructor(host: IEventTerminalHost) {
    this.#host = host
  }

  /** Calls the host reportError only when the member exists; failures remain observable upstream. */
  reportError(error: unknown): boolean {
    if (!('reportError' in this.#host)) return false
    this.#host.reportError!(error)
    return true
  }

  /** Calls the original console object's error method when that member exists. */
  consoleError(error: unknown): boolean {
    /** Read once to preserve getter effects and the original console receiver. */
    const consoleObject = this.#host.console
    if (consoleObject === undefined) return false
    if (!('error' in consoleObject)) return false
    consoleObject.error!(error)
    return true
  }

  /** Queues an uncaught throw, retaining both errors if host feature detection or queueing fails. */
  enqueueThrow(error: unknown): void {
    /** Presence is checked separately because a hostile host may throw from its has trap. */
    let hasQueueMicrotask = false
    try {
      hasQueueMicrotask = 'queueMicrotask' in this.#host
    } catch (failure) {
      throw createEventAggregateError(
        EventSubscriberErrorCode.unhandledListenerFailure,
        [error, failure],
        eventErrorText(EventSubscriberErrorCode.unhandledListenerFailure)
      )
    }
    if (hasQueueMicrotask) {
      /** Optional call argument evaluation distinguishes missing callbacks from successful queueing. */
      const callbackState = { evaluated: false }
      try {
        this.#host.queueMicrotask?.(createThrowCallback(error, callbackState))
      } catch (failure) {
        throw createEventAggregateError(
          EventSubscriberErrorCode.unhandledListenerFailure,
          [error, failure],
          eventErrorText(EventSubscriberErrorCode.unhandledListenerFailure)
        )
      }
      if (!callbackState.evaluated) throw error
      return
    }
    throw error
  }
}

/** Builds the final microtask only when optional-call argument evaluation actually occurs. */
function createThrowCallback(error: unknown, state: { evaluated: boolean }): () => never {
  state.evaluated = true
  return () => {
    throw error
  }
}

/** Runs the single terminal-report ladder while preserving every failure in occurrence order. */
export const reportTerminalDiagnostic = (
  code: (typeof EventSubscriberErrorCode)[keyof typeof EventSubscriberErrorCode],
  errors: readonly unknown[],
  terminalReport: ((error: AggregateError) => void | PromiseLike<void>) | undefined,
  runtime: IEventTerminalRuntime
): void => {
  /** Terminal sink observes this aggregate before any host fallback starts. */
  const diagnostic = createEventAggregateError(code, errors, eventErrorText(code))
  if (!terminalReport) {
    reportSystemDiagnostic(code, errors, runtime)
    return
  }
  try {
    Promise.resolve(terminalReport(diagnostic)).then(
      () => undefined,
      (error) => reportSystemDiagnostic(code, [...errors, error], runtime)
    )
  } catch (error) {
    reportSystemDiagnostic(code, [...errors, error], runtime)
  }
}

/** Attempts host sinks in order, retaining each failed sink before proceeding to the next. */
function reportSystemDiagnostic(
  code: (typeof EventSubscriberErrorCode)[keyof typeof EventSubscriberErrorCode],
  errors: readonly unknown[],
  runtime: IEventTerminalRuntime
): void {
  /** Each failed host appends once; the maximum two host failures are bounded by the sink ladder. */
  const accumulated = [...errors]
  try {
    if (runtime.reportError(createEventAggregateError(code, accumulated, eventErrorText(code))))
      return
  } catch (error) {
    accumulated.push(error)
  }
  try {
    if (runtime.consoleError(createEventAggregateError(code, accumulated, eventErrorText(code))))
      return
  } catch (error) {
    accumulated.push(error)
  }
  runtime.enqueueThrow(createEventAggregateError(code, accumulated, eventErrorText(code)))
}
