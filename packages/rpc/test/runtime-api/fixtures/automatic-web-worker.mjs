import { createThreadPeer } from '../../../dist/threads/index.js'

/** Capture genuine worker bootstrap before the module's first top-level await. */
let initialized
initialized = createThreadPeer({
  provide: {
    /** Genuine reverse dispatch is independent from bootstrap-returned identity labels. */
    probe: async (value) => {
      const peer = await initialized
      return { value, self: peer.self, parent: await peer.request('parentEcho') }
    }
  },
  report: () => undefined
})
await initialized
