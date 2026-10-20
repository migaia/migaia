import { createProcessPeer } from '@migaia/rpc-process'
import { provide, report } from './runtime-api-provide.mjs'

/** The original automatic stdin bootstrap supplies actual identity, offer, auth and execution facts. */
await createProcessPeer({ provide, report })
