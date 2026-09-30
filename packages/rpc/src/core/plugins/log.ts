import { hostRethrowReporter } from '@migaia/utils/promise'
import { defineFeature } from '../feature.js'
import type { IIpcLogInstallation, IIpcLogRecord, IIpcSendGate } from './flow-control.js'

/** Observational reporter does not change a gate admission or business Promise result. */
export function createIpcLogFeature(
  options: Readonly<{
    gate: IIpcSendGate
    report(record: IIpcLogRecord): void | Promise<void>
    onReportError(error: unknown, record: IIpcLogRecord): void | Promise<void>
  }>
): IIpcLogInstallation {
  /** Sends a diagnostic failure to the next reporter without creating an unhandled rejection. */
  const handleReportError = (error: unknown, record: IIpcLogRecord): void => {
    try {
      void Promise.resolve(options.onReportError(error, record)).catch((reporterError: unknown) =>
        hostRethrowReporter(reporterError, { operation: 'limiter', phase: 'reporter' })
      )
    } catch (reporterError) {
      hostRethrowReporter(reporterError, { operation: 'limiter', phase: 'reporter' })
    }
  }
  /** Captures both synchronous throws and asynchronous rejections from the injected sink. */
  const publish = (record: IIpcLogRecord): void => {
    try {
      void Promise.resolve(options.report(record)).catch((error: unknown) =>
        handleReportError(error, record)
      )
    } catch (error) {
      handleReportError(error, record)
    }
  }
  const feature = defineFeature(() => {
    options.gate.onEvent(publish)
    return Object.freeze({})
  })
  return Object.freeze({ feature, recordStderr: publish })
}
