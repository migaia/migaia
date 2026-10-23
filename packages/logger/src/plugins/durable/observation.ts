import { createEventChannel, invokeEachLive } from '@migaia/event-subscriber'
import {
  captureLoggerPromiseLike,
  observeLoggerReporterResult,
  reportLoggerReporterFailure
} from '../../thenable.js'
import { getLoggerRuntimeManager } from '../../runtime-manager.js'
import { DurableText } from './text.js'
import type { ILogObservation, ILogStoreOptions } from './types.js'

/** Contains reporter failures on the existing logger terminal channel. */
export function durableReporter(report?: (error: unknown) => void): (error: unknown) => void {
  return (error) => {
    try {
      if (report) observeLoggerReporterResult(report(error))
      else {
        const runtime = getLoggerRuntimeManager()
        observeLoggerReporterResult(
          runtime.console
            ? runtime.console.error(DurableText.ioFailed, error)
            : runtime.write(DurableText.ioFailed)
        )
      }
    } catch (failure) {
      reportLoggerReporterFailure(failure)
    }
  }
}
/** Invokes an observer synchronously and only observes its asynchronous failure. */
export function observeResult(run: () => unknown, report: (error: unknown) => void): void {
  try {
    const pending = captureLoggerPromiseLike(run())
    if (pending) void pending.catch(report)
  } catch (error) {
    report(error)
  }
}
/**
 * Event-subscriber owns observer registration and dispatch; no second listener platform is
 * introduced.
 */
export function createObservation(options: ILogStoreOptions, report: (error: unknown) => void) {
  const channel = createEventChannel<ILogObservation, void>()
  if (options.observe) channel.subscribe((event) => options.observe!(event.value))
  return (make: () => ILogObservation): void => {
    if (channel.size === 0) return
    invokeEachLive(channel, Object.freeze(make()), (invocation) =>
      observeResult(() => invocation.invoke(), report)
    )
  }
}
