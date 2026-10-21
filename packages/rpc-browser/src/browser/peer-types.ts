import type { IAdapterDefinitionPeerOptions } from '@migaia/rpc-core/adapter'
import type { IRuntimePeerOptions } from '@migaia/rpc-core/remote'
import type { IWindowMessageTarget, IWindowMessageReceiver } from './adapters/window.js'
import type { ISharedWorkerPort } from './adapters/shared-worker.js'
import type { IRTCDataChannel } from './adapters/rtc-data-channel.js'

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

/**
 * Browser sources use Core's Runtime Peer provider, timeout, probe and error contracts. Supply
 * exactly one connect or listen source; no carrier is created implicitly. self defaults to a
 * browser name with a generated instance id. Other inherited defaults remain owned by Core.
 */
export type IRuntimeBrowserPeerOptions = Omit<IRuntimePeerOptions, 'spawn' | 'connect' | 'listen'> &
  Readonly<{
    /** One borrowed Window, SharedWorker port or reliable ordered RTC channel; excludes listen. */
    connect?: IRuntimeBrowserConnect
    /**
     * SharedWorker connect-event scope; returns a listener before any page connects and excludes
     * connect.
     */
    listen?: IRuntimeBrowserListen
    /**
     * Caller cancellation releases unfinished handshake subscriptions without closing borrowed
     * carriers. A listener also retains this signal to close its accepts and sessions; omission
     * installs no caller cancellation source.
     */
    signal?: IAdapterDefinitionPeerOptions<unknown>['signal']
  }>
