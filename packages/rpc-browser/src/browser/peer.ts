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

/** A declared remote surface retains the same method, payload and generator typing as other Peers. */
export function createBrowserPeer<TRemote = never>(
  options: IRuntimeBrowserPeerOptions
): Promise<[TRemote] extends [never] ? IRuntimePeer : IRuntimeTypedPeer<TRemote>>
/** Preserve the same dynamic factory signature used by the canonical Runtime Peer constructor. */
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
