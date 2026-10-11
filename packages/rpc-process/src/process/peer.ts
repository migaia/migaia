import type { IRuntimeProcessPeerOptions } from './runtime-peer.js'
import { prepareAdapterPeer, validateAdapterPeerTimeout } from '@migaia/rpc-core/adapter'
import { RuntimePluginKey, type IRuntimePeerOptions } from '@migaia/rpc-core/remote'
import type { IRuntimeTypedPeer, IRuntimeFlatten } from '@migaia/rpc-core/remote'
import { createProcessSourcePeer } from './runtime-peer.js'
import { createAutomaticProcessPeer } from './automatic-peer.js'
import type { IProcessByteChannel } from './types.js'

/** Native discovery opens the actual runtime I/O, never returns a constructed/trusted Peer DTO. */
export type IAdapterProcessRuntimeIO = Readonly<{
  discover(): Readonly<{ marker: string | undefined; runtime: string }>
  open(): Promise<Readonly<{ channel: IProcessByteChannel; bootstrap?: Uint8Array }>>
}>
/** Loaded native resources retain their original I/O operations. */
export type IAdapterProcessRuntimeModule = Readonly<{ processRuntimeIO: IAdapterProcessRuntimeIO }>
/** The runtime owner retains its real native import Promise. */
export type IAdapterProcessRuntimeLoader = Readonly<{
  load(): Promise<IAdapterProcessRuntimeModule> | undefined
}>

/**
 * The moved runtime factory retains Core preparation while Process owns native discovery/source
 * policy.
 */
export function createAdapterProcessPeer<TRemote = Record<never, never>>(
  options: IRuntimeProcessPeerOptions,
  runtime: IAdapterProcessRuntimeLoader
): Promise<IRuntimeTypedPeer<TRemote, IRuntimeFlatten<TRemote>, typeof RuntimePluginKey.process>>
/** Untyped native construction retains its original operation Promise. */
export function createAdapterProcessPeer(
  options: IRuntimeProcessPeerOptions,
  runtime: IAdapterProcessRuntimeLoader
): Promise<object> {
  /** Local listener addressing is configuration; Core retains genuine default-self/Host provenance. */
  const listener = typeof options.listen === 'object' ? options.listen : undefined
  /** One opaque view carries the same transfer restriction through every source branch. */
  const preparation = prepareAdapterPeer(
    options,
    RuntimePluginKey.process,
    listener
      ? { name: options.self?.name ?? RuntimePluginKey.process, instanceId: listener.offer.peer.id }
      : undefined
  ).withoutTransfer()
  /** Native loading retains the original acquisition promise and discovery ordering. */
  const loaded = runtime.load()
  if (!loaded) return preparation.peer(options as IRuntimePeerOptions)
  return loaded.then((module) => {
    validateAdapterPeerTimeout(options)
    /** Discovery still precedes launch/dial/listen effects. */
    const discovery = module.processRuntimeIO.discover()
    if (
      !discovery.marker &&
      (typeof options.spawn === 'object' ||
        typeof options.connect === 'object' ||
        typeof options.listen === 'object')
    )
      return createProcessSourcePeer(options, discovery.runtime, preparation)
    return createAutomaticProcessPeer(
      options as IRuntimePeerOptions,
      {
        marker: discovery.marker,
        runtime: discovery.runtime,
        open: () => module.processRuntimeIO.open()
      },
      preparation
    )
  })
}

import { NativeProcessRuntimeLoader } from './runtime-loader.js'

/** Discover this platform's actual I/O while Core owns the peer and its preparation resources. */
export function createProcessPeer<TRemote = Record<never, never>>(
  options: IRuntimeProcessPeerOptions
): Promise<IRuntimeTypedPeer<TRemote, IRuntimeFlatten<TRemote>, typeof RuntimePluginKey.process>>
/** The loader only selects native modules; it cannot register trust for an arbitrary transport. */
export function createProcessPeer(options: IRuntimeProcessPeerOptions): Promise<object> {
  return createAdapterProcessPeer(options, new NativeProcessRuntimeLoader())
}
