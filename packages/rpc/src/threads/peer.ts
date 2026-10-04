import {
  createRuntimePeer,
  type IRuntimePeer,
  type IRuntimePeerOptions
} from '../remote/runtime-api/peer.js'
import { createAutomaticWebThreadPeer } from './automatic-peer.js'
import type { IThreadWebPort } from './types.js'

/** Platform-owned context plus validated library bootstrap grants automatic discovery. */
export function createThreadPeer(options: IRuntimePeerOptions): Promise<IRuntimePeer> {
  /** Browser/Deno worker globals have independent native type identity. */
  const Scope = Reflect.get(globalThis, 'WorkerGlobalScope') as
    | (new (...args: never[]) => object)
    | undefined
  /** Bun supplies an independent worker-context flag even without WorkerGlobalScope. */
  const bun = Reflect.get(globalThis, 'Bun') as { isMainThread?: boolean } | undefined
  if (
    (typeof Scope === 'function' && globalThis instanceof Scope) ||
    (bun?.isMainThread === false && typeof Reflect.get(globalThis, 'postMessage') === 'function')
  )
    return createAutomaticWebThreadPeer(options, globalThis as unknown as IThreadWebPort)
  if (
    (typeof process !== 'undefined' && process.versions?.node !== undefined) ||
    Reflect.get(globalThis, 'Deno')
  )
    return import('./adapters/node-peer.js').then((adapter) => adapter.createThreadPeer(options))
  return createRuntimePeer(options)
}
