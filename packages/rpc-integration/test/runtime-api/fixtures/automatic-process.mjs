import { execFile } from 'node:child_process'
import { PROCESS_RUNTIME_API_ENV } from '../../../../rpc-plugin-process/dist/process/constants.js'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'

/** The canonical private bootstrap owner is the preserved protocol baseline. */
let initialized
initialized = createRpcHost({
  plugins: [processPlugin({ connectToParent: true })],
  provide: {
    /** A real nested launch inherits the current environment without a fixture marker override. */
    auditSource: async () => {
      const script = `import { createRpcHost } from ${JSON.stringify(new URL('../../../../rpc-host/dist/index.js', import.meta.url).href)};
import { processPlugin } from ${JSON.stringify(new URL('../../../../rpc-plugin-process/dist/process/index.js', import.meta.url).href)};
const before = process.stdin.listenerCount('data');
try { await createRpcHost({plugins: [processPlugin({connectToParent: true})], report: () => undefined}); }
catch (error) { console.log(JSON.stringify({code: error.code, before, after: process.stdin.listenerCount('data')})); }`
      const grandchild = await new Promise((resolve, reject) => {
        execFile(
          process.execPath,
          ['--input-type=module', '-e', script],
          { timeout: 2000 },
          (error, output) => {
            if (error) reject(error)
            else resolve(JSON.parse(output))
          }
        )
      })
      return { consumed: process.env[PROCESS_RUNTIME_API_ENV] === undefined, grandchild }
    },
    /** The actual Host result owns identity; fixture metadata never fabricates one. */
    probe: async (value) => {
      const peer = await initialized
      return { value, self: peer.self, parent: await peer.process.request('parentEcho') }
    }
  },
  report: () => undefined
})
await initialized
