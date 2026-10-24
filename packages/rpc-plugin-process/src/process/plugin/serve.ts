/**
 * Own native process session acceptance, publication and shutdown for child and listener ingress.
 * The supervision guard owns the parent-loss deadline; this module owns its session cleanup.
 */
import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import type {
  IAdapterListenerPreparation,
  IAdapterListenerSession,
  IAdapterDeploymentAccept,
  IAdapterDeploymentAcceptedSession
} from '@migaia/rpc-host/plugin'
import { ERROR_SOURCE as RPC_PROCESS_ERROR_SOURCE } from '../error-code.js'
import { createParentLossGuard } from '@migaia/supervision/process'
import { attachErrorIdentity } from '@migaia/utils/error'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { ERROR_SOURCE, RpcProcessErrorCode } from '../error-code.js'

import { RpcProcessErrorText } from '../error-text.js'
import type { IRuntimePeerSourceResult } from '@migaia/rpc-host/plugin'
import type { IRemoteChannel, IRemoteServeEndpoint } from '@migaia/rpc-host/plugin'
import type {
  IProcessByteChannel,
  IProcessByteListener,
  IProcessMessageChannel,
  IProcessPendingByteConnection
} from '../types.js'
import { createAdapterId as defaultRpcId } from '@migaia/rpc-host/plugin'
import { createAdapterBindingDrain as createRemoteBindingDrain } from '@migaia/rpc-host/plugin'
import {
  createProcessSessionManager,
  type IProcessConnectionLease,
  type IProcessSessionManager
} from '../resilience/session.js'
import { createProcessProviderAdmission } from '../resilience/provider-admission.js'
import type { IProcessInstanceFallback } from '../resilience/fallback.js'
import { processSessionManager } from '../resilience/index.js'
import type { IProcessResilience } from '../resilience/types.js'
import { RpcCapability } from '@migaia/rpc-contract'
import type { IProcessServeListenerIngress, IProcessServeEndpointFactory } from './types.js'
import type { IRpcProviderLimits } from '@migaia/rpc-host'
import { readAdapterAbortReason as resolveAbortReason } from '@migaia/rpc-host/plugin'
import type { IProcessSessionIdentity } from '../resilience/types.js'
import { invalidOption, reportSafely } from './binding.js'
import { ProcessPluginChannelKind } from './constants.js'
import type { IProcessServeChildIngress } from './types.js'

/** Native sessions retain the accepted member's original close operation. */
type IProcessSessionServiceHandle = Pick<IAdapterDeploymentAcceptedSession['peer'], 'close'>

/** The canonical public drain operation determines this internal held-resource shape. */
type IRemoteBindingDrain = ReturnType<typeof createRemoteBindingDrain>

/** A ready session is independently owned by its remote service registration and channel. */
type IProcessServeSession = Readonly<{
  channel: IRemoteChannel
  service: IProcessSessionServiceHandle
  /** Read the original close Promise rather than copying a ready/closing state. */
  active(): boolean
  close(): Promise<void>
}>

/** Runtime publication follows the same authenticated candidate, commit and shutdown ownership. */
type IProcessRuntimeSessionPublication = Readonly<{
  signal?: IAbortSignal
  initialSignal?: IAbortSignal
  own?(close: () => Promise<void>): void
  publish?(service: IProcessSessionServiceHandle): () => void
  /** Original close retains owned governor cleanup failures alongside session cleanup failures. */
  release?(): Promise<void>
  /** The selected core policy is merged by the original connection admission owner. */
  providerLimits?: IRpcProviderLimits
  /** The SDK budget reaches the same pending byte handshake owner. */
  handshakeTimeoutMs?: number
}>

/** Runtime assembly receives the exact original service manager; the public factory stays unchanged. */
type IProcessSessionEndpointFactory = (
  ...args: [...Parameters<IProcessServeEndpointFactory>, IProcessSessionManager]
) => Promise<IRemoteServeEndpoint>

/** Private service reads use the original session Set, without another listener registry. */
export type IProcessSessionsHandle = Readonly<{
  close(): Promise<void>
  /** Read original closure state without a separate listener availability flag. */
  closed(): boolean
  services(): readonly IProcessSessionServiceHandle[]
  current(): IProcessSessionServiceHandle | null | undefined
}>

/** Preserves every cleanup failure under one registered process code. */
function cleanupFailure(errors: readonly unknown[]): AggregateError {
  return attachErrorIdentity(new AggregateError(errors, RpcProcessErrorText.channelClosed), {
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.channelClosed
  })
}

