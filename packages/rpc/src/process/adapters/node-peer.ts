import { createAutomaticProcessPeer } from '../automatic-peer.js'
import type { IRuntimePeerOptions } from '../../remote/runtime-api/peer.js'
import { createProcessSourcePeer, type IRuntimeProcessPeerOptions } from '../runtime-peer.js'
import { PROCESS_RUNTIME_API_ENV, PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS } from '../constants.js'
import { openProcessStdioChannel } from './node-child-process.js'

/** Node and Bun use their original Node-compatible byte adapter for genuine child stdio. */
export function createProcessPeer(options: IRuntimeProcessPeerOptions) {
  /** Automatic source authority is checked before accepting any full explicit deployment. */
  const marker = process.env[PROCESS_RUNTIME_API_ENV]
  /** Node-compatible launchers retain the runtime's actual protocol label. */
  const runtime = process.versions.bun === undefined ? 'node' : 'bun'
  if (!marker && (typeof options.spawn === 'object' || typeof options.connect === 'object'))
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
