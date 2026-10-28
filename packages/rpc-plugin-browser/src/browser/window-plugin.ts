/** Builds the Window transport definition from a borrowed target and explicit origin policy. */
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'
import type { IRpcTransportPlugin, IRpcTransportFeatureExtensions } from '@migaia/rpc-host/sdk'
import { BrowserPeerErrorText } from '../error-text.ts'
import { RpcBrowserErrorCode } from '@migaia/rpc-contract/error-code'
import { createBrowserPeerError } from './peer-error.ts'
import { createBrowserConfigurationError } from './error.ts'
import { BrowserRpcErrorText } from './error-text.ts'
import { BrowserPluginName, BrowserNamespace } from './peer-text.ts'
import { attachBrowserCarrier } from './native-message.ts'
import { createWindowCarrier } from './adapters/window.ts'
import type { IWindowPluginOptions } from './peer-types.ts'
import type { IBrowserFeature } from './plugin-types.ts'

/** Capture the exact borrowed Window and required origin before installation can touch native IO. */
export function windowPlugin<
  const N extends string = 'window',
  const TFeatures extends readonly IBrowserFeature[] = readonly IBrowserFeature[]
>(
  options: IWindowPluginOptions & Readonly<{ namespace?: N; features?: TFeatures }>
): IRpcTransportPlugin<NoInfer<N>, IRpcTransportFeatureExtensions<TFeatures[number]>, true> {
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
    namespace: (options.namespace ?? BrowserNamespace.window) as N,
    closingWrites: true,
    expose: options.expose,
    features: options.features,
    handshakeTimeoutMs: options.connect?.timeoutMs,
    connect: { retain: options.connect?.retain },
    open: (context) =>
      attachBrowserCarrier(
        createWindowCarrier(
          {
            target: options.window,
            receiver: options.receiver,
            targetOrigin: options.origin,
            allowUnsafeTargetOrigin: options.allowUnsafeTargetOrigin
          },
          context
        ),
        context
      )
  }) as IRpcTransportPlugin<NoInfer<N>, IRpcTransportFeatureExtensions<TFeatures[number]>, true>
}
