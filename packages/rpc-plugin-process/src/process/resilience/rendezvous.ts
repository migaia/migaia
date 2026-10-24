import { ERROR_SOURCE as RPC_PROCESS_ERROR_SOURCE } from '../error-code.js'
import { RpcProcessErrorText } from '../error-text.js'
import { attachErrorIdentity } from '@migaia/utils/error'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '@migaia/rpc-host/plugin'
import type { IRemoteChannel } from '@migaia/rpc-host/plugin'
import { RpcProcessErrorCode } from '../error-code.js'

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

/** Shared admission resources belong to the listener; adopted channels leave this scope. */
type IRegistrationScope = Readonly<{
  manager: IProcessSessionManager
  options: IProcessRegistrationListenOptions
  report: (error: unknown) => void
  controller: AbortController
  pendingClosers: Set<() => Promise<void>>
}>

/** Own one unauthenticated connection until adoption or the original rollback completes. */
class ProcessRegistrationCandidate {
  /** Admission policy and listener cancellation are borrowed from the original listener. */
  #scope: IRegistrationScope
  /** This candidate alone owns the pending physical connection. */
  #pending: IProcessPendingByteConnection
  /** The admission lease remains held until this connection closes. */
  #lease: IProcessConnectionLease
  /** This cancellation ends only this candidate's handshake and endpoint preparation. */
  #controller = new AbortController()
  /** A successful handshake replaces pending physical close with channel close. */
  #channel: IRemoteChannel | undefined
  /** Listener cancellation cannot revoke an explicitly adopted session. */
  #adopted = false
  /** The live channel's transport subscription is removed before physical cleanup. */
  #unsubscribeTransport: (() => void) | undefined
  /** Cancellation, rejection and rollback share one cleanup receipt. */
  #closePromise: Promise<void> | undefined
  /** Install listener cancellation before starting caller-controlled handshake work. */
  constructor(
    scope: IRegistrationScope,
    pending: IProcessPendingByteConnection,
    lease: IProcessConnectionLease
  ) {
    this.#scope = scope
    this.#pending = pending
    this.#lease = lease
    scope.pendingClosers.add(this.close)
    scope.controller.signal.addEventListener('abort', this.#onListenerAbort, { once: true })
    if (scope.controller.signal.aborted) this.#onListenerAbort()
  }
  /** Release this lease even if the original physical close fails. */
  close = (): Promise<void> => (this.#closePromise ??= this.#release())
  /** Detach listener-owned callbacks before releasing the physical connection and lease. */
  async #release(): Promise<void> {
    this.#controller.abort()
    ;(0, this.#unsubscribeTransport)?.()
    this.#scope.controller.signal.removeEventListener('abort', this.#onListenerAbort)
    try {
      if (this.#channel) await this.#channel.close()
      else await this.#pending.close()
    } finally {
      this.#lease.release()
      this.#scope.pendingClosers.delete(this.close)
    }
  }
  /** Closing a listener affects only candidates that have not transferred ownership. */
  #onListenerAbort = (): void => {
    if (!this.#adopted)
      void this.close().catch((error: unknown) => reportSafely(this.#scope.report, error))
  }
  /**
   * Settle handshake/publication failures locally because the native accept callback is
   * synchronous.
   */
  async run(): Promise<void> {
    try {
      if (this.#controller.signal.aborted) return
      /** Caller context and the accepted principal jointly define this session's immutable identity. */
      const context = this.#scope.options.createConnectionContext(this.#pending)
      const accepted = await this.#pending.accept({
        ...context,
        offer: this.#scope.options.offer,
        scheduler: this.#scope.options.scheduler,
        handshakeTimeoutMs: this.#scope.options.handshakeTimeoutMs,
        signal: this.#controller.signal,
        report: this.#scope.report
      })
      this.#channel = accepted.channel
      if (this.#controller.signal.aborted || this.#scope.controller.signal.aborted) {
        await this.close()
        return
      }
      /** The verifier's stable principal, not the route peer, owns dedup scope. */
      const identity: IProcessSessionIdentity = Object.freeze({
        connectionId: context.ipc.connectionId,
        sessionId: context.ipc.sessionId,
        principalId: accepted.principalId,
        ...(context.ipc.processId ? { processId: context.ipc.processId } : {})
      })
      this.#unsubscribeTransport = this.#channel.transport.onTransportError?.(() => {
        void this.close().catch((error: unknown) => reportSafely(this.#scope.report, error))
      })
      if (this.#controller.signal.aborted) {
        await this.close()
        return
      }
      const outcome = await this.#scope.options.onCandidate(
        Object.freeze({
          channel: this.#channel,
          identity,
          signal: this.#controller.signal,
          close: this.close
        })
      )
      if (outcome === 'adopt' && !this.#controller.signal.aborted) {
        this.#adopted = true
        this.#scope.pendingClosers.delete(this.close)
        this.#scope.controller.signal.removeEventListener('abort', this.#onListenerAbort)
      } else await this.close()
    } catch (error) {
      reportSafely(this.#scope.report, error)
      try {
        await this.close()
      } catch (cleanupError) {
        reportSafely(this.#scope.report, cleanupError)
      }
    }
  }
}

/** Own the native listener and its unauthenticated candidates without retaining adopted channels. */
class ProcessRegistrationListener {
  /** One explicit scope is shared with candidates until each transfers ownership. */
  #scope: IRegistrationScope
  /** Native listener close precedes waiting for pending-candidate cleanup. */
  #listener: IProcessByteListener | undefined
  /** All callers observe the same close transaction. */
  #closePromise: Promise<void> | undefined
  /** Attach external cancellation before acquiring the native listener. */
  constructor(
    manager: IProcessSessionManager,
    options: IProcessRegistrationListenOptions,
    report: (error: unknown) => void
  ) {
    this.#scope = {
      manager,
      options,
      report,
      controller: new AbortController(),
      pendingClosers: new Set()
    }
    options.signal?.addEventListener('abort', this.#cancelAll, { once: true })
    if (options.signal?.aborted) this.#cancelAll()
  }
  /** Cancel pending candidates without changing ownership of adopted sessions. */
  #cancelAll = (): void => this.#scope.controller.abort()
  /** Claim admission before any caller context or handshake work starts. */
  #onConnection = (pending: IProcessPendingByteConnection): void => {
    /** Rejection closes the unclaimed raw candidate and reports both independent failures. */
    let lease: IProcessConnectionLease
    try {
      lease = this.#scope.manager.claimConnection()
    } catch (error) {
      void pending
        .close()
        .catch((cleanupError: unknown) => reportSafely(this.#scope.report, cleanupError))
      reportSafely(this.#scope.report, error)
      return
    }
    void new ProcessRegistrationCandidate(this.#scope, pending, lease).run()
  }
  /** Acquire the native listener; failed acquisition releases only its external abort subscription. */
  async open(): Promise<IProcessRegistrationListener> {
    try {
      this.#listener = await this.#scope.options.listen({
        address: this.#scope.options.address,
        serviceId: this.#scope.options.serviceId,
        signal: this.#scope.controller.signal,
        auth: { mode: 'required', verify: this.#scope.options.verifyToken },
        report: this.#scope.report,
        onConnection: this.#onConnection
      })
    } catch (error) {
      this.#scope.options.signal?.removeEventListener('abort', this.#cancelAll)
      throw error
    }
    return Object.freeze({ address: this.#listener.address, close: this.#close })
  }
  /** Share one listener teardown receipt while keeping adopted sessions independent. */
  #close = (): Promise<void> => (this.#closePromise ??= this.#release())
  /** Stop ingress before settling every still-unadopted candidate. */
  async #release(): Promise<void> {
    this.#scope.controller.abort()
    this.#scope.options.signal?.removeEventListener('abort', this.#cancelAll)
    try {
      await this.#listener!.close()
    } finally {
      await Promise.allSettled([...this.#scope.pendingClosers].map((close) => close()))
    }
  }
}

/** Validate the public registration boundary before acquiring listener-owned resources. */
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
    throw ((originalDetail: Readonly<Record<string, unknown>> | undefined) =>
      attachErrorIdentity(new TypeError(RpcProcessErrorText.resilienceInvalidOption), {
        source: RPC_PROCESS_ERROR_SOURCE,
        code: RpcProcessErrorCode.resilienceInvalidOption,
        ...(originalDetail ? { detail: originalDetail } : {})
      }))({
      field: 'listenRegistrations'
    })
  if (
    options.address.startsWith('/') &&
    (typeof options.serviceId !== 'string' || options.serviceId.length === 0)
  )
    throw ((originalDetail: Readonly<Record<string, unknown>> | undefined) =>
      attachErrorIdentity(new TypeError(RpcProcessErrorText.resilienceInvalidOption), {
        source: RPC_PROCESS_ERROR_SOURCE,
        code: RpcProcessErrorCode.resilienceInvalidOption,
        ...(originalDetail ? { detail: originalDetail } : {})
      }))({
      field: 'serviceId'
    })
  return new ProcessRegistrationListener(manager, options, report).open()
}
