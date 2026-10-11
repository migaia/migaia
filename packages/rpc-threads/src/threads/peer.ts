import { createAdapterNodeThreadPeer } from './node-peer.js'
import { threadRuntimeResource } from './runtime-resource.js'
import type { IThreadRuntimeResource } from './runtime-types.js'
import { validateAdapterPeerTimeout } from '@migaia/rpc-core/adapter'
import type { IRuntimeTypedPeer } from '@migaia/rpc-core/remote'
import { createRuntimePeer, type IRuntimePeerOptions } from '@migaia/rpc-core/remote'
import { createAutomaticWebThreadPeer } from './automatic-peer.js'
import type { IThreadWebPort } from './types.js'
import { createThreadSourcePeer, type IRuntimeThreadPeerOptions } from './runtime-peer.js'

/** Platform-owned context plus validated library bootstrap grants automatic discovery. */
export function createThreadPeer<TRemote = Record<never, never>>(
  options: IRuntimeThreadPeerOptions,
  runtime?: IThreadRuntimeResource
): Promise<IRuntimeTypedPeer<TRemote>>
/** Platform implementations retain their original untyped internal callable owner. */
export function createThreadPeer(
  options: IRuntimeThreadPeerOptions,
  runtime: IThreadRuntimeResource = threadRuntimeResource
): Promise<object> {
  validateAdapterPeerTimeout(options)
  /** Browser automatic discovery is limited to genuine dedicated Worker globals. */
  const Scope = Reflect.get(globalThis, 'DedicatedWorkerGlobalScope') as
    | (new (...args: never[]) => object)
    | undefined
  /** Deno supports dedicated module Workers through its own WorkerGlobalScope identity. */
  const DenoScope = Reflect.get(globalThis, 'Deno')
    ? (Reflect.get(globalThis, 'WorkerGlobalScope') as
        | (new (...args: never[]) => object)
        | undefined)
    : undefined
  /** Bun supplies an independent worker-context flag even without WorkerGlobalScope. */
  const bun = Reflect.get(globalThis, 'Bun') as { isMainThread?: boolean } | undefined
  if (
    (typeof Scope === 'function' && globalThis instanceof Scope) ||
    (typeof DenoScope === 'function' && globalThis instanceof DenoScope) ||
    (bun?.isMainThread === false && typeof Reflect.get(globalThis, 'postMessage') === 'function')
  )
    return createAutomaticWebThreadPeer(
      options as IRuntimePeerOptions,
      globalThis as unknown as IThreadWebPort
    )
  if (
    (typeof process !== 'undefined' && process.versions?.node !== undefined) ||
    Reflect.get(globalThis, 'Deno')
  )
    return runtime
      .load()
      .then((native) => createAdapterNodeThreadPeer(options, native.parentPort, native.workerData))
  return typeof options.spawn === 'object'
    ? createThreadSourcePeer(options)
    : createRuntimePeer(options as IRuntimePeerOptions)
}
