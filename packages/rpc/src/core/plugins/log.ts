import { hostRethrowReporter } from '@migaia/utils/promise'
import { defineFeature } from '../feature.js'
import type { IRpcFeatureExpose } from '../internal/feature-contract.js'
import type { IIpcLogInstallation, IIpcLogRecord, IIpcSendGate } from './flow-control.js'
import { IpcReporterContext } from './reporter-context.js'

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
        hostRethrowReporter(reporterError, IpcReporterContext)
      )
    } catch (reporterError) {
      hostRethrowReporter(reporterError, IpcReporterContext)
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
  const feature = defineFeature<Record<never, never>, Record<never, never>, IRpcFeatureExpose>(
    (core) => {
      const unsubscribe = options.gate.onEvent(publish)
      core.featureExpose.getKernel().resources.addSync('IPC log', unsubscribe)
      return Object.freeze({})
    }
  )
  return Object.freeze({ feature, recordStderr: publish })
}
