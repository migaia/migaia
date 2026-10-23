import { createThreadPeer } from '../../../../rpc-plugin-thread/test/protocol.ts'
/** The original native owner remains the automatic bootstrap protocol baseline. */
let initialized
initialized = createThreadPeer({
  provide: {
    /** Await this original factory result before exercising reverse business. */
    probe: async (value) => {
      const peer = await initialized
      return { value, self: peer.self, parent: await peer.request('parentEcho') }
    },
    /** Preserve the existing default binary stream behavior. */
    values: async function* (value) {
      yield value
    }
  },
  report: (error) => process.stderr.write(`${error?.code ?? 'fixture-error'}\n`)
})
await initialized
