import { createAdapterProcessPeer } from '@migaia/rpc-core/adapter/process'
import type { IRuntimeTypedPeer, IRuntimeFlatten } from '@migaia/rpc-core/remote'
import { RuntimePluginKey } from '@migaia/rpc-core/remote'
import type { IRuntimeProcessPeerOptions } from '@migaia/rpc-core/adapter/process'
import { NativeProcessRuntimeLoader } from './runtime-loader.js'

/** Discover this platform's actual I/O while Core owns the peer and its preparation resources. */
export function createProcessPeer<TRemote = Record<never, never>>(
  options: IRuntimeProcessPeerOptions
): Promise<IRuntimeTypedPeer<TRemote, IRuntimeFlatten<TRemote>, typeof RuntimePluginKey.process>>
/** The loader only selects native modules; it cannot register trust for an arbitrary transport. */
export function createProcessPeer(options: IRuntimeProcessPeerOptions): Promise<object> {
  return createAdapterProcessPeer(options, new NativeProcessRuntimeLoader())
}
