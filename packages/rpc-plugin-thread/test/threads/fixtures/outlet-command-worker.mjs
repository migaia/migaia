import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'

/** The admitted Peer identity distinguishes each real native generation. */
const peer = await createRpcHost({
  provide: {
    math: {
      /** @param {number} value Input number. @returns {number} Doubled value. */
      double: (value) => value * 2
    },
    /** @returns {string} This generation's original accepted identity. */
    identity: () => peer.self.instanceId
  },
  /** @param {unknown} error Original diagnostic. @returns {void} */
  report: (error) => console.error(error),
  plugins: [threadPlugin({ connectToParent: true })]
})
