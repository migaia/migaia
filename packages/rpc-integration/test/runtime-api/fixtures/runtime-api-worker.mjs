import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
import { createRpcHost } from '@migaia/rpc-host'
import { idempotencyFeature } from '@migaia/rpc-host/plugins/idempotency'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { provide, report } from './runtime-api-provide.mjs'

/** The actual Node parentPort or Web Worker bootstrap supplies actual native source provenance. */
await createRpcHost({
  plugins: [
    rpcFeaturesPlugin({ features: { idempotency: idempotencyFeature() } }),
    threadPlugin({ connectToParent: true })
  ],
  provide,
  report
})
