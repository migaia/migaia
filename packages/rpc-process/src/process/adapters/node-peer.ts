import type { IAdapterProcessRuntimeIO } from '../peer.js'
import { PROCESS_RUNTIME_API_ENV, PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS } from '../constants.js'
import { openProcessStdioChannel } from './node-child-process.js'

/** Consumed discovery stays in this actual native process; a second factory sees the same marker. */
let automaticMarker: string | undefined

/** The actual Node/Bun stdio owner exposes discovery and I/O, never a Core preparation callback. */
class NativeNodeProcessRuntimeIO implements IAdapterProcessRuntimeIO {
  /** Read and consume the original environment marker before any explicit deployment is started. */
  discover() {
    /** A consumed marker remains local to the same native process and precedes ambient discovery. */
    const marker = automaticMarker ?? process.env[PROCESS_RUNTIME_API_ENV]
    if (marker !== undefined) {
      automaticMarker = marker
      delete process.env[PROCESS_RUNTIME_API_ENV]
    }
    /** Node-compatible I/O retains the actual host runtime's protocol diagnostic label. */
    const runtime = process.versions.bun === undefined ? 'node' : 'bun'
    return { marker, runtime }
  }

  /** Open this process's actual stdin/stdout through the existing native byte operation. */
  open() {
    return openProcessStdioChannel({
      bootstrap: 'stdin',
      bootstrapTimeoutMs: PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS
    })
  }
}

/** The native module hands Core the stdio resource it actually holds. */
export const processRuntimeIO = new NativeNodeProcessRuntimeIO()
