/** Owns native BroadcastChannel discovery and participant routes while Host owns RPC sessions. */
import { BrowserPeerEvent } from './peer-text.js'
import {
  defineTransportPlugin,
  createRpcMessageCarrier,
  createRpcBackingDigest,
  defaultRpcId
} from '@migaia/rpc-host/sdk'
import type {
  IRpcTransportPlugin,
  IRpcTransportSetupContext,
  IRpcTransportFeatureExtensions
} from '@migaia/rpc-host/sdk'
import {
  type IRpcCarrierWriteOptions,
  type IRpcSessionHandle
} from '@migaia/rpc-contract/interfaces'
import {
  RpcBrowserErrorCode,
  RpcCoreErrorCode,
  RPC_ENDPOINT_ERROR_SOURCE
} from '@migaia/rpc-contract/error-code'
import { attachErrorIdentity } from '@migaia/utils/error'
import { BroadcastRouteIO } from './adapters/broadcast-channel.js'
import { createBrowserPeerError } from './peer-error.js'
import {
  createBrowserTransportError,
  rejectBrowserTransfer,
  normalizeBrowserHandshakeFailure
} from './error.js'
import { BrowserPeerErrorText } from '../error-text.js'
import { BrowserRpcErrorText } from './error-text.js'
import type { IBrowserPluginOptions, IBrowserFeature } from './plugin-types.js'
import { BroadcastChannelControl } from './broadcast-channel-text.js'
import { BrowserNamespace } from './peer-text.js'

/** The caller retains ownership of this actual same-origin native channel. */
export type IBroadcastChannelPluginOptions = IBrowserPluginOptions &
  Readonly<{ channel: BroadcastChannel }>
/** Native discovery addresses select physical pairs; payloads grant no accepted identity or methods. */
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
/** Original native membership holds only physical IO and its actual Host lifecycle handle. */
type IBroadcastSession = Readonly<{ io: BroadcastRouteIO; handle: IRpcSessionHandle }>

