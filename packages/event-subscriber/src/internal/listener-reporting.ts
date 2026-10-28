/**
 * Owns late-listener failure reporting and terminal fallback; does not participate in result
 * settlement.
 */
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { EventSubscriberErrorCode } from '../error-code.ts'
import { createEventAggregateError, eventErrorText } from '../errors.ts'
import type { IEventChannelOptions, IEventContext, IEventDispatchSnapshot } from '../types.ts'
import type { IEventApiStyle } from '../style.ts'
import { createSystemTerminalRuntime, reportTerminalDiagnostic } from './terminal-runtime.ts'
import { createEventContext } from './dispatch-context.ts'

/** The host adapter remains lazy until the terminal path needs a sink. */
const systemTerminalRuntime = createSystemTerminalRuntime()

/** Reports a late listener rejection without making synchronous publish awaitable. */
export const reportLateFailure = <
  T,
  S extends IEventApiStyle | undefined = undefined,
  V = undefined
>(
  options: IEventChannelOptions<T, S, V>,
  event: IEventContext<T>,
  failure: unknown
): void => {
  /** Aggregate error that carries the late listener failure as its first entry. */
  const diagnostic = createEventAggregateError(
    EventSubscriberErrorCode.unhandledListenerFailure,
    [failure],
    eventErrorText(EventSubscriberErrorCode.unhandledListenerFailure)
  )
  /** Caller's reporter, if configured; otherwise the terminal path receives the failure. */
  const report = options.report
  if (report) {
    /** Reporter result; a rejection is forwarded to the terminal path. */
    let reportResult: void | PromiseLike<void>
    try {
      reportResult = report({ event: event as never, error: failure })
    } catch (error) {
      reportTerminal(options, diagnostic, error)
      return
    }
    observeRejection(reportResult, (error) => reportTerminal(options, diagnostic, error))
    return
  }
  reportTerminal(options, diagnostic, undefined)
}

/**
 * Observes a listener or reporter result for rejection. The `then` property is read once: a
 * thenable is assimilated with its original receiver, a throwing `then` getter is reported one
 * microtask later as an asynchronous rejection, and any other value schedules no work.
 */
export const observeRejection = (value: unknown, onRejected: (error: unknown) => void): void => {
  /** Result of reading `then` exactly once, so a throwing getter is observed instead of escaping. */
  const inspection = inspectThenable(value)
  if ('error' in inspection) void Promise.reject(inspection.error).then(undefined, onRejected)
  else observeThenableRejection(value, inspection, onRejected)
}

/** Final fallback chain. Runtime access is isolated here so core channel code has no host branch. */
const reportTerminal = <T, S extends IEventApiStyle | undefined = undefined, V = undefined>(
  options: IEventChannelOptions<T, S, V>,
  diagnostic: AggregateError,
  failure: unknown
): void => {
  /**
   * Errors passed to the terminal reporter: the diagnostic entries plus the reporter's own failure,
   * if any.
   */
  const errors = failure === undefined ? diagnostic.errors : [...diagnostic.errors, failure]
  reportTerminalDiagnostic(
    EventSubscriberErrorCode.unhandledListenerFailure,
    errors,
    options.terminalReport,
    systemTerminalRuntime
  )
}

/** Only the dispatch data needed if this listener eventually rejects; no channel owner is retained. */
type ILateListenerContext<T, R, V> = {
  readonly options: IEventChannelOptions<T, undefined, V>
  readonly value: T
  readonly snapshot: IEventDispatchSnapshot<T, R, V>
  readonly projection: Parameters<typeof createEventContext<T, R, V>>[2]
}

/** Observes one listener result without retaining channel membership or the pending publish queue. */
export const observeDispatchRejection = <T, R, V>(
  result: unknown,
  context: ILateListenerContext<T, R, V>
): void => {
  observeRejection(result, (error) =>
    reportLateFailure<T, undefined, V>(
      context.options,
      createEventContext(context.value, context.snapshot, context.projection),
      error
    )
  )
}
