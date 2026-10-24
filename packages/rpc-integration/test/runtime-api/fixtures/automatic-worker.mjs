import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
/** The canonical Host remains the automatic bootstrap protocol baseline. */
let initialized
initialized = createRpcHost({
  plugins: [threadPlugin({ connectToParent: true })],
  provide: {
    /** Await this actual Host result before exercising reverse business. */
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
