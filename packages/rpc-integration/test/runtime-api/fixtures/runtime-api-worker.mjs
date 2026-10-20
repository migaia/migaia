import { createThreadPeer } from '@migaia/rpc-threads'
import { provide, report } from './runtime-api-provide.mjs'

/** The original Node parentPort or Web Worker bootstrap supplies actual native source provenance. */
await createThreadPeer({ provide, report })
