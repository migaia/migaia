import { openNodeThreadTask } from './node-peer.js'
import { threadRuntimeResource } from './runtime-resource.js'
import type { IThreadRuntimeResource } from './runtime-types.js'
import type { IRuntimeTypedPeer } from '@migaia/rpc-core/remote'
import type { IRuntimePeerOptions } from '@migaia/rpc-core/remote'
import { createAutomaticWebThreadPeer } from './automatic-peer.js'
import { createThreadSourcePeer, type IRuntimeThreadPeerOptions } from './runtime-peer.js'
import { threadBunNativeParent, threadWebParent } from './child.js'
import { expandThreadSpawn, isShortThreadSpawn } from './short-spawn.js'
import { captureThreadTask } from './adapter.js'
import { defaultRpcReporter } from '@migaia/rpc-core'

/**
 * Open one Worker Peer from an owned spawn, borrowed source, or the current child's real bootstrap.
 * Await isThreadChild before self-spawning so the full entry does not recursively create Workers.
 * Closing an owned source drains under its supervisor budget and requests termination; borrowed
 * MessagePorts remain physically caller-owned. Invalid entries/data reject before Worker creation;
 * Core owns request deadlines, cancellation, authentication, and negotiated binary/transfer
 * support.
 */
export function createThreadPeer<TRemote = Record<never, never>>(
  options: IRuntimeThreadPeerOptions,
  runtime?: IThreadRuntimeResource
): Promise<IRuntimeTypedPeer<TRemote>>
/** Platform implementations retain their original untyped internal callable owner. */
export function createThreadPeer(
  options: IRuntimeThreadPeerOptions,
  runtime: IThreadRuntimeResource = threadRuntimeResource
): Promise<object> {
  /** SDK capture performs the original early timeout admission before any native discovery. */
  const task = captureThreadTask(options)
  /** Bun's native bootstrap takes priority over its compatibility Web globals. */
  const nativeParent = threadBunNativeParent()
  if (nativeParent)
    return openNodeThreadTask(options, nativeParent.parentPort, nativeParent.workerData, task)
  /** The actual Worker global selects automatic discovery; capture attaches without an await. */
  const parent = threadWebParent()
  if (parent) return createAutomaticWebThreadPeer(options, parent, task)
  if (isShortThreadSpawn(options.spawn))
    return expandThreadSpawn(options, runtime).then((source) =>
      createThreadSourcePeer(options, source, task)
    )
  if (
    (typeof process !== 'undefined' && process.versions?.node !== undefined) ||
    Reflect.get(globalThis, 'Deno')
  )
    return runtime
      .load()
      .then((native) => openNodeThreadTask(options, native.parentPort, native.workerData, task))
  if (typeof options.spawn === 'object') return createThreadSourcePeer(options, undefined, task)
  /** Main-thread borrowed sources use the same Core-generated default address as spawn sources. */
  const preparation = task.preparation
  return preparation.peer({
    ...options,
    self: preparation.context.self,
    report: options.report ?? defaultRpcReporter
  } as IRuntimePeerOptions)
}
