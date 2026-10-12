import { workerData } from 'node:worker_threads'
import { createThreadPeer, readThreadBootstrap } from '@migaia/rpc-threads'
import { createFixtureAuthentication } from './dx-authentication.mjs'

/** Native launch input carries test configuration; each endpoint independently installs credentials. */
const { data } = readThreadBootstrap(workerData)
/** Provider count proves signature failures occur before application execution. */
let calls = 0
await createThreadPeer({
  ...(data.signed ? { authentication: createFixtureAuthentication() } : {}),
  provide: {
    bytes: {
      inspect: (buffer) => {
        calls += 1
        return { length: buffer.byteLength, first: new Uint8Array(buffer)[0] }
      },
      calls: () => calls
    }
  },
  report: (error) => process.stderr.write(`${error?.stack ?? String(error)}\n`)
})
