/** These native event names are shared by the Peer carrier bridge and listener owner. */
export const BrowserPeerEvent = { message: 'message', connect: 'connect' } as const

/** Source names are public option discriminants, never accepted handshake or trust claims. */
export const BrowserPeerSource = {
  window: 'window',
  sharedWorker: 'sharedWorker',
  rtcDataChannel: 'rtcDataChannel'
} as const

/** Default addressing stays descriptive; Core generates the actual local connection identity. */
export const BrowserPeerText = { name: 'browser' } as const
