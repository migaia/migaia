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
/** Allocate one raw browser carrier projection before installing behavior callbacks. */
function browserPeerPortState(transport: IRpcTransport<unknown, Transferable>, json = false) {
  /** The projection retains only registrations belonging to its exact Core raw resource. */
  const subscriptions = new Map<IBrowserPeerPortListener, () => void>()

  return { subscriptions, transport, json }
}

/** Own one raw browser carrier projection; callbacks access only this explicit instance. */
class BrowserPeerPort {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof browserPeerPortState>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IBrowserPeerPort
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(transport: IRpcTransport<unknown, Transferable>, json = false) {
    this.#state = browserPeerPortState(transport, json)

    this.value = {
      observe:
        this.#state.transport.observe === undefined
          ? undefined
          : (probe) => this.#state.transport.observe!(probe),
      postMessage: (message, transfer) => {
        void this.#state.transport.send(message, {
          transfer: transfer as readonly Transferable[] | undefined
        })
      },
      addEventListener: (type, listener) => {
        if (type !== BrowserPeerEvent.message || this.#state.subscriptions.has(listener)) return
        this.#state.subscriptions.set(
          listener,
          this.#state.transport.subscribe((message) => {
            if (
              this.#state.transport.sourceProof &&
              !this.#state.transport.sourceProof(message.source, message.origin)
            )
              return
            /** RTC's existing carrier sends strings; only decoding belongs to this physical bridge. */
            let data = message.data
            if (this.#state.json) {
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
      removeEventListener: (type, listener) => {
        if (type !== BrowserPeerEvent.message) return
        /** Failed native cleanup retains its remover so the same resource can retry retirement. */
        const remove = this.#state.subscriptions.get(listener)
        remove?.()
        if (this.#state.subscriptions.get(listener) === remove)
          this.#state.subscriptions.delete(listener)
      },
      onError: (listener) => {
        /** Existing transport error channels preserve the carrier's own Error object and cause. */
        const removeTransport = this.#state.transport.onTransportError?.(listener)
        /**
         * Decoder failures use the existing listener failure channel rather than a parallel
         * reporter.
         */
        const removeListener = this.#state.transport.onListenerError?.(listener)
        return () =>
          drainListenerFailures(
            collectListenerCleanupFailures([() => removeTransport?.(), () => removeListener?.()]),
            { code: RpcCoreErrorCode.transport }
          )
      }
    }
  }
}

/** Construct the single owner for one raw browser carrier projection. */
export function projectBrowserPeerPort(
  transport: IRpcTransport<unknown, Transferable>,
  json = false
): IBrowserPeerPort {
  return new BrowserPeerPort(transport, json).value
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
    const { createWebWorkerTransport } = await import('@migaia/rpc-host/plugin')
    return projectBrowserPeerPort(createWebWorkerTransport(input.worker))
  }
  /** Remaining admitted source is the reliable ordered RTC channel. */
  const source = input as IRuntimeBrowserRtcConnect
  /** The carrier retains native terminal observation and physical string encoding. */
  const { createRtcDataChannelTransport } = await import('./adapters/rtc-data-channel.js')
  return projectBrowserPeerPort(createRtcDataChannelTransport(source.rtcDataChannel), true)
}
