import type { Readable, Writable } from 'node:stream'
import { Buffer } from 'node:buffer'
import { createRuntimeEventByteIO } from '@migaia/rpc-host/plugin'
import { ProcessChannelDiagnostics } from './diagnostics.js'

/** Node glue supplies actual streams; Core constructs and observes the physical byte resource. */
export function nodeByteStream(readable: Readable, writable: Writable, destroy: () => void) {
  return createRuntimeEventByteIO(
    readable,
    writable,
    { close: destroy },
    ProcessChannelDiagnostics.closed,
    Buffer
  )
}