/** Own a committed endpoint's publication, drain and physical close as one session. */
class ProcessServeSession {
  /** The physical channel and service remain the original committed pair. */
  #channel: IRemoteChannel
  /** The endpoint is closed before its physical channel. */
  #service: IProcessSessionServiceHandle
  /** The accept owner retains only committed sessions that still own resources. */
  #sessions: Set<IProcessServeSession>
  /** The canonical drain owns outstanding service work. */
  #drain: IRemoteBindingDrain
  /** This lease is released exactly once by the shared cleanup transaction. */
  #lease: IProcessConnectionLease
  /** Admission closes before endpoint draining begins. */
  #closeAdmission: () => void
  /** Repeated EOF, listener close and explicit close share this exact Promise. */
  #closePromise: Promise<void> | undefined
  /** The native error subscription exists only while the session owns its endpoint. */
  #unsubscribe: (() => void) | undefined
  /** Fallback retains this session until its resources have been released. */
  #unregisterFallback: (() => void) | undefined
  /** Only this committed session may withdraw its published contribution. */
  #withdraw: (() => void) | undefined
  /** The externally retained session is also the identity stored in the accept owner's Set. */
  readonly value: IProcessServeSession
  /** Publish the committed session and install its original loss and fallback callbacks. */
  constructor(
    channel: IRemoteChannel,
    service: IProcessSessionServiceHandle,
    sessions: Set<IProcessServeSession>,
    report: (error: unknown) => void,
    drain: IRemoteBindingDrain,
    lease: IProcessConnectionLease,
    closeAdmission: () => void,
    identity: IProcessSessionIdentity,
    fallback?: IProcessInstanceFallback,
    publication?: IProcessRuntimeSessionPublication
  ) {
    this.#channel = channel
    this.#service = service
    this.#sessions = sessions
    this.#drain = drain
    this.#lease = lease
    this.#closeAdmission = closeAdmission
    this.value = {
      channel,
      service,
      active: () => this.#closePromise === undefined,
      close: this.#close
    }
    sessions.add(this.value)
    this.#unsubscribe = channel.transport.onTransportError?.(() => {
      void this.#close().catch((error: unknown) => reportSafely(report, error))
    })
    this.#unregisterFallback = fallback?.add({
      connectionId: identity.connectionId,
      close: this.#close
    })
    try {
      this.#withdraw = publication?.publish?.(service)
    } catch (error) {
      reportSafely(report, error)
      void this.#close().catch((cleanup: unknown) => reportSafely(report, cleanup))
    }
  }
  /** Withdraw readiness before draining; retain all service/channel cleanup failures. */
  #close = (): Promise<void> => (this.#closePromise ??= this.#release())
  /** Release the exact resources this committed session acquired, in their original order. */
  async #release(): Promise<void> {
    ;(0, this.#withdraw)?.()
    ;(0, this.#unsubscribe)?.()
    ;(0, this.#closeAdmission)()
    /** Both physical cleanup failures remain reachable under the package cleanup code. */
    const errors: unknown[] = []
    await this.#drain.drainCurrent()
    try {
      await this.#service.close()
    } catch (error) {
      errors.push(error)
    }
    try {
      await this.#channel.close()
    } catch (error) {
      errors.push(error)
    }
    this.#lease.release()
    this.#sessions.delete(this.value)
    ;(0, this.#unregisterFallback)?.()
    if (errors.length > 0) throw cleanupFailure(errors)
  }
}

/** Commit one ready session without creating a second session registry or lifetime. */
function createSession(
  ...args: ConstructorParameters<typeof ProcessServeSession>
): IProcessServeSession {
  return new ProcessServeSession(...args).value
}

/** Invoking the service callback transfers endpoint ownership, including failed-startup rollback. */
export type IProcessReadySession = Readonly<{
  channel: IRemoteChannel
  endpoint: IRemoteServeEndpoint
  identity: IProcessSessionIdentity
  signal: INativeAbortSignal
  /** Genuine Core runtime operation retains its prepared endpoint and Peer internally. */
  runtime?: IAdapterListenerSession
  /** New native hosts borrow the accepted session of their one existing endpoint. */
  accepted?: IAdapterDeploymentAcceptedSession
}>

/** Native service endpoints must support the control capability their peer will probe. */
function validateServiceEndpoint(channel: IRemoteChannel, endpoint: IRemoteServeEndpoint): void {
  if (
    channel.agreement.capabilities.includes(RpcCapability.ping) &&
    typeof endpoint.endpoint.ping !== 'function'
  )
    throw ((originalDetail: Readonly<Record<string, unknown>> | undefined) =>
      attachErrorIdentity(new TypeError(RpcProcessErrorText.resilienceInvalidOption), {
        source: RPC_PROCESS_ERROR_SOURCE,
        code: RpcProcessErrorCode.resilienceInvalidOption,
        ...(originalDetail ? { detail: originalDetail } : {})
      }))({
      field: 'endpointFactory'
    })
}

/** Own one accept/parent-loss loop for Plugin and Host services, with canonical session quotas. */
/** Create the service's one accept scope before any native ingress can invoke it. */
function processSessionState(
  ingress: IProcessServeChildIngress | IProcessServeListenerIngress,
  endpointFactory: IProcessSessionEndpointFactory | undefined,
  onReadySession: (session: IProcessReadySession) => Promise<IProcessSessionServiceHandle>,
  resilience: IProcessResilience,
  report: (error: unknown) => void,
  fallback?: IProcessInstanceFallback,
  scheduler: IScheduler = ingress.kind === 'listener'
    ? (ingress.scheduler ?? systemScheduler)
    : systemScheduler,
  publication?: IProcessRuntimeSessionPublication,
  runtime?: IAdapterListenerPreparation,
  adopt?: IAdapterDeploymentAccept
) {
  if (ingress.kind === 'listener' && typeof ingress.verify !== 'function')
    invalidOption('ingress.verify')
  if (ingress.kind === 'child' && typeof ingress.parentLoss?.exit !== 'function')
    invalidOption('ingress.parentLoss.exit')
  /** Both facades borrow the exact manager held by their one service governor. */
  const borrowedManager = processSessionManager(resilience)
  /** Structural custom governors retain their own sessionOptions and use default admission quotas. */
  const manager =
    borrowedManager ??
    createProcessSessionManager({
      scheduler,
      report
    })
  /** This owner aborts pending ingress preparation when session shutdown begins. */
  const controller = new AbortController()
  /** A service owns only sessions accepted through this invocation. */
  const sessions = new Set<IProcessServeSession>()
  /** Pending accepts must settle before close snapshots the accepted sessions. */
  const accepting = new Set<Promise<void>>()
  /** The listener is separate from accepted channels and closes first. */
  const listener = undefined as IProcessByteListener | undefined
  /** Child EOF is observed through the one supervision-owned parent-loss guard. */
  const removeParentClose = undefined as (() => void) | undefined
  /** The optional parent probe is owned by this serve handle. */
  const removeProbe = undefined as (() => void) | undefined
  /**
   * The original close Promise stops candidate publication while accepted sessions retain their
   * drain signal.
   */
  const closePromise = undefined as Promise<void> | undefined

  return {
    borrowedManager,
    manager,
    controller,
    sessions,
    accepting,
    listener: listener as IProcessByteListener | undefined,
    removeParentClose: removeParentClose as (() => void) | undefined,
    removeProbe: removeProbe as (() => void) | undefined,
    closePromise: closePromise as Promise<void> | undefined,
    ingress,
    endpointFactory,
    onReadySession,
    resilience,
    report,
    fallback,
    scheduler,
    publication,
    runtime,
    adopt
  }
}

/** Own accepted sessions, candidate publication and shutdown for one listener or parent ingress. */
class ProcessSessionOwner {
  /** Every callback shares only this explicit service owner and its original resource receipts. */
  #state: ReturnType<typeof processSessionState>
  /** Preserve construction-time validation before registering native ingress callbacks. */
  constructor(
    ingress: IProcessServeChildIngress | IProcessServeListenerIngress,
    endpointFactory: IProcessSessionEndpointFactory | undefined,
    onReadySession: (session: IProcessReadySession) => Promise<IProcessSessionServiceHandle>,
    resilience: IProcessResilience,
    report: (error: unknown) => void,
    fallback?: IProcessInstanceFallback,
    scheduler: IScheduler = ingress.kind === 'listener'
      ? (ingress.scheduler ?? systemScheduler)
      : systemScheduler,
    publication?: IProcessRuntimeSessionPublication,
    runtime?: IAdapterListenerPreparation,
    adopt?: IAdapterDeploymentAccept
  ) {
    this.#state = processSessionState(
      ingress,
      endpointFactory,
      onReadySession,
      resilience,
      report,
      fallback,
      scheduler,
      publication,
      runtime,
      adopt
    )
  }
  /** Attach external cancellation before starting the selected original ingress path. */
  async open(): Promise<IProcessSessionsHandle> {
    this.#state.publication?.own?.(this.#close)
    this.#state.publication?.signal?.addEventListener('abort', this.#onAbort, { once: true })
    this.#state.publication?.initialSignal?.addEventListener('abort', this.#onAbort, { once: true })
    if (this.#state.publication?.signal?.aborted || this.#state.publication?.initialSignal?.aborted)
      this.#onAbort()
    return this.#state.ingress.kind === 'listener'
      ? this.#serveListener(this.#state.ingress)
      : this.#serveChild(this.#state.ingress)
  }
  /** The original external lifecycle is detached when this service scope closes. */
  #onAbort = (): void => {
    void this.#close().catch((error: unknown) => reportSafely(this.#state.report, error))
  }

  #close = (): Promise<void> =>
    (this.#state.closePromise ??= (async () => {
      /** Detach parent-loss observers before abort synchronously closes this owned channel. */
      ;(0, this.#state.removeParentClose)?.()
      ;(0, this.#state.removeProbe)?.()
      this.#state.publication?.signal?.removeEventListener('abort', this.#onAbort)
      this.#state.publication?.initialSignal?.removeEventListener('abort', this.#onAbort)
      const fallbackClose = this.#state.fallback?.close()
      const errors: unknown[] = []
      try {
        await this.#state.listener?.close()
      } catch (error) {
        errors.push(error)
      }
      await Promise.allSettled(this.#state.accepting)
      for (const session of this.#state.sessions) {
        try {
          await session.close()
        } catch (error) {
          errors.push(error)
        }
      }

      /** Pending candidates are closed above; live carriers abort only after their native drain. */
      this.#state.controller.abort(
        this.#state.publication?.initialSignal?.aborted
          ? resolveAbortReason(this.#state.publication.initialSignal)
          : this.#state.publication?.signal?.aborted
            ? resolveAbortReason(this.#state.publication.signal)
            : undefined
      )
      await fallbackClose
      if (!this.#state.borrowedManager) this.#state.manager.close()
      try {
        await this.#state.publication?.release?.()
      } catch (error) {
        errors.push(error)
      }
      if (errors.length > 0) throw cleanupFailure(errors)
    })())

  /**
   * Actual active sessions alone are projected; closing resource records remain owned until
   * settled.
   */
  #services = (): readonly IProcessSessionServiceHandle[] =>
    [...this.#state.sessions]
      .filter((session) => session.active())
      .map((session) => session.service)

  /** One implicit Peer target is safe only when this original owner has one active session. */
  #current = (): IProcessSessionServiceHandle | null | undefined => {
    /** No second index or availability flag is maintained for this private selection. */
    let selected: IProcessSessionServiceHandle | undefined
    for (const session of this.#state.sessions) {
      if (!session.active()) continue
      if (selected) return null
      selected = session.service
    }
    return selected
  }
  /** Register the listener, preserving accept-before-return and abort rollback ordering. */
  #serveListener = async (
    ingress: IProcessServeListenerIngress
  ): Promise<IProcessSessionsHandle> => {
    const listenerIngress = ingress
    try {
      this.#state.listener = await listenerIngress.listen({
        address: listenerIngress.address,
        signal: this.#state.controller.signal,
        auth: { mode: 'required', verify: listenerIngress.verify },
        report: this.#state.report,
        onConnection: (pending) => this.#acceptListener(pending, listenerIngress)
      })
      this.#state.publication?.initialSignal?.removeEventListener('abort', this.#onAbort)
      if (this.#state.controller.signal.aborted || this.#state.closePromise !== undefined) {
        await this.#state.listener.close()
        throw ((originalCause: unknown) =>
          attachErrorIdentity(
            new Error(
              RpcProcessErrorText.channelClosed,
              originalCause === undefined ? undefined : { cause: originalCause }
            ),
            { source: RPC_PROCESS_ERROR_SOURCE, code: RpcProcessErrorCode.channelClosed }
          ))(resolveAbortReason(this.#state.controller.signal))
      }
    } catch (error) {
      try {
        await this.#state.fallback?.close()
      } catch (cleanupError) {
        reportSafely(this.#state.report, cleanupError)
      }
      throw error
    }
    return Object.freeze({
      close: this.#close,
      closed: () => this.#state.closePromise !== undefined,
      services: this.#services,
      current: this.#current
    })
  }
  /** Track the original candidate Promise before exposing its completion to the listener. */
  #acceptListener = (
    pending: IProcessPendingByteConnection,
    listenerIngress: IProcessServeListenerIngress
  ): Promise<void> => {
    /** The listener may invoke callbacks without awaiting their Promise. */
    const acceptingOne = this.#admitListener(pending, listenerIngress)
    this.#state.accepting.add(acceptingOne)
    void acceptingOne.then(
      () => this.#state.accepting.delete(acceptingOne),
      () => this.#state.accepting.delete(acceptingOne)
    )
    return acceptingOne
  }
  /** Admit one authenticated listener candidate, retaining transaction-local rollback receipts. */
  #admitListener = async (
    pending: IProcessPendingByteConnection,
    listenerIngress: IProcessServeListenerIngress
  ): Promise<void> => {
    /** Ownership transfers only after pending.accept fulfills. */
    let channel: IRemoteChannel | undefined
    /** A failed candidate returns its physical capacity before reporting the error. */
    let lease: IProcessConnectionLease | undefined
    /** The frame observer is removed on either candidate rollback or session close. */
    let closeAdmission: (() => void) | undefined
    let candidateEndpoint: IRemoteServeEndpoint | undefined
    /** A returned service remains a candidate until recovery and cancellation checks pass. */
    let candidateService: IProcessSessionServiceHandle | undefined
    try {
      if (this.#state.controller.signal.aborted || this.#state.closePromise !== undefined) {
        await pending.close()
        return
      }
      lease = this.#state.manager.claimConnection()
      const context = listenerIngress.createConnectionContext(pending)
      const accepted = await pending.accept({
        offer: listenerIngress.offer,
        peerId: context.peerId,
        ipc: context.ipc,
        scheduler: listenerIngress.scheduler,
        signal: this.#state.controller.signal,
        report: this.#state.report,
        handshakeTimeoutMs: this.#state.publication?.handshakeTimeoutMs
      })
      channel = accepted.channel
      if (this.#state.controller.signal.aborted || this.#state.closePromise !== undefined)
        throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
          source: RPC_PROCESS_ERROR_SOURCE,
          code: RpcProcessErrorCode.channelClosed
        })
      const identity: IProcessSessionIdentity = Object.freeze({
        connectionId: context.ipc.connectionId,
        sessionId: context.ipc.sessionId,
        principalId: accepted.principalId,
        ...(context.ipc.processId ? { processId: context.ipc.processId } : {})
      })
      await this.#state.fallback?.ready()
      if (this.#state.controller.signal.aborted || this.#state.closePromise !== undefined)
        throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
          source: RPC_PROCESS_ERROR_SOURCE,
          code: RpcProcessErrorCode.channelClosed
        })
      const fallbackVersion = this.#state.fallback?.version
      const sessionOptions = this.#state.borrowedManager
        ? this.#state.manager.connectionOptions(channel, identity)
        : this.#state.resilience.sessionOptions(identity)
      const drain = createRemoteBindingDrain(
        channel.scheduler,
        (error) => reportSafely(this.#state.report, error),
        this.#state.manager.options.drainMs
      )
      /** A policy violation closes only this accepted connection. */
      let publishedSession: IProcessServeSession | undefined
      const admission = createProcessProviderAdmission(
        channel,
        this.#state.manager.options,
        channel.scheduler,
        () => publishedSession?.close() ?? Promise.resolve(),
        (error) => reportSafely(this.#state.report, error)
      )
      closeAdmission = admission.close
      /** Numeric policy is merged before the original endpoint constructor observes it. */
      const limits = admission.limits(
        sessionOptions.limits,
        this.#state.publication?.providerLimits
      )
      /** Actual Core resource assembly preserves Host and authenticated scope provenance. */
      const runtimeSession = !this.#state.adopt
        ? this.#state.runtime?.session(
            channel,
            this.#state.controller.signal,
            this.#state.manager.coreScope,
            limits,
            this.#state.borrowedManager ? undefined : sessionOptions.idempotency
          )
        : undefined
      /** Native admission and cleanup remain here; Host borrows this exact policy. */
      const acceptedSession = this.#state.adopt
        ? await (0, this.#state.adopt)(channel as IRuntimePeerSourceResult, {
            policy: { idempotency: sessionOptions.idempotency, providerLimits: limits },
            execution: {
              providerAdmission: this.#state.manager.runtimeAdmission,
              ...(this.#state.borrowedManager
                ? {
                    /** The built-in session's normalized capacity belongs to this exact channel. */
                    connectionQuota: Object.freeze({
                      key: channel,
                      maxConcurrent: this.#state.manager.options.maxConcurrentCallsPerConnection
                    }),
                    /** Only explicit logical policy may constrain the original shared Host scope. */
                    limits: admission.limits({}, this.#state.publication?.providerLimits)
                  }
                : {
                    /** Structural governors retain their original selected limits and observers. */
                    limits
                  }),
              idempotency: sessionOptions.idempotency,
              provider: admission.core.provider,
              enterStream: admission.core.enterStream,
              streamResult: admission.core.streamResult
            },
            wrapEndpoint: (endpoint, onExecution) => drain.wrap(channel!, endpoint, onExecution)
          })
        : undefined
      /** Preserve the original endpoint callback receiver when no held runtime prepares it. */
      const endpointFactory = this.#state.endpointFactory
      const builtEndpoint = (candidateEndpoint =
        acceptedSession?.endpoint ??
        (runtimeSession
          ? await runtimeSession.prepare()
          : await endpointFactory!(
              channel,
              this.#state.controller.signal,
              { identity, ...sessionOptions, limits },
              this.#state.manager
            )))
      validateServiceEndpoint(channel, builtEndpoint)
      const endpoint = acceptedSession
        ? builtEndpoint
        : runtimeSession
          ? runtimeSession.attach(drain, admission.core)
          : admission.wrap(drain.wrap(channel, builtEndpoint))
      if (this.#state.controller.signal.aborted || this.#state.closePromise !== undefined) {
        candidateEndpoint = undefined
        try {
          await endpoint.endpoint.dispose()
        } catch (cleanupError) {
          reportSafely(this.#state.report, cleanupError)
        }
        throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
          source: RPC_PROCESS_ERROR_SOURCE,
          code: RpcProcessErrorCode.channelClosed
        })
      }
      candidateEndpoint = undefined
      const service = (candidateService = await (0, this.#state.onReadySession)({
        channel,
        endpoint,
        identity,
        signal: this.#state.controller.signal,
        ...(runtimeSession ? { runtime: runtimeSession } : {}),
        ...(acceptedSession ? { accepted: acceptedSession } : {})
      }))
      ;(channel as IRuntimePeerSourceResult).activateReceive?.()
      if (this.#state.controller.signal.aborted || this.#state.closePromise !== undefined)
        throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
          source: RPC_PROCESS_ERROR_SOURCE,
          code: RpcProcessErrorCode.channelClosed
        })
      await this.#state.fallback?.ready()
      if (this.#state.controller.signal.aborted || this.#state.closePromise !== undefined)
        throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
          source: RPC_PROCESS_ERROR_SOURCE,
          code: RpcProcessErrorCode.channelClosed
        })
      if (this.#state.fallback?.version !== fallbackVersion)
        throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
          source: RPC_PROCESS_ERROR_SOURCE,
          code: RpcProcessErrorCode.channelClosed
        })
      publishedSession = createSession(
        channel,
        service,
        this.#state.sessions,
        this.#state.report,
        drain,
        lease,
        admission.close,
        identity,
        this.#state.fallback,
        this.#state.publication
      )
      candidateService = undefined
      lease = undefined
      closeAdmission = undefined
    } catch (error) {
      closeAdmission?.()
      if (candidateService) {
        try {
          await candidateService.close()
        } catch (cleanupError) {
          reportSafely(this.#state.report, cleanupError)
        }
      }
      if (candidateEndpoint) {
        try {
          await candidateEndpoint.endpoint.dispose()
        } catch (cleanupError) {
          reportSafely(this.#state.report, cleanupError)
        }
      }
      lease?.release()
      if (!channel) {
        try {
          await pending.close()
        } catch (cleanupError) {
          reportSafely(this.#state.report, cleanupError)
        }
      }
      try {
        await channel?.close()
      } catch (cleanupError) {
        reportSafely(this.#state.report, cleanupError)
      }
      reportSafely(this.#state.report, error)
    }
  }
  /** Track child preparation so parent-loss shutdown joins its original rollback before exiting. */
  #serveChild = async (ingress: IProcessServeChildIngress): Promise<IProcessSessionsHandle> => {
    /** The existing guard bounds preparation and committed-session cleanup with one deadline. */
    const guard = createParentLossGuard({
      shutdown: () => this.#close(),
      exit: ingress.parentLoss.exit,
      graceMs: ingress.parentLoss.graceMs,
      /** The session owner supplies the same clock for shutdown and its original grace deadline. */
      scheduler: this.#state.scheduler,
      report: this.#state.report
    })
    this.#state.removeProbe = ingress.parentLoss.probe?.((reason) => guard.trigger(reason))
    /** Failed preparation remains owned until its cleanup settles or the grace deadline exits. */
    const preparing = this.#prepareChild(ingress, guard)
    /** Shutdown joins either outcome without introducing another rejection owner. */
    const accepting = preparing.then(
      () => undefined,
      () => undefined
    )
    this.#state.accepting.add(accepting)
    void accepting.then(() => this.#state.accepting.delete(accepting))
    return preparing
  }
  /**
   * Establish and publish one child session, retaining its original rollback and resource order.
   * Preparation and rollback form one acquisition transaction; local candidates stay together so
   * their ownership transfers and release order remain explicit.
   */
  #prepareChild = async (
    ingress: IProcessServeChildIngress,
    guard: ReturnType<typeof createParentLossGuard>
  ): Promise<IProcessSessionsHandle> => {
    /** The acquired carrier is observed before handshake or service preparation can suspend. */
    let raw: IProcessByteChannel | IProcessMessageChannel | undefined
    /** Ownership transfers only after pending.accept fulfills. */
    let channel: IRemoteChannel | undefined
    /** A failed child startup must return the one physical connection lease. */
    let lease: IProcessConnectionLease | undefined
    /** A failed child setup removes its own frame observer. */
    let closeAdmission: (() => void) | undefined
    let candidateEndpoint: IRemoteServeEndpoint | undefined
    /** A returned child service is rolled back if readiness fails before publication. */
    let candidateService: IProcessSessionServiceHandle | undefined
    try {
      lease = this.#state.manager.claimConnection()
      const sessionInfo = Object.freeze({ connectionId: defaultRpcId(), sessionId: defaultRpcId() })
      const opened = await ingress.openRaw(this.#state.controller.signal)
      raw = 'raw' in opened ? opened.raw : opened
      this.#state.removeParentClose = raw.onClose((reason) => guard.trigger(reason))
      if (ingress.channelKind === ProcessPluginChannelKind.byte) {
        if (!('raw' in opened) || !('bootstrap' in opened)) {
          raw = opened
          invalidOption('ingress.bootstrap')
        }
        raw = opened.raw
        if (typeof ingress.createVerifier !== 'function') invalidOption('ingress.createVerifier')
        const verify = ingress.createVerifier(opened.bootstrap)
        if (typeof verify !== 'function') invalidOption('ingress.createVerifier')
        channel = await ingress.establish(raw, {
          signal: this.#state.controller.signal,
          role: 'responder',
          session: sessionInfo,
          scheduler: this.#state.scheduler,
          verify
        })
      } else {
        if ('raw' in opened) {
          raw = opened.raw
          invalidOption('ingress.channelKind')
        }
        raw = opened
        channel = await ingress.establish(raw, {
          signal: this.#state.controller.signal,
          role: 'responder',
          session: sessionInfo,
          scheduler: this.#state.scheduler
        })
      }
      const identity: IProcessSessionIdentity = Object.freeze({
        ...sessionInfo,
        principalId: sessionInfo.connectionId
      })
      await this.#state.fallback?.ready()
      if (this.#state.controller.signal.aborted || this.#state.closePromise !== undefined)
        throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
          source: RPC_PROCESS_ERROR_SOURCE,
          code: RpcProcessErrorCode.channelClosed
        })
      const fallbackVersion = this.#state.fallback?.version
      const sessionOptions = this.#state.borrowedManager
        ? this.#state.manager.connectionOptions(channel, identity)
        : this.#state.resilience.sessionOptions(identity)
      const drain = createRemoteBindingDrain(
        channel.scheduler,
        (error) => reportSafely(this.#state.report, error),
        this.#state.manager.options.drainMs
      )
      /** Child ingress uses the same bounded admission path as listener sessions. */
      let publishedSession: IProcessServeSession | undefined
      const admission = createProcessProviderAdmission(
        channel,
        this.#state.manager.options,
        channel.scheduler,
        () => publishedSession?.close() ?? Promise.resolve(),
        (error) => reportSafely(this.#state.report, error)
      )
      closeAdmission = admission.close

      /** Child sessions use the same original policy-before-endpoint ordering. */
      const limits = admission.limits(
        sessionOptions.limits,
        this.#state.publication?.providerLimits
      )
      /** Actual Core resource assembly preserves Host and authenticated scope provenance. */
      const runtimeSession = this.#state.runtime?.session(
        channel,
        this.#state.controller.signal,
        this.#state.manager.coreScope,
        limits,
        this.#state.borrowedManager ? undefined : sessionOptions.idempotency
      )
      /** Preserve the original endpoint callback receiver when no held runtime prepares it. */
      const endpointFactory = this.#state.endpointFactory
      const builtEndpoint = (candidateEndpoint = runtimeSession
        ? await runtimeSession.prepare()
        : await endpointFactory!(
            channel,
            this.#state.controller.signal,
            { identity, ...sessionOptions, limits },
            this.#state.manager
          ))
      validateServiceEndpoint(channel, builtEndpoint)
      const endpoint: IRemoteServeEndpoint = runtimeSession
        ? runtimeSession.attach(drain, admission.core)
        : admission.wrap(drain.wrap(channel, builtEndpoint))
      if (this.#state.controller.signal.aborted || this.#state.closePromise !== undefined) {
        candidateEndpoint = undefined
        try {
          await endpoint.endpoint.dispose()
        } catch (cleanupError) {
          reportSafely(this.#state.report, cleanupError)
        }
        throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
          source: RPC_PROCESS_ERROR_SOURCE,
          code: RpcProcessErrorCode.channelClosed
        })
      }
      candidateEndpoint = undefined
      const service = (candidateService = await (0, this.#state.onReadySession)({
        channel,
        endpoint,
        identity,
        signal: this.#state.controller.signal,
        ...(runtimeSession ? { runtime: runtimeSession } : {})
      }))
      ;(channel as IRuntimePeerSourceResult).activateReceive?.()
      if (this.#state.controller.signal.aborted || this.#state.closePromise !== undefined)
        throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
          source: RPC_PROCESS_ERROR_SOURCE,
          code: RpcProcessErrorCode.channelClosed
        })
      await this.#state.fallback?.ready()
      if (this.#state.controller.signal.aborted || this.#state.closePromise !== undefined)
        throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
          source: RPC_PROCESS_ERROR_SOURCE,
          code: RpcProcessErrorCode.channelClosed
        })
      if (this.#state.fallback?.version !== fallbackVersion)
        throw attachErrorIdentity(new Error(RpcProcessErrorText.channelClosed), {
          source: RPC_PROCESS_ERROR_SOURCE,
          code: RpcProcessErrorCode.channelClosed
        })
      publishedSession = createSession(
        channel,
        service,
        this.#state.sessions,
        this.#state.report,
        drain,
        lease,
        admission.close,
        identity,
        this.#state.fallback,
        this.#state.publication
      )
      candidateService = undefined
      lease = undefined
      closeAdmission = undefined
      return Object.freeze({
        close: this.#close,
        closed: () => this.#state.closePromise !== undefined,
        services: this.#services,
        current: this.#current
      })
    } catch (error) {
      closeAdmission?.()
      if (candidateService) {
        try {
          await candidateService.close()
        } catch (cleanupError) {
          reportSafely(this.#state.report, cleanupError)
        }
      }
      if (candidateEndpoint) {
        try {
          await candidateEndpoint.endpoint.dispose()
        } catch (cleanupError) {
          reportSafely(this.#state.report, cleanupError)
        }
      }
      lease?.release()
      try {
        await channel?.close()
        if (!channel) await raw?.close()
      } catch (cleanupError) {
        reportSafely(this.#state.report, cleanupError)
      }
      try {
        await this.#state.fallback?.close()
      } catch (cleanupError) {
        reportSafely(this.#state.report, cleanupError)
      }
      guard.trigger(error)
      throw error
    }
  }
}

/** Own one native accept or parent-loss loop and return its original service operations. */
export async function serveProcessSessions(
  ingress: IProcessServeChildIngress | IProcessServeListenerIngress,
  endpointFactory: IProcessSessionEndpointFactory | undefined,
  onReadySession: (session: IProcessReadySession) => Promise<IProcessSessionServiceHandle>,
  resilience: IProcessResilience,
  report: (error: unknown) => void,
  fallback?: IProcessInstanceFallback,
  scheduler: IScheduler = ingress.kind === 'listener'
    ? (ingress.scheduler ?? systemScheduler)
    : systemScheduler,
  publication?: IProcessRuntimeSessionPublication,
  runtime?: IAdapterListenerPreparation,
  adopt?: IAdapterDeploymentAccept
): Promise<IProcessSessionsHandle> {
  return new ProcessSessionOwner(
    ingress,
    endpointFactory,
    onReadySession,
    resilience,
    report,
    fallback,
    scheduler,
    publication,
    runtime,
    adopt
  ).open()
}
