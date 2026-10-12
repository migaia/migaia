import type { IAdapterDefinitionPeerOptions } from '@migaia/rpc-core/adapter'
import type { IRuntimePeerOptions } from '@migaia/rpc-core/remote'
import type { IWindowMessageTarget, IWindowMessageReceiver } from './adapters/window.js'
import type { ISharedWorkerPort } from './adapters/shared-worker.js'
import type { IRTCDataChannel } from './adapters/rtc-data-channel.js'

/**
 * Borrowed Window delivery requires an explicit origin and retains the transport's sole wildcard
 * escape.
 */
export type IRuntimeBrowserWindowConnect = Readonly<{
  window: IWindowMessageTarget
  origin: string
  receiver?: IWindowMessageReceiver
  allowUnsafeTargetOrigin?: boolean
}>

/** The caller owns the SharedWorker and its concrete page-side messaging port. */
export type IRuntimeBrowserSharedWorkerConnect = Readonly<{
  sharedWorker: Readonly<{ port: ISharedWorkerPort }>
}>

/** Native RTC settings must expose the ordered reliable configuration required by a Runtime Peer. */
export type IRuntimeBrowserRtcDataChannel = IRTCDataChannel &
  Readonly<{
    ordered: boolean
    maxRetransmits: number | null
    maxPacketLifeTime: number | null
  }>

/** The caller establishes and owns the already-open RTC channel. */
export type IRuntimeBrowserRtcConnect = Readonly<{ rtcDataChannel: IRuntimeBrowserRtcDataChannel }>

/** Only one-to-one ordered reliable carriers can supply a Browser Runtime Peer connection. */
export type IRuntimeBrowserConnect =
  | IRuntimeBrowserWindowConnect
  | IRuntimeBrowserSharedWorkerConnect
  | IRuntimeBrowserRtcConnect

/** SharedWorker connection events supply actual native ports, never a preaccepted Peer or identity. */
export type IRuntimeBrowserConnectEvent = Readonly<{ ports: readonly ISharedWorkerPort[] }>

/** A worker-side connect scope owns accept notification while each accepted port remains borrowed. */
export type IRuntimeBrowserListen = Readonly<{
  addEventListener(type: 'connect', listener: (event: IRuntimeBrowserConnectEvent) => void): void
  removeEventListener(type: 'connect', listener: (event: IRuntimeBrowserConnectEvent) => void): void
}>

/** Browser physical sources share the original Runtime Peer provider, timeout and error contracts. */
export type IRuntimeBrowserPeerOptions = Omit<IRuntimePeerOptions, 'spawn' | 'connect' | 'listen'> &
  Readonly<{
    connect?: IRuntimeBrowserConnect
    listen?: IRuntimeBrowserListen
    /**
     * Caller cancellation releases unfinished handshake subscriptions without closing borrowed
     * carriers.
     */
    signal?: IAdapterDefinitionPeerOptions<unknown>['signal']
  }>
