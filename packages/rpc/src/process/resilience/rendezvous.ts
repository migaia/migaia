import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import type { IRemoteChannel } from '../../remote/types.js'
import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
import type { IProcessByteListener, IProcessPendingByteConnection } from '../types.js'
import type { IProcessSessionManager, IProcessConnectionLease } from './session.js'
import type {
  IProcessRegistrationListenOptions,
  IProcessRegistrationListener,
  IProcessSessionIdentity
} from './types.js'

/** A diagnostic callback cannot replace the candidate's primary failure. */
function reportSafely(report: (error: unknown) => void, error: unknown): void {
  try {
    report(error)
  } catch (reporterError) {
    hostRethrowReporter(reporterError, IpcReporterContext)
  }
}

/** Own each unauthenticated candidate until one ready channel is explicitly adopted. */
export async function listenProcessRegistrations(
  manager: IProcessSessionManager,
  options: IProcessRegistrationListenOptions,
  report: (error: unknown) => void
): Promise<IProcessRegistrationListener> {
  if (
    !options ||
    options.wire !== 'native' ||
    typeof options.address !== 'string' ||
    typeof options.listen !== 'function' ||
    typeof options.verifyToken !== 'function' ||
    typeof options.onCandidate !== 'function' ||
    typeof options.createConnectionContext !== 'function'
  )
    throw createProcessError(RpcProcessErrorCode.resilienceInvalidOption, undefined, {
      field: 'listenRegistrations'
    })
  if (
    options.address.startsWith('/') &&
    (typeof options.serviceId !== 'string' || options.serviceId.length === 0)
  )
    throw createProcessError(RpcProcessErrorCode.resilienceInvalidOption, undefined, {
      field: 'serviceId'
    })
  /** Closing the listener cancels candidates, while adopted channels keep their own owner. */
  const controller = new AbortController()
  /** Pre-adoption cleanup functions are retained only for the listener lifetime. */
  const pendingClosers = new Set<() => Promise<void>>()
  const cancelAll = (): void => controller.abort()
  options.signal?.addEventListener('abort', cancelAll, { once: true })
  if (options.signal?.aborted) cancelAll()
  let listener: IProcessByteListener
  try {
    listener = await options.listen({
      address: options.address,
      serviceId: options.serviceId,
      signal: controller.signal,
      auth: { mode: 'required', verify: options.verifyToken },
      report,
      onConnection(pending: IProcessPendingByteConnection) {
        /** The lease is claimed before any handshake or caller context work. */
        let lease: IProcessConnectionLease
        try {
          lease = manager.claimConnection()
        } catch (error) {
          void pending.close().catch((cleanupError: unknown) => reportSafely(report, cleanupError))
          reportSafely(report, error)
          return
        }
        const candidateController = new AbortController()
        let channel: IRemoteChannel | undefined
        let adopted = false
        let unsubscribeTransport: (() => void) | undefined
        let closePromise: Promise<void> | undefined
        /** Every cancellation and rollback shares one physical close and lease release. */
        const closeCandidate = (): Promise<void> =>
          (closePromise ??= (async () => {
            candidateController.abort()
            unsubscribeTransport?.()
            controller.signal.removeEventListener('abort', onListenerAbort)
            try {
              if (channel) await channel.close()
              else await pending.close()
            } finally {
              lease.release()
              pendingClosers.delete(closeCandidate)
            }
          })())
        const onListenerAbort = (): void => {
          if (!adopted) void closeCandidate().catch((error: unknown) => reportSafely(report, error))
        }
        pendingClosers.add(closeCandidate)
        controller.signal.addEventListener('abort', onListenerAbort, { once: true })
        if (controller.signal.aborted) onListenerAbort()
        /** The adapter does not await this task; settle failures locally and report once. */
        void (async () => {
          try {
            if (candidateController.signal.aborted) return
            const context = options.createConnectionContext(pending)
            const accepted = await pending.accept({
              ...context,
              offer: options.offer,
              scheduler: options.scheduler,
              handshakeTimeoutMs: options.handshakeTimeoutMs,
              signal: candidateController.signal,
              report
            })
            channel = accepted.channel
            if (candidateController.signal.aborted || controller.signal.aborted) {
              await closeCandidate()
              return
            }
            /** The verifier's stable principal, not the route peer, owns dedup scope. */
            const identity: IProcessSessionIdentity = Object.freeze({
              connectionId: context.ipc.connectionId,
              sessionId: context.ipc.sessionId,
              principalId: accepted.principalId,
              ...(context.ipc.processId ? { processId: context.ipc.processId } : {})
            })
          unsubscribeTransport = channel.transport.onTransportError?.(() => {
            void closeCandidate().catch((error: unknown) => reportSafely(report, error))
          })
          if (candidateController.signal.aborted) {
            await closeCandidate()
            return
          }
          const outcome = await options.onCandidate(
              Object.freeze({
                channel,
                identity,
                signal: candidateController.signal,
                close: closeCandidate
              })
            )
            if (outcome === 'adopt' && !candidateController.signal.aborted) {
              adopted = true
              pendingClosers.delete(closeCandidate)
              controller.signal.removeEventListener('abort', onListenerAbort)
            } else await closeCandidate()
          } catch (error) {
            reportSafely(report, error)
            try {
              await closeCandidate()
            } catch (cleanupError) {
              reportSafely(report, cleanupError)
            }
          }
        })()
      }
    })
  } catch (error) {
    options.signal?.removeEventListener('abort', cancelAll)
    throw error
  }
  /** Listener close is idempotent and cannot revoke already adopted sessions. */
  let closePromise: Promise<void> | undefined
  return Object.freeze({
    address: listener.address,
    close(): Promise<void> {
      return (closePromise ??= (async () => {
        controller.abort()
        options.signal?.removeEventListener('abort', cancelAll)
        try {
          await listener.close()
        } finally {
          await Promise.allSettled([...pendingClosers].map((close) => close()))
        }
      })())
    }
  })
}
