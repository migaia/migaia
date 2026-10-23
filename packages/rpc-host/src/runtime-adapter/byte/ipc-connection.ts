import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { deferred, hostRethrowReporter } from '@migaia/utils/promise'
import { createDisposeTransaction, DisposeTransactionKind } from '@migaia/lifecycle'
import { drainListenerFailures } from '../../core/internal/listener-safety.js'
import { RpcCoreErrorCode } from '../../core/error-code.js'
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

/** Only actual connection construction can associate a physical transport with its diagnostic sink. */
const diagnosticActivations = new WeakMap<IRpcTransport, IIpcLogInstallation['activate']>()

/** Mount the original physical log subscription when a host mux borrows this exact channel. */
export function activateIpcConnectionDiagnostics(
  transport: IRpcTransport
): (() => void) | undefined {
  return diagnosticActivations.get(transport)?.()
}

/** Compose one physical carrier with the canonical envelope gate and diagnostic installation. */
export function attachIpcConnection(
  transport: IRpcTransport,
  ipc: IRuntimeConnectionOptions['ipc'],
  report: (error: unknown) => void,
  scheduler: IScheduler = systemScheduler
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
    diagnosticActivations.set(installedTransport, log.activate)
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
        diagnosticActivations.delete(installedTransport)
        /** Publish before a close resource invokes a reporter or reenters the connection. */
        const done = deferred<void>()
        closing = done.promise
        void (async () => {
          try {
            resourcesClosed = true
            /** Lifecycle runs every resource followed by the physical close in the existing order. */
            const items = [...resources, { close: () => installedTransport.close?.() }].map(
              (resource, index) => ({
                source: String(index),
                descriptor: { force: () => resource.close() }
              })
            )
            resources.clear()
            /** Collecting preserves the first original error while preventing skipped releases. */
            const failures = await createDisposeTransaction(
              { kind: DisposeTransactionKind.plan },
              { errorPolicy: 'collect', scheduler }
            ).run(items)
            if (failures.length === 1) throw failures[0]!.error
            drainListenerFailures(
              failures.map(({ error }) => error),
              { code: RpcCoreErrorCode.transport }
            )
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
