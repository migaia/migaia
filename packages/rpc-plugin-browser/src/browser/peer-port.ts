import type { IMessageAdapterPort } from '@migaia/rpc-host/plugin'
import {
  collectListenerCleanupFailures,
  drainListenerFailures,
  type IRpcTransport
} from '@migaia/rpc-host/plugin'
import { RpcCoreErrorCode } from '@migaia/rpc-host'
import { BrowserPeerEvent, BrowserPeerSource } from './peer-text.js'
import { BrowserPeerErrorText } from '../error-text.js'
import { RpcBrowserErrorCode } from '../error-code.js'
import { createBrowserPeerError } from './peer-error.js'
import type {
  IRuntimeBrowserConnect,
  IRuntimeBrowserWindowConnect,
  IRuntimeBrowserSharedWorkerConnect,
  IRuntimeBrowserRtcConnect
} from './peer-types.js'

/** This raw operation projection supplies no accepted agreement, provenance or ownership claims. */
export type IBrowserPeerPort = Extract<IMessageAdapterPort, { addEventListener: unknown }>

/** One physical callback has one transport subscription and retains its native removal identity. */
type IBrowserPeerPortListener = (event: unknown) => void

/** Adapt the existing carrier operations; source admission runs before ACK capture and business I/O. */
export function projectBrowserPeerPort(
  transport: IRpcTransport<unknown, Transferable>,
  json = false
): IBrowserPeerPort {
  /** The projection retains only registrations belonging to its exact Core raw resource. */
  const subscriptions = new Map<IBrowserPeerPortListener, () => void>()
  return {
    observe: transport.observe === undefined ? undefined : (probe) => transport.observe!(probe),
    postMessage: (message, transfer) => {
      void transport.send(message, { transfer: transfer as readonly Transferable[] | undefined })
    },
    addEventListener(type, listener) {
      if (type !== BrowserPeerEvent.message || subscriptions.has(listener)) return
      subscriptions.set(
        listener,
        transport.subscribe((message) => {
          if (transport.sourceProof && !transport.sourceProof(message.source, message.origin))
            return
          /** RTC's existing carrier sends strings; only decoding belongs to this physical bridge. */
          let data = message.data
          if (json) {
            try {
              data = JSON.parse(data as string)
            } catch (cause) {
              throw createBrowserPeerError(
                RpcBrowserErrorCode.messageDecodeFailed,
                BrowserPeerErrorText.messageDecodeFailed,
                cause
              )
            }
          }
          listener({ data })
        })
      )
    },
    removeEventListener(type, listener) {
      if (type !== BrowserPeerEvent.message) return
      /** Failed native cleanup retains its remover so the same resource can retry retirement. */
      const remove = subscriptions.get(listener)
      remove?.()
      if (subscriptions.get(listener) === remove) subscriptions.delete(listener)
    },
    onError(listener) {
      /** Existing transport error channels preserve the carrier's own Error object and cause. */
      const removeTransport = transport.onTransportError?.(listener)
      /** Decoder failures use the existing listener failure channel rather than a parallel reporter. */
      const removeListener = transport.onListenerError?.(listener)
      return () =>
        drainListenerFailures(
          collectListenerCleanupFailures([() => removeTransport?.(), () => removeListener?.()]),
          { code: RpcCoreErrorCode.transport }
        )
    }
  }
}

/** Load only the selected carrier while retaining its existing physical filtering and error owner. */
export async function openBrowserPeerPort(
  input: IRuntimeBrowserConnect
): Promise<IBrowserPeerPort> {
  if (BrowserPeerSource.window in input) {
    /** Type narrowing follows the public source discriminant after entry-point admission. */
    const source = input as IRuntimeBrowserWindowConnect
    /** The existing Window transport remains the sole origin and source algorithm. */
    const { createWindowMessageTransport } = await import('./adapters/window.js')
    return projectBrowserPeerPort(
      createWindowMessageTransport({
        target: source.window,
        targetOrigin: source.origin,
        receiver: source.receiver,
        allowUnsafeTargetOrigin: source.allowUnsafeTargetOrigin
      })
    )
  }
  if (BrowserPeerSource.sharedWorker in input) {
    /** Borrowed page ports use the same carrier as accepted worker-side ports. */
    const source = input as IRuntimeBrowserSharedWorkerConnect
    /** Lazy loading keeps unrelated carrier modules out of the root Peer entry. */
    const { createSharedWorkerTransport } = await import('./adapters/shared-worker.js')
    return projectBrowserPeerPort(createSharedWorkerTransport(source.sharedWorker.port))
  }
  if (BrowserPeerSource.worker in input) {
    /** Browser Worker metadata and failure presentation are retained by the carrier shell. */
    const { createWebWorkerTransport } = await import('./adapters/web-worker.js')
    return projectBrowserPeerPort(createWebWorkerTransport(input.worker))
  }
  /** Remaining admitted source is the reliable ordered RTC channel. */
  const source = input as IRuntimeBrowserRtcConnect
  /** The carrier retains native terminal observation and physical string encoding. */
  const { createRtcDataChannelTransport } = await import('./adapters/rtc-data-channel.js')
  return projectBrowserPeerPort(createRtcDataChannelTransport(source.rtcDataChannel), true)
}
