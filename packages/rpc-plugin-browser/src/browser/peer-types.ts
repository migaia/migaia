import type { IWindowMessageTarget, IWindowMessageReceiver } from './adapters/window.js'
import type { ISharedWorkerPort } from './adapters/shared-worker.js'
import type { IRTCDataChannel } from './adapters/rtc-data-channel.js'
import type { IWebWorkerLikePort } from './adapters/web-worker.js'
import type { IBrowserPluginOptions } from './plugin-types.js'

/**
 * Connect to one borrowed Window, binding both its native identity and an explicit origin before
 * Core accepts handshake or business messages. This does not create or navigate the Window.
 */
export type IRuntimeBrowserWindowConnect = Readonly<{
  /** Outbound Window identity; incoming messages must identify this same native target. */
  window: IWindowMessageTarget
  /** Nonempty destination origin, without a default; '*' also requires the explicit unsafe opt-in. */
  origin: string
  /** Inbound event owner; omitted uses the current Window-like global, otherwise supply it. */
  receiver?: IWindowMessageReceiver
  /**
   * Only true permits '*'; omitted/false still requires an exact origin, and never relaxes source
   * identity.
   */
  allowUnsafeTargetOrigin?: boolean
}>

/** The caller owns the SharedWorker and its concrete page-side messaging port. */
export type IRuntimeBrowserSharedWorkerConnect = Readonly<{
  /** Existing worker whose port is borrowed; neither the worker nor its port is closed by the Peer. */
  sharedWorker: Readonly<{ port: ISharedWorkerPort }>
}>

/** Native RTC settings must expose the ordered reliable configuration required by a Runtime Peer. */
export type IRuntimeBrowserRtcDataChannel = IRTCDataChannel &
  Readonly<{
    /** Must be true for Core's ordered one-to-one Peer protocol. */
    ordered: boolean
    /** Must be null; a finite retransmission limit does not provide reliable Peer delivery. */
    maxRetransmits: number | null
    /** Must be null; a packet lifetime limit does not provide reliable Peer delivery. */
    maxPacketLifeTime: number | null
  }>

/** The caller completes signaling and owns the reliable ordered RTC channel. */
export type IRuntimeBrowserRtcConnect = Readonly<{
  /** Use an already-open channel; the factory does not wait for open or close the native channel. */
  rtcDataChannel: IRuntimeBrowserRtcDataChannel
}>

/** Only one-to-one ordered reliable carriers can supply a Browser Runtime Peer connection. */
export type IRuntimeBrowserConnect =
  | IRuntimeBrowserWindowConnect
  | IRuntimeBrowserSharedWorkerConnect
  | IRuntimeBrowserRtcConnect
  | Readonly<{ worker: IWebWorkerLikePort }>

/** Window connection configuration is validated before the cold plugin is registered. */
export type IWindowPluginOptions = IBrowserPluginOptions & IRuntimeBrowserWindowConnect

/** Both a page Worker and its worker-side self supply the same borrowed native operations. */
export type IWorkerPluginOptions = IBrowserPluginOptions & Readonly<{ worker: IWebWorkerLikePort }>

/** Exactly one SharedWorker page port or native worker accept scope is selected. */
export type ISharedWorkerPluginOptions = IBrowserPluginOptions &
  (
    | Readonly<{
        sharedWorker: Readonly<{ port: ISharedWorkerPort }>
        listen?: never
      }>
    | Readonly<{
        sharedWorker?: never
        listen: IRuntimeBrowserListen
      }>
  )

/** Reliable ordered native RTC settings stay part of the physical carrier admission contract. */
export type IRtcDataChannelPluginOptions = IBrowserPluginOptions & IRuntimeBrowserRtcConnect

/** SharedWorker connection events supply actual native ports, never a preaccepted Peer or identity. */
export type IRuntimeBrowserConnectEvent = Readonly<{
  /**
   * Each supplied port receives a separate Core handshake and logical connection; ports stay
   * borrowed.
   */
  ports: readonly ISharedWorkerPort[]
}>

/** A worker-side connect scope owns accept notification while each accepted port remains borrowed. */
export type IRuntimeBrowserListen = Readonly<{
  /** Register the native connect callback; one scope may have only one active Browser Peer listener. */
  addEventListener(type: 'connect', listener: (event: IRuntimeBrowserConnectEvent) => void): void
  /** Remove that exact callback when the listener closes; this must not terminate the worker scope. */
  removeEventListener(type: 'connect', listener: (event: IRuntimeBrowserConnectEvent) => void): void
}>
