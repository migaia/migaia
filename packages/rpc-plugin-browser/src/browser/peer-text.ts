/** These native event names are shared by the Peer carrier bridge and listener owner. */
export const BrowserPeerEvent = {
  message: 'message',
  connect: 'connect',
  messageError: 'messageerror',
  closing: 'closing',
  close: 'close',
  error: 'error'
} as const

/** Native RTC ready states are admission facts, independent of RPC session state. */
export const BrowserNativeState = { open: 'open', closed: 'closed' } as const

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

/** Default namespaces identify browser media, independently from native definition names. */
export const BrowserNamespace = {
  window: 'window',
  worker: 'worker',
  shared: 'sharedWorker',
  rtc: 'rtcDataChannel',
  broadcast: 'broadcastChannel',
  service: 'serviceWorker',
  webTransport: 'webTransport'
} as const
