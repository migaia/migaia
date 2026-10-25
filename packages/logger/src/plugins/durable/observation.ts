import { createEventChannel, invokeEachLive } from '@migaia/event-subscriber'
import {
  captureLoggerPromiseLike,
  observeLoggerReporterResult,
  reportLoggerReporterFailure
} from '../../thenable.js'
import { getLoggerRuntimeManager } from '../../runtime-manager.js'
import { DurableText } from './text.js'
import { createLoggerTypeError, LoggerErrorCode, LOGGER_SOURCE } from '../../errors.js'
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
  const observer = options.observe
  if (observer) channel.subscribe((event) => observer(event.value))
  return (make: () => ILogObservation): void => {
    if (channel.size === 0) return
    invokeEachLive(channel, Object.freeze(make()), (invocation) =>
      observeResult(() => invocation.invoke(), report)
    )
  }
}

/** Captures only public callbacks before resource creation; invalid accessors retain their cause. */
export function captureStoreOptions(input: ILogStoreOptions | undefined): ILogStoreOptions {
  if (input === undefined) return {}
  try {
    if (!input || typeof input !== 'object')
      throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
    const observe = input.observe
    const report = input.report
    if (
      (observe !== undefined && typeof observe !== 'function') ||
      (report !== undefined && typeof report !== 'function')
    )
      throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
    return { observe, report }
  } catch (error) {
    if (
      error instanceof Error &&
      Object.getOwnPropertyDescriptor(error, 'source')?.value === LOGGER_SOURCE
    )
      throw error
    throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption, {
      cause: error
    })
  }
}
