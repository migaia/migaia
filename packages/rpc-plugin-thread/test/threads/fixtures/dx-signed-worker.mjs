import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { workerData } from 'node:worker_threads'
import { readThreadBootstrap } from '../../../dist/threads/bootstrap.js'
import { createFixtureAuthentication } from './dx-authentication.mjs'

/** Native launch input carries test configuration; each endpoint independently installs credentials. */
const { data } = readThreadBootstrap(workerData)
/** Provider count proves signature failures occur before application execution. */
let calls = 0
await createRpcHost({
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
  report: (error) => process.stderr.write(`${error?.stack ?? String(error)}\n`),
  plugins: [threadPlugin({ connectToParent: true })]
})
