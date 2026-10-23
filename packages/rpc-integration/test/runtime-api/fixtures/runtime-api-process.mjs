import { createProcessPeer } from '../../../../rpc-plugin-process/test/protocol.ts'
import { provide, report } from './runtime-api-provide.mjs'

/** The original automatic stdin bootstrap supplies actual identity, offer, auth and execution facts. */
await createProcessPeer({ provide, report })
