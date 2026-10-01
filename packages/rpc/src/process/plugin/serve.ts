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
  report: (error: unknown) => void
): IProcessServeSession {
  /** Repeated EOF, listener close, and explicit close share one cleanup outcome. */
  let closePromise: Promise<void> | undefined
  /** A live transport error denotes terminal connection loss for this session. */
  let unsubscribe: (() => void) | undefined
  const session: IProcessServeSession = {
    channel,
    service,
    close: () =>
      (closePromise ??= (async () => {
        unsubscribe?.()
        const errors: unknown[] = []
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
        sessions.delete(session)
        if (errors.length > 0) throw cleanupFailure(errors)
      })())
  }
  sessions.add(session)
  unsubscribe = channel.transport.onTransportError?.(() => {
    void session.close().catch((error: unknown) => reportSafely(report, error))
  })
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
  const contract = normalizeRemoteContract(options.contract)
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
      if (errors.length > 0) throw cleanupFailure(errors)
    })())

  if (options.ingress.kind === 'listener') {
    const ingress = options.ingress
    if (typeof ingress.verify !== 'function') invalidOption('ingress.verify')
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
          try {
            if (controller.signal.aborted) {
              await pending.close()
              return
            }
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
            const endpoint = await options.endpointFactory(channel, controller.signal)
            if (controller.signal.aborted) {
              try {
                await endpoint.endpoint.dispose()
              } catch (cleanupError) {
                reportSafely(options.report, cleanupError)
              }
              throw createProcessError(RpcProcessErrorCode.channelClosed)
            }
            const service = await serveRemotePlugin({
              host: options.host,
              contract,
              endpoint,
              report: options.report
            })
            if (controller.signal.aborted) await rejectLateService(service, options.report)
            createSession(channel, service, sessions, options.report)
          } catch (error) {
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
    return Object.freeze({ close })
  }

  const ingress: IProcessServeChildIngress = options.ingress
  if (!ingress.parentLoss || typeof ingress.parentLoss.exit !== 'function')
    invalidOption('ingress.parentLoss.exit')
  const guard = createParentLossGuard({
    shutdown: () => close(),
    exit: ingress.parentLoss.exit,
    graceMs: ingress.parentLoss.graceMs,
    report: options.report
  })
  removeProbe = ingress.parentLoss.probe?.((reason) => guard.trigger(reason))
  let raw: IProcessByteChannel | IProcessMessageChannel | undefined
  let channel: IRemoteChannel | undefined
  try {
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
        session: { connectionId: defaultRpcId(), sessionId: defaultRpcId() },
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
        session: { connectionId: defaultRpcId(), sessionId: defaultRpcId() },
        scheduler: systemScheduler
      })
    }
    const endpoint: IRemoteServeEndpoint = await options.endpointFactory(channel, controller.signal)
    if (controller.signal.aborted) {
      try {
        await endpoint.endpoint.dispose()
      } catch (cleanupError) {
        reportSafely(options.report, cleanupError)
      }
      throw createProcessError(RpcProcessErrorCode.channelClosed)
    }
    const service = await serveRemotePlugin({
      host: options.host,
      contract,
      endpoint,
      report: options.report
    })
    if (controller.signal.aborted) await rejectLateService(service, options.report)
    createSession(channel, service, sessions, options.report)
    removeParentClose = raw.onClose((reason) => guard.trigger(reason))
    return Object.freeze({ close })
  } catch (error) {
    try {
      await channel?.close()
      if (!channel) await raw?.close()
    } catch (cleanupError) {
      reportSafely(options.report, cleanupError)
    }
    guard.trigger(error)
    throw error
  }
}
