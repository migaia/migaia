import { createRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { provide, report } from './runtime-api-provide.mjs'

/** The actual Node parentPort or Web Worker bootstrap supplies actual native source provenance. */
await createRpcHost({
  plugins: [threadPlugin({ connectToParent: true })],
  provide,
  report
})
