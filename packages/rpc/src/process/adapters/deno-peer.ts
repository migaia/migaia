import { createAutomaticProcessPeer } from '../automatic-peer.js'
import type { IRuntimePeerOptions } from '../../remote/runtime-api/peer.js'
import { createProcessSourcePeer, type IRuntimeProcessPeerOptions } from '../runtime-peer.js'
import { PROCESS_RUNTIME_API_ENV, PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS } from '../constants.js'
import { openProcessStdioChannel } from './deno-command.js'

/** Deno discovery borrows its native environment and stream owner, never a Node stdin shim. */
export function createProcessPeer(options: IRuntimeProcessPeerOptions) {
  /** This deep adapter is selected only in a native Deno runtime. */
  const runtime = Reflect.get(globalThis, 'Deno') as {
    env: { get(key: string): string | undefined }
  }
  /** Genuine automatic context keeps precedence over explicit source effects. */
  const marker = runtime.env.get(PROCESS_RUNTIME_API_ENV)
  if (!marker && (typeof options.spawn === 'object' || typeof options.connect === 'object'))
    return createProcessSourcePeer(options, 'deno')
  return createAutomaticProcessPeer(options as IRuntimePeerOptions, {
    marker,
    runtime: 'deno',
    open: () =>
      openProcessStdioChannel({
        bootstrap: 'stdin',
        bootstrapTimeoutMs: PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS
      })
  })
}
