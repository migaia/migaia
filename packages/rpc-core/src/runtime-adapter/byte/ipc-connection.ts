import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { deferred, hostRethrowReporter } from '@migaia/utils/promise'
import type { IRpcFeature } from '../../core/index.js'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import { createIpcLogFeature } from '../../core/plugins/log.js'
import {
  createIpcSendQueueFeature,
  createIpcSendQueueTransport
} from '../../core/plugins/send-queue.js'
import type { IRpcTransport } from '../../core/transport.js'
import type { IIpcGatedTransport, IIpcLogInstallation } from '../../core/plugins/flow-control.js'
import type { IRuntimeConnectionOptions } from './types.js'

/** A connection owns actual diagnostic resources before its physical transport teardown. */
export type IRuntimeCloseResource = Readonly<{ close(): void | Promise<void> }>

/** Compose one physical carrier with the canonical envelope gate and diagnostic installation. */
export function attachIpcConnection(
  transport: IRpcTransport,
  ipc: IRuntimeConnectionOptions['ipc'],
  report: (error: unknown) => void,
  _scheduler: IScheduler = systemScheduler
): Readonly<{
  transport: IRpcTransport
  features: readonly IRpcFeature[]
  log: IIpcLogInstallation
  ownClose(resource: IRuntimeCloseResource): void
  close(): Promise<void>
}> {
  /** Gate exists before any wrapper or feature is visible. */
  const queue = createIpcSendQueueFeature({
    connectionId: ipc.connectionId,
    sessionId: ipc.sessionId,
    maxPendingData: ipc.maxPendingData,
    maxPendingControl: ipc.maxPendingControl
  })
  /** These held resources contain cleanup operations, never private proof callbacks. */
  const resources = new Set<IRuntimeCloseResource>()
  /** New resources attached after explicit close release immediately. */
  let resourcesClosed = false
  /** Reentrant closes share one settlement, published before diagnostic teardown. */
  let closing: Promise<void> | undefined
  /** Construction rollback closes the same wrapper once one has been installed. */
  let gated: IIpcGatedTransport | undefined
  /** Reporter failures remain observable without replacing the original cleanup failure. */
  const reportSafely = (error: unknown): void => {
    try {
      report(error)
    } catch (reporterError) {
      hostRethrowReporter(reporterError, IpcReporterContext)
    }
  }
  try {
    gated = createIpcSendQueueTransport(transport, queue.gate)
    /** The closure retains the exact gate-bearing transport selected above. */
    const installedTransport = gated
    /** The returned actual log operation lets the adapter attach native diagnostic resources. */
    const log = createIpcLogFeature({
      gate: queue.gate,
      report: ipc.log,
      onReportError: reportSafely
    })
    return Object.freeze({
      transport: gated,
      features: Object.freeze([queue.feature, log.feature]),
      log,
      ownClose(resource) {
        if (!resourcesClosed) {
          resources.add(resource)
          return
        }
        try {
          void Promise.resolve(resource.close()).catch(reportSafely)
        } catch (error) {
          reportSafely(error)
        }
      },
      close() {
        if (closing) return closing
        /** Publish before a close resource invokes a reporter or reenters the connection. */
        const done = deferred<void>()
        closing = done.promise
        void (async () => {
          try {
            resourcesClosed = true
            for (const resource of resources) {
              /** Synchronous removers preserve the original physical-close invocation order. */
              const result = resource.close()
              if (result !== undefined) await result
            }
            resources.clear()
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
      /** The canonical wrapper already closes the physical carrier even when it returns void. */
      const cleanup = gated ? gated.close?.() : transport.close?.()
      void Promise.resolve(cleanup).catch(reportSafely)
    } catch (cleanupError) {
      reportSafely(cleanupError)
    }
    throw error
  }
}
