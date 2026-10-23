import { createThreadPeer } from '../../../../rpc-plugin-thread/test/protocol.ts'
import { provide, report } from './runtime-api-provide.mjs'

/** The original Node parentPort or Web Worker bootstrap supplies actual native source provenance. */
await createThreadPeer({ provide, report })
