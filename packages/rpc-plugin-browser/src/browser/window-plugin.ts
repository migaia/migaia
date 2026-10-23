import type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'
import { defineTransportPlugin, RpcTransportMode } from '@migaia/rpc-host/plugin'
import { BrowserPeerErrorText } from '../error-text.js'
import { RpcBrowserErrorCode } from '../error-code.js'
import { createBrowserPeerError } from './peer-error.js'
import { createBrowserConfigurationError } from './error.js'
import { BrowserRpcErrorText } from './error-text.js'
import { BrowserPluginName } from './peer-text.js'
import { getBrowserMessageAdapter } from './peer-adapter.js'
import type { IWindowPluginOptions } from './peer-types.js'

/** Capture a borrowed Window source after synchronous origin and carrier admission. */
export function windowPlugin(options: IWindowPluginOptions): IRpcTransportPlugin {
  if (!options?.window || typeof options.window.postMessage !== 'function')
    throw createBrowserPeerError(
      RpcBrowserErrorCode.invalidPeerSource,
      BrowserPeerErrorText.invalidPeerSource
    )
  if (typeof options.origin !== 'string' || options.origin.length === 0)
    throw createBrowserPeerError(
      RpcBrowserErrorCode.windowOriginRequired,
      BrowserPeerErrorText.windowOriginRequired
    )
  if (options.origin === '*' && options.allowUnsafeTargetOrigin !== true)
    throw createBrowserConfigurationError(
      BrowserRpcErrorText.wildcardTargetOriginRequiresAllowUnsafeTargetOrigin
    )
  return defineTransportPlugin({
    name: options.name ?? BrowserPluginName.window,
    expose: options.expose,
    connect: options.connect,
    mode: RpcTransportMode.connect,
    deployment: getBrowserMessageAdapter().deployment({
      connect: {
        window: options.window,
        origin: options.origin,
        receiver: options.receiver,
        allowUnsafeTargetOrigin: options.allowUnsafeTargetOrigin
      }
    })
  })
}
