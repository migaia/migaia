import { readRuntimeDefaultTimeout } from '../remote/runtime-api/timeout.js'
import type { IRuntimeTypedPeer, IRuntimeFlatten } from '../remote/runtime-api/typing.js'
import { createRuntimePeer, type IRuntimePeerOptions } from '../remote/runtime-api/peer.js'
import type { IRuntimeProcessPeerOptions } from './runtime-peer.js'
import { RuntimePluginKey } from '../remote/runtime-api/constants.js'

/**
 * Discover genuine platform stdio in its existing deep adapter; explicit sources retain shared
 * assembly.
 */
export function createProcessPeer<TRemote = Record<never, never>>(
  options: IRuntimeProcessPeerOptions
): Promise<IRuntimeTypedPeer<TRemote, IRuntimeFlatten<TRemote>, typeof RuntimePluginKey.process>>
/** Platform implementations retain their original untyped internal callable owner. */
export function createProcessPeer(options: IRuntimeProcessPeerOptions): Promise<object> {
  readRuntimeDefaultTimeout(options)
  if (Reflect.get(globalThis, 'Deno'))
    return import('./adapters/deno-peer.js').then((adapter) => adapter.createProcessPeer(options))
  if (typeof process !== 'undefined' && process.versions?.node !== undefined)
    return import('./adapters/node-peer.js').then((adapter) => adapter.createProcessPeer(options))
  return createRuntimePeer(options as IRuntimePeerOptions, undefined, RuntimePluginKey.process)
}