/** Ignore unrelated native channel traffic before admitting a physical route. */
function readFrame(value: unknown): IBroadcastFrame | undefined {
  if (value === null || typeof value !== 'object') return undefined
  /** This discriminator is native discovery framing, separate from the new semantic protocol. */
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

/** Original native discovery owns membership once; SDK and Host own all RPC execution and state. */
class BroadcastChannelListener {
  /** The one original native channel remains borrowed across every logical participant route. */
  readonly #channel: BroadcastChannel
  /** Host remains sole identity, namespace, directory, handshake and retirement authority. */
  readonly #context: IRpcTransportSetupContext
  /** Existing native sender routing is not another accepted peer/method directory. */
  readonly #sessions = new Map<string, IBroadcastSession>()
  /** Close is published before native leave or arbitrary remover callbacks can reenter. */
  #closing: Promise<void> | undefined

  /** Install one native listener pair and announce only this real host's current identity. */
  constructor(channel: BroadcastChannel, context: IRpcTransportSetupContext) {
    this.#channel = channel
    this.#context = context
    channel.addEventListener(BrowserPeerEvent.message, this.#message)
    try {
      channel.addEventListener(BrowserPeerEvent.messageError, this.#error)
      this.#send(BroadcastChannelControl.join)
    } catch (primary) {
      try {
        channel.removeEventListener(BrowserPeerEvent.message, this.#message)
      } catch (cleanup) {
        context.report(cleanup)
      }
      try {
        channel.removeEventListener(BrowserPeerEvent.messageError, this.#error)
      } catch (cleanup) {
        context.report(cleanup)
      }
      throw primary
    }
  }
  /** All semantic frames remain opaque to the native discovery and physical routing owner. */
  #send(
    kind: IBroadcastFrame['kind'],
    target?: string,
    payload?: unknown,
    options?: IRpcCarrierWriteOptions,
    route?: BroadcastRouteIO
  ): void {
    options?.onWriteStart?.()
    /** Observation borrows the one actual native wrapper, never a reconstructed semantic frame. */
    const frame = {
      protocol: BroadcastChannelControl.protocol,
      kind,
      sender: this.#context.self().instanceId,
      ...(target === undefined ? {} : { target }),
      ...(kind === BroadcastChannelControl.data ? { payload } : {})
    }
    route?.observeSend(frame)
    this.#channel.postMessage(frame)
  }
  /** Real native framing selects one source route; no business metadata is read or reconstructed. */
  readonly #message = (event: MessageEvent<unknown>): void => {
    if (this.#closing) return
    try {
      /** Capture native discovery once; the inner semantic frame remains opaque. */
      const data = event.data
      /** Native routing inspects only its existing shell; its payload remains opaque. */
      const frame = readFrame(data)
      if (
        !frame ||
        frame.sender === this.#context.self().instanceId ||
        (frame.target !== undefined && frame.target !== this.#context.self().instanceId)
      )
        return
      if (frame.kind === BroadcastChannelControl.join) {
        this.#discover(frame.sender)
        if (frame.target === undefined) this.#send(BroadcastChannelControl.join, frame.sender)
      } else if (frame.kind === BroadcastChannelControl.leave) {
        /** Delete before retirement callbacks can reenter native discovery. */
        const route = this.#sessions.get(frame.sender)
        this.#sessions.delete(frame.sender)
        route?.io.leave()
      } else if (frame.target === this.#context.self().instanceId)
        this.#sessions.get(frame.sender)?.io.receive(frame.payload, data)
    } catch (cause) {
      this.#context.report(
        createBrowserTransportError(BrowserRpcErrorText.carrierOperationFailed, cause)
      )
    }
  }
  /** Native deserialization failure reaches current SDK physical owners without invented peers. */
  readonly #error = (): void => {
    /** One native failure keeps the same instance across this original observer snapshot. */
    const error = createBrowserTransportError(BrowserRpcErrorText.carrierOperationFailed)
    const routes = [...this.#sessions.values()]
    for (const route of routes) route.io.fail(error)
  }
  /** Discovery creates precisely one SDK carrier per native route; Host owns its real handshake. */
  #discover(id: string): void {
    if (this.#sessions.has(id)) return
    /** Only this exact original IO record may remove itself during native route retirement. */
    const io = new BroadcastRouteIO(
      (value, options) => this.#send(BroadcastChannelControl.data, id, value, options, io),
      () => {
        if (this.#sessions.get(id)?.io === io) this.#sessions.delete(id)
      },
      this.#context.report
    )
    /** Native BroadcastChannel can clone actual backings, although it cannot transfer ownership. */
    const carrier = createRpcMessageCarrier({
      id: defaultRpcId(),
      closingWrites: true,
      nativeBinary: true,
      assertTransfer: rejectBrowserTransfer,
      digest: createRpcBackingDigest(),
      io,
      observation: io.observation,
      report: this.#context.report
    })
    try {
      /** Host alone admits the semantic identity; native sender labels are not trusted source facts. */
      const handle = this.#context.attach(carrier)
      this.#sessions.set(id, { io, handle })
      void handle.ready.catch((error: unknown) =>
        this.#context.report(normalizeBrowserHandshakeFailure(error))
      )
    } catch (primary) {
      void carrier.close(primary).catch(this.#context.report)
      throw primary
    }
  }
  /** Explicit leave precedes native unsubscribe; all accepted handles retire without channel.close. */
  readonly close = (): Promise<void> =>
    (this.#closing ??= Promise.resolve().then(async () => {
      /** Native cleanup failures do not prevent sibling Session retirement. */
      const failures: unknown[] = []
      try {
        this.#send(BroadcastChannelControl.leave)
      } catch (error) {
        failures.push(error)
      }
      try {
        this.#channel.removeEventListener(BrowserPeerEvent.message, this.#message)
      } catch (error) {
        failures.push(error)
      }
      try {
        this.#channel.removeEventListener(BrowserPeerEvent.messageError, this.#error)
      } catch (error) {
        failures.push(error)
      }
      /** Every route borrows the original Host close operation, never a Peer facade. */
      const routes = [...this.#sessions.values()]
      /** Original snapshot order and eager detach starts survive synchronous native retirement. */
      const pending: Promise<void>[] = []
      for (const route of routes) pending.push(this.#context.detach(route.handle))
      /** Each exact original detach result keeps its position in cleanup error aggregation. */
      const results = await Promise.allSettled(pending)
      for (const result of results) if (result.status === 'rejected') failures.push(result.reason)
      this.#sessions.clear()
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1)
        throw attachErrorIdentity(
          new AggregateError(failures, BrowserPeerErrorText.listenerCleanupFailed, {
            cause: failures[0]
          }),
          { source: RPC_ENDPOINT_ERROR_SOURCE, code: RpcCoreErrorCode.transport }
        )
    }))
}

/** Capture a borrowed native channel; each real installation owns independent discovery membership. */
export function broadcastChannelPlugin<
  const N extends string = 'broadcastChannel',
  const TFeatures extends readonly IBrowserFeature[] = readonly IBrowserFeature[]
>(
  options: IBroadcastChannelPluginOptions & Readonly<{ namespace?: N; features?: TFeatures }>
): IRpcTransportPlugin<NoInfer<N>, IRpcTransportFeatureExtensions<TFeatures[number]>, true> {
  /** Native source shape is admitted before subscribing or publishing any discovery frame. */
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
  return defineTransportPlugin({
    name: options.name ?? BroadcastChannelControl.plugin,
    namespace: (options.namespace ?? BrowserNamespace.broadcast) as N,
    closingWrites: true,
    expose: options.expose,
    features: options.features,
    handshakeTimeoutMs: options.connect?.timeoutMs,
    open: (context) => {
      /** This one actual native membership owner holds no request/provider/forwarding facade. */
      const listener = new BroadcastChannelListener(channel, context)
      return { dispose: listener.close }
    }
  }) as IRpcTransportPlugin<NoInfer<N>, IRpcTransportFeatureExtensions<TFeatures[number]>, true>
}
