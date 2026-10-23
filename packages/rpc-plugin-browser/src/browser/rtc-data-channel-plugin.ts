import type { IRpcTransportPlugin } from '@migaia/rpc-host/plugin'
import { defineTransportPlugin, RpcTransportMode } from '@migaia/rpc-host/plugin'
import { BrowserPeerErrorText } from '../error-text.js'
import { RpcBrowserErrorCode } from '../error-code.js'
import { createBrowserPeerError } from './peer-error.js'
import { BrowserPluginName } from './peer-text.js'
import { getBrowserMessageAdapter } from './peer-adapter.js'
import type { IRtcDataChannelPluginOptions } from './peer-types.js'

/** Capture only an ordered reliable channel; native signaling and channel ownership stay borrowed. */
export function rtcDataChannelPlugin(options: IRtcDataChannelPluginOptions): IRpcTransportPlugin {
  /** The actual channel exposes its negotiated native reliability settings. */
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
    expose: options.expose,
    connect: options.connect,
    mode: RpcTransportMode.connect,
    deployment: getBrowserMessageAdapter().deployment({ connect: { rtcDataChannel: channel } })
  })
}
