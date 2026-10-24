import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { provide, report } from './runtime-api-provide.mjs'

/** Automatic stdin bootstrap supplies actual identity, offer, auth and execution facts. */
await createRpcHost({ provide, report, plugins: [processPlugin({ connectToParent: true })] })
