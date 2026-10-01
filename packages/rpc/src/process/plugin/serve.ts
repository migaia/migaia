import { createParentLossGuard } from '@migaia/supervision/process'
import { attachErrorIdentity } from '@migaia/utils/error'
import { systemScheduler } from '@migaia/utils/scheduler'
import { ERROR_SOURCE, RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
import { RpcProcessErrorText } from '../error-text.js'
import { serveRemotePlugin, type IRemoteServePluginHandle } from '../../remote/serve-plugin.js'
import { normalizeRemoteContract } from '../../remote/contract.js'
import type { IRemoteChannel, IRemoteServeEndpoint } from '../../remote/types.js'
import type { IProcessByteChannel, IProcessByteListener, IProcessMessageChannel } from '../types.js'
import { defaultRpcId } from '../../core/internal/id.js'
import { createProcessBindingDrain, type IProcessBindingDrain } from '../resilience/drain.js'
import { createProcessSessionManager, type IProcessConnectionLease } from '../resilience/session.js'
import { createProcessProviderAdmission } from '../resilience/provider-admission.js'
import {
  createProcessInstanceFallback,
  type IProcessInstanceFallback
} from '../resilience/fallback.js'
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
  close(): Promise<void>
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
  drain: IProcessBindingDrain,
  lease: IProcessConnectionLease,
  closeAdmission: () => void,
  identity: IProcessSessionIdentity,
  fallback: IProcessInstanceFallback,
  closeHost?: () => Promise<void>
): IProcessServeSession {
  /** Repeated EOF, listener close, and explicit close share one cleanup outcome. */
  let closePromise: Promise<void> | undefined
  /** A live transport error denotes terminal connection loss for this session. */
  let unsubscribe: (() => void) | undefined
  /** The fault owner retains only sessions that still own a live endpoint. */
  let unregisterFallback: (() => void) | undefined
  const session: IProcessServeSession = {
    channel,
    service,
    close: () =>
      (closePromise ??= (async () => {
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
        if (closeHost) {
          try {
            await closeHost()
          } catch (error) {
            errors.push(error)
          }
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
  unregisterFallback = fallback.add({ connectionId: identity.connectionId, close: session.close })
  return session
}

/** A late ready service belongs to the closing ingress and cannot outlive its handle. */
async function rejectLateService(
  service: IRemoteServePluginHandle,
  report: (error: unknown) => void
): Promise<never> {
  try {
    await service.close()
  } catch (error) {
    reportSafely(report, error)
  }
  throw createProcessError(RpcProcessErrorCode.channelClosed)
}

/** Serve either a child channel or an authenticated listener without duplicating remote methods. */
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
  if (options.ingress.kind === 'listener' && typeof options.ingress.verify !== 'function')
    invalidOption('ingress.verify')
  if (
    options.ingress.kind === 'child' &&
    (!options.ingress.parentLoss || typeof options.ingress.parentLoss.exit !== 'function')
  )
    invalidOption('ingress.parentLoss.exit')
  /** A default owner bounds physical sessions even before registration policy is attached. */
  const manager = createProcessSessionManager({
    scheduler:
      options.ingress.kind === 'listener'
        ? (options.ingress.scheduler ?? systemScheduler)
        : systemScheduler,
    report: options.report
  })
  /** Explicit instance events, never ordinary call failures, trigger target replacement. */
  const fallback = createProcessInstanceFallback({
    mode,
    targetName: contract.plugin,
    host: options.host,
    createSharedTarget: options.createSharedTarget,
    onInstanceUnhealthy: options.onInstanceUnhealthy,
    report: (error) => reportSafely(options.report, error)
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
  const close = (): Promise<void> =>
    (closePromise ??= (async () => {
      controller.abort()
      const fallbackClose = fallback.close()
      removeParentClose?.()
      removeProbe?.()
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
      manager.close()
      await fallbackClose
      if (errors.length > 0) throw cleanupFailure(errors)
    })())

  if (options.ingress.kind === 'listener') {
    const ingress = options.ingress
    try {
      listener = await ingress.listen({
        address: ingress.address,
        signal: controller.signal,
        auth: { mode: 'required', verify: ingress.verify },
        report: options.report,
        onConnection(pending) {
          /** The listener may invoke callbacks without awaiting their Promise. */
          const acceptingOne = (async () => {
            /** Ownership transfers only after pending.accept fulfills. */
            let channel: IRemoteChannel | undefined
            /** A failed candidate returns its physical capacity before reporting the error. */
            let lease: IProcessConnectionLease | undefined
            /** A per-connection Host remains owned by this candidate until session publication. */
            let closeSessionHost: (() => Promise<void>) | undefined
            /** The frame observer is removed on either candidate rollback or session close. */
            let closeAdmission: (() => void) | undefined
            try {
              if (controller.signal.aborted) {
                await pending.close()
                return
              }
              lease = manager.claimConnection()
              const context = ingress.createConnectionContext(pending)
              const accepted = await pending.accept({
                offer: ingress.offer,
                peerId: context.peerId,
                ipc: context.ipc,
                scheduler: ingress.scheduler,
                signal: controller.signal,
                report: options.report
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
              await fallback.ready()
              const fallbackVersion = fallback.version
              const sessionOptions =
                options.resilience?.sessionOptions(identity) ?? manager.sessionOptions(identity)
              const drain = createProcessBindingDrain(
                channel.scheduler,
                (error) => reportSafely(options.report, error),
                manager.options.drainMs
              )
              const builtEndpoint = await options.endpointFactory(channel, controller.signal, {
                identity,
                ...sessionOptions
              })
              /** A policy violation closes only this accepted connection. */
              let publishedSession: IProcessServeSession | undefined
              const admission = createProcessProviderAdmission(
                channel,
                manager.options,
                channel.scheduler,
                () => publishedSession?.close() ?? Promise.resolve(),
                (error) => reportSafely(options.report, error)
              )
              closeAdmission = admission.close
              const endpoint = admission.wrap(drain.wrap(channel, builtEndpoint))
              if (controller.signal.aborted) {
                try {
                  await endpoint.endpoint.dispose()
                } catch (cleanupError) {
                  reportSafely(options.report, cleanupError)
                }
                throw createProcessError(RpcProcessErrorCode.channelClosed)
              }
              let targetHost = options.host
              if (mode === 'per-connection') {
                const sessionHost = await options.createSessionHost!(identity)
                targetHost = sessionHost
                closeSessionHost = async () => {
                  await sessionHost.dispose()
                }
              }
              const service = await serveRemotePlugin({
                host: targetHost,
                contract,
                endpoint,
                report: options.report,
                invocationContext: (rpcContext) =>
                  Object.freeze({ session: identity, signal: rpcContext.signal })
              })
              if (controller.signal.aborted) await rejectLateService(service, options.report)
              await fallback.ready()
              if (controller.signal.aborted) await rejectLateService(service, options.report)
              if (fallback.version !== fallbackVersion)
                await rejectLateService(service, options.report)
              publishedSession = createSession(
                channel,
                service,
                sessions,
                options.report,
                drain,
                lease,
                admission.close,
                identity,
                fallback,
                closeSessionHost
              )
              lease = undefined
              closeSessionHost = undefined
              closeAdmission = undefined
            } catch (error) {
              closeAdmission?.()
              lease?.release()
              try {
                await closeSessionHost?.()
              } catch (cleanupError) {
                reportSafely(options.report, cleanupError)
              }
              if (!channel) {
                try {
                  await pending.close()
                } catch (cleanupError) {
                  reportSafely(options.report, cleanupError)
                }
              }
              try {
                await channel?.close()
              } catch (cleanupError) {
                reportSafely(options.report, cleanupError)
              }
              reportSafely(options.report, error)
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
    } catch (error) {
      manager.close()
      try {
        await fallback.close()
      } catch (cleanupError) {
        reportSafely(options.report, cleanupError)
      }
      throw error
    }
    return Object.freeze({ close, inspectRecovery: () => fallback.inspect() })
  }

  const ingress: IProcessServeChildIngress = options.ingress
  const guard = createParentLossGuard({
    shutdown: () => close(),
    exit: ingress.parentLoss.exit,
    graceMs: ingress.parentLoss.graceMs,
    report: options.report
  })
  removeProbe = ingress.parentLoss.probe?.((reason) => guard.trigger(reason))
  let raw: IProcessByteChannel | IProcessMessageChannel | undefined
  let channel: IRemoteChannel | undefined
  /** A failed child startup must return the one physical connection lease. */
  let lease: IProcessConnectionLease | undefined
  /** Per-connection Hosts created before publication are rolled back on failure. */
  let closeSessionHost: (() => Promise<void>) | undefined
  /** A failed child setup removes its own frame observer. */
  let closeAdmission: (() => void) | undefined
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
        scheduler: systemScheduler,
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
        scheduler: systemScheduler
      })
    }
    const identity: IProcessSessionIdentity = Object.freeze({
      ...sessionInfo,
      principalId: sessionInfo.connectionId
    })
    await fallback.ready()
    const fallbackVersion = fallback.version
    const sessionOptions =
      options.resilience?.sessionOptions(identity) ?? manager.sessionOptions(identity)
    const drain = createProcessBindingDrain(
      channel.scheduler,
      (error) => reportSafely(options.report, error),
      manager.options.drainMs
    )
    const builtEndpoint = await options.endpointFactory(channel, controller.signal, {
      identity,
      ...sessionOptions
    })
    /** Child ingress uses the same bounded admission path as listener sessions. */
    let publishedSession: IProcessServeSession | undefined
    const admission = createProcessProviderAdmission(
      channel,
      manager.options,
      channel.scheduler,
      () => publishedSession?.close() ?? Promise.resolve(),
      (error) => reportSafely(options.report, error)
    )
    closeAdmission = admission.close
    const endpoint: IRemoteServeEndpoint = admission.wrap(drain.wrap(channel, builtEndpoint))
    if (controller.signal.aborted) {
      try {
        await endpoint.endpoint.dispose()
      } catch (cleanupError) {
        reportSafely(options.report, cleanupError)
      }
      throw createProcessError(RpcProcessErrorCode.channelClosed)
    }
    let targetHost = options.host
    if (mode === 'per-connection') {
      const sessionHost = await options.createSessionHost!(identity)
      targetHost = sessionHost
      closeSessionHost = async () => {
        await sessionHost.dispose()
      }
    }
    const service = await serveRemotePlugin({
      host: targetHost,
      contract,
      endpoint,
      report: options.report,
      invocationContext: (rpcContext) =>
        Object.freeze({ session: identity, signal: rpcContext.signal })
    })
    if (controller.signal.aborted) await rejectLateService(service, options.report)
    await fallback.ready()
    if (controller.signal.aborted) await rejectLateService(service, options.report)
    if (fallback.version !== fallbackVersion) await rejectLateService(service, options.report)
    publishedSession = createSession(
      channel,
      service,
      sessions,
      options.report,
      drain,
      lease,
      admission.close,
      identity,
      fallback,
      closeSessionHost
    )
    lease = undefined
    closeSessionHost = undefined
    closeAdmission = undefined
    removeParentClose = raw.onClose((reason) => guard.trigger(reason))
    return Object.freeze({ close, inspectRecovery: () => fallback.inspect() })
  } catch (error) {
    closeAdmission?.()
    lease?.release()
    try {
      await closeSessionHost?.()
    } catch (cleanupError) {
      reportSafely(options.report, cleanupError)
    }
    try {
      await channel?.close()
      if (!channel) await raw?.close()
    } catch (cleanupError) {
      reportSafely(options.report, cleanupError)
    }
    try {
      await fallback.close()
    } catch (cleanupError) {
      reportSafely(options.report, cleanupError)
    }
    guard.trigger(error)
    throw error
  }
}
