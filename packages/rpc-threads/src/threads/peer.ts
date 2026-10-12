import { createAdapterNodeThreadPeer } from './node-peer.js'
import { threadRuntimeResource } from './runtime-resource.js'
import type { IThreadRuntimeResource } from './runtime-types.js'
import { prepareAdapterPeer, validateAdapterPeerTimeout } from '@migaia/rpc-core/adapter'
import type { IRuntimeTypedPeer } from '@migaia/rpc-core/remote'
import { RuntimePluginKey, type IRuntimePeerOptions } from '@migaia/rpc-core/remote'
import { createAutomaticWebThreadPeer } from './automatic-peer.js'
import { createThreadSourcePeer, type IRuntimeThreadPeerOptions } from './runtime-peer.js'
import { threadWebParent } from './child.js'
import { expandThreadSpawn, isShortThreadSpawn } from './short-spawn.js'

/** Create one owned or borrowed Worker Peer; entry shorthand uses the existing deployment path. */
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
  /** The actual Worker global selects automatic discovery; bootstrap still grants the connection. */
  const parent = threadWebParent()
  if (parent) return createAutomaticWebThreadPeer(options, parent)
  if (isShortThreadSpawn(options.spawn))
    return expandThreadSpawn(options, runtime).then((source) =>
      createThreadSourcePeer(options, source)
    )
  if (
    (typeof process !== 'undefined' && process.versions?.node !== undefined) ||
    Reflect.get(globalThis, 'Deno')
  )
    return runtime
      .load()
      .then((native) => createAdapterNodeThreadPeer(options, native.parentPort, native.workerData))
  if (typeof options.spawn === 'object') return createThreadSourcePeer(options)
  /** Main-thread borrowed sources use the same Core-generated default address as spawn sources. */
  const preparation = prepareAdapterPeer(options, RuntimePluginKey.thread)
  return preparation.peer({
    ...options,
    self: preparation.context.self,
    report: options.report ?? console.error
  } as IRuntimePeerOptions)
}
