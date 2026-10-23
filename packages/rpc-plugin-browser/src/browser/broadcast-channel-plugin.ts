import { RpcCapability } from '@migaia/rpc-contract'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { systemScheduler } from '@migaia/utils/scheduler'
import { hostRethrowReporter } from '@migaia/utils/promise'
import {
  createAdapterDeployment,
  createAdapterMessageHandshakeBudget,
  createAdapterSourceConfigurationError,
  createEventTargetMessageResource,
  defineTransportPlugin,
  drainListenerFailures,
  IpcReporterContext
} from '@migaia/rpc-host/plugin'
import type {
  IAdapterDeploymentContext,
  IAdapterDeploymentAccept,
  IAdapterDeploymentAcceptedSession,
  IAdapterMessageResource,
  IRpcTransport,
  IRpcTransportPlugin
} from '@migaia/rpc-host/plugin'
import { RpcCoreErrorCode } from '@migaia/rpc-host'
import { createBroadcastChannelTransport } from './adapters/broadcast-channel.js'
import { projectBrowserPeerPort } from './peer-port.js'
import { createBrowserPeerError } from './peer-error.js'
import { BrowserPeerErrorText } from '../error-text.js'
import { RpcBrowserErrorCode } from '../error-code.js'
import type { IBrowserPluginOptions } from './plugin-types.js'
import { BroadcastChannelControl } from './broadcast-channel-text.js'

/** The caller owns the physical channel; plugin close withdraws only this listener's participation. */
export type IBroadcastChannelPluginOptions = IBrowserPluginOptions &
  Readonly<{ channel: BroadcastChannel }>
/**
 * Necessary discovery addresses select a raw route; they grant no accepted capabilities or provider
 * data.
 */
type IBroadcastFrame = Readonly<{
  protocol: typeof BroadcastChannelControl.protocol
  kind:
    | typeof BroadcastChannelControl.join
    | typeof BroadcastChannelControl.leave
    | typeof BroadcastChannelControl.data
  sender: string
  target?: string
  payload?: unknown
}>
/** A discovered physical route retains only its original resource operation and host accept receipt. */
type IBroadcastSession = {
  resource: IAdapterMessageResource
  opening?: Promise<void>
  accepted?: IAdapterDeploymentAcceptedSession
}
/** All physical participants of this transport kind share the same native ordinary-Host slot family. */
const broadcastFamily = Object.freeze({})

/** Ignore unrelated same-origin application traffic before selecting the exact raw pair. */
function readFrame(value: unknown): IBroadcastFrame | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const frame = value as IBroadcastFrame
  return frame.protocol === BroadcastChannelControl.protocol &&
    (frame.kind === BroadcastChannelControl.join ||
      frame.kind === BroadcastChannelControl.leave ||
      frame.kind === BroadcastChannelControl.data) &&
    typeof frame.sender === 'string' &&
    frame.sender.length > 0 &&
    (frame.target === undefined || typeof frame.target === 'string')
    ? frame
    : undefined
}

/**
 * Listen once on the actual native channel and adopt each discovered route into the shared
 * endpoint.
 */
