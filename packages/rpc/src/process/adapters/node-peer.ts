import { readRuntimeDefaultTimeout } from '../../remote/runtime-api/timeout.js'
import { createAutomaticProcessPeer } from '../automatic-peer.js'
import type { IRuntimePeerOptions } from '../../remote/index.js'
import { createProcessSourcePeer, type IRuntimeProcessPeerOptions } from '../runtime-peer.js'
import { PROCESS_RUNTIME_API_ENV, PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS } from '../constants.js'
import { openProcessStdioChannel } from './node-child-process.js'

/** Consumed discovery remains local so repeated factories retain the original strict automatic gate. */
let automaticMarker: string | undefined

/** Node and Bun use their original Node-compatible byte adapter for genuine child stdio. */
export function createProcessPeer(options: IRuntimeProcessPeerOptions) {
  readRuntimeDefaultTimeout(options)
  /** Automatic source authority is checked before accepting any full explicit deployment. */
  const marker = automaticMarker ?? process.env[PROCESS_RUNTIME_API_ENV]
  if (marker !== undefined) {
    automaticMarker = marker
    delete process.env[PROCESS_RUNTIME_API_ENV]
  }
  /** Node-compatible launchers retain the runtime's actual protocol label. */
  const runtime = process.versions.bun === undefined ? 'node' : 'bun'
  if (
    !marker &&
    (typeof options.spawn === 'object' ||
      typeof options.connect === 'object' ||
      typeof options.listen === 'object')
  )
    return createProcessSourcePeer(options, runtime)
  return createAutomaticProcessPeer(options as IRuntimePeerOptions, {
    marker,
    runtime,
    open: () =>
      openProcessStdioChannel({
        bootstrap: 'stdin',
        bootstrapTimeoutMs: PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS
      })
  })
}
