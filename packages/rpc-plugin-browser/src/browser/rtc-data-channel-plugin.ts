/** Validates a borrowed reliable RTC channel and builds its cold transport definition. */
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'
import type { IRpcTransportPlugin, IRpcTransportFeatureExtensions } from '@migaia/rpc-host/sdk'
import { BrowserPeerErrorText } from '../error-text.js'
import { RpcBrowserErrorCode } from '@migaia/rpc-contract/error-code'
import { createBrowserPeerError } from './peer-error.js'
import { BrowserPluginName, BrowserNamespace } from './peer-text.js'
import { attachBrowserCarrier } from './native-message.js'
import { createRtcDataChannelCarrier } from './adapters/rtc-data-channel.js'
import type { IRtcDataChannelPluginOptions } from './peer-types.js'
import type { IBrowserFeature } from './plugin-types.js'

/** Capture an already ordered/reliable native channel; no signaling or implicit native close. */
export function rtcDataChannelPlugin<
  const N extends string = 'rtcDataChannel',
  const TFeatures extends readonly IBrowserFeature[] = readonly IBrowserFeature[]
>(
  options: IRtcDataChannelPluginOptions & Readonly<{ namespace?: N; features?: TFeatures }>
): IRpcTransportPlugin<NoInfer<N>, IRpcTransportFeatureExtensions<TFeatures[number]>, true> {
  /** Native reliability settings are admitted before any listener acquisition. */
  const channel = options?.rtcDataChannel
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
  return defineTransportPlugin({
    name: options.name ?? BrowserPluginName.rtc,
    namespace: (options.namespace ?? BrowserNamespace.rtc) as N,
    closingWrites: true,
    expose: options.expose,
    features: options.features,
    handshakeTimeoutMs: options.connect?.timeoutMs,
    open: (context) => attachBrowserCarrier(createRtcDataChannelCarrier(channel, context), context)
  }) as IRpcTransportPlugin<NoInfer<N>, IRpcTransportFeatureExtensions<TFeatures[number]>, true>
}