function listenBroadcast(
  channel: BroadcastChannel,
  context: IAdapterDeploymentContext,
  accept: IAdapterDeploymentAccept
) {
  /** The existing BC adapter alone owns native subscription, clone, probe and I/O error behavior. */
  const transport = createBroadcastChannelTransport(channel)
  /** Only per-participant raw routes live here; accepted directories remain owned by the host. */
  const sessions = new Map<string, IBroadcastSession>()
  /** Explicit closure prevents new discovery and returns the same native cleanup completion. */
  let closing: Promise<void> | undefined
  /** Asynchronous discovery retains reporter failures through the existing global reporter owner. */
  const report = (error: unknown): void => {
    try {
      context.report(error)
    } catch (failure) {
      hostRethrowReporter(failure, IpcReporterContext)
    }
  }
  /** Structured cloning supports native storage but never an ownership transfer list on BC. */
  const capabilities = context.capabilities.filter(
    (capability) => capability !== RpcCapability.transfer
  )
  /** Canonical clone control augments only the local proposal before its actual bilateral ACK. */
  const offer = rpcMessageCapabilityControl.localOffer(capabilities) as Extract<
    ReturnType<typeof rpcMessageCapabilityControl.localOffer>,
    { valid: true }
  >
  /** Discovery control is distinct from the inner original message handshake and application frames. */
  const send = (kind: IBroadcastFrame['kind'], target?: string, payload?: unknown): void => {
    void transport.send({
      protocol: BroadcastChannelControl.protocol,
      kind,
      sender: context.self.instanceId,
      ...(target === undefined ? {} : { target }),
      ...(kind === BroadcastChannelControl.data ? { payload } : {})
    })
  }
  /** Retire this one physical route without closing any borrowed channel or sibling endpoint. */
  const release = async (session: IBroadcastSession): Promise<void> => {
    try {
      await session.accepted?.peer.close()
    } finally {
      await session.resource.close()
    }
  }
  /** Install the raw receiver synchronously before replying to the participant's discovery. */
  const discover = (id: string): void => {
    if (closing || sessions.has(id)) return
    /** A pair is only a projection of the original BC adapter, never another native listener owner. */
    const pair: IRpcTransport = {
      ...transport,
      send: (payload) => send(BroadcastChannelControl.data, id, payload),
      subscribe: (listener) =>
        transport.subscribe((message) => {
          const frame = readFrame(message.data)
          if (
            frame?.kind === BroadcastChannelControl.data &&
            frame.sender === id &&
            frame.target === context.self.instanceId
          )
            listener({ ...message, data: frame.payload })
        })
    }
    /** The canonical resource retains the only initial/ACK capture, replay and clone qualification. */
    const resource = createEventTargetMessageResource(projectBrowserPeerPort(pair))
    /** This receipt holds no duplicate generation or reconnect policy. */
    const session: IBroadcastSession = { resource }
    sessions.set(id, session)
    session.opening = (async () => {
      /** One existing budget covers identity and ACK, without a discovery/retry timer. */
      const budget = createAdapterMessageHandshakeBudget(systemScheduler, context.connectTimeoutMs)
      const peerId = await resource.exchangeIdentity(
        { ...context, capabilities },
        context.signal,
        budget
      )
      if (peerId !== id)
        throw createBrowserPeerError(
          RpcBrowserErrorCode.invalidPeerSource,
          BrowserPeerErrorText.invalidPeerSource
        )
      const opened = await resource.open({
        peerId,
        scheduler: systemScheduler,
        offer: offer.value,
        control: rpcMessageCapabilityControl,
        signal: context.signal,
        handshakeBudget: budget
      })
      if (closing || sessions.get(id) !== session) {
        await resource.close()
        return
      }
      session.accepted = await accept(opened)
      if (closing || sessions.get(id) !== session) await release(session)
    })().catch(async (error: unknown) => {
      report(error)
      try {
        await release(session)
      } catch (cleanup) {
        report(cleanup)
      }
    })
  }
  /** Only the existing shared subscriber hub installs the single actual BC message callback. */
  const remove = transport.subscribe((message) => {
    const frame = readFrame(message.data)
    if (
      !frame ||
      frame.sender === context.self.instanceId ||
      (frame.target !== undefined && frame.target !== context.self.instanceId) ||
      closing
    )
      return
    if (frame.kind === BroadcastChannelControl.join) {
      discover(frame.sender)
      if (frame.target === undefined) send(BroadcastChannelControl.join, frame.sender)
    } else if (frame.kind === BroadcastChannelControl.leave) {
      const session = sessions.get(frame.sender)
      sessions.delete(frame.sender)
      if (session) void release(session).catch(report)
    }
  })
  try {
    send(BroadcastChannelControl.join)
  } catch (error) {
    try {
      remove()
    } catch (cleanup) {
      report(cleanup)
    }
    throw error
  }
  return {
    close: (): Promise<void> =>
      (closing ??= (async () => {
        /**
         * Explicit leave is observable before subscriptions are removed; the channel stays
         * borrowed.
         */
        const failures: unknown[] = []
        try {
          send(BroadcastChannelControl.leave)
        } catch (error) {
          failures.push(error)
        }
        try {
          remove()
        } catch (error) {
          failures.push(error)
        }
        /** Closing resources cancels unfinished original captures before awaiting their preparation. */
        for (const session of sessions.values())
          try {
            await release(session)
          } catch (error) {
            failures.push(error)
          }
        await Promise.all([...sessions.values()].map((session) => session.opening))
        sessions.clear()
        drainListenerFailures(failures, { code: RpcCoreErrorCode.transport })
      })())
  }
}

/** Define an inert reusable multiparty transport over one caller-owned same-origin channel. */
export function broadcastChannelPlugin(
  options: IBroadcastChannelPluginOptions
): IRpcTransportPlugin {
  /** Source shape admission precedes native subscription or any physical publication. */
  const channel = options?.channel
  if (
    !channel ||
    typeof channel.postMessage !== 'function' ||
    typeof channel.addEventListener !== 'function' ||
    typeof channel.removeEventListener !== 'function'
  )
    throw createBrowserPeerError(
      RpcBrowserErrorCode.invalidPeerSource,
      BrowserPeerErrorText.invalidPeerSource
    )
  /** Every installation receives independent discovery/resources on the same borrowed channel. */
  const deployment = createAdapterDeployment({
    runtimeFamily: broadcastFamily,
    open: async () => {
      throw createAdapterSourceConfigurationError()
    },
    listen: async (context, accept) => listenBroadcast(channel, context, accept)
  })
  return defineTransportPlugin({
    name: options.name ?? BroadcastChannelControl.plugin,
    expose: options.expose,
    connect: options.connect,
    mode: 'listen',
    deployment
  })
}
