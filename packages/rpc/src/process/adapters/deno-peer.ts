import { createAutomaticProcessPeer } from '../automatic-peer.js'
import type { IRuntimePeerOptions } from '../../remote/runtime-api/peer.js'
import { createProcessSourcePeer, type IRuntimeProcessPeerOptions } from '../runtime-peer.js'
import { PROCESS_RUNTIME_API_ENV, PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS } from '../constants.js'
import { openProcessStdioChannel } from './deno-command.js'

/** Only this process retains consumed discovery; grandchildren inherit no automatic authority. */
let automaticMarker: string | undefined

/** Deno discovery borrows its native environment and stream owner, never a Node stdin shim. */
export function createProcessPeer(options: IRuntimeProcessPeerOptions) {
  /** This deep adapter is selected only in a native Deno runtime. */
  const runtime = Reflect.get(globalThis, 'Deno') as {
    env: { get(key: string): string | undefined; delete(key: string): void }
    permissions: {
      querySync(descriptor: { name: 'env'; variable: string }): { state: string }
    }
  }
  /** Discovery never asks for permission or reads a denied environment variable. */
  const permitted =
    runtime.permissions.querySync({ name: 'env', variable: PROCESS_RUNTIME_API_ENV }).state ===
    'granted'
  /** Genuine consumed context retains precedence over explicit source effects. */
  const marker =
    automaticMarker ?? (permitted ? runtime.env.get(PROCESS_RUNTIME_API_ENV) : undefined)
  if (marker !== undefined && permitted) {
    automaticMarker = marker
    runtime.env.delete(PROCESS_RUNTIME_API_ENV)
  }
  if (
    !marker &&
    (typeof options.spawn === 'object' ||
      typeof options.connect === 'object' ||
      typeof options.listen === 'object')
  )
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
