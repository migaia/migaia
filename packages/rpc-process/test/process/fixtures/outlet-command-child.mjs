import { createProcessPeer } from '@migaia/rpc-process'

/**
 * Resolves with this generation's Peer. The parent may send its first request as soon as the
 * handshake completes, which can precede the return of `createProcessPeer` below; `identity`
 * therefore waits for the Peer instead of reading a binding that is not initialized yet.
 */
let resolvePeer
/** Settles once `createProcessPeer` returns; consumed only by the `identity` provider. */
const peerReady = new Promise((resolve) => {
  resolvePeer = resolve
})

/** Automatic stdio bootstrap admits a new identity for every real child generation. */
const peer = await createProcessPeer({
  provide: {
    math: {
      /** @param {number} value Input number. @returns {number} Doubled value. */
      double: (value) => value * 2
    },
    /** @returns {Promise<string>} This generation's original accepted identity. */
    identity: async () => (await peerReady).self.instanceId
  },
  /** @param {unknown} error Original diagnostic. @returns {void} */
  report: (error) => console.error(error)
})
resolvePeer(peer)
