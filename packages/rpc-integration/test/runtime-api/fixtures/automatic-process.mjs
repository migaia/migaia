import { execFile } from 'node:child_process'
import { PROCESS_RUNTIME_API_ENV } from '../../../../rpc-plugin-process/dist/process/constants.js'
import { createProcessPeer } from '../../../../rpc-plugin-process/test/protocol.ts'

/** The canonical private bootstrap owner is the preserved protocol baseline. */
let initialized
initialized = createProcessPeer({
  provide: {
    /** A real nested launch inherits the current environment without a fixture marker override. */
    auditSource: async () => {
      const script = `import { createProcessPeer } from ${JSON.stringify(new URL('../../../../rpc-plugin-process/test/protocol.ts', import.meta.url).href)};
const before = process.stdin.listenerCount('data');
try { await createProcessPeer({report: () => undefined}); }
catch (error) { console.log(JSON.stringify({code: error.code, before, after: process.stdin.listenerCount('data')})); }`
      const grandchild = await new Promise((resolve) => {
        execFile(
          process.execPath,
          ['--input-type=module', '-e', script],
          { timeout: 2000 },
          (error, output) => {
            resolve(error ? { code: 'NATIVE_CHILD_TIMEOUT' } : JSON.parse(output))
          }
        )
      })
      return { consumed: process.env[PROCESS_RUNTIME_API_ENV] === undefined, grandchild }
    },
    /** The actual factory result owns identity; fixture metadata never fabricates one. */
    probe: async (value) => {
      const peer = await initialized
      return { value, self: peer.self, parent: await peer.request('parentEcho') }
    }
  },
  report: () => undefined
})
await initialized
