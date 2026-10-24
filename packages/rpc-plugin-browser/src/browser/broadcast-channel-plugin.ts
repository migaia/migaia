import { RpcTransportMode } from '@migaia/rpc-host/plugin'
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
/** Allocate only the native listener's original membership and cleanup storage. */
function broadcastChannelListenerState(
  channel: BroadcastChannel,
  context: IAdapterDeploymentContext,
  accept: IAdapterDeploymentAccept
) {
  /** The existing BC adapter alone owns native subscription, clone, probe and I/O error behavior. */
  const transport = createBroadcastChannelTransport(channel)
  /** Only per-participant raw routes live here; accepted directories remain owned by the host. */
  const sessions = new Map<string, IBroadcastSession>()
  /** Explicit closure prevents new discovery and returns the same native cleanup completion. */
  const closing = undefined as Promise<void> | undefined
  /** Structured cloning supports native storage but never an ownership transfer list on BC. */
  const capabilities = context.capabilities.filter(
    (capability) => capability !== RpcCapability.transfer
  )
  /** Canonical clone control augments only the local proposal before its actual bilateral ACK. */
  const offer = rpcMessageCapabilityControl.localOffer(capabilities) as Extract<
    ReturnType<typeof rpcMessageCapabilityControl.localOffer>,
    { valid: true }
  >
  /** Only the existing shared subscriber hub installs the single actual BC message callback. */
  const remove = undefined as unknown as ReturnType<typeof transport.subscribe>
  return { channel, context, accept, transport, sessions, closing, capabilities, offer, remove }
}

/** Own one native browser listener while the Host keeps accepted endpoint and directory ownership. */
class BroadcastChannelListener {
  /** Native membership, pending preparation and the one close receipt belong to this listener. */
  #state: ReturnType<typeof broadcastChannelListenerState>
  /** Create storage before native callbacks can publish any accepted resource. */
  constructor(
    channel: BroadcastChannel,
    context: IAdapterDeploymentContext,
    accept: IAdapterDeploymentAccept
  ) {
    this.#state = broadcastChannelListenerState(channel, context, accept)
  }
  /** Attach native acceptance and retain the original rollback and close semantics. */
  open() {
    this.#state.remove = this.#state.transport.subscribe((message) => {
      const frame = readFrame(message.data)
      if (
        !frame ||
        frame.sender === this.#state.context.self.instanceId ||
        (frame.target !== undefined && frame.target !== this.#state.context.self.instanceId) ||
        this.#state.closing
      )
        return
      if (frame.kind === BroadcastChannelControl.join) {
        this.#discover(frame.sender)
        if (frame.target === undefined) this.#send(BroadcastChannelControl.join, frame.sender)
      } else if (frame.kind === BroadcastChannelControl.leave) {
        /** This receipt holds no duplicate generation or reconnect policy. */
        const session = this.#state.sessions.get(frame.sender)
        this.#state.sessions.delete(frame.sender)
        if (session) void this.#release(session).catch(this.#report)
      }
    })
    try {
      this.#send(BroadcastChannelControl.join)
    } catch (error) {
      try {
        ;(0, this.#state.remove)()
      } catch (cleanup) {
        this.#report(cleanup)
      }
      throw error
    }
    return {
      close: (): Promise<void> =>
        (this.#state.closing ??= (async () => {
          /**
           * Explicit leave is observable before subscriptions are removed; the channel stays
           * borrowed.
           */
          const failures: unknown[] = []
          try {
            this.#send(BroadcastChannelControl.leave)
          } catch (error) {
            failures.push(error)
          }
          try {
            ;(0, this.#state.remove)()
          } catch (error) {
            failures.push(error)
          }
          /**
           * Closing resources cancels unfinished original captures before awaiting their
           * preparation.
           */
          for (const session of this.#state.sessions.values())
            try {
              await this.#release(session)
            } catch (error) {
              failures.push(error)
            }
          await Promise.all([...this.#state.sessions.values()].map((session) => session.opening))
          this.#state.sessions.clear()
          drainListenerFailures(failures, { code: RpcCoreErrorCode.transport })
        })())
    }
  }
  /**
   * Isolate reporter failures so discovery failures remain observable through the existing reporter
   * owner.
   */
  #report = (error: unknown): void => {
    try {
      this.#state.context.report(error)
    } catch (failure) {
      hostRethrowReporter(failure, IpcReporterContext)
    }
  }
  /**
   * Send discovery control through the original adapter, keeping inner application frames
   * unchanged.
   */
  #send = (kind: IBroadcastFrame['kind'], target?: string, payload?: unknown): void => {
    void this.#state.transport.send({
      protocol: BroadcastChannelControl.protocol,
      kind,
      sender: this.#state.context.self.instanceId,
      ...(target === undefined ? {} : { target }),
      ...(kind === BroadcastChannelControl.data ? { payload } : {})
    })
  }
  /** Retire one physical route while leaving its borrowed native channel and sibling sessions open. */
  #release = async (session: IBroadcastSession): Promise<void> => {
    try {
      await session.accepted?.peer.close()
    } finally {
      await session.resource.close()
    }
  }
  /**
   * Install a source-filtered raw receiver before discovery replies can trigger the held identity
   * exchange.
   */
  #discover = (id: string): void => {
    if (this.#state.closing || this.#state.sessions.has(id)) return
    /** A pair is only a projection of the original BC adapter, never another native listener owner. */
    const pair: IRpcTransport = {
      ...this.#state.transport,
      send: (payload) => this.#send(BroadcastChannelControl.data, id, payload),
      subscribe: (listener) =>
        this.#state.transport.subscribe((message) => {
          const frame = readFrame(message.data)
          if (
            frame?.kind === BroadcastChannelControl.data &&
            frame.sender === id &&
            frame.target === this.#state.context.self.instanceId
          )
            listener({ ...message, data: frame.payload })
        })
    }
    /** The canonical resource retains the only initial/ACK capture, replay and clone qualification. */
    const resource = createEventTargetMessageResource(projectBrowserPeerPort(pair))
    /** This receipt holds no duplicate generation or reconnect policy. */
    const session: IBroadcastSession = { resource }
    this.#state.sessions.set(id, session)
    session.opening = (async () => {
      /** One existing budget covers identity and ACK, without a discovery/retry timer. */
      const budget = createAdapterMessageHandshakeBudget(
        systemScheduler,
        this.#state.context.connectTimeoutMs
      )
      const peerId = await resource.exchangeIdentity(
        { ...this.#state.context, capabilities: this.#state.capabilities },
        this.#state.context.signal,
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
        offer: this.#state.offer.value,
        control: rpcMessageCapabilityControl,
        signal: this.#state.context.signal,
        handshakeBudget: budget
      })
      if (this.#state.closing || this.#state.sessions.get(id) !== session) {
        await resource.close()
        return
      }
      session.accepted = await (0, this.#state.accept)(opened)
      if (this.#state.closing || this.#state.sessions.get(id) !== session)
        await this.#release(session)
    })().catch(async (error: unknown) => {
      this.#report(error)
      try {
        await this.#release(session)
      } catch (cleanup) {
        this.#report(cleanup)
      }
    })
  }
}

/** Attach the one native listener without creating another Host or endpoint. */
function listenBroadcast(
  channel: BroadcastChannel,
  context: IAdapterDeploymentContext,
  accept: IAdapterDeploymentAccept
) {
  return new BroadcastChannelListener(channel, context, accept).open()
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
    mode: RpcTransportMode.listen,
    deployment
  })
}
