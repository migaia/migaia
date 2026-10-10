import { createProcessPeer } from '@migaia/rpc-process'
import { provide, report } from './runtime-u25-provide.mjs'

/** The original automatic stdin bootstrap supplies actual identity, offer, auth and execution facts. */
await createProcessPeer({ provide, report })
