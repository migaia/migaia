import type { IRuntimeProcessPeerOptions } from './runtime-peer.js'
import { validateAdapterPeerTimeout } from '@migaia/rpc-core/adapter/internal-advanced'
import { RuntimePluginKey, type IRuntimePeerOptions } from '@migaia/rpc-core/remote'
import type { IRuntimeTypedPeer, IRuntimeFlatten } from '@migaia/rpc-core/remote'
import { createProcessSourcePeer } from './runtime-peer.js'
import { createAutomaticProcessPeer } from './automatic-peer.js'
import type { IProcessByteChannel } from './types.js'
import {
  normalizeProcessSources,
  type IProcessShortSourceOptions
} from './adapters/short-source.js'
import { captureProcessTask } from './adapter.js'

/** Native discovery opens the actual runtime I/O, never returns a constructed/trusted Peer DTO. */
export type IAdapterProcessRuntimeIO = Readonly<{
  /** Read native child discovery without opening streams or granting authentication. */
  discover(): Readonly<{ marker: string | undefined; runtime: string }>
  /** Acquire the actual child I/O and optional already-read bootstrap for Core's one handoff. */
  open(): Promise<Readonly<{ channel: IProcessByteChannel; bootstrap?: Uint8Array }>>
}>
/** Loaded native resources retain their original I/O operations. */
export type IAdapterProcessRuntimeModule = Readonly<{ processRuntimeIO: IAdapterProcessRuntimeIO }>
/** The runtime owner retains its real native import Promise. */
export type IAdapterProcessRuntimeLoader = Readonly<{
  /** Return the original optional runtime import Promise; undefined selects Core's source path. */
  load(): Promise<IAdapterProcessRuntimeModule> | undefined
}>

/**
 * The moved runtime factory retains Core preparation while Process owns native discovery/source
 * policy.
 */
export function createAdapterProcessPeer<TRemote = Record<never, never>>(
  options: IRuntimeProcessPeerOptions,
  runtime: IAdapterProcessRuntimeLoader,
  forwarded?: IProcessShortSourceOptions
): Promise<IRuntimeTypedPeer<TRemote, IRuntimeFlatten<TRemote>, typeof RuntimePluginKey.process>>
/** Untyped native construction retains its original operation Promise. */
export function createAdapterProcessPeer(
  options: IRuntimeProcessPeerOptions,
  runtime: IAdapterProcessRuntimeLoader,
  forwarded?: IProcessShortSourceOptions
): Promise<object> {
  /** Local listener addressing is configuration; Core retains genuine default-self/Host provenance. */
  const listener = typeof options.listen === 'object' ? options.listen : undefined
  /** One opaque view carries the same transfer restriction through every source branch. */
  const task = captureProcessTask(
    options,
    listener
      ? { name: options.self?.name ?? RuntimePluginKey.process, instanceId: listener.offer.peer.id }
      : undefined
  )
  /** Complex native sources reuse this task's sole original preparation owner. */
  const preparation = task.preparation
  /** Native loading retains the original acquisition promise and discovery ordering. */
  const loaded = runtime.load()
  if (!loaded)
    return preparation.peer({
      ...options,
      report: options.report ?? defaultRpcReporter
    } as IRuntimePeerOptions)
  return loaded.then((module) => {
    validateAdapterPeerTimeout(options)
    /** Discovery still precedes launch/dial/listen effects. */
    const discovery = module.processRuntimeIO.discover()
    if (
      !discovery.marker &&
      ((options.spawn !== undefined && typeof options.spawn !== 'function') ||
        (options.connect !== undefined && typeof options.connect !== 'function') ||
        (options.listen !== undefined && typeof options.listen !== 'function'))
    )
      return normalizeProcessSources(options, discovery.runtime, preparation, forwarded).then(
        (resolved) => createProcessSourcePeer(resolved, discovery.runtime, task)
      )
    return createAutomaticProcessPeer(
      { ...options, report: options.report ?? defaultRpcReporter } as IRuntimePeerOptions,
      {
        marker: discovery.marker,
        runtime: discovery.runtime,
        open: () => module.processRuntimeIO.open()
      },
      task
    )
  })
}

import { NativeProcessRuntimeLoader } from './runtime-loader.js'
import { defaultRpcReporter } from '@migaia/rpc-core'

/**
 * Open one owned child, borrowed connection, listener, or discovered child endpoint. Native modules
 * load only for the selected runtime. The returned Peer owns its connection resources; closing a
 * connect Peer does not terminate the external process. Invalid source combinations reject before
 * launch/dial/listen, and bootstrap/handshake failures retain their owning error identity.
 */
export function createProcessPeer<TRemote = Record<never, never>>(
  options: IRuntimeProcessPeerOptions
): Promise<IRuntimeTypedPeer<TRemote, IRuntimeFlatten<TRemote>, typeof RuntimePluginKey.process>>
/** The loader only selects native modules; it cannot register trust for an arbitrary transport. */
export function createProcessPeer(options: IRuntimeProcessPeerOptions): Promise<object> {
  return createAdapterProcessPeer(options, new NativeProcessRuntimeLoader())
}
