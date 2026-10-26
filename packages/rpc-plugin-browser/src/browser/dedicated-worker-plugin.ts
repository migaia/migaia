/**
 * Builds the transport definition for a borrowed Worker or worker global without launching its
 * owner.
 */
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'
import type { IRpcTransportPlugin, IRpcTransportFeatureExtensions } from '@migaia/rpc-host/sdk'
import { BrowserPeerErrorText } from '../error-text.js'
import { RpcBrowserErrorCode } from '@migaia/rpc-contract/error-code'
import { createBrowserPeerError } from './peer-error.js'
import { BrowserPluginName, BrowserNamespace } from './peer-text.js'
import { attachBrowserCarrier } from './native-message.js'
import type { IWorkerPluginOptions } from './peer-types.js'
import { createDedicatedWorkerCarrier } from './adapters/dedicated-worker.js'
import type { IBrowserFeature } from './plugin-types.js'

/** Borrow a real Worker or worker self; installation never launches or terminates its native owner. */
export function dedicatedWorkerPlugin<
  const N extends string = 'worker',
  const TFeatures extends readonly IBrowserFeature[] = readonly IBrowserFeature[]
>(
  options: IWorkerPluginOptions & Readonly<{ namespace?: N; features?: TFeatures }>
): IRpcTransportPlugin<NoInfer<N>, IRpcTransportFeatureExtensions<TFeatures[number]>, true> {
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
    closingWrites: true,
    expose: options.expose,
    features: options.features,
    handshakeTimeoutMs: options.connect?.timeoutMs,
    connect: { retain: options.connect?.retain },
    open: (context) => attachBrowserCarrier(createDedicatedWorkerCarrier(worker, context), context)
  }) as IRpcTransportPlugin<NoInfer<N>, IRpcTransportFeatureExtensions<TFeatures[number]>, true>
}
