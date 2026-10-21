import { EventSubscriberErrorCode } from '../error-code.js'
import { createEventAggregateError, eventErrorText } from '../errors.js'

/** Internal host terminal sinks; this type never crosses the package public boundary. */
export type IEventTerminalRuntime = {
  reportError(error: unknown): boolean
  consoleError(error: unknown): boolean
  enqueueThrow(error: unknown): void
}

/** Host diagnostics read by the terminal fallback; injectable for isolated failure tests. */
export type IEventTerminalHost = {
  readonly reportError?: (value: unknown) => void
  readonly console?: { readonly error?: (value: unknown) => void }
  readonly queueMicrotask?: (callback: () => void) => void
}

/** Feature-detects host diagnostics lazily without importing DOM, Node, or lifecycle types. */
export const createSystemTerminalRuntime = (
  host: IEventTerminalHost = globalThis as IEventTerminalHost
): IEventTerminalRuntime => ({
  reportError(error: unknown): boolean {
    if (!('reportError' in host)) return false
    host.reportError!(error)
    return true
  },
  consoleError(error: unknown): boolean {
    /** Host console, read once. */
    const consoleObject = host.console
    if (consoleObject === undefined) return false
    if (!('error' in consoleObject)) return false
    consoleObject.error!(error)
    return true
  },
  enqueueThrow(error: unknown): void {
    /** Whether the host offers `queueMicrotask`. */
    let hasQueueMicrotask = false
    try {
      hasQueueMicrotask = 'queueMicrotask' in host
    } catch (failure) {
      throw createEventAggregateError(
        EventSubscriberErrorCode.unhandledListenerFailure,
        [error, failure],
        eventErrorText(EventSubscriberErrorCode.unhandledListenerFailure)
      )
    }
    if (hasQueueMicrotask) {
      /** Set when the host had a callable `queueMicrotask` and the callback was built. */
      let callbackArgumentEvaluated = false
      try {
        // Optional method call reads the getter once, evaluates its argument only when
        // a callable target exists, and preserves the original host as the receiver.
        host.queueMicrotask?.(
          (() => {
            callbackArgumentEvaluated = true
            return () => {
              throw error
            }
          })()
        )
      } catch (failure) {
        throw createEventAggregateError(
          EventSubscriberErrorCode.unhandledListenerFailure,
          [error, failure],
          eventErrorText(EventSubscriberErrorCode.unhandledListenerFailure)
        )
      }
      if (!callbackArgumentEvaluated) throw error
      return
    }
    throw error
  }
})

/** Runs the single terminal-report ladder while preserving every failure in occurrence order. */
export const reportTerminalDiagnostic = (
  code: (typeof EventSubscriberErrorCode)[keyof typeof EventSubscriberErrorCode],
  errors: readonly unknown[],
  terminalReport: ((error: AggregateError) => void | PromiseLike<void>) | undefined,
  runtime: IEventTerminalRuntime
): void => {
  /**
   * Sends errors to the host: `reportError` first, then `console.error`, and finally a thrown error
   * on a microtask.
   */
  const reportSystem = (currentErrors: readonly unknown[]): void => {
    /** Errors to report, including later reporter failures. */
    const accumulated = [...currentErrors]
    /** Builds the aggregate error from the current list. */
    const diagnostic = (): AggregateError =>
      createEventAggregateError(code, accumulated, eventErrorText(code))
    try {
      if (runtime.reportError(diagnostic())) return
    } catch (error) {
      accumulated.push(error)
    }
    try {
      if (runtime.consoleError(diagnostic())) return
    } catch (error) {
      accumulated.push(error)
    }
    runtime.enqueueThrow(diagnostic())
  }
  /** Aggregate error handed to `terminalReport`. */
  const diagnostic = createEventAggregateError(code, errors, eventErrorText(code))
  if (!terminalReport) {
    reportSystem(errors)
    return
  }
  try {
    Promise.resolve(terminalReport(diagnostic)).then(
      () => undefined,
      (error) => reportSystem([...errors, error])
    )
  } catch (error) {
    reportSystem([...errors, error])
  }
}
