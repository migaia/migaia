/** Peer names, origins and provider names of the browser forwarding topologies. */
export const BrowserTopology = {
  /** Second Vite origin serving the cross-origin iframe. */
  frameOrigin: 'http://127.0.0.1:4179',
  /** Peer name of the iframe as the top window sees it. */
  frame: 'frame',
  /** Peer name of the top window as the iframe sees it. */
  top: 'top',
  /** Peer name of the dedicated worker leaf as the top window sees it. */
  worker: 'w',
  /** Peer name of the SharedWorker hub as each tab sees it. */
  hub: 'hub',
  /** Top-window provider that closes its worker namespace while a forwarded call is in flight. */
  closeWorker: 'closeWorker'
} as const
