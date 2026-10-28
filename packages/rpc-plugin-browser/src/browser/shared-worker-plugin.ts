/** Builds the SharedWorker transport from one borrowed page port or native connect-event scope. */
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'
import type { IRpcTransportPlugin, IRpcTransportFeatureExtensions } from '@migaia/rpc-host/sdk'
import { BrowserPeerErrorText } from '../error-text.ts'
import { RpcBrowserErrorCode } from '@migaia/rpc-contract/error-code'
import { createBrowserPeerError } from './peer-error.ts'
import { BrowserPluginName, BrowserNamespace } from './peer-text.ts'
import { attachBrowserCarrier } from './native-message.ts'
import { createSharedWorkerCarrier } from './adapters/shared-worker.ts'
import { listenBrowserPorts } from './peer-listener.ts'
import type { ISharedWorkerPluginOptions } from './peer-types.ts'
import type { IBrowserFeature } from './plugin-types.ts'

/** Capture one existing page port or native connect scope; no physical effect occurs cold. */
export function sharedWorkerPlugin<
  const N extends string = 'sharedWorker',
  const TFeatures extends readonly IBrowserFeature[] = readonly IBrowserFeature[]
>(
  options: ISharedWorkerPluginOptions & Readonly<{ namespace?: N; features?: TFeatures }>
): IRpcTransportPlugin<NoInfer<N>, IRpcTransportFeatureExtensions<TFeatures[number]>, true> {
  if (
    !options ||
    Number(options.sharedWorker !== undefined) + Number(options.listen !== undefined) !== 1
  )
    throw createBrowserPeerError(
      RpcBrowserErrorCode.invalidPeerSource,
      BrowserPeerErrorText.invalidPeerSource
    )
  /** Native port and connect scope remain distinct acquisition kinds. */
  const port = options.sharedWorker?.port
  /** Native connect events are the only source of worker-side accepted ports. */
  const scope = options.listen
  if (
    scope
      ? typeof scope.addEventListener !== 'function' ||
        typeof scope.removeEventListener !== 'function'
      : !port ||
        typeof port.postMessage !== 'function' ||
        typeof port.addEventListener !== 'function' ||
        typeof port.removeEventListener !== 'function'
  )
    throw createBrowserPeerError(
      RpcBrowserErrorCode.invalidPeerSource,
      BrowserPeerErrorText.invalidPeerSource
    )
  return defineTransportPlugin({
    name: options.name ?? BrowserPluginName.shared,
    namespace: (options.namespace ?? BrowserNamespace.shared) as N,
    closingWrites: true,
    expose: options.expose,
    features: options.features,
    handshakeTimeoutMs: options.connect?.timeoutMs,
    connect: { retain: options.connect?.retain },
    open: (context) =>
      scope
        ? listenBrowserPorts(scope, context)
        : attachBrowserCarrier(createSharedWorkerCarrier(port!, context), context)
  }) as IRpcTransportPlugin<NoInfer<N>, IRpcTransportFeatureExtensions<TFeatures[number]>, true>
}
