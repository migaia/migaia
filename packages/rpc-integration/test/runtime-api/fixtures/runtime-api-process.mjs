import { defineFlowPlugin } from '@migaia/rpc-host/sdk'
import { createRpcHost } from '@migaia/rpc-host'
import { idempotencyFeature } from '@migaia/rpc-host/features/idempotency'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { provide, report } from './runtime-api-provide.mjs'

/** Automatic stdin bootstrap supplies actual identity, offer, auth and execution facts. */
await createRpcHost({
  provide,
  report,
  plugins: [
    defineFlowPlugin({
      name: 'rpc-flow-features',
      features: { idempotency: idempotencyFeature() }
    }),
    processPlugin({ connectToParent: true })
  ]
})
