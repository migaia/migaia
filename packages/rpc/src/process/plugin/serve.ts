import { createParentLossGuard } from '@migaia/supervision/process'
import { attachErrorIdentity } from '@migaia/utils/error'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { ERROR_SOURCE, RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
import { RpcProcessErrorText } from '../error-text.js'
import { serveRemotePlugin, type IRemoteServePluginHandle } from '../../remote/serve-plugin.js'
import type { IRuntimePeerSourceResult } from '../../remote/runtime-api/peer.js'
import { normalizeRemoteContract } from '../../remote/contract.js'
import type { IRemoteChannel, IRemoteServeEndpoint } from '../../remote/types.js'
import type { IProcessByteChannel, IProcessByteListener, IProcessMessageChannel } from '../types.js'
import { defaultRpcId } from '../../core/internal/id.js'
import {
  createRemoteBindingDrain,
  type IRemoteBindingDrain
} from '../../remote/internal/binding-drain.js'
import {
  createProcessSessionManager,
  type IProcessConnectionLease,
  type IProcessSessionManager
} from '../resilience/session.js'
import { createProcessProviderAdmission } from '../resilience/provider-admission.js'
import {
  createProcessInstanceFallback,
  type IProcessInstanceFallback
} from '../resilience/fallback.js'
import { createProcessResilience, processSessionManager } from '../resilience/index.js'
import type { IProcessResilience } from '../resilience/types.js'
import { RpcCapability } from '../../contract/wire-constants.js'
import type { IProcessServeListenerIngress, IProcessServeEndpointFactory } from './types.js'
import type { IAbortSignal } from '@migaia/lifecycle'
import type { IRpcProviderLimits } from '../../core/typing.js'
import { resolveAbortReason } from '../../core/internal/async-control.js'
import type { IProcessSessionIdentity } from '../resilience/types.js'
import { invalidOption, reportSafely } from './binding.js'
import { ProcessPluginChannelKind } from './constants.js'
import type {
  IProcessPluginServeHandle,
  IProcessServeChildIngress,
  IProcessServePluginOptions
} from './types.js'

/** A ready session is independently owned by its remote service registration and channel. */
type IProcessServeSession = Readonly<{
  channel: IRemoteChannel
  service: IRemoteServePluginHandle
  /** Read the original close Promise rather than copying a ready/closing state. */
  active(): boolean
  close(): Promise<void>
}>

/** Runtime publication follows the same authenticated candidate, commit and shutdown ownership. */
type IProcessRuntimeSessionPublication = Readonly<{
  signal?: IAbortSignal
  initialSignal?: IAbortSignal
  own?(close: () => Promise<void>): void
  publish?(service: IRemoteServePluginHandle): () => void
  /** Original close retains owned governor cleanup failures alongside session cleanup failures. */
  release?(): Promise<void>
  /** The selected core policy is merged by the original connection admission owner. */
  providerLimits?: IRpcProviderLimits
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
  services(): readonly IRemoteServePluginHandle[]
  current(): IRemoteServePluginHandle | null | undefined
}>

/** Preserves every cleanup failure under one registered process code. */
function cleanupFailure(errors: readonly unknown[]): AggregateError {
  return attachErrorIdentity(new AggregateError(errors, RpcProcessErrorText.channelClosed), {
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.channelClosed
  })
}

/** Close one service before its physical channel, retaining both cleanup failures. */
function createSession(
  channel: IRemoteChannel,
  service: IRemoteServePluginHandle,
  sessions: Set<IProcessServeSession>,
  report: (error: unknown) => void,
  drain: IRemoteBindingDrain,
  lease: IProcessConnectionLease,
  closeAdmission: () => void,
  identity: IProcessSessionIdentity,
  fallback?: IProcessInstanceFallback,
  publication?: IProcessRuntimeSessionPublication
): IProcessServeSession {
  /** Repeated EOF, listener close, and explicit close share one cleanup outcome. */
  let closePromise: Promise<void> | undefined
  /** A live transport error denotes terminal connection loss for this session. */
  let unsubscribe: (() => void) | undefined
  /** The fault owner retains only sessions that still own a live endpoint. */
  let unregisterFallback: (() => void) | undefined
  /** Only this committed session may withdraw its ready contribution. */
  let withdraw: (() => void) | undefined
  const session: IProcessServeSession = {
    channel,
    service,
    active: () => closePromise === undefined,
    close: () =>
      (closePromise ??= (async () => {
        withdraw?.()
        unsubscribe?.()
        closeAdmission()
        const errors: unknown[] = []
        await drain.drainCurrent()
        try {
          await service.close()
        } catch (error) {
          errors.push(error)
        }
        try {
          await channel.close()
        } catch (error) {
          errors.push(error)
        }
        lease.release()
        sessions.delete(session)
        unregisterFallback?.()
        if (errors.length > 0) throw cleanupFailure(errors)
      })())
  }
  sessions.add(session)
  unsubscribe = channel.transport.onTransportError?.(() => {
    void session.close().catch((error: unknown) => reportSafely(report, error))
  })
  unregisterFallback = fallback?.add({ connectionId: identity.connectionId, close: session.close })
  try {
    withdraw = publication?.publish?.(service)
  } catch (error) {
    reportSafely(report, error)
    void session.close().catch((cleanup: unknown) => reportSafely(report, cleanup))
  }
  return session
}

/** Invoking the service callback transfers endpoint ownership, including failed-startup rollback. */
export type IProcessReadySession = Readonly<{
  channel: IRemoteChannel
  endpoint: IRemoteServeEndpoint
  identity: IProcessSessionIdentity
  signal: IAbortSignal
}>

/** Native service endpoints must support the control capability their peer will probe. */
function validateServiceEndpoint(channel: IRemoteChannel, endpoint: IRemoteServeEndpoint): void {
  if (
    channel.agreement.capabilities.includes(RpcCapability.ping) &&
    typeof endpoint.endpoint.ping !== 'function'
  )
    throw createProcessError(RpcProcessErrorCode.resilienceInvalidOption, undefined, {
      field: 'endpointFactory'
    })
}

/** Own one accept/parent-loss loop for Plugin and Host services, with canonical session quotas. */
export async function serveProcessSessions(
  ingress: IProcessServeChildIngress | IProcessServeListenerIngress,
  endpointFactory: IProcessSessionEndpointFactory,
  onReadySession: (session: IProcessReadySession) => Promise<IRemoteServePluginHandle>,
  resilience: IProcessResilience,
  report: (error: unknown) => void,
  fallback?: IProcessInstanceFallback,
  scheduler: IScheduler = ingress.kind === 'listener'
    ? (ingress.scheduler ?? systemScheduler)
    : systemScheduler,
  publication?: IProcessRuntimeSessionPublication
): Promise<IProcessSessionsHandle> {
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
  const controller = new AbortController()
  /** A service owns only sessions accepted through this invocation. */
  const sessions = new Set<IProcessServeSession>()
  /** Pending accepts must settle before close snapshots the accepted sessions. */
  const accepting = new Set<Promise<void>>()
  /** The listener is separate from accepted channels and closes first. */
  let listener: IProcessByteListener | undefined
  /** Child EOF is observed through the one supervision-owned parent-loss guard. */
  let removeParentClose: (() => void) | undefined
  /** The optional parent probe is owned by this serve handle. */
  let removeProbe: (() => void) | undefined
  /** Explicit close returns the same Promise to all callers. */
  let closePromise: Promise<void> | undefined
  /** The original external lifecycle is detached when this service scope closes. */
  const onAbort = (): void => {
    void close().catch((error: unknown) => reportSafely(report, error))
  }
  const close = (): Promise<void> =>
    (closePromise ??= (async () => {
      /** Detach parent-loss observers before abort synchronously closes this owned channel. */
      removeParentClose?.()
      removeProbe?.()
      publication?.signal?.removeEventListener('abort', onAbort)
      publication?.initialSignal?.removeEventListener('abort', onAbort)
      controller.abort(
        publication?.initialSignal?.aborted
          ? resolveAbortReason(publication.initialSignal)
          : publication?.signal?.aborted
            ? resolveAbortReason(publication.signal)
            : undefined
      )
      const fallbackClose = fallback?.close()
      const errors: unknown[] = []
      try {
        await listener?.close()
      } catch (error) {
        errors.push(error)
      }
      await Promise.allSettled(accepting)
      for (const session of sessions) {
        try {
          await session.close()
        } catch (error) {
          errors.push(error)
        }
      }

      await fallbackClose
      if (!borrowedManager) manager.close()
      try {
        await publication?.release?.()
      } catch (error) {
        errors.push(error)
      }
      if (errors.length > 0) throw cleanupFailure(errors)
    })())

  publication?.own?.(close)
  publication?.signal?.addEventListener('abort', onAbort, { once: true })
  publication?.initialSignal?.addEventListener('abort', onAbort, { once: true })
  if (publication?.signal?.aborted || publication?.initialSignal?.aborted) onAbort()
  /**
   * Actual active sessions alone are projected; closing resource records remain owned until
   * settled.
   */
  const services = (): readonly IRemoteServePluginHandle[] =>
    [...sessions].filter((session) => session.active()).map((session) => session.service)
  /** One implicit Peer target is safe only when this original owner has one active session. */
  const current = (): IRemoteServePluginHandle | null | undefined => {
    /** No second index or availability flag is maintained for this private selection. */
    let selected: IRemoteServePluginHandle | undefined
    for (const session of sessions) {
      if (!session.active()) continue
      if (selected) return null
      selected = session.service
    }
    return selected
  }

  if (ingress.kind === 'listener') {
    const listenerIngress = ingress
    try {
      listener = await listenerIngress.listen({
        address: listenerIngress.address,
        signal: controller.signal,
        auth: { mode: 'required', verify: listenerIngress.verify },
        report: report,
        onConnection(pending) {
          /** The listener may invoke callbacks without awaiting their Promise. */
          const acceptingOne = (async () => {
            /** Ownership transfers only after pending.accept fulfills. */
            let channel: IRemoteChannel | undefined
            /** A failed candidate returns its physical capacity before reporting the error. */
            let lease: IProcessConnectionLease | undefined
            /** The frame observer is removed on either candidate rollback or session close. */
            let closeAdmission: (() => void) | undefined
            let candidateEndpoint: IRemoteServeEndpoint | undefined
            /** A returned service remains a candidate until recovery and cancellation checks pass. */
            let candidateService: IRemoteServePluginHandle | undefined
            try {
              if (controller.signal.aborted) {
                await pending.close()
                return
              }
              lease = manager.claimConnection()
              const context = listenerIngress.createConnectionContext(pending)
              const accepted = await pending.accept({
                offer: listenerIngress.offer,
                peerId: context.peerId,
                ipc: context.ipc,
                scheduler: listenerIngress.scheduler,
                signal: controller.signal,
                report: report
              })
              channel = accepted.channel
              if (controller.signal.aborted)
                throw createProcessError(RpcProcessErrorCode.channelClosed)
              const identity: IProcessSessionIdentity = Object.freeze({
                connectionId: context.ipc.connectionId,
                sessionId: context.ipc.sessionId,
                principalId: accepted.principalId,
                ...(context.ipc.processId ? { processId: context.ipc.processId } : {})
              })
              await fallback?.ready()
              const fallbackVersion = fallback?.version
              const sessionOptions = resilience.sessionOptions(identity)
              const drain = createRemoteBindingDrain(
                channel.scheduler,
                (error) => reportSafely(report, error),
                manager.options.drainMs
              )
              /** A policy violation closes only this accepted connection. */
              let publishedSession: IProcessServeSession | undefined
              const admission = createProcessProviderAdmission(
                channel,
                manager.options,
                channel.scheduler,
                () => publishedSession?.close() ?? Promise.resolve(),
                (error) => reportSafely(report, error)
              )
              closeAdmission = admission.close
              const builtEndpoint = (candidateEndpoint = await endpointFactory(
                channel,
                controller.signal,
                {
                  identity,
                  ...sessionOptions,
                  limits: admission.limits(sessionOptions.limits, publication?.providerLimits)
                },
                manager
              ))
              validateServiceEndpoint(channel, builtEndpoint)
              const endpoint = admission.wrap(drain.wrap(channel, builtEndpoint))
              if (controller.signal.aborted) {
                candidateEndpoint = undefined
                try {
                  await endpoint.endpoint.dispose()
                } catch (cleanupError) {
                  reportSafely(report, cleanupError)
                }
                throw createProcessError(RpcProcessErrorCode.channelClosed)
              }
              candidateEndpoint = undefined
              const service = (candidateService = await onReadySession({
                channel,
                endpoint,
                identity,
                signal: controller.signal
              }))
              ;(channel as IRuntimePeerSourceResult).activateReceive?.()
              if (controller.signal.aborted)
                throw createProcessError(RpcProcessErrorCode.channelClosed)
              await fallback?.ready()
              if (controller.signal.aborted)
                throw createProcessError(RpcProcessErrorCode.channelClosed)
              if (fallback?.version !== fallbackVersion)
                throw createProcessError(RpcProcessErrorCode.channelClosed)
              publishedSession = createSession(
                channel,
                service,
                sessions,
                report,
                drain,
                lease,
                admission.close,
                identity,
                fallback,
                publication
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
                  reportSafely(report, cleanupError)
                }
              }
              if (candidateEndpoint) {
                try {
                  await candidateEndpoint.endpoint.dispose()
                } catch (cleanupError) {
                  reportSafely(report, cleanupError)
                }
              }
              lease?.release()
              if (!channel) {
                try {
                  await pending.close()
                } catch (cleanupError) {
                  reportSafely(report, cleanupError)
                }
              }
              try {
                await channel?.close()
              } catch (cleanupError) {
                reportSafely(report, cleanupError)
              }
              reportSafely(report, error)
            }
          })()
          accepting.add(acceptingOne)
          void acceptingOne.then(
            () => accepting.delete(acceptingOne),
            () => accepting.delete(acceptingOne)
          )
          return acceptingOne
        }
      })
      publication?.initialSignal?.removeEventListener('abort', onAbort)
      if (controller.signal.aborted) {
        await listener.close()
        throw createProcessError(
          RpcProcessErrorCode.channelClosed,
          resolveAbortReason(controller.signal)
        )
      }
    } catch (error) {
      try {
        await fallback?.close()
      } catch (cleanupError) {
        reportSafely(report, cleanupError)
      }
      throw error
    }
    return Object.freeze({ close, closed: () => closePromise !== undefined, services, current })
  }

  const guard = createParentLossGuard({
    shutdown: () => close(),
    exit: ingress.parentLoss.exit,
    graceMs: ingress.parentLoss.graceMs,
    /** The session owner supplies the same clock for shutdown and its original grace deadline. */
    scheduler,
    report: report
  })
  removeProbe = ingress.parentLoss.probe?.((reason) => guard.trigger(reason))
  let raw: IProcessByteChannel | IProcessMessageChannel | undefined
  let channel: IRemoteChannel | undefined
  /** A failed child startup must return the one physical connection lease. */
  let lease: IProcessConnectionLease | undefined
  /** A failed child setup removes its own frame observer. */
  let closeAdmission: (() => void) | undefined
  let candidateEndpoint: IRemoteServeEndpoint | undefined
  /** A returned child service is rolled back if readiness fails before publication. */
  let candidateService: IRemoteServePluginHandle | undefined
  try {
    lease = manager.claimConnection()
    const sessionInfo = Object.freeze({ connectionId: defaultRpcId(), sessionId: defaultRpcId() })
    const opened = await ingress.openRaw(controller.signal)
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
        signal: controller.signal,
        role: 'responder',
        session: sessionInfo,
        scheduler,
        verify
      })
    } else {
      if ('raw' in opened) {
        raw = opened.raw
        invalidOption('ingress.channelKind')
      }
      raw = opened
      channel = await ingress.establish(raw, {
        signal: controller.signal,
        role: 'responder',
        session: sessionInfo,
        scheduler
      })
    }
    const identity: IProcessSessionIdentity = Object.freeze({
      ...sessionInfo,
      principalId: sessionInfo.connectionId
    })
    await fallback?.ready()
    const fallbackVersion = fallback?.version
    const sessionOptions = resilience.sessionOptions(identity)
    const drain = createRemoteBindingDrain(
      channel.scheduler,
      (error) => reportSafely(report, error),
      manager.options.drainMs
    )
    /** Child ingress uses the same bounded admission path as listener sessions. */
    let publishedSession: IProcessServeSession | undefined
    const admission = createProcessProviderAdmission(
      channel,
      manager.options,
      channel.scheduler,
      () => publishedSession?.close() ?? Promise.resolve(),
      (error) => reportSafely(report, error)
    )
    closeAdmission = admission.close

    const builtEndpoint = (candidateEndpoint = await endpointFactory(
      channel,
      controller.signal,
      {
        identity,
        ...sessionOptions,
        limits: admission.limits(sessionOptions.limits, publication?.providerLimits)
      },
      manager
    ))
    validateServiceEndpoint(channel, builtEndpoint)
    const endpoint: IRemoteServeEndpoint = admission.wrap(drain.wrap(channel, builtEndpoint))
    if (controller.signal.aborted) {
      candidateEndpoint = undefined
      try {
        await endpoint.endpoint.dispose()
      } catch (cleanupError) {
        reportSafely(report, cleanupError)
      }
      throw createProcessError(RpcProcessErrorCode.channelClosed)
    }
    candidateEndpoint = undefined
    const service = (candidateService = await onReadySession({
      channel,
      endpoint,
      identity,
      signal: controller.signal
    }))
    ;(channel as IRuntimePeerSourceResult).activateReceive?.()
    if (controller.signal.aborted) throw createProcessError(RpcProcessErrorCode.channelClosed)
    await fallback?.ready()
    if (controller.signal.aborted) throw createProcessError(RpcProcessErrorCode.channelClosed)
    if (fallback?.version !== fallbackVersion)
      throw createProcessError(RpcProcessErrorCode.channelClosed)
    publishedSession = createSession(
      channel,
      service,
      sessions,
      report,
      drain,
      lease,
      admission.close,
      identity,
      fallback,
      publication
    )
    candidateService = undefined
    lease = undefined
    closeAdmission = undefined
    removeParentClose = raw.onClose((reason) => guard.trigger(reason))
    return Object.freeze({ close, closed: () => closePromise !== undefined, services, current })
  } catch (error) {
    closeAdmission?.()
    if (candidateService) {
      try {
        await candidateService.close()
      } catch (cleanupError) {
        reportSafely(report, cleanupError)
      }
    }
    if (candidateEndpoint) {
      try {
        await candidateEndpoint.endpoint.dispose()
      } catch (cleanupError) {
        reportSafely(report, cleanupError)
      }
    }
    lease?.release()
    try {
      await channel?.close()
      if (!channel) await raw?.close()
    } catch (cleanupError) {
      reportSafely(report, cleanupError)
    }
    try {
      await fallback?.close()
    } catch (cleanupError) {
      reportSafely(report, cleanupError)
    }
    guard.trigger(error)
    throw error
  }
}

