import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { deferred, hostRethrowReporter } from '@migaia/utils/promise'
import type { IRpcFeature } from '../core/index.js'
import { IpcReporterContext } from '../core/plugins/reporter-context.js'
import { createIpcLogFeature } from '../core/plugins/log.js'
import {
  createIpcSendQueueFeature,
  createIpcSendQueueTransport
} from '../core/plugins/send-queue.js'
import type { IRpcTransport } from '../core/index.js'
import type { IIpcGatedTransport } from '../core/plugins/flow-control.js'
import { attachIpcStderr } from './stderr.js'
import type { IProcessCommonOptions } from './types.js'

/** One owner composes the physical transport, whole-envelope gate, and redacted diagnostics. */
export function attachIpcConnection(
  transport: IRpcTransport,
  ipc: IProcessCommonOptions['ipc'],
  report: (error: unknown) => void,
  scheduler: IScheduler = systemScheduler
): Readonly<{
  transport: IRpcTransport
  features: readonly IRpcFeature[]
  close(): Promise<void>
}> {
  /** Gate exists before any wrapper or feature is made visible. */
  const queue = createIpcSendQueueFeature({
    connectionId: ipc.connectionId,
    sessionId: ipc.sessionId,
    maxPendingData: ipc.maxPendingData,
    maxPendingControl: ipc.maxPendingControl
  })
  /** Teardown runs before the gated transport closes the physical channel. */
  let unsubscribeStderr: (() => void) | undefined
  /** Repeated close calls share one settlement result. */
  let closing: Promise<void> | undefined
  /** If setup fails after wrapping, the wrapper still owns physical close. */
  let gated: IIpcGatedTransport | undefined
  try {
    gated = createIpcSendQueueTransport(transport, queue.gate)
    /** The return object closes the same gate-bearing wrapper selected above. */
    const installedTransport = gated
    const log = createIpcLogFeature({
      gate: queue.gate,
      report: ipc.log,
      onReportError: (error) => {
        try {
          report(error)
        } catch (reporterError) {
          hostRethrowReporter(reporterError, IpcReporterContext)
        }
      }
    })
    unsubscribeStderr = attachIpcStderr(log, ipc, report, scheduler)
    return Object.freeze({
      transport: gated,
      features: Object.freeze([queue.feature, log.feature]),
      close() {
        if (closing) return closing
        /** Publish the existing close owner before a final-summary reporter can reenter it. */
        const done = deferred<void>()
        closing = done.promise
        void (async () => {
          try {
            /** Child stderr subscription is released before the log and gate close. */
            unsubscribeStderr?.()
            await installedTransport.close?.()
            done.resolve()
          } catch (error) {
            done.reject(error)
          }
        })()
        return closing
      }
    })
  } catch (error) {
    queue.gate.close(error)
    try {
      unsubscribeStderr?.()
    } catch (cleanupError) {
      report(cleanupError)
    }
    try {
      /** The wrapper already closes the physical transport even when it returns void. */
      const cleanup = gated ? gated.close?.() : transport.close?.()
      void Promise.resolve(cleanup).catch(report)
    } catch (cleanupError) {
      report(cleanupError)
    }
    throw error
  }
}
