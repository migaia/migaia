/** These native event names are shared by the Peer carrier bridge and listener owner. */
export const BrowserPeerEvent = { message: 'message', connect: 'connect' } as const

/** Source names are public option discriminants, never accepted handshake or trust claims. */
export const BrowserPeerSource = {
  window: 'window',
  worker: 'worker',
  sharedWorker: 'sharedWorker',
  rtcDataChannel: 'rtcDataChannel'
} as const

/** Default local plugin registrations distinguish carrier definitions without naming remote peers. */
export const BrowserPluginName = {
  window: 'rpc-window',
  worker: 'rpc-dedicated-worker',
  shared: 'rpc-shared-worker',
  rtc: 'rpc-rtc-data-channel'
} as const
