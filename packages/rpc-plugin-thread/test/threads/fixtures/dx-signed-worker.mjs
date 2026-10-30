import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { workerData } from 'node:worker_threads'
import { readThreadBootstrap } from '../../../dist/threads/bootstrap.js'
import { createFixtureAuthentication } from './dx-authentication.mjs'

/** Native launch input carries test configuration; each endpoint independently installs credentials. */
const { data } = readThreadBootstrap(workerData)
/** Provider count proves signature failures occur before application execution. */
let calls = 0
await createRpcHost({
  provide: {
    bytes: {
      inspect: (buffer) => {
        calls += 1
        return { length: buffer.byteLength, first: new Uint8Array(buffer)[0] }
      },
      calls: () => calls,
      /** Returns the received view so the parent can inspect its restored backing and offset. */
      echo: (value) => value
    }
  },
  report: (error) => process.stderr.write(`${error?.stack ?? String(error)}\n`),
  plugins: [
    ...(data.signed
      ? [rpcFeaturesPlugin({ features: { security: authFeature(createFixtureAuthentication()) } })]
      : []),
    threadPlugin({ connectToParent: true })
  ]
})
import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
