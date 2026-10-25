/**
 * Builds the transport definition for a borrowed Worker or worker global without launching its
 * owner.
 */
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'
import type { IRpcTransportPlugin } from '@migaia/rpc-host/sdk'
import { BrowserPeerErrorText } from '../error-text.js'
import { RpcBrowserErrorCode } from '@migaia/rpc-contract/error-code'
import { createBrowserPeerError } from './peer-error.js'
import { BrowserPluginName, BrowserNamespace } from './peer-text.js'
import { attachBrowserCarrier } from './native-message.js'
import type { IWorkerPluginOptions } from './peer-types.js'
import { createDedicatedWorkerCarrier } from './adapters/dedicated-worker.js'

/** Borrow a real Worker or worker self; installation never launches or terminates its native owner. */
export function dedicatedWorkerPlugin<const N extends string = 'worker'>(
  options: IWorkerPluginOptions & Readonly<{ namespace?: N }>
): IRpcTransportPlugin<NoInfer<N>> {
  /** Source admission is cold and precedes all native subscriptions. */
  const worker = options?.worker
  if (
    !worker ||
    typeof worker.postMessage !== 'function' ||
    typeof worker.addEventListener !== 'function' ||
    typeof worker.removeEventListener !== 'function'
  )
    throw createBrowserPeerError(
      RpcBrowserErrorCode.invalidPeerSource,
      BrowserPeerErrorText.invalidPeerSource
    )
  return defineTransportPlugin({
    name: options.name ?? BrowserPluginName.worker,
    namespace: (options.namespace ?? BrowserNamespace.worker) as N,
    expose: options.expose,
    features: options.features,
    handshakeTimeoutMs: options.connect?.timeoutMs,
    open: (context) => attachBrowserCarrier(createDedicatedWorkerCarrier(worker, context), context)
  })
}
