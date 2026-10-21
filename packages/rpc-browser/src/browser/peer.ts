import type { IRuntimePeer, IRuntimeTypedPeer } from '@migaia/rpc-core/remote'
import { createAdapterId } from '@migaia/rpc-core/adapter/internal-advanced'
import { BrowserPeerErrorText } from '../error-text.js'
import { RpcBrowserErrorCode } from '../error-code.js'
import { createBrowserPeerError } from './peer-error.js'
import { BrowserPeerSource, BrowserPeerText } from './peer-text.js'
import { getBrowserMessageAdapter } from './peer-adapter.js'
import { createBrowserListenerPeer } from './peer-listener.js'
import type {
  IRuntimeBrowserPeerOptions,
  IRuntimeBrowserRtcConnect,
  IRuntimeBrowserSharedWorkerConnect,
  IRuntimeBrowserWindowConnect
} from './peer-types.js'

/**
 * Open a Core Runtime Peer over one existing Window, SharedWorker port or reliable ordered RTC
 * channel, or attach a SharedWorker listener. Connect resolves after the real handshake; listen
 * resolves after acceptance is installed and can have zero or many connections. The remote type
 * preserves method, payload and scalar/generator distinctions without changing runtime dispatch.
 *
 * Supply exactly one source. Invalid source/origin/reliability rejects with a Browser TypeError;
 * carrier and Core negotiation failures retain their existing owners and original causes. Caller
 * cancellation can retire an unfinished opening. close()/asyncDispose release logical sessions and
 * subscriptions, retain Core's shared close Promise, and never close borrowed native carriers.
 */
export function createBrowserPeer<TRemote = never>(
  options: IRuntimeBrowserPeerOptions
): Promise<[TRemote] extends [never] ? IRuntimePeer : IRuntimeTypedPeer<TRemote>>
/** Open the same Peer without a declared remote surface, using dynamic Core method names. */
export function createBrowserPeer(options: IRuntimeBrowserPeerOptions): Promise<IRuntimePeer>
/** The dynamic implementation returns Core's original facade without a Proxy or lifecycle wrapper. */
export async function createBrowserPeer(
  options: IRuntimeBrowserPeerOptions
): Promise<IRuntimePeer> {
  if (
    !options ||
    typeof options !== 'object' ||
    Number(options.connect !== undefined) + Number(options.listen !== undefined) !== 1
  )
    throw createBrowserPeerError(
      RpcBrowserErrorCode.invalidPeerSource,
      BrowserPeerErrorText.invalidPeerSource
    )
  if (options.listen) {
    /** Native acceptance attaches synchronously; its actual carrier still loads only on selection. */
    return createBrowserListenerPeer(options)
  }
  /** Entry admission rejects unsupported or competing carrier discriminants before physical effects. */
  const source = options.connect
  if (
    !source ||
    typeof source !== 'object' ||
    Object.values(BrowserPeerSource).filter((key) => key in source).length !== 1
  )
    throw createBrowserPeerError(
      RpcBrowserErrorCode.invalidPeerSource,
      BrowserPeerErrorText.invalidPeerSource
    )
  if (BrowserPeerSource.window in source) {
    /**
     * Explicit origin is stronger than the Endpoint transport's realm-derived compatibility
     * default.
     */
    const window = source as IRuntimeBrowserWindowConnect
    if (!window.window || typeof window.window.postMessage !== 'function')
      throw createBrowserPeerError(
        RpcBrowserErrorCode.invalidPeerSource,
        BrowserPeerErrorText.invalidPeerSource
      )
    if (typeof window.origin !== 'string' || window.origin.length === 0)
      throw createBrowserPeerError(
        RpcBrowserErrorCode.windowOriginRequired,
        BrowserPeerErrorText.windowOriginRequired
      )
  }
  if (BrowserPeerSource.sharedWorker in source) {
    /** Mandatory physical operations belong to the supported port contract, not caller trust inputs. */
    const port = (source as IRuntimeBrowserSharedWorkerConnect).sharedWorker?.port
    if (
      !port ||
      typeof port.postMessage !== 'function' ||
      typeof port.addEventListener !== 'function' ||
      typeof port.removeEventListener !== 'function'
    )
      throw createBrowserPeerError(
        RpcBrowserErrorCode.invalidPeerSource,
        BrowserPeerErrorText.invalidPeerSource
      )
  }
  if (BrowserPeerSource.rtcDataChannel in source) {
    /** Actual native reliability settings, rather than caller trust flags, qualify this carrier. */
    const channel = (source as IRuntimeBrowserRtcConnect).rtcDataChannel
    if (
      !channel ||
      channel.ordered !== true ||
      channel.maxRetransmits !== null ||
      channel.maxPacketLifeTime !== null
    )
      throw createBrowserPeerError(
        RpcBrowserErrorCode.rtcChannelUnreliable,
        BrowserPeerErrorText.rtcChannelUnreliable
      )
  }
  return getBrowserMessageAdapter().peer({
    ...options,
    listen: undefined,
    self: options.self ?? { name: BrowserPeerText.name, instanceId: createAdapterId() }
  })
}
