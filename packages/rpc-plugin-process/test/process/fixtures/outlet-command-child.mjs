import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'

/**
 * Resolves with this generation's Peer. The parent may send its first request as soon as the
 * handshake completes, which can precede the return of `createRpcHost` below; `identity` therefore
 * waits for the Peer instead of reading a binding that is not initialized yet.
 */
let resolvePeer
/** Settles once `createRpcHost` returns; consumed only by the `identity` provider. */
const peerReady = new Promise((resolve) => {
  resolvePeer = resolve
})

/** Automatic stdio bootstrap admits a new identity for every real child generation. */
const peer = await createRpcHost({
  provide: {
    math: {
      /** @param {number} value Input number. @returns {number} Doubled value. */
      double: (value) => value * 2
    },
    /** @returns {Promise<string>} This generation's original accepted identity. */
    identity: async () => (await peerReady).self.instanceId
  },
  report: (error) => console.error(error),
  plugins: [processPlugin({ connectToParent: true })]
})
resolvePeer(peer)
