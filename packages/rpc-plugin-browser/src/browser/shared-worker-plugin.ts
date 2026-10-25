/** Builds the SharedWorker transport from one borrowed page port or native connect-event scope. */
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'
import type { IRpcTransportPlugin } from '@migaia/rpc-host/sdk'
import { BrowserPeerErrorText } from '../error-text.js'
import { RpcBrowserErrorCode } from '@migaia/rpc-contract/error-code'
import { createBrowserPeerError } from './peer-error.js'
import { BrowserPluginName, BrowserNamespace } from './peer-text.js'
import { attachBrowserCarrier } from './native-message.js'
import { createSharedWorkerCarrier } from './adapters/shared-worker.js'
import { listenBrowserPorts } from './peer-listener.js'
import type { ISharedWorkerPluginOptions } from './peer-types.js'

/** Capture one existing page port or native connect scope; no physical effect occurs cold. */
export function sharedWorkerPlugin<const N extends string = 'sharedWorker'>(
  options: ISharedWorkerPluginOptions & Readonly<{ namespace?: N }>
): IRpcTransportPlugin<NoInfer<N>, Record<never, never>, true> {
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
    open: (context) =>
      scope
        ? listenBrowserPorts(scope, context)
        : attachBrowserCarrier(createSharedWorkerCarrier(port!, context), context)
  })
}
