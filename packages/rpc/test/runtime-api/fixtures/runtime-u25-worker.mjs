import { createThreadPeer } from '../../../dist/threads/index.js'
import { provide, report } from './runtime-u25-provide.mjs'

/** The original Node parentPort or Web Worker bootstrap supplies actual native source provenance. */
await createThreadPeer({ provide, report })
