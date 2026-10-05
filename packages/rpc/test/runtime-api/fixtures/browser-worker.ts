import type { IRuntimeDynamicSurface } from '../../../src/remote/runtime-api/typing.js'
import { createThreadPeer } from '../../../src/threads/index.js'

/** The true DedicatedWorkerGlobalScope installs bootstrap capture before its first top-level await. */
let initialized: ReturnType<typeof createThreadPeer<IRuntimeDynamicSurface>>
initialized = createThreadPeer<IRuntimeDynamicSurface>({
  provide: {
    /** A separately observed parent provider proves genuine reverse dispatch. */
    probe: async (value: unknown) => {
      const peer = await initialized
      return { value, self: peer.self, parent: await peer.request('parentEcho') }
    }
  },
  report: () => undefined
})
await initialized
