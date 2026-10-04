import { createAutomaticProcessPeer } from '../automatic-peer.js'
import type { IRuntimePeerOptions } from '../../remote/runtime-api/peer.js'
import { PROCESS_RUNTIME_API_ENV, PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS } from '../constants.js'
import { openProcessStdioChannel } from './node-child-process.js'

/** Node and Bun use their original Node-compatible byte adapter for genuine child stdio. */
export function createProcessPeer(options: IRuntimePeerOptions) {
  return createAutomaticProcessPeer(options, {
    marker: process.env[PROCESS_RUNTIME_API_ENV],
    runtime: process.versions.bun === undefined ? 'node' : 'bun',
    open: () =>
      openProcessStdioChannel({
        bootstrap: 'stdin',
        bootstrapTimeoutMs: PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS
      })
  })
}
