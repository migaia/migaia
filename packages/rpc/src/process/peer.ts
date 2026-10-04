import {
  createRuntimePeer,
  type IRuntimePeer,
  type IRuntimePeerOptions
} from '../remote/runtime-api/peer.js'
import type { IRuntimeProcessPeerOptions } from './runtime-peer.js'

/**
 * Discover genuine platform stdio in its existing deep adapter; explicit sources retain shared
 * assembly.
 */
export function createProcessPeer(options: IRuntimeProcessPeerOptions): Promise<IRuntimePeer> {
  if (Reflect.get(globalThis, 'Deno'))
    return import('./adapters/deno-peer.js').then((adapter) => adapter.createProcessPeer(options))
  if (typeof process !== 'undefined' && process.versions?.node !== undefined)
    return import('./adapters/node-peer.js').then((adapter) => adapter.createProcessPeer(options))
  return createRuntimePeer(options as IRuntimePeerOptions)
}
