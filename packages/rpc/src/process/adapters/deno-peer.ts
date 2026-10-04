import { createAutomaticProcessPeer } from '../automatic-peer.js'
import type { IRuntimePeerOptions } from '../../remote/runtime-api/peer.js'
import { PROCESS_RUNTIME_API_ENV, PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS } from '../constants.js'
import { openProcessStdioChannel } from './deno-command.js'

/** Deno discovery borrows its native environment and stream owner, never a Node stdin shim. */
export function createProcessPeer(options: IRuntimePeerOptions) {
  /** This deep adapter is selected only in a native Deno runtime. */
  const runtime = Reflect.get(globalThis, 'Deno') as {
    env: { get(key: string): string | undefined }
  }
  return createAutomaticProcessPeer(options, {
    marker: runtime.env.get(PROCESS_RUNTIME_API_ENV),
    runtime: 'deno',
    open: () =>
      openProcessStdioChannel({
        bootstrap: 'stdin',
        bootstrapTimeoutMs: PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS
      })
  })
}