/** Add Plugin instance recovery and invocation context to the shared process session owner. */
export async function createServeProcessPlugin(
  options: IProcessServePluginOptions
): Promise<IProcessPluginServeHandle> {
  if (
    !options ||
    !options.ingress ||
    typeof options.report !== 'function' ||
    typeof options.endpointFactory !== 'function'
  )
    invalidOption('serve')
  const mode = options.instanceMode ?? 'shared'
  if (mode === 'per-connection') {
    if (typeof options.createSessionHost !== 'function') invalidOption('createSessionHost')
  } else if (mode === 'shared') {
    if (
      typeof options.createSharedTarget !== 'function' ||
      typeof options.onInstanceUnhealthy !== 'function'
    )
      invalidOption('createSharedTarget/onInstanceUnhealthy')
  } else invalidOption('instanceMode')
  const contract = normalizeRemoteContract(options.contract)
  const resilience =
    options.resilience ??
    createProcessResilience({
      scheduler:
        options.ingress.kind === 'listener'
          ? (options.ingress.scheduler ?? systemScheduler)
          : systemScheduler,
      report: options.report
    })
  const fallback = createProcessInstanceFallback({
    mode,
    targetName: contract.plugin,
    host: options.host,
    createSharedTarget: options.createSharedTarget,
    onInstanceUnhealthy: options.onInstanceUnhealthy,
    report: (error) => reportSafely(options.report, error)
  })
  try {
    const sessions = await serveProcessSessions(
      options.ingress,
      options.endpointFactory,
      async ({ endpoint, identity }) => {
        let targetHost: IProcessServePluginOptions['host'] | undefined
        let closeTarget: (() => Promise<unknown>) | undefined
        let transferred = false
        try {
          if (mode === 'per-connection') {
            const ownedTarget = await options.createSessionHost!(identity)
            targetHost = ownedTarget
            closeTarget = () => ownedTarget.dispose()
          } else targetHost = options.host
          transferred = true
          const service = await serveRemotePlugin({
            host: targetHost,
            contract,
            endpoint,
            report: options.report,
            invocationContext: (context) =>
              Object.freeze({ session: identity, signal: context.signal })
          })
          return {
            close: async () => {
              const errors: unknown[] = []
              try {
                await service.close()
              } catch (error) {
                errors.push(error)
              }
              if (mode === 'per-connection') {
                try {
                  await closeTarget?.()
                } catch (error) {
                  errors.push(error)
                }
              }
              if (errors.length === 1) throw errors[0]
              if (errors.length > 1) throw cleanupFailure(errors)
            }
          }
        } catch (error) {
          if (!transferred) {
            try {
              await endpoint.endpoint.dispose()
            } catch (cleanupError) {
              reportSafely(options.report, cleanupError)
            }
          }
          if (mode === 'per-connection' && targetHost) {
            try {
              await closeTarget?.()
            } catch (cleanupError) {
              reportSafely(options.report, cleanupError)
            }
          }
          throw error
        }
      },
      resilience,
      options.report,
      fallback
    )
    let closing: Promise<void> | undefined
    return Object.freeze({
      inspectRecovery: () => fallback.inspect(),
      close: () =>
        (closing ??= (async () => {
          const errors: unknown[] = []
          try {
            await sessions.close()
          } catch (error) {
            errors.push(error)
          }
          if (!options.resilience) {
            try {
              await resilience.close()
            } catch (error) {
              errors.push(error)
            }
          }
          if (errors.length === 1) throw errors[0]
          if (errors.length > 1) throw cleanupFailure(errors)
        })())
    })
  } catch (error) {
    if (!options.resilience) {
      try {
        await resilience.close()
      } catch (cleanupError) {
        reportSafely(options.report, cleanupError)
      }
    }
    throw error
  }
}
