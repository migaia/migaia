import { hostRethrowReporter } from '@migaia/utils/promise'
import type { IIpcLogInstallation } from '../core/plugins/flow-control.js'
import { IpcLogEventName } from '../core/plugins/flow-control.js'
import { IpcReporterContext } from '../core/plugins/reporter-context.js'
import { CHILD_STDERR_REDACTED } from './constants.js'
import type { IProcessCommonOptions } from './types.js'

/** Attach only to the binding's existing stderr reader; diagnostics never retain raw chunks. */
export function attachIpcStderr(
  install: IIpcLogInstallation,
  ipc: IProcessCommonOptions['ipc'],
  report: (error: unknown) => void
): () => void {
  if (!ipc.stderr) return () => undefined
  /** Ignore callbacks racing after unsubscribe, including callbacks retained by a bad source. */
  let closed = false
  /** The binding owns reading; this listener only projects a fixed redacted record. */
  const unsubscribe = ipc.stderr((_chunk) => {
    if (closed) return
    try {
      install.recordStderr({
        name: IpcLogEventName['ipc.stderr'],
        connectionId: ipc.connectionId,
        sessionId: ipc.sessionId,
        ...(ipc.processId === undefined ? {} : { processId: ipc.processId }),
        text: CHILD_STDERR_REDACTED
      })
    } catch (error) {
      try {
        report(error)
      } catch (reporterError) {
        hostRethrowReporter(reporterError, IpcReporterContext)
      }
    }
  })
  /** One teardown point guarantees the source is unsubscribed at most once. */
  return () => {
    if (closed) return
    closed = true
    unsubscribe()
  }
}
